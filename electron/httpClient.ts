import axios from "axios";

/**
 * 电脑休眠再唤醒之后，之前建立的 TCP 连接经常会变成"看起来还在、实际已经死了"的状态，
 * 默认 axios 不设超时的话，请求会一直挂着不返回也不报错，把整个搜索循环卡死。
 * 所有对外请求都走这个实例，统一给个超时兜底。
 */
export const http = axios.create({
  timeout: 15_000,
});
