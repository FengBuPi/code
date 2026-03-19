/**
 * 最终优化版：
 * 1. 提前处理单字“拾/佰/仟”，直接返回结果
 * 2. 遍历中处理“拾伍/佰零玖”等无前置数字场景
 * 3. 零作为分隔符，遇到零就分组相加
 */
function chineseToNumberFinal(chineseStr: string): number {
  // 基础映射
  const digitMap: Record<string, number> = {
    零: 0,
    壹: 1,
    一: 1,
    贰: 2,
    二: 2,
    叁: 3,
    三: 3,
    肆: 4,
    四: 4,
    伍: 5,
    五: 5,
    陆: 6,
    六: 6,
    柒: 7,
    七: 7,
    捌: 8,
    八: 8,
    玖: 9,
    九: 9,
  };

  const unitMap: Record<string, number> = {
    拾: 10,
    十: 10,
    佰: 100,
    百: 100,
    仟: 1000,
    千: 1000,
    万: 10000,
    亿: 100000000,
  };

  // ========== 核心优化：提前处理单字“拾/佰/仟” ==========
  if (chineseStr.length === 1) {
    // 单字数字（零/壹/贰...）
    if (digitMap[chineseStr] !== undefined) {
      return digitMap[chineseStr];
    }
    // 单字单位（拾/佰/仟）
    else if (unitMap[chineseStr] !== undefined) {
      return unitMap[chineseStr];
    }
  }

  // ========== 多字符场景处理 ==========
  let total = 0; // 最终总和
  let currentGroup = 0; // 当前组合（零分隔前的一组）
  let currentNum = 0; // 当前数字

  for (const char of chineseStr) {
    // 1. 零：分隔组合，提前相加
    if (char === "零") {
      total += currentGroup;
      currentGroup = 0;
      currentNum = 0;
      continue;
    }

    // 2. 普通数字
    if (digitMap[char] !== undefined) {
      currentNum = digitMap[char];
    }

    // 3. 单位（拾/佰/仟/万/亿）
    else if (unitMap[char] !== undefined) {
      const unitVal = unitMap[char];

      // 处理多字符场景的无前置数字（如“拾伍”“佰零玖”）
      if (currentNum === 0 && (unitVal === 10 || unitVal === 100 || unitVal === 1000)) {
        currentNum = 1;
      }

      // 小单位：累加到当前组合
      if (unitVal === 10 || unitVal === 100 || unitVal === 1000) {
        currentGroup += currentNum * unitVal;
        currentNum = 0;
      }
      // 大单位：合并到总和
      else {
        currentGroup = (currentGroup + currentNum) * unitVal;
        total += currentGroup;
        currentGroup = 0;
        currentNum = 0;
      }
    }
  }

  // 兜底：处理末尾无零的剩余值
  total += currentGroup + currentNum;

  return total;
}

// 测试验证：
console.log(chineseToNumberFinal("拾")); // 10（提前处理）
console.log(chineseToNumberFinal("佰")); // 100（提前处理）
console.log(chineseToNumberFinal("仟")); // 1000（提前处理）
console.log(chineseToNumberFinal("拾伍")); // 15（遍历中处理）
console.log(chineseToNumberFinal("佰零玖")); // 109（遍历中处理）
console.log(chineseToNumberFinal("壹仟零壹")); // 1001（零分隔）
console.log(chineseToNumberFinal("壹万零壹")); // 10001（零分隔）
console.log(chineseToNumberFinal("亿")); // 100000000（提前处理）
