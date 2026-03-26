async function promiseLimit(tasks: (() => Promise<any>)[], limit: number) {
  while (tasks.length > 0) {
    const _tasks = tasks.splice(0, limit)
    const res = await Promise.allSettled(_tasks.map((t) => t?.()));
    console.log(res);
  }
}

const tasks = [
  () => Promise.reject(new Error("fail")),
  () => new Promise((resolve) => setTimeout(() => resolve(2), 100)),
  () => Promise.resolve(1),
];

(async () => {
  await promiseLimit(tasks, 2);
})();
