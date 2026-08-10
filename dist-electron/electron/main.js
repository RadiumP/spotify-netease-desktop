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
    electron_1.ipcMain.handle(types_1.IPC.checkpointStatus, (_e, playlistId) => {
        const checkpoint = (0, config_1.loadCheckpoint)(playlistId);
        return checkpoint ? { count: checkpoint.length } : null;
    });
    electron_1.ipcMain.handle(types_1.IPC.exportAndMatch, async (_e, config, resume) => {
        const cookie = (0, config_1.loadCookie)();
        if (!cookie)
            throw new Error("还没登录网易云，请先扫码登录");
        // 跑起来可能要好几分钟到几十分钟，别让系统中途待机把网络连接搞断。
        // 只挡"系统休眠"，屏幕该黑还是会黑，不影响省电，也不会一直常亮费电
        const blockerId = electron_1.powerSaveBlocker.start("prevent-app-suspension");
        (0, logger_1.log)("info", "开始导出并匹配，已阻止系统休眠", { playlistId: config.spotifyPlaylistId, resume });
        try {
            const tracks = await (0, spotify_1.fetchSpotifyPlaylist)(config);
            (0, logger_1.log)("info", `Spotify 歌单导出完成，共 ${tracks.length} 首`);
            // 断点续传：已经处理过的曲目直接复用结果，不用重新打接口
            const previousResults = resume ? (0, config_1.loadCheckpoint)(config.spotifyPlaylistId) : null;
            const doneMap = new Map();
            if (previousResults) {
                for (const r of previousResults)
                    doneMap.set(r.spotifyTrack.spotifyId, r);
                (0, logger_1.log)("info", `从断点继续，已有 ${doneMap.size} 首处理过`);
            }
            else if (!resume) {
                (0, config_1.clearCheckpoint)(config.spotifyPlaylistId);
            }
            const results = [];
            const RATE_LIMIT_ABORT_THRESHOLD = 6; // 限流：网易云还在正常应答，只是让你慢点，多等几首再判断
            const NETWORK_ERROR_ABORT_THRESHOLD = 3; // 网络问题：请求根本没通，大概率是断网/待机/连接死了，快点判断
            let consecutiveRateLimited = 0;
            let consecutiveNetworkErrors = 0;
            let aborted = false;
            let abortReason;
            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i];
                const cached = doneMap.get(track.spotifyId);
                if (cached) {
                    results.push(cached);
                    mainWindow?.webContents.send(types_1.IPC.matchResult, cached);
                    mainWindow?.webContents.send(types_1.IPC.matchProgress, {
                        done: i + 1,
                        total: tracks.length,
                        currentTrackName: track.name,
                    });
                    continue;
                }
                const { candidates, failureKind } = await (0, netease_1.searchCandidates)(cookie, track);
                const best = candidates[0];
                consecutiveRateLimited = failureKind === "rateLimited" ? consecutiveRateLimited + 1 : 0;
                consecutiveNetworkErrors = failureKind === "network" ? consecutiveNetworkErrors + 1 : 0;
                if (!best) {
                    (0, logger_1.log)("warn", `未匹配到任何候选: ${track.name} - ${track.artists.join("/")}`);
                }
                const match = {
                    spotifyTrack: track,
                    candidates,
                    selectedNeteaseId: best && best.score >= match_1.MATCH_THRESHOLD ? best.id : null,
                    status: !best ? "notfound" : best.score >= match_1.MATCH_THRESHOLD ? "matched" : "uncertain",
                };
                results.push(match);
                // 每首处理完立刻推给界面，不用等全部跑完才看到结果
                mainWindow?.webContents.send(types_1.IPC.matchResult, match);
                // 每首都存一下断点，中途崩了/被限流中止了也不会丢进度
                (0, config_1.saveCheckpoint)(config.spotifyPlaylistId, results);
                mainWindow?.webContents.send(types_1.IPC.matchProgress, {
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
                    (0, logger_1.log)("error", `连续 ${consecutiveNetworkErrors} 首请求没通，判断网络断了，自动暂停`);
                    break;
                }
                if (consecutiveRateLimited >= RATE_LIMIT_ABORT_THRESHOLD) {
                    aborted = true;
                    abortReason =
                        `已经连续 ${consecutiveRateLimited} 首歌搜索都被网易云限流拒绝，看起来是被暂时限制访问了。` +
                            `已经匹配到的 ${results.length} 首已经可以直接导入，剩下的建议先歇一会儿（几十分钟到几小时不等）` +
                            `再重新点"导出并匹配"接着跑`;
                    (0, logger_1.log)("error", `连续 ${consecutiveRateLimited} 首触发限流，自动暂停`);
                    break;
                }
            }
            if (!aborted) {
                // 顺利跑完，断点就没用了，清掉
                (0, config_1.clearCheckpoint)(config.spotifyPlaylistId);
            }
            (0, logger_1.log)("info", aborted ? "匹配阶段被自动暂停" : "匹配阶段完成", {
                total: results.length,
                matched: results.filter((r) => r.status === "matched").length,
                uncertain: results.filter((r) => r.status === "uncertain").length,
                notfound: results.filter((r) => r.status === "notfound").length,
                aborted,
            });
            return { results, aborted, abortReason };
        }
        finally {
            electron_1.powerSaveBlocker.stop(blockerId);
            (0, logger_1.log)("info", "已解除系统休眠阻止");
        }
    });
    electron_1.ipcMain.handle(types_1.IPC.importToNetease, async (_e, matches, playlistName) => {
        const cookie = (0, config_1.loadCookie)();
        if (!cookie)
            throw new Error("还没登录网易云，请先扫码登录");
        const blockerId = electron_1.powerSaveBlocker.start("prevent-app-suspension");
        try {
            const toImport = matches.filter((m) => m.selectedNeteaseId !== null);
            const unmatched = matches.filter((m) => m.selectedNeteaseId === null);
            const { playlistId, existingTrackIds, reused } = await (0, netease_1.getOrCreatePlaylist)(cookie, playlistName);
            // 去重：跳过"歌单里已经有的"和"这一批里选中了同一首网易云曲目"这两种重复
            const seenInThisBatch = new Set();
            const idsToAdd = [];
            for (const m of toImport) {
                const id = m.selectedNeteaseId;
                if (existingTrackIds.has(id) || seenInThisBatch.has(id))
                    continue;
                seenInThisBatch.add(id);
                idsToAdd.push(id);
            }
            const skippedDuplicates = toImport.length - idsToAdd.length;
            (0, logger_1.log)("info", "开始导入网易云", {
                playlistId,
                reused,
                toAdd: idsToAdd.length,
                skippedDuplicates,
            });
            await (0, netease_1.addTracksToPlaylist)(cookie, playlistId, idsToAdd);
            return {
                playlistId,
                matchedCount: idsToAdd.length,
                unmatchedCount: unmatched.length,
                unmatchedTracks: unmatched.map((m) => m.spotifyTrack),
                duplicateCount: skippedDuplicates,
                reusedExistingPlaylist: reused,
            };
        }
        finally {
            electron_1.powerSaveBlocker.stop(blockerId);
        }
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
