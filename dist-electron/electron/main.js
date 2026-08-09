"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const types_1 = require("../shared/types");
const config_1 = require("./config");
const neteaseServer_1 = require("./neteaseServer");
const spotify_1 = require("./ipc/spotify");
const spotifyAuth_1 = require("./ipc/spotifyAuth");
const netease_1 = require("./ipc/netease");
const match_1 = require("./ipc/match");
const logger_1 = require("./logger");
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
    }
}
function registerIpcHandlers() {
    electron_1.ipcMain.handle(types_1.IPC.loadConfig, () => (0, config_1.loadConfig)());
    electron_1.ipcMain.handle(types_1.IPC.openLogFolder, () => (0, logger_1.openLogFolder)());
    electron_1.ipcMain.handle(types_1.IPC.saveConfig, (_e, config) => {
        (0, config_1.saveConfig)(config);
    });
    electron_1.ipcMain.handle(types_1.IPC.neteaseIsLoggedIn, () => !!(0, config_1.loadCookie)());
    electron_1.ipcMain.handle(types_1.IPC.spotifyIsLoggedIn, () => !!(0, config_1.loadSpotifyToken)());
    electron_1.ipcMain.handle(types_1.IPC.spotifyLogin, async (_e, config) => {
        const token = await (0, spotifyAuth_1.loginWithBrowser)(config.spotifyClientId);
        (0, config_1.saveSpotifyToken)(token);
    });
    electron_1.ipcMain.handle(types_1.IPC.neteaseLoginStart, () => (0, netease_1.startQrLogin)());
    electron_1.ipcMain.handle(types_1.IPC.neteaseLoginPoll, async (_e, unikey) => {
        const status = await (0, netease_1.checkQrLogin)(unikey);
        if (status.code === 803 && status.cookie) {
            (0, config_1.saveCookie)(status.cookie);
        }
        return { code: status.code, message: status.message };
    });
    electron_1.ipcMain.handle(types_1.IPC.exportAndMatch, async (_e, config) => {
        const cookie = (0, config_1.loadCookie)();
        if (!cookie)
            throw new Error("还没登录网易云，请先扫码登录");
        (0, logger_1.log)("info", "开始导出并匹配", { playlistId: config.spotifyPlaylistId });
        const tracks = await (0, spotify_1.fetchSpotifyPlaylist)(config);
        (0, logger_1.log)("info", `Spotify 歌单导出完成，共 ${tracks.length} 首`);
        const results = [];
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const candidates = await (0, netease_1.searchCandidates)(cookie, track);
            const best = candidates[0];
            if (!best) {
                (0, logger_1.log)("warn", `未匹配到任何候选: ${track.name} - ${track.artists.join("/")}`);
            }
            results.push({
                spotifyTrack: track,
                candidates,
                selectedNeteaseId: best && best.score >= match_1.MATCH_THRESHOLD ? best.id : null,
                status: !best ? "notfound" : best.score >= match_1.MATCH_THRESHOLD ? "matched" : "uncertain",
            });
            mainWindow?.webContents.send(types_1.IPC.matchProgress, {
                done: i + 1,
                total: tracks.length,
                currentTrackName: track.name,
            });
            await new Promise((r) => setTimeout(r, 500)); // 别把网易云接口打太快
        }
        (0, logger_1.log)("info", "匹配阶段完成", {
            total: results.length,
            matched: results.filter((r) => r.status === "matched").length,
            uncertain: results.filter((r) => r.status === "uncertain").length,
            notfound: results.filter((r) => r.status === "notfound").length,
        });
        return results;
    });
    electron_1.ipcMain.handle(types_1.IPC.importToNetease, async (_e, matches, playlistName) => {
        const cookie = (0, config_1.loadCookie)();
        if (!cookie)
            throw new Error("还没登录网易云，请先扫码登录");
        const toImport = matches.filter((m) => m.selectedNeteaseId !== null);
        const unmatched = matches.filter((m) => m.selectedNeteaseId === null);
        const playlistId = await (0, netease_1.createPlaylist)(cookie, playlistName);
        await (0, netease_1.addTracksToPlaylist)(cookie, playlistId, toImport.map((m) => m.selectedNeteaseId));
        return {
            playlistId,
            matchedCount: toImport.length,
            unmatchedCount: unmatched.length,
            unmatchedTracks: unmatched.map((m) => m.spotifyTrack),
        };
    });
}
electron_1.app.whenReady().then(async () => {
    try {
        await (0, neteaseServer_1.startNeteaseServer)();
    }
    catch (err) {
        console.error("[main] serveNcmApi 编程方式启动失败，退回子进程方式:", err);
        (0, neteaseServer_1.startNeteaseServerFallback)();
    }
    registerIpcHandlers();
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
