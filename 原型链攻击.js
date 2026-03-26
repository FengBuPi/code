// 渲染线程代码
const user1 = getXXXFeature('001');
console.log(user1); // 正常： { name: '张三' }

const user2 = getXXXFeature('__proto__');
// user2 === Object.prototype;
// user2.constructor === Object;
// user2.constructor.__proto__ === Function.prototype;
// user2.constructor.__proto__.constructor === Function;
// user2.constructor.constructor === Function;
console.log(user2.constructor.constructor("console.log('hello')")());
// 主进程代码
function getXXXFeature(hashId) {
  const user = Object.create(null);

  user['001'] = { name: '张三' };
  user['002'] = { name: '李四' };
  user['003'] = { name: '王五' };

  return Object.hasOwn(user, hashId) ? user[hashId] : undefined;
}

