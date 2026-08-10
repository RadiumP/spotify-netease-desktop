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
import { startQrLogin, checkQrLogin, searchCandidates, getOrCreatePlaylist, addTracksToPlaylist } from "./ipc/netease";
import { MATCH_THRESHOLD } from "./ipc/match";
import { requestPause, clearPause, isPauseRequested } from "./pauseState";
import { log, openLogFolder } from "./logger";

let mainWindow: BrowserWindow | null = null;
// 防止意外并发跑两个导出/匹配任务（比如前端 bug 导致重复触发）——两边同时搜索同一个歌单，
// 会导致结果重复出现、限流更容易触发。前端已经会在跑的时候禁用按钮，这里是兜底的第二道保险。
let matchInProgress = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    icon: path.join(__dirname, "..", "..", "build", "icon.png"), // 打包后的实际图标由 package.json build.win/mac.icon 决定，这个只影响开发模式下窗口/任务栏显示
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

  ipcMain.handle(IPC.pauseMatch, () => {
    if (matchInProgress) {
      requestPause();
      log("info", "用户点击了暂停按钮");
    }
  });

  ipcMain.handle(
    IPC.exportAndMatch,
    async (_e, config: AppConfig, resume: boolean): Promise<ExportMatchOutcome> => {
      const cookie = loadCookie();
      if (!cookie) throw new Error("还没登录网易云，请先扫码登录");

      if (matchInProgress) {
        throw new Error("已经有一个导出/匹配任务在跑了，等它结束或者自动暂停之后再试");
      }
      matchInProgress = true;
      clearPause(); // 保险起见，开始新任务前把上一轮可能残留的暂停标记清掉

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
            if (isPauseRequested()) {
              aborted = true;
              abortReason = `手动暂停，已经匹配到的 ${results.length} 首已经保存，随时可以点"从上次继续"接着跑`;
              log("info", "用户手动暂停（回放断点阶段），停止匹配循环");
              clearPause();
              saveCheckpoint(config.spotifyPlaylistId, results);
              break;
            }
            continue;
          }

          const { candidates, failureKind, paused } = await searchCandidates(cookie, track);

          if (paused) {
            aborted = true;
            abortReason = `手动暂停，已经匹配到的 ${results.length} 首已经保存，随时可以点"从上次继续"接着跑`;
            log("info", "用户手动暂停，停止匹配循环（当前这首没搜完，下次会重新搜）");
            clearPause();
            break;
          }

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
        matchInProgress = false;
        clearPause();
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

        const { playlistId, existingTrackIds, reused } = await getOrCreatePlaylist(
          cookie,
          playlistName
        );

        // 去重：跳过"歌单里已经有的"和"这一批里选中了同一首网易云曲目"这两种重复
        const seenInThisBatch = new Set<number>();
        const idsToAdd: number[] = [];
        for (const m of toImport) {
          const id = m.selectedNeteaseId as number;
          if (existingTrackIds.has(id) || seenInThisBatch.has(id)) continue;
          seenInThisBatch.add(id);
          idsToAdd.push(id);
        }
        const skippedDuplicates = toImport.length - idsToAdd.length;

        log("info", "开始导入网易云", {
          playlistId,
          reused,
          toAdd: idsToAdd.length,
          skippedDuplicates,
        });

        await addTracksToPlaylist(cookie, playlistId, idsToAdd);

        return {
          playlistId,
          matchedCount: idsToAdd.length,
          unmatchedCount: unmatched.length,
          unmatchedTracks: unmatched.map((m) => m.spotifyTrack),
          duplicateCount: skippedDuplicates,
          reusedExistingPlaylist: reused,
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
