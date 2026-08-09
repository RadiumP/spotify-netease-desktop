"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startQrLogin = startQrLogin;
exports.checkQrLogin = checkQrLogin;
exports.searchCandidates = searchCandidates;
exports.createPlaylist = createPlaylist;
exports.addTracksToPlaylist = addTracksToPlaylist;
const axios_1 = __importDefault(require("axios"));
const neteaseServer_1 = require("../neteaseServer");
const match_1 = require("./match");
const logger_1 = require("../logger");
async function startQrLogin() {
    const keyResp = await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/login/qr/key`, {
        params: { timestamp: Date.now() },
    });
    const unikey = keyResp.data.data.unikey;
    const createResp = await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/login/qr/create`, {
        params: { key: unikey, qrimg: true, timestamp: Date.now() },
    });
    return { unikey, qrimgBase64: createResp.data.data.qrimg };
}
async function checkQrLogin(unikey) {
    const resp = await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/login/qr/check`, {
        params: { key: unikey, timestamp: Date.now() },
    });
    return { code: resp.data.code, message: resp.data.message, cookie: resp.data.cookie };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function searchCandidates(cookie, track, limit = 5) {
    const keyword = `${track.name} ${track.artists[0] ?? ""}`;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const resp = await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/search`, {
                params: { keywords: keyword, limit, cookie, timestamp: Date.now() },
            });
            // 网易云接口有时候 HTTP 200 但 body 里的 code 字段才是真实状态（比如 -462 是需要验证码，
            // 这种通常就是被风控了），这种情况日志里也记一下，不然只看 HTTP 状态码会漏掉
            if (resp.data?.code && resp.data.code !== 200) {
                (0, logger_1.log)("warn", `网易云搜索返回非200业务码: ${keyword}`, {
                    bodyCode: resp.data.code,
                    bodyMessage: resp.data.message,
                });
            }
            const songs = resp.data?.result?.songs ?? [];
            const candidates = songs.map((s) => {
                const artistNames = s.artists.map((a) => a.name);
                return {
                    id: s.id,
                    name: s.name,
                    artists: artistNames.join("/"),
                    score: (0, match_1.scoreCandidate)(track, s.name, artistNames),
                };
            });
            return candidates.sort((a, b) => b.score - a.score);
        }
        catch (err) {
            (0, logger_1.log)("error", `网易云搜索失败（第${attempt}次尝试）: ${keyword}`, {
                httpStatus: err.response?.status,
                responseData: err.response?.data,
                message: err.message,
            });
            // 接口偶尔抽风（限流/临时报错），退避一下再试，别一首搜索失败就把整批歌单的进度全丢了
            if (attempt < maxAttempts) {
                await sleep(1500 * attempt);
            }
        }
    }
    (0, logger_1.log)("error", `网易云搜索彻底失败，已重试 ${maxAttempts} 次: ${keyword}`);
    return []; // 搜索彻底失败就当没搜到，交给后面的"未匹配清单"处理，不中断整批导出
}
async function createPlaylist(cookie, name) {
    const resp = await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/playlist/create`, {
        params: { name, cookie, timestamp: Date.now() },
    });
    return resp.data.id ?? resp.data.playlist.id;
}
async function addTracksToPlaylist(cookie, playlistId, trackIds) {
    const chunkSize = 100;
    for (let i = 0; i < trackIds.length; i += chunkSize) {
        const chunk = trackIds.slice(i, i + chunkSize);
        await axios_1.default.get(`${neteaseServer_1.NETEASE_API_BASE}/playlist/tracks`, {
            params: { op: "add", pid: playlistId, tracks: chunk.join(","), cookie, timestamp: Date.now() },
        });
        await new Promise((r) => setTimeout(r, 500));
    }
}
