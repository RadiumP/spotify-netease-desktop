"use strict";
// electron 主进程和 renderer 都会引用这个文件，别放任何依赖具体环境（node/dom）的代码进来
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = exports.SPOTIFY_REDIRECT_URI = void 0;
// PKCE 授权码流程用的本地回调地址，设置页和主进程都要用到这个值
exports.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8888/callback";
exports.IPC = {
    loadConfig: "config:load",
    saveConfig: "config:save",
    spotifyLogin: "spotify:login",
    spotifyIsLoggedIn: "spotify:is-logged-in",
    neteaseLoginStart: "netease:login-start",
    neteaseLoginPoll: "netease:login-poll",
    neteaseLoginStatusCheck: "netease:login-check",
    neteaseIsLoggedIn: "netease:is-logged-in",
    exportAndMatch: "flow:export-and-match",
    matchProgress: "flow:match-progress", // main -> renderer 推送
    importToNetease: "flow:import",
    openLogFolder: "log:open-folder",
};
