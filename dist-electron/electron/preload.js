"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("../shared/types");
const api = {
    loadConfig: () => electron_1.ipcRenderer.invoke(types_1.IPC.loadConfig),
    saveConfig: (config) => electron_1.ipcRenderer.invoke(types_1.IPC.saveConfig, config),
    isSpotifyLoggedIn: () => electron_1.ipcRenderer.invoke(types_1.IPC.spotifyIsLoggedIn),
    loginSpotify: (config) => electron_1.ipcRenderer.invoke(types_1.IPC.spotifyLogin, config),
    isNeteaseLoggedIn: () => electron_1.ipcRenderer.invoke(types_1.IPC.neteaseIsLoggedIn),
    startNeteaseLogin: () => electron_1.ipcRenderer.invoke(types_1.IPC.neteaseLoginStart),
    pollNeteaseLogin: (unikey) => electron_1.ipcRenderer.invoke(types_1.IPC.neteaseLoginPoll, unikey),
    exportAndMatch: (config, resume) => electron_1.ipcRenderer.invoke(types_1.IPC.exportAndMatch, config, resume),
    pauseMatch: () => electron_1.ipcRenderer.invoke(types_1.IPC.pauseMatch),
    checkpointStatus: (playlistId) => electron_1.ipcRenderer.invoke(types_1.IPC.checkpointStatus, playlistId),
    onMatchProgress: (cb) => {
        const listener = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on(types_1.IPC.matchProgress, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(types_1.IPC.matchProgress, listener);
        };
    },
    // 每首歌处理完就会推一条，用来实时更新界面上的表格，不用等全部跑完
    onMatchResult: (cb) => {
        const listener = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on(types_1.IPC.matchResult, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(types_1.IPC.matchResult, listener);
        };
    },
    importToNetease: (matches, playlistName) => electron_1.ipcRenderer.invoke(types_1.IPC.importToNetease, matches, playlistName),
    openLogFolder: () => electron_1.ipcRenderer.invoke(types_1.IPC.openLogFolder),
};
electron_1.contextBridge.exposeInMainWorld("api", api);
