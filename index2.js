// 使用一次反转1到0或者不使用
// 求最后数组最大的空格长度

// 思路,寻找到当前数组中最长的"空格",在最长的空格的第一个0的前一个或者最后一个0看是否能施加魔法
// 都不能,说明已经找到了最长的空格


const rl = require("readline").createInterface({ input: process.stdin });
let iter = rl[Symbol.asyncIterator]();
const readline = async () => (await iter.next()).value;
(async () => {
  const value = await readline()
  console.log("readline", value)
})()
// void async function () {
//   // Write your code here
//   // let number = readline();
//   // while (line = await readline()) {
//   //   let tokens = line.split(' ');
//   //   let n = parseInt(tokens[0]);
//   //   let arr = parseInt(tokens[1]);
//   getMax()
//   // }
// }()

// async function getMax() {
//   // let t = parseInt(prompt());
//   let line = await readline();
//   console.log(number)
//   for (let i = 0; i < number; i++) {
//     let tokens = line.split(' ');
//     let n = parseInt(tokens[0]);
//     let arr = parseInt(tokens[1]);
//     // let n = parseInt(prompt()); // 获取数组长度
//     // let arr = prompt()?.split(' ').map(Number)
//     let b = new Array(n + 1).fill(0);
//     let c = new Array(n + 1).fill(0);

//     let count = 0;
//     let maxNumber = 0;

//     // 正向统计
//     for (let j = 0; j < n; j++) {
//       if (arr[j] === 0) {
//         count++
//       } else {
//         maxNumber = Math.max(maxNumber, count)
//         count = 0;
//       }
//       b[j] = count
//     }
//     maxNumber = Math.max(maxNumber, count)
//     count = 0;

//     // 反向统计
//     for (let j = n - 1; j >= 0; j--) {
//       if (arr[j] === 0) {
//         count++
//       } else {
//         count = 0;
//       }
//       c[j] = count;
//     }
//     //计算最大值
//     let max = 0;
//     if (arr[0] === 0) {
//       max = 1
//     }

//     for (let j = 1; j < n; j++) {
//       if (arr[j] === 1) {
//         max = Math.max(max, b[j - 1] + c[j + 1] + 1);
//       }
//     }

//     // 结果为
//     console.log(Math.max(max, maxNumber))
//   }
// }

// getMax(4, [0, 1, 1, 0])