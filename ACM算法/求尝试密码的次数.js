/**
 * 小美准备登录美团，需要输入密码，小美忘记了密码，只记得密码可能是n 个字符串中的一个。
 * 小美会按照密码的长度从小到大依次尝试每个字符串，对于相同长度的字符串，小美随机尝试，并且相同的密码只会尝试一次。
 * 小美想知道，她最少需要尝试多少次才能登录成功，最多需要尝试多少次才能登录成功。
 * 小美不会重新尝试已经尝试过的字符串。成功登录后会立即停止尝试。
 * 输入例子：
 * 4
 * ab
 * abc
 * ab
 * ac
 * ac
 * 输出例子：
 * 1 2
 * 例子说明：
 * 小美可能按照 ["ab", "ac", "abc"] 的顺序尝试，第一次尝试成功，也可能按照 ["ac", "ab", "abc"] 的顺序尝试，第二次尝试成功。
 * 小美在尝试 "ac" 发现不正确后不会继续尝试 "ac"。
 */

// 没做出来
const rl = require("readline").createInterface({ input: process.stdin });
var iter = rl[Symbol.asyncIterator]();
const readline = async () => (await iter.next()).value;

void async function () {
    // Write your code here
    // while (line = await readline()) {
    //     let tokens = line.split(' ');
    //     let a = parseInt(tokens[0]);
    //     let b = parseInt(tokens[1]);
    //     console.log(a + b);
    // }
    len = await readline() // 次数
    res = await readline() // 正确密码
    pws = []; // 小美记得的所有密码
    for (let i = 0; i < len; i++) {
        pws.push(await readline())
    }
    pws = [...new Set(pws)].sort((a, b) => a.length - b.length) // 去重并排序,保证不重复测试密码
    let maxCout = 0; // 记录长度小于或等于正确密码长度的元素
    let minCout = 0; // 记录长度小于正确密码长度的元素
    for (const item of pws) {
        // 当当前元素的长度大于正确密码的长度就跳过本次循环
        if (item.length > res.length) {
            continue;
        }

        // 如果当前元素的长度小于等于正确密码的长度就记录加一,求得最大值
        if (item.length <= res.length) {
            maxCout++
        }

        // 如果当前值的长度等于正确密码的长度减一就记录加一,求的最小值
        if (item.length === res.length - 1) {
            minCout++
        }
    }
    console.log(minCout, maxCout)
}()