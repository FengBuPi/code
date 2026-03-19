/**
 * 求二维矩阵所有元素的和
 * @param matrix 二维数字矩阵
 * @returns 所有元素的和
 */
function getMatrixSum(matrix: number[][]): number {
  let sum = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      sum += matrix[i][j];
    }
  }
  return sum;
}

console.log(
  getMatrixSum([
    [1, 2],
    [3, 4],
  ]),
);
