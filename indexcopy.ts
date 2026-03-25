// function getTaskByLimit(getTaskBylimtTasks: (() => Promise<any>)[], limit: number) {
//   const _tasks = [];
//   for (let i = 0; i < limit; i++) {
//     _tasks.push(getTaskBylimtTasks.shift())
//   }
//   return _tasks
// }

function getTaskByLimit(tasks: (() => Promise<any>)[], limit: number) {
  return tasks.splice(0, limit);
}

async function promiseLimit(tasks: (() => Promise<any>)[], limit: number) {
  while (tasks.length > 0) {
    const _tasks = getTaskByLimit(tasks, limit);
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
