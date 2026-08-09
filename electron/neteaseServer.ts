/**
 * NeteaseCloudMusicApi 支持作为 Node 模块被引入并用编程方式启动
 * （对应它 README 里 "作为 Node.js 模块使用" 那部分：serveNcmApi）。
 * 这样用户不需要自己另开一个终端跑 npx，打包成 exe 之后也能内嵌运行。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ncmApi = require("NeteaseCloudMusicApi");

export const NETEASE_LOCAL_PORT = 3000;
export const NETEASE_API_BASE = `http://localhost:${NETEASE_LOCAL_PORT}`;

let started = false;

export async function startNeteaseServer(): Promise<void> {
  if (started) return;
  await ncmApi.serveNcmApi({
    port: NETEASE_LOCAL_PORT,
    checkVersionSubmission: false,
  });
  started = true;
  console.log(`[netease-server] 已在 ${NETEASE_API_BASE} 启动`);
}

/**
 * 如果装的 NeteaseCloudMusicApi 版本没有导出 serveNcmApi（老版本只有 CLI），
 * 就退回成 spawn 子进程的方式。两种方式二选一，由 startNeteaseServer 优先尝试
 * 编程方式，失败了再退回这个。
 */
export function startNeteaseServerFallback(): void {
  const { spawn } = require("child_process");
  const path = require("path");
  const binPath = path.join(
    __dirname,
    "..",
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "NeteaseCloudMusicApi.cmd" : "NeteaseCloudMusicApi"
  );
  const child = spawn(binPath, [], {
    env: { ...process.env, PORT: String(NETEASE_LOCAL_PORT) },
    stdio: "inherit",
  });
  child.on("error", (err: Error) => {
    console.error("[netease-server] 启动失败:", err.message);
  });
}
