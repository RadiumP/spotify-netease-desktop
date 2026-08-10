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
// 自适应节流：正常情况下按 BASE_DELAY 走，一旦命中限流就翻倍拉长后续所有请求的间隔，
// 顶到 MAX_DELAY 封顶；连续成功之后再慢慢降回 BASE_DELAY。模块级状态，整个搜索过程共享。
const BASE_DELAY_MS = 600;
const MAX_DELAY_MS = 20000;
let currentDelayMs = BASE_DELAY_MS;
function isRateLimited(err) {
    const data = err.response?.data;
    return (err.response?.status === 405 ||
        data?.code === 405 ||
        (typeof data?.msg === "string" && data.msg.includes("频繁")) ||
        (typeof data?.message === "string" && data.message.includes("频繁")));
}
async function searchCandidates(cookie, track, limit = 5) {
    const keyword = `${track.name} ${track.artists[0] ?? ""}`;
    const maxAttempts = 4;
    let lastWasRateLimited = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await sleep(currentDelayMs); // 每次真正发请求前都按当前节流间隔等一下，不只是失败后才等
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
            // 请求顺利成功，把节流间隔慢慢降回去，别一直卡在拉长之后的慢速度
            if (currentDelayMs > BASE_DELAY_MS) {
                currentDelayMs = Math.max(BASE_DELAY_MS, currentDelayMs - 300);
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
            return { candidates: candidates.sort((a, b) => b.score - a.score), rateLimited: false };
        }
        catch (err) {
            const rateLimited = isRateLimited(err);
            lastWasRateLimited = rateLimited;
            if (rateLimited) {
                currentDelayMs = Math.min(MAX_DELAY_MS, currentDelayMs * 2);
                (0, logger_1.log)("warn", `触发网易云限流，节流间隔拉长到 ${currentDelayMs}ms: ${keyword}`);
            }
            (0, logger_1.log)("error", `网易云搜索失败（第${attempt}次尝试）: ${keyword}`, {
                httpStatus: err.response?.status,
                responseData: err.response?.data,
                message: err.message,
                rateLimited,
                currentDelayMs,
            });
        }
    }
    (0, logger_1.log)("error", `网易云搜索彻底失败，已重试 ${maxAttempts} 次: ${keyword}`, { currentDelayMs });
    // 搜索彻底失败就当没搜到，交给后面的"未匹配清单"处理；rateLimited 交给上层判断要不要整体中止
    return { candidates: [], rateLimited: lastWasRateLimited };
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
