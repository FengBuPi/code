/**
 * 求矩阵每一行的和
 * @param matrix 二维数字矩阵
 * @returns 每一行的和
 */
function getRowSum(matrix: number[][]): number[] {
  return matrix.map((row) => row.reduce((sum, num) => sum + num, 0));
}

console.log(
  getRowSum([
    [1, 2],
    [3, 4],
  ]),
);
