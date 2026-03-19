/**
 * 矩阵转置
 * @param matrix 二维数字矩阵
 * @returns 转置后的矩阵
 */
function transposeMatrix(matrix: number[][]): number[][] {
  // 1. 获取原始矩阵的 行数 和 列数
  const rows = matrix.length;
  const cols = matrix[0].length;

  // 2. 创建新矩阵：结构是 cols 行，rows 列
  // 原来 m行n列 → 现在 n行m列
  const result: number[][] = Array.from({ length: cols }, () => []);

  // 3. 核心：遍历【列】，再遍历【行】
  for (let i = 0; i < cols; i++) {
    // i = 新行 = 原列
    for (let j = 0; j < rows; j++) {
      // j = 新列 = 原行
      result[i][j] = matrix[j][i];
    }
  }

  return result;
}

console.log(
  transposeMatrix([
    [1, 2, 3],
    [4, 5, 6],
  ]),
);
// [[1, 4], [2, 5], [3, 6]]
