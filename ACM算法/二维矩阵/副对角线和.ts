// 副对角线和：右上 -> 左下（仅支持方阵）
function getAntiDiagonalSum(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 0) return 0;

  // 校验是否为方阵
  if (!matrix.every((row) => row.length === n)) {
    throw new Error("只有方阵才能计算副对角线");
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += matrix[i][n - 1 - i];
  }

  return sum;
}
