// 暂停状态的单一数据源。之前 main.ts 自己存了个模块级变量，但 netease.ts 里正在重试/等待的
// 请求也需要能实时看到这个状态才能立刻中断，所以拆出来单独一个模块，两边一起用。
let paused = false;

export function requestPause(): void {
  paused = true;
}

export function clearPause(): void {
  paused = false;
}

export function isPauseRequested(): boolean {
  return paused;
}
