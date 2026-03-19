// ==UserScript==
// @name         单页表单自动填写助手
// @namespace    https://local.form.autofill
// @version      1.0.0
// @description  基于控件顺序的表单自动填写油猴脚本，支持配置面板、JSON 导入导出和可选自动提交。
// @author       Codex
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG_KEY = "form_autofill_config_v1";
  const LOG_PREFIX = "[form-autofill]";
  const DEFAULT_CONFIG = {
    pageRule: {
      urlPattern: "https://example.com/form/*",
      autoRun: true,
      submitMode: "manual",
      submitDelayMs: 1500,
    },
    fields: [
      { index: 1, type: "text", label: "第1项", value: "ZHANG" },
      { index: 2, type: "text", label: "第2项", value: "San" },
      { index: 3, type: "text", label: "第3项", value: "20250001" },
      { index: 7, type: "radio", label: "第7项", value: "China (Mainland)" },
    ],
  };
  const STATE = {
    config: null,
    panel: null,
    launcher: null,
    statusNode: null,
    observer: null,
    autoRunStarted: false,
  };

  function gmGetValue(key, fallback) {
    if (typeof GM_getValue === "function") {
      return GM_getValue(key, fallback);
    }
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(LOG_PREFIX, "parse localStorage failed", error);
      return fallback;
    }
  }

  function gmSetValue(key, value) {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function log(level, message, payload) {
    const method = console[level] || console.log;
    if (payload === undefined) {
      method(LOG_PREFIX, message);
      return;
    }
    method(LOG_PREFIX, message, payload);
  }

  function showStatus(message, tone) {
    if (!STATE.statusNode) {
      const node = document.createElement("div");
      node.id = "tm-form-autofill-status";
      node.style.cssText = [
        "position:fixed",
        "right:16px",
        "bottom:16px",
        "z-index:2147483647",
        "max-width:320px",
        "padding:10px 14px",
        "border-radius:10px",
        "background:#1f2937",
        "color:#fff",
        "font-size:13px",
        "line-height:1.5",
        "box-shadow:0 12px 30px rgba(0,0,0,.18)",
        "opacity:0",
        "transform:translateY(8px)",
        "transition:opacity .2s ease, transform .2s ease",
        "pointer-events:none",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      ].join(";");
      document.body.appendChild(node);
      STATE.statusNode = node;
    }

    const colors = {
      info: "#1f2937",
      success: "#0f766e",
      warning: "#b45309",
      error: "#b91c1c",
    };
    STATE.statusNode.textContent = message;
    STATE.statusNode.style.background = colors[tone] || colors.info;
    STATE.statusNode.style.opacity = "1";
    STATE.statusNode.style.transform = "translateY(0)";

    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => {
      if (!STATE.statusNode) return;
      STATE.statusNode.style.opacity = "0";
      STATE.statusNode.style.transform = "translateY(8px)";
    }, 3600);
  }

  function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function normalizeField(field, fallbackIndex) {
    const index = Number(field && field.index);
    return {
      index: Number.isFinite(index) && index > 0 ? Math.floor(index) : fallbackIndex,
      type: normalizeType(field && field.type),
      label: String((field && field.label) || `第${fallbackIndex}项`),
      value: field && field.value != null ? String(field.value) : "",
    };
  }

  function normalizeType(type) {
    const valid = ["text", "select", "radio", "checkbox", "date"];
    return valid.includes(type) ? type : "text";
  }

  function normalizeConfig(raw) {
    const config = cloneDefaultConfig();
    const input = raw && typeof raw === "object" ? raw : {};
    const pageRule = input.pageRule && typeof input.pageRule === "object" ? input.pageRule : {};
    const fields = Array.isArray(input.fields) ? input.fields : config.fields;

    config.pageRule.urlPattern = String(pageRule.urlPattern || config.pageRule.urlPattern).trim();
    config.pageRule.autoRun = pageRule.autoRun !== false;
    config.pageRule.submitMode = pageRule.submitMode === "auto" ? "auto" : "manual";
    const delay = Number(pageRule.submitDelayMs);
    config.pageRule.submitDelayMs = Number.isFinite(delay) && delay >= 0 ? delay : config.pageRule.submitDelayMs;
    config.fields = fields.map((field, index) => normalizeField(field, index + 1));
    config.fields.sort((a, b) => a.index - b.index);

    return config;
  }

  function loadConfig() {
    const stored = gmGetValue(CONFIG_KEY, null);
    return normalizeConfig(stored || DEFAULT_CONFIG);
  }

  function saveConfig(config) {
    const normalized = normalizeConfig(config);
    gmSetValue(CONFIG_KEY, normalized);
    STATE.config = normalized;
    log("info", "config saved", normalized);
    return normalized;
  }

  function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }

  function isPageMatched(config) {
    const pattern = config.pageRule.urlPattern;
    if (!pattern) return false;
    try {
      return wildcardToRegExp(pattern).test(window.location.href);
    } catch (error) {
      log("error", "invalid urlPattern", { pattern, error });
      return false;
    }
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute("disabled") != null);
  }

  function getRootContainer(element) {
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 4) {
      if (current.tagName === "FIELDSET" || current.getAttribute("role") === "radiogroup" || current.getAttribute("role") === "group") {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    return element.parentElement || element;
  }

  function collectControls() {
    // 只依赖页面上可交互控件的自然渲染顺序，不依赖业务 DOM 标识。
    const nodes = Array.from(document.querySelectorAll("input, select, textarea"));
    const controls = [];
    const seenGroupKeys = new Set();

    for (const node of nodes) {
      if (!isElementVisible(node) || isDisabled(node)) {
        continue;
      }

      const tag = node.tagName.toLowerCase();
      const type = (node.getAttribute("type") || "").toLowerCase();

      if (tag === "select") {
        controls.push({ type: "select", element: node });
        continue;
      }

      if (tag === "textarea") {
        controls.push({ type: "text", element: node });
        continue;
      }

      if (tag === "input") {
        if (["hidden", "submit", "button", "image", "file", "reset", "range", "color"].includes(type)) {
          continue;
        }

        if (type === "radio" || type === "checkbox") {
          const root = getRootContainer(node);
          const name = node.getAttribute("name") || "";
          const groupKey = `${type}::${name}::${getElementPath(root)}`;
          if (seenGroupKeys.has(groupKey)) {
            continue;
          }
          const options = collectGroupedOptions(type, name, root, node);
          if (!options.length) {
            continue;
          }
          seenGroupKeys.add(groupKey);
          controls.push({ type, options, element: root });
          continue;
        }

        if (type === "date") {
          controls.push({ type: "date", element: node });
          continue;
        }

        if (["text", "tel", "email", "number", "search", "url", "password", ""].includes(type)) {
          controls.push({ type: "text", element: node });
        }
      }
    }

    return controls;
  }

  function collectGroupedOptions(type, name, root, seed) {
    let selector = `input[type="${type}"]`;
    if (name) {
      selector += `[name="${cssEscape(name)}"]`;
    }
    const pool = Array.from((root || document).querySelectorAll(selector)).filter((element) => {
      return isElementVisible(element) && !isDisabled(element);
    });
    if (!pool.length && seed) {
      return [buildOptionDescriptor(seed, 0)];
    }
    return pool.map((element, index) => buildOptionDescriptor(element, index)).filter(Boolean);
  }

  function buildOptionDescriptor(element, index) {
    if (!element) return null;
    const id = element.id;
    let text = "";
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) {
        text = label.textContent || "";
      }
    }
    if (!text) {
      const wrapperLabel = element.closest("label");
      if (wrapperLabel) {
        text = wrapperLabel.textContent || "";
      }
    }
    if (!text) {
      const root = getRootContainer(element);
      text = root && root !== element ? root.textContent || "" : "";
    }
    return {
      index,
      element,
      text: compactText(text),
      value: String(element.value || ""),
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function compactText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function getElementPath(element) {
    if (!element || !(element instanceof HTMLElement)) return "unknown";
    const parts = [];
    let current = element;
    let depth = 0;
    while (current && depth < 3) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
      } else if (current.className && typeof current.className === "string") {
        const className = current.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (className) {
          part += `.${className}`;
        }
      }
      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(">");
  }

  function describeControls(controls) {
    return controls.map((item, index) => ({
      index: index + 1,
      type: item.type,
      optionCount: item.options ? item.options.length : undefined,
    }));
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchFormEvents(element) {
    // 主动补发常见表单事件，兼容 React/Vue 这类依赖事件同步状态的表单。
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function fillTextLike(control, value) {
    setNativeValue(control.element, value);
    dispatchFormEvents(control.element);
  }

  function fillSelect(control, value) {
    const select = control.element;
    const target = String(value).trim().toLowerCase();
    let matched = Array.from(select.options).find((option) => compactText(option.textContent).toLowerCase() === target);
    if (!matched) {
      matched = Array.from(select.options).find((option) => String(option.value).trim().toLowerCase() === target);
    }
    if (!matched) {
      throw new Error(`未找到匹配的下拉选项: ${value}`);
    }
    select.value = matched.value;
    dispatchFormEvents(select);
  }

  function fillChoice(control, value) {
    const raw = String(value).trim();
    if (control.type === "radio") {
      const lowered = raw.toLowerCase();
      let targetOption = control.options.find((option) => option.text.toLowerCase() === lowered || option.value.toLowerCase() === lowered);
      if (!targetOption && /^\d+$/.test(raw)) {
        const index = Number(raw) - 1;
        targetOption = control.options[index];
      }
      if (!targetOption) {
        throw new Error(`未找到匹配的单选项: ${value}`);
      }
      targetOption.element.click();
      dispatchFormEvents(targetOption.element);
      return;
    }

    const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
    const selected = values.length > 1 ? values : [raw];
    const normalizedSelected = selected.map((item) => item.toLowerCase());
    let matchedAny = false;

    for (const option of control.options) {
      const shouldCheck =
        normalizedSelected.includes(option.text.toLowerCase()) ||
        normalizedSelected.includes(option.value.toLowerCase()) ||
        normalizedSelected.includes(String(option.index + 1));
      if (option.element.checked !== shouldCheck) {
        option.element.click();
        dispatchFormEvents(option.element);
      }
      if (shouldCheck) matchedAny = true;
    }

    if (!matchedAny) {
      throw new Error(`未找到匹配的复选框选项: ${value}`);
    }
  }

  function fillControl(control, field) {
    // 配置项与顺序采集结果按索引一一对应，再根据控件类型走不同填写策略。
    switch (control.type) {
      case "text":
      case "date":
        fillTextLike(control, field.value);
        return;
      case "select":
        fillSelect(control, field.value);
        return;
      case "radio":
      case "checkbox":
        fillChoice(control, field.value);
        return;
      default:
        throw new Error(`不支持的控件类型: ${control.type}`);
    }
  }

  function findSubmitButton() {
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:not([type])',
    ];
    for (const selector of selectors) {
      const button = Array.from(document.querySelectorAll(selector)).find((element) => isElementVisible(element) && !isDisabled(element));
      if (button) return button;
    }
    return null;
  }

  async function runAutofill() {
    if (STATE.autoRunStarted) {
      return;
    }
    STATE.autoRunStarted = true;
    showStatus("采集中...", "info");

    try {
      const controls = await waitForControls();
      log("info", "page matched", { url: window.location.href, pattern: STATE.config.pageRule.urlPattern });
      log("info", "collected controls", describeControls(controls));

      const warnings = [];
      let successCount = 0;

      for (const field of STATE.config.fields) {
        if (!String(field.value).trim()) {
          warnings.push(`第${field.index}项配置为空，已跳过`);
          continue;
        }

        const control = controls[field.index - 1];
        if (!control) {
          warnings.push(`第${field.index}项超出页面控件范围`);
          continue;
        }
        if (control.type !== field.type) {
          warnings.push(`第${field.index}项类型不匹配，页面为 ${control.type}，配置为 ${field.type}`);
          continue;
        }

        try {
          fillControl(control, field);
          successCount += 1;
          log("info", "field filled", field);
        } catch (error) {
          warnings.push(`第${field.index}项填写失败: ${error.message}`);
          log("warn", "field fill failed", { field, error });
        }
      }

      if (!successCount) {
        showStatus("未完成填写，请查看控制台日志", "warning");
      } else if (warnings.length) {
        showStatus(`部分失败，成功 ${successCount} 项`, "warning");
      } else {
        showStatus(`填写完成，共 ${successCount} 项`, "success");
      }

      warnings.forEach((message) => log("warn", message));

      if (STATE.config.pageRule.submitMode === "auto") {
        const submitButton = findSubmitButton();
        if (!submitButton) {
          const message = "未找到提交按钮，无法自动提交";
          log("error", message);
          showStatus(message, "error");
          return;
        }
        window.setTimeout(() => {
          submitButton.click();
          log("info", "form submitted automatically");
          showStatus("已自动提交", "success");
        }, STATE.config.pageRule.submitDelayMs);
      }
    } catch (error) {
      log("error", "autofill failed", error);
      showStatus(`填写失败: ${error.message}`, "error");
    }
  }

  function waitForControls() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timeoutMs = 10000;
      const maxConfiguredIndex = STATE.config.fields.reduce((max, field) => Math.max(max, Number(field.index) || 0), 0);
      const minControls = Math.max(1, maxConfiguredIndex);

      function check() {
        // 页面可能是异步渲染，持续观测直到目标顺序范围内的控件都出现或超时。
        const controls = collectControls();
        if (controls.length >= minControls) {
          cleanup();
          resolve(controls);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          reject(new Error(`控件加载超时，仅发现 ${controls.length} 个控件`));
        }
      }

      function cleanup() {
        if (STATE.observer) {
          STATE.observer.disconnect();
          STATE.observer = null;
        }
        window.clearInterval(timer);
      }

      const timer = window.setInterval(check, 500);
      STATE.observer = new MutationObserver(check);
      STATE.observer.observe(document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    GM_registerMenuCommand("打开表单配置", openPanel);
    GM_registerMenuCommand("导出 JSON 配置", exportConfig);
    GM_registerMenuCommand("导入 JSON 配置", importConfig);
    GM_registerMenuCommand("清空当前配置", resetConfig);
  }

  function exportConfig() {
    const text = JSON.stringify(STATE.config, null, 2);
    window.prompt("复制以下 JSON 配置", text);
  }

  function importConfig() {
    const input = window.prompt("粘贴 JSON 配置");
    if (!input) return;

    try {
      const parsed = JSON.parse(input);
      saveConfig(parsed);
      showStatus("配置已导入", "success");
      renderPanel();
    } catch (error) {
      log("error", "import config failed", error);
      showStatus(`导入失败: ${error.message}`, "error");
    }
  }

  function resetConfig() {
    const confirmed = window.confirm("确定清空当前配置并恢复默认值吗？");
    if (!confirmed) return;
    saveConfig(cloneDefaultConfig());
    showStatus("已恢复默认配置", "success");
    renderPanel();
  }

  function openPanel() {
    if (!STATE.panel) {
      STATE.panel = createPanel();
      document.body.appendChild(STATE.panel);
    }
    renderPanel();
    STATE.panel.style.display = "flex";
  }

  function closePanel() {
    if (STATE.panel) {
      STATE.panel.style.display = "none";
    }
  }

  function ensureLauncher() {
    if (STATE.launcher) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "配置";
    button.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:72px",
      "z-index:2147483645",
      "border:none",
      "border-radius:999px",
      "padding:10px 14px",
      "background:#2563eb",
      "color:#fff",
      "font-size:13px",
      "font-weight:600",
      "box-shadow:0 12px 24px rgba(37,99,235,.28)",
      "cursor:pointer",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");
    button.addEventListener("click", openPanel);
    document.body.appendChild(button);
    STATE.launcher = button;
  }

  function createPanel() {
    const overlay = document.createElement("div");
    overlay.id = "tm-form-autofill-panel";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483646",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "background:rgba(15,23,42,.55)",
      "padding:24px",
      "box-sizing:border-box",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");
    overlay.innerHTML = `
      <div style="width:min(960px, 100%); max-height:90vh; overflow:auto; background:#fff; border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,.2);">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 22px; border-bottom:1px solid #e5e7eb;">
          <div>
            <div style="font-size:20px; font-weight:700; color:#111827;">表单自动填写配置</div>
            <div style="font-size:13px; color:#6b7280; margin-top:4px;">按“顺序 + 控件类型 + 预填值”维护即可。</div>
          </div>
          <button data-role="close" style="border:none; background:#f3f4f6; color:#111827; border-radius:10px; padding:8px 12px; cursor:pointer;">关闭</button>
        </div>
        <div style="padding:20px 22px;">
          <div style="display:grid; grid-template-columns:1fr 180px 180px; gap:12px; margin-bottom:18px;">
            <label style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#374151;">
              URL 匹配规则
              <input data-role="urlPattern" type="text" style="padding:10px 12px; border:1px solid #d1d5db; border-radius:10px;" />
            </label>
            <label style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#374151;">
              自动运行
              <select data-role="autoRun" style="padding:10px 12px; border:1px solid #d1d5db; border-radius:10px;">
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </select>
            </label>
            <label style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#374151;">
              提交模式
              <select data-role="submitMode" style="padding:10px 12px; border:1px solid #d1d5db; border-radius:10px;">
                <option value="manual">仅填写不提交</option>
                <option value="auto">填写后自动提交</option>
              </select>
            </label>
          </div>
          <div style="display:grid; grid-template-columns:180px 1fr; gap:12px; margin-bottom:20px;">
            <label style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#374151;">
              自动提交延时(ms)
              <input data-role="submitDelayMs" type="number" min="0" style="padding:10px 12px; border:1px solid #d1d5db; border-radius:10px;" />
            </label>
            <div style="padding:10px 12px; background:#f9fafb; border-radius:12px; color:#4b5563; font-size:13px; line-height:1.6;">
              配置说明：索引从 1 开始，对应页面上第 1 个、第 2 个可填写控件。单选/复选的值优先按选项文本匹配，匹配不到时可填数字索引。
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div style="font-weight:700; color:#111827;">字段列表</div>
            <div style="display:flex; gap:8px;">
              <button data-role="addField" style="border:none; background:#2563eb; color:#fff; border-radius:10px; padding:9px 14px; cursor:pointer;">新增字段</button>
              <button data-role="save" style="border:none; background:#059669; color:#fff; border-radius:10px; padding:9px 14px; cursor:pointer;">保存配置</button>
            </div>
          </div>
          <div data-role="fieldsWrap"></div>
        </div>
      </div>
    `;

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });

    overlay.querySelector('[data-role="close"]').addEventListener("click", closePanel);
    overlay.querySelector('[data-role="addField"]').addEventListener("click", () => {
      STATE.config.fields.push({
        index: STATE.config.fields.length + 1,
        type: "text",
        label: `第${STATE.config.fields.length + 1}项`,
        value: "",
      });
      renderPanel();
    });
    overlay.querySelector('[data-role="save"]').addEventListener("click", savePanelConfig);

    return overlay;
  }

  function renderPanel() {
    if (!STATE.panel) return;
    const config = STATE.config;
    STATE.panel.querySelector('[data-role="urlPattern"]').value = config.pageRule.urlPattern;
    STATE.panel.querySelector('[data-role="autoRun"]').value = String(config.pageRule.autoRun);
    STATE.panel.querySelector('[data-role="submitMode"]').value = config.pageRule.submitMode;
    STATE.panel.querySelector('[data-role="submitDelayMs"]').value = String(config.pageRule.submitDelayMs);

    const wrap = STATE.panel.querySelector('[data-role="fieldsWrap"]');
    wrap.innerHTML = "";

    config.fields.forEach((field, index) => {
      const row = document.createElement("div");
      row.style.cssText = "display:grid; grid-template-columns:90px 120px 160px 1fr 90px; gap:10px; margin-bottom:10px; align-items:center;";
      row.innerHTML = `
        <input data-name="index" type="number" min="1" value="${escapeHtml(String(field.index))}" style="padding:9px 10px; border:1px solid #d1d5db; border-radius:10px;" />
        <select data-name="type" style="padding:9px 10px; border:1px solid #d1d5db; border-radius:10px;">
          ${["text", "select", "radio", "checkbox", "date"]
            .map((type) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${type}</option>`)
            .join("")}
        </select>
        <input data-name="label" type="text" value="${escapeHtml(field.label)}" style="padding:9px 10px; border:1px solid #d1d5db; border-radius:10px;" />
        <input data-name="value" type="text" value="${escapeHtml(field.value)}" style="padding:9px 10px; border:1px solid #d1d5db; border-radius:10px;" />
        <button data-role="remove" data-index="${index}" style="border:none; background:#ef4444; color:#fff; border-radius:10px; padding:9px 10px; cursor:pointer;">删除</button>
      `;
      wrap.appendChild(row);
    });

    wrap.querySelectorAll('[data-role="remove"]').forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.getAttribute("data-index"));
        STATE.config.fields.splice(index, 1);
        renderPanel();
      });
    });
  }

  function savePanelConfig() {
    if (!STATE.panel) return;

    const pageRule = {
      urlPattern: STATE.panel.querySelector('[data-role="urlPattern"]').value.trim(),
      autoRun: STATE.panel.querySelector('[data-role="autoRun"]').value === "true",
      submitMode: STATE.panel.querySelector('[data-role="submitMode"]').value === "auto" ? "auto" : "manual",
      submitDelayMs: Number(STATE.panel.querySelector('[data-role="submitDelayMs"]').value || 0),
    };

    const rows = Array.from(STATE.panel.querySelectorAll('[data-role="fieldsWrap"] > div'));
    const fields = rows.map((row, index) => ({
      index: Number(row.querySelector('[data-name="index"]').value || index + 1),
      type: normalizeType(row.querySelector('[data-name="type"]').value),
      label: row.querySelector('[data-name="label"]').value.trim() || `第${index + 1}项`,
      value: row.querySelector('[data-name="value"]').value,
    }));

    saveConfig({ pageRule, fields });
    showStatus("配置已保存", "success");
    closePanel();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function init() {
    STATE.config = loadConfig();
    registerMenus();
    log("info", "config loaded", STATE.config);

    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", ensureLauncher, { once: true });
    } else {
      ensureLauncher();
    }

    if (!isPageMatched(STATE.config)) {
      log("info", "page not matched", { url: window.location.href, pattern: STATE.config.pageRule.urlPattern });
      return;
    }

    if (!STATE.config.pageRule.autoRun) {
      showStatus("已命中页面，但当前配置关闭了自动运行", "info");
      return;
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
      runAutofill();
    } else {
      window.addEventListener("DOMContentLoaded", runAutofill, { once: true });
    }
  }

  init();
})();
