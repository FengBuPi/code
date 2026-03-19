/**
 * 顺时针遍历矩阵所有元素并求和
 * @param matrix 二维数字矩阵
 * @returns 顺时针累加的和
 */
function clockwiseSum(matrix: number[][]): number {
  if (!matrix.length || !matrix[0].length) return 0;

  // 定义四个边界
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;

  let sum = 0;

  while (true) {
    // 1. 左 → 右（顶部行）
    for (let i = left; i <= right; i++) sum += matrix[top][i];
    top++;
    if (top > bottom) break;

    // 2. 上 → 下（右侧列）
    for (let i = top; i <= bottom; i++) sum += matrix[i][right];
    right--;
    if (left > right) break;

    // 3. 右 → 左（底部行）
    for (let i = right; i >= left; i--) sum += matrix[bottom][i];
    bottom--;
    if (top > bottom) break;

    // 4. 下 → 上（左侧列）
    for (let i = bottom; i >= top; i--) sum += matrix[i][left];
    left++;
    if (left > right) break;
  }

  return sum;
}
