type Matrix = number[][];
// 创建 m 行 n 列的零矩阵
const createMatrix = (m: number, n: number): Matrix => {
  return Array.from({ length: m }, () => Array(n).fill(0));
};
const matrix = createMatrix(10, 10);
console.log(matrix);
