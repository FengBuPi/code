export class PubSub<T = string> {
  subscribers: Map<T, Function>;

  constructor() {
    // 存储每个事件及其对应的回调函数
    this.subscribers = new Map();
  }

  // 订阅方法：添加一个新的回调函数到指定的事件
  subscribe(event: T, callback: Function) {
    !this.subscribers.has(event) && this.subscribers.set(event, callback);
  }

  // 发布方法：对指定事件执行所有注册的回调，并传递给定的数据
  publish(event: T, ...args: any) {
    this.subscribers.has(event) && this.subscribers.get(event)!(...args);
  }

  // 取消订阅方法：移除一个特定事件
  unsubscribe(event: T) {
    this.subscribers.has(event) && this.subscribers.delete(event);
  }
}

type Events = 'add' | 'remove';
const pubsub = new PubSub<Events>();
pubsub.subscribe('add', (a: string, b: number) => {
  console.log('add', a, b);
});
// pubsub.subscribe('remove', (...args) => {
//   console.log('remove', args);
// });
pubsub.publish('add', 1, 2, 3);