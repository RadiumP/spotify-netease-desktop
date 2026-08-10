import { app, BrowserWindow, ipcMain, powerSaveBlocker } from "electron";
import * as path from "path";
import { AppConfig, ExportMatchOutcome, IPC, TrackMatch } from "../shared/types";
import {
  loadConfig,
  saveConfig,
  loadCookie,
  saveCookie,
  loadSpotifyToken,
  saveSpotifyToken,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
} from "./config";
import { startNeteaseServer, startNeteaseServerFallback } from "./neteaseServer";
import { fetchSpotifyPlaylist } from "./ipc/spotify";
import { loginWithBrowser } from "./ipc/spotifyAuth";
import { startQrLogin, checkQrLogin, searchCandidates, createPlaylist, addTracksToPlaylist } from "./ipc/netease";
import { MATCH_THRESHOLD } from "./ipc/match";
import { log, openLogFolder } from "./logger";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload.js 里 require 了 ../shared/types，沙盒模式的受限 require 不支持这种相对路径引用
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
}

function registerIpcHandlers() {
  ipcMain.handle(IPC.loadConfig, () => loadConfig());

  ipcMain.handle(IPC.openLogFolder, () => openLogFolder());

  ipcMain.handle(IPC.saveConfig, (_e, config: AppConfig) => {
    saveConfig(config);
  });

  ipcMain.handle(IPC.neteaseIsLoggedIn, () => !!loadCookie());

  ipcMain.handle(IPC.spotifyIsLoggedIn, () => !!loadSpotifyToken());

  ipcMain.handle(IPC.spotifyLogin, async (_e, config: AppConfig) => {
    const token = await loginWithBrowser(config.spotifyClientId);
    saveSpotifyToken(token);
  });

  ipcMain.handle(IPC.neteaseLoginStart, () => startQrLogin());

  ipcMain.handle(IPC.neteaseLoginPoll, async (_e, unikey: string) => {
    const status = await checkQrLogin(unikey);
    if (status.code === 803 && status.cookie) {
      saveCookie(status.cookie);
    }
    return { code: status.code, message: status.message };
  });

  ipcMain.handle(IPC.checkpointStatus, (_e, playlistId: string) => {
    const checkpoint = loadCheckpoint(playlistId);
    return checkpoint ? { count: checkpoint.length } : null;
  });

  ipcMain.handle(
    IPC.exportAndMatch,
    async (_e, config: AppConfig, resume: boolean): Promise<ExportMatchOutcome> => {
      const cookie = loadCookie();
      if (!cookie) throw new Error("还没登录网易云，请先扫码登录");

      // 跑起来可能要好几分钟到几十分钟，别让系统中途待机把网络连接搞断。
      // 只挡"系统休眠"，屏幕该黑还是会黑，不影响省电，也不会一直常亮费电
      const blockerId = powerSaveBlocker.start("prevent-app-suspension");
      log("info", "开始导出并匹配，已阻止系统休眠", { playlistId: config.spotifyPlaylistId, resume });

      try {
        const tracks = await fetchSpotifyPlaylist(config);
        log("info", `Spotify 歌单导出完成，共 ${tracks.length} 首`);

        // 断点续传：已经处理过的曲目直接复用结果，不用重新打接口
        const previousResults = resume ? loadCheckpoint(config.spotifyPlaylistId) : null;
        const doneMap = new Map<string, TrackMatch>();
        if (previousResults) {
          for (const r of previousResults) doneMap.set(r.spotifyTrack.spotifyId, r);
          log("info", `从断点继续，已有 ${doneMap.size} 首处理过`);
        } else if (!resume) {
          clearCheckpoint(config.spotifyPlaylistId);
        }

        const results: TrackMatch[] = [];
        const RATE_LIMIT_ABORT_THRESHOLD = 6; // 限流：网易云还在正常应答，只是让你慢点，多等几首再判断
        const NETWORK_ERROR_ABORT_THRESHOLD = 3; // 网络问题：请求根本没通，大概率是断网/待机/连接死了，快点判断
        let consecutiveRateLimited = 0;
        let consecutiveNetworkErrors = 0;
        let aborted = false;
        let abortReason: string | undefined;

        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          const cached = doneMap.get(track.spotifyId);

          if (cached) {
            results.push(cached);
            mainWindow?.webContents.send(IPC.matchResult, cached);
            mainWindow?.webContents.send(IPC.matchProgress, {
              done: i + 1,
              total: tracks.length,
              currentTrackName: track.name,
            });
            continue;
          }

          const { candidates, failureKind } = await searchCandidates(cookie, track);
          const best = candidates[0];

          consecutiveRateLimited = failureKind === "rateLimited" ? consecutiveRateLimited + 1 : 0;
          consecutiveNetworkErrors = failureKind === "network" ? consecutiveNetworkErrors + 1 : 0;

          if (!best) {
            log("warn", `未匹配到任何候选: ${track.name} - ${track.artists.join("/")}`);
          }

          const match: TrackMatch = {
            spotifyTrack: track,
            candidates,
            selectedNeteaseId: best && best.score >= MATCH_THRESHOLD ? best.id : null,
            status: !best ? "notfound" : best.score >= MATCH_THRESHOLD ? "matched" : "uncertain",
          };
          results.push(match);

          // 每首处理完立刻推给界面，不用等全部跑完才看到结果
          mainWindow?.webContents.send(IPC.matchResult, match);

          // 每首都存一下断点，中途崩了/被限流中止了也不会丢进度
          saveCheckpoint(config.spotifyPlaylistId, results);

          mainWindow?.webContents.send(IPC.matchProgress, {
            done: i + 1,
            total: tracks.length,
            currentTrackName: track.name,
          });

          if (consecutiveNetworkErrors >= NETWORK_ERROR_ABORT_THRESHOLD) {
            aborted = true;
            abortReason =
              `连续 ${consecutiveNetworkErrors} 首歌请求都没连上网易云接口，看起来是网络断了` +
              `（比如电脑刚从待机唤醒、断网、或者 VPN 断开）。已经匹配到的 ${results.length} 首已经` +
              `可以直接导入，剩下的等网络恢复了重新点"导出并匹配"会自动接着跑`;
            log("error", `连续 ${consecutiveNetworkErrors} 首请求没通，判断网络断了，自动暂停`);
            break;
          }

          if (consecutiveRateLimited >= RATE_LIMIT_ABORT_THRESHOLD) {
            aborted = true;
            abortReason =
              `已经连续 ${consecutiveRateLimited} 首歌搜索都被网易云限流拒绝，看起来是被暂时限制访问了。` +
              `已经匹配到的 ${results.length} 首已经可以直接导入，剩下的建议先歇一会儿（几十分钟到几小时不等）` +
              `再重新点"导出并匹配"接着跑`;
            log("error", `连续 ${consecutiveRateLimited} 首触发限流，自动暂停`);
            break;
          }
        }

        if (!aborted) {
          // 顺利跑完，断点就没用了，清掉
          clearCheckpoint(config.spotifyPlaylistId);
        }

        log("info", aborted ? "匹配阶段被自动暂停" : "匹配阶段完成", {
          total: results.length,
          matched: results.filter((r) => r.status === "matched").length,
          uncertain: results.filter((r) => r.status === "uncertain").length,
          notfound: results.filter((r) => r.status === "notfound").length,
          aborted,
        });

        return { results, aborted, abortReason };
      } finally {
        powerSaveBlocker.stop(blockerId);
        log("info", "已解除系统休眠阻止");
      }
    }
  );

  ipcMain.handle(
    IPC.importToNetease,
    async (_e, matches: TrackMatch[], playlistName: string) => {
      const cookie = loadCookie();
      if (!cookie) throw new Error("还没登录网易云，请先扫码登录");

      const blockerId = powerSaveBlocker.start("prevent-app-suspension");
      try {
        const toImport = matches.filter((m) => m.selectedNeteaseId !== null);
        const unmatched = matches.filter((m) => m.selectedNeteaseId === null);

        const playlistId = await createPlaylist(cookie, playlistName);
        await addTracksToPlaylist(
          cookie,
          playlistId,
          toImport.map((m) => m.selectedNeteaseId as number)
        );

        return {
          playlistId,
          matchedCount: toImport.length,
          unmatchedCount: unmatched.length,
          unmatchedTracks: unmatched.map((m) => m.spotifyTrack),
        };
      } finally {
        powerSaveBlocker.stop(blockerId);
      }
    }
  );
}

app.whenReady().then(async () => {
  try {
    await startNeteaseServer();
  } catch (err) {
    console.error("[main] serveNcmApi 编程方式启动失败，退回子进程方式:", err);
    startNeteaseServerFallback();
  }

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
