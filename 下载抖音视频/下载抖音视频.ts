/// <reference path="./node-shims.d.ts" />
/// tsx 下载抖音视频.ts --input <抖音链接或ID> --out <保存路径> --timeout <超时时间> --help
import * as fs from "node:fs";
import * as path from "node:path";
import { once } from "node:events";
import * as processModule from "node:process";
import { createInterface } from "node:readline/promises";

const { stdin: input, stdout: output, stderr } = processModule;

const DEFAULT_BASE_URL = "https://www.douyin.com";
const DEFAULT_REFERER = "https://www.douyin.com/";
const DEFAULT_TIMEOUT_MS = 30_000;
const RESOURCE_VIDEO = "video";
const RESOURCE_NOTE = "note";
const RENDER_DATA_START = `<script id="RENDER_DATA" type="application/json">`;
const RENDER_DATA_END = `</script>`;

const SHARE_PATH_PATTERN = /\/((?:video)|(?:note))\/([0-9]+)/;
const QUOTED_JSON_REGEXP = /"([^"]*?(?:playAddr|searchProps|app)[^"]*?)"/g;
const URL_EXTRACT_REGEXP = /https?:\/\/[^\s]+/;
const DIGITS_REGEXP = /^\d+$/;

interface ResolveResult {
  sourceInput: string;
  finalShareURL: string;
  normalizedURL: string;
  resourceType: string;
  awemeID: string;
  title: string;
  coverURL: string;
  downloadURL: string;
  downloadHeaders: Record<string, string>;
}

interface CliArgs {
  inputArg: string;
  outputArg: string;
  timeoutMs: number;
  showHelp: boolean;
}

class DouyinClient {
  constructor(
    private readonly timeoutMs: number,
    private readonly baseURL = DEFAULT_BASE_URL,
    private readonly referer = DEFAULT_REFERER,
  ) {}

  async resolve(rawInput: string): Promise<ResolveResult> {
    const inputValue = normalizeInput(rawInput);
    if (!inputValue) {
      throw new Error("douyin input is empty");
    }

    if (looksLikeMediaURL(inputValue)) {
      return {
        sourceInput: rawInput,
        finalShareURL: inputValue,
        normalizedURL: "",
        resourceType: RESOURCE_VIDEO,
        awemeID: "",
        title: "",
        coverURL: "",
        downloadURL: inputValue,
        downloadHeaders: buildDownloadHeaders(this.referer, ""),
      };
    }

    let finalShareURL = inputValue;
    let { awemeID, resourceType, normalizedURL } = extractAwemeIDFromInput(
      inputValue,
      this.baseURL,
    );
    if (!awemeID) {
      const redirectedURL = await this.resolveRedirectURL(inputValue);
      finalShareURL = redirectedURL;
      ({ awemeID, resourceType, normalizedURL } = extractAwemeIDFromInput(
        redirectedURL,
        this.baseURL,
      ));
      if (!awemeID) {
        throw new Error(`douyin aweme_id not found: ${rawInput}`);
      }
    }

    const html = await this.fetchJingxuanHTML(awemeID);
    const renderDataEncoded = extractRenderDataEncoded(html);
    let renderData: string;
    try {
      renderData = decodeURIComponent(renderDataEncoded);
    } catch (error) {
      throw new Error(`decode render data failed: ${formatError(error)}`);
    }

    const result = buildResolveResult(renderData);
    return {
      ...result,
      sourceInput: rawInput,
      finalShareURL,
      normalizedURL,
      resourceType: firstNonEmpty(result.resourceType, resourceType, RESOURCE_VIDEO),
      awemeID,
      downloadHeaders: buildDownloadHeaders(this.referer, normalizedURL),
    };
  }

  async downloadToPath(
    rawURL: string,
    headers: Record<string, string>,
    savePath: string,
  ): Promise<{ size: number; contentType: string }> {
    const response = await this.fetchResponse(rawURL, headers);
    if (!response.ok) {
      throw new Error(`download douyin video status=${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "").trim();
    if (!isAcceptableVideoContentType(contentType)) {
      throw new Error(
        `download douyin video invalid content_type=${contentType} status=${response.status}`,
      );
    }

    if (!response.body) {
      throw new Error("download douyin video response body is empty");
    }

    await fs.promises.mkdir(path.dirname(savePath), { recursive: true, mode: 0o755 });

    const tempPath = `${savePath}.part`;
    const file = fs.createWriteStream(tempPath, {
      flags: "w",
      mode: 0o664,
    });

    const total = parseContentLength(response.headers.get("content-length"));
    const reader = response.body.getReader();
    const startedAt = Date.now();
    let lastPrintAt = 0;
    let written = 0;
    let success = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }

        written += value.byteLength;
        if (!file.write(value)) {
          await once(file, "drain");
        }

        const now = Date.now();
        if (lastPrintAt === 0 || now - lastPrintAt >= 200) {
          printProgress(written, total, startedAt);
          lastPrintAt = now;
        }
      }

      printProgress(written, total, startedAt);
      output.write("\n");

      await new Promise<void>((resolvePromise, rejectPromise) => {
        file.once("error", rejectPromise);
        file.once("close", resolvePromise);
        file.end();
      });

      await fs.promises.rename(tempPath, savePath);
      success = true;
      return { size: written, contentType };
    } catch (error) {
      output.write("\n");
      file.destroy();
      throw error;
    } finally {
      if (!success) {
        file.destroy();
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private async resolveRedirectURL(rawURL: string): Promise<string> {
    const response = await this.fetchResponse(rawURL, setCommonHeaders(this.referer));
    try {
      if (!response.url) {
        throw new Error(`douyin aweme_id not found: ${rawURL}`);
      }
      return response.url;
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  private async fetchJingxuanHTML(awemeID: string): Promise<string> {
    const requestURL = `${this.baseURL}/jingxuan?modal_id=${encodeURIComponent(awemeID)}`;
    const response = await this.fetchResponse(requestURL, setCommonHeaders(this.referer));
    if (!response.ok) {
      throw new Error(`request douyin jingxuan status=${response.status}`);
    }
    return response.text();
  }

  private async fetchResponse(rawURL: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(rawURL, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request timeout after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(processModule.argv.slice(2));
  if (args.showHelp) {
    printUsage();
    return;
  }

  let inputArg = args.inputArg;
  let outputArg = args.outputArg;

  const rl = createInterface({ input, output });
  try {
    if (!inputArg.trim()) {
      inputArg = (await prompt(rl, "请输入抖音链接或视频ID")).trim();
    }
    if (!outputArg.trim()) {
      outputArg = await prompt(rl, "请输入保存路径(留空默认当前目录)");
    }
  } finally {
    rl.close();
  }

  const client = new DouyinClient(args.timeoutMs);
  const result = await client.resolve(inputArg);
  const savePath = await buildSavePath(result, outputArg);

  console.log(`标题: ${fallbackText(result.title, "(无标题)")}`);
  console.log(`ID: ${fallbackText(result.awemeID, "(未知)")}`);
  console.log(`类型: ${fallbackText(result.resourceType, RESOURCE_VIDEO)}`);
  console.log(`下载地址: ${result.downloadURL}`);
  console.log(`保存到: ${savePath}`);

  const { size, contentType } = await client.downloadToPath(
    result.downloadURL,
    result.downloadHeaders,
    savePath,
  );
  console.log(`下载完成: ${savePath} (${humanBytes(size)}, ${contentType || "未知类型"})`);
}

function parseArgs(argv: string[]): CliArgs {
  let inputArg = "";
  let outputArg = "";
  let timeoutValue = `${DEFAULT_TIMEOUT_MS}ms`;
  let showHelp = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      showHelp = true;
      continue;
    }

    const [flag, inlineValue] = splitFlag(arg);
    if (flag === "-input" || flag === "--input") {
      inputArg = inlineValue ?? argv[index + 1] ?? "";
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }
    if (flag === "-out" || flag === "--out") {
      outputArg = inlineValue ?? argv[index + 1] ?? "";
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }
    if (flag === "-timeout" || flag === "--timeout") {
      timeoutValue = inlineValue ?? argv[index + 1] ?? timeoutValue;
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    positional.push(arg);
  }

  if (!inputArg && positional[0]) {
    inputArg = positional[0];
  }
  if (!outputArg && positional[1]) {
    outputArg = positional[1];
  }

  return {
    inputArg,
    outputArg,
    timeoutMs: parseDuration(timeoutValue),
    showHelp,
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const equalIndex = arg.indexOf("=");
  if (equalIndex < 0) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalIndex), arg.slice(equalIndex + 1)];
}

function parseDuration(text: string): number {
  const value = text.trim().toLowerCase();
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const matched = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!matched) {
    throw new Error(`invalid timeout: ${text}`);
  }

  const amount = Number(matched[1]);
  const unit = matched[2] ?? "ms";
  const multiplierMap: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  };
  return Math.max(1, Math.round(amount * multiplierMap[unit]));
}

async function prompt(rl: ReturnType<typeof createInterface>, label: string): Promise<string> {
  return rl.question(`${label}: `);
}

function printUsage(): void {
  console.log(`用法:
  tsx 下载抖音视频.ts --input <抖音链接或ID> --out <保存路径>

参数:
  -input, --input      抖音分享链接、媒体直链或作品 ID
  -out, --out          保存路径或目录，默认当前目录
  -timeout, --timeout  请求超时，支持 ms/s/m/h，例如 30s
  -h, --help           显示帮助
`);
}

function normalizeInput(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }

  const matchedURL = text.match(URL_EXTRACT_REGEXP)?.[0];
  if (matchedURL) {
    return matchedURL.replace(/[.,;)]*$/, "");
  }
  if (DIGITS_REGEXP.test(text)) {
    return text;
  }
  return text;
}

function extractAwemeIDFromInput(
  rawInput: string,
  baseURL: string,
): { awemeID: string; resourceType: string; normalizedURL: string } {
  const clean = rawInput.trim();
  if (DIGITS_REGEXP.test(clean)) {
    return {
      awemeID: clean,
      resourceType: RESOURCE_VIDEO,
      normalizedURL: `${baseURL.replace(/\/+$/, "")}/${RESOURCE_VIDEO}/${clean}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return { awemeID: "", resourceType: "", normalizedURL: "" };
  }

  const modalID = parsed.searchParams.get("modal_id")?.trim() ?? "";
  if (modalID) {
    return {
      awemeID: modalID,
      resourceType: RESOURCE_VIDEO,
      normalizedURL: `${baseURL.replace(/\/+$/, "")}/${RESOURCE_VIDEO}/${modalID}`,
    };
  }

  const matches = parsed.pathname.match(SHARE_PATH_PATTERN);
  if (!matches) {
    return { awemeID: "", resourceType: "", normalizedURL: "" };
  }

  const resourceType = matches[1] ?? "";
  const awemeID = matches[2] ?? "";
  return {
    awemeID,
    resourceType,
    normalizedURL: `${baseURL.replace(/\/+$/, "")}/${resourceType}/${awemeID}`,
  };
}

function extractRenderDataEncoded(html: string): string {
  const start = html.indexOf(RENDER_DATA_START);
  if (start >= 0) {
    const contentStart = start + RENDER_DATA_START.length;
    const end = html.indexOf(RENDER_DATA_END, contentStart);
    if (end >= 0) {
      return html.slice(contentStart, end);
    }
  }

  for (const match of html.matchAll(QUOTED_JSON_REGEXP)) {
    const candidate = match[1] ?? "";
    if (
      candidate.includes("playAddr") &&
      candidate.includes("searchProps") &&
      candidate.includes("app")
    ) {
      return candidate;
    }
  }

  throw new Error("douyin render data not found");
}

function buildResolveResult(renderData: string): ResolveResult {
  let payload: unknown;
  try {
    payload = JSON.parse(renderData);
  } catch (error) {
    throw new Error(`parse render data failed: ${formatError(error)}`);
  }

  const resourceType = hasValue(payload, "app.noteDetail") ? RESOURCE_NOTE : RESOURCE_VIDEO;
  const result: ResolveResult = {
    sourceInput: "",
    finalShareURL: "",
    normalizedURL: "",
    resourceType,
    awemeID: "",
    title: firstJSONValue(payload, ["app.videoDetail.desc", "app.noteDetail.desc"]),
    coverURL: firstJSONValue(payload, [
      "app.videoDetail.video.cover.urlList.0",
      "app.videoDetail.video.dynamicCover.urlList.0",
      "app.videoDetail.video.originCover.urlList.0",
      "app.noteDetail.video.cover.urlList.0",
      "app.noteDetail.video.dynamicCover.urlList.0",
      "app.noteDetail.video.originCover.urlList.0",
    ]),
    downloadURL: firstJSONValue(payload, [
      "app.videoDetail.video.playAddr.0.src",
      "app.videoDetail.video.playAddr.1.src",
      "app.noteDetail.video.playAddr.0.src",
      "app.noteDetail.video.playAddr.1.src",
    ]),
    downloadHeaders: {},
  };

  if (!result.downloadURL.trim()) {
    throw new Error("douyin video url not found");
  }
  return result;
}

function hasValue(payload: unknown, route: string): boolean {
  return jsonPath(payload, route).ok;
}

function firstJSONValue(payload: unknown, routes: string[]): string {
  for (const route of routes) {
    const { ok, value } = jsonPath(payload, route);
    if (!ok) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return "";
}

function jsonPath(payload: unknown, route: string): { ok: boolean; value?: unknown } {
  let current: unknown = payload;

  for (const part of route.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { ok: false };
      }
      current = current[index];
      continue;
    }

    if (current && typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (!(part in record)) {
        return { ok: false };
      }
      current = record[part];
      continue;
    }

    return { ok: false };
  }

  return { ok: true, value: current };
}

function buildDownloadHeaders(defaultReferer: string, shareURL: string): Record<string, string> {
  const referer = shareURL.trim() || defaultReferer.trim();
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Encoding": "identity",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Connection: "keep-alive",
    Referer: referer,
  };
}

function setCommonHeaders(referer: string): Record<string, string> {
  return {
    ...buildDownloadHeaders(referer, ""),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  };
}

function looksLikeMediaURL(rawURL: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawURL.trim());
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return false;
  }

  return ["douyinvod.com", "aweme.com", "amemv.com", "byteimg.com", "bdxiguaimg.com"].some(
    (keyword) => host.includes(keyword),
  );
}

async function buildSavePath(result: ResolveResult, outputArg: string): Promise<string> {
  const filename = defaultFilename(result);
  const cleanOutput = outputArg.trim();

  if (!cleanOutput) {
    return path.join(processModule.cwd(), filename);
  }

  try {
    const info = await fs.promises.stat(cleanOutput);
    if (info.isDirectory()) {
      return path.join(cleanOutput, filename);
    }
  } catch {
    // Ignore missing path; keep the same heuristics as the Go version.
  }

  if (!path.basename(cleanOutput).includes(".")) {
    return path.join(cleanOutput, filename);
  }
  if (cleanOutput.endsWith(path.sep) || cleanOutput.endsWith("/")) {
    return path.join(cleanOutput, filename);
  }
  return cleanOutput;
}

function defaultFilename(result: ResolveResult): string {
  const base = sanitizeFilename(firstNonEmpty(result.title, result.awemeID, "douyin_video"));
  return `${base}.mp4`;
}

function sanitizeFilename(name: string): string {
  let value = name.trim();
  if (!value) {
    return "douyin_video";
  }

  value = value
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/[\n\r\t]/g, " ")
    .replace(/\s+/g, " ");
  value = truncateRunes(value, 80)
    .trim()
    .replace(/^[ .]+|[ .]+$/g, "");

  return value || "douyin_video";
}

function truncateRunes(value: string, limit: number): string {
  if (limit <= 0) {
    return "";
  }
  return Array.from(value).slice(0, limit).join("");
}

function isAcceptableVideoContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mediaType) {
    return true;
  }
  if (mediaType.startsWith("video/")) {
    return true;
  }
  return ["application/octet-stream", "binary/octet-stream", "application/mp4"].includes(mediaType);
}

function printProgress(written: number, total: number, startedAt: number): void {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const speed = written / elapsedSeconds;

  if (total > 0) {
    const percent = (written / total) * 100;
    output.write(
      `\r进度: ${percent.toFixed(2).padStart(6, " ")}%  ${humanBytes(written)} / ${humanBytes(total)}  速度: ${humanBytes(Math.round(speed))}/s`,
    );
    return;
  }

  output.write(`\r已下载: ${humanBytes(written)}  速度: ${humanBytes(Math.round(speed))}/s`);
}

function parseContentLength(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function humanBytes(bytes: number): string {
  let size = bytes;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function fallbackText(value: string, fallback: string): string {
  return value.trim() ? value : fallback;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

void main().catch((error) => {
  stderr.write(`失败: ${formatError(error)}\n`);
  processModule.exit(1);
});
