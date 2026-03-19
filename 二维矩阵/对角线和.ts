// 对角线和：左上 -> 右下 和 右上 -> 左下
function getDiagonalSum(matrix: number[][]): number {
  if (!matrix.length) return 0;

  const rows = matrix.length;
  const cols = matrix[0].length;

  // 取较小值，避免越界
  const size = Math.min(rows, cols);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    // 左上 -> 右下 i = j
    sum += matrix[i][i];
    // 右上 -> 左下 i + j = n -1
    sum += matrix[i][cols - 1 - i];
  }

  return sum;
}

console.log(
  getDiagonalSum([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]),
);
