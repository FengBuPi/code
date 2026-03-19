// 主对角线和：左上 -> 右下
function getMainDiagonalSum(matrix: number[][]): number {
  if (!matrix.length) return 0;

  const rows = matrix.length;
  const cols = matrix[0].length;

  // 取较小值，避免越界
  const size = Math.min(rows, cols);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    sum += matrix[i][i];
  }

  return sum;
}
