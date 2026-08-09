import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { AppConfig, IPC, TrackMatch } from "../shared/types";
import { loadConfig, saveConfig, loadCookie, saveCookie, loadSpotifyToken, saveSpotifyToken } from "./config";
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

  ipcMain.handle(IPC.exportAndMatch, async (_e, config: AppConfig): Promise<TrackMatch[]> => {
    const cookie = loadCookie();
    if (!cookie) throw new Error("还没登录网易云，请先扫码登录");

    log("info", "开始导出并匹配", { playlistId: config.spotifyPlaylistId });

    const tracks = await fetchSpotifyPlaylist(config);
    log("info", `Spotify 歌单导出完成，共 ${tracks.length} 首`);

    const results: TrackMatch[] = [];

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const candidates = await searchCandidates(cookie, track);
      const best = candidates[0];

      if (!best) {
        log("warn", `未匹配到任何候选: ${track.name} - ${track.artists.join("/")}`);
      }

      results.push({
        spotifyTrack: track,
        candidates,
        selectedNeteaseId: best && best.score >= MATCH_THRESHOLD ? best.id : null,
        status: !best ? "notfound" : best.score >= MATCH_THRESHOLD ? "matched" : "uncertain",
      });

      mainWindow?.webContents.send(IPC.matchProgress, {
        done: i + 1,
        total: tracks.length,
        currentTrackName: track.name,
      });
    }

    log("info", "匹配阶段完成", {
      total: results.length,
      matched: results.filter((r) => r.status === "matched").length,
      uncertain: results.filter((r) => r.status === "uncertain").length,
      notfound: results.filter((r) => r.status === "notfound").length,
    });

    return results;
  });

  ipcMain.handle(
    IPC.importToNetease,
    async (_e, matches: TrackMatch[], playlistName: string) => {
      const cookie = loadCookie();
      if (!cookie) throw new Error("还没登录网易云，请先扫码登录");

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
