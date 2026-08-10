import { http } from "../httpClient";
import { NETEASE_API_BASE } from "../neteaseServer";
import { NeteaseCandidate, NeteaseLoginStatus, SpotifyTrack } from "../../shared/types";
import { scoreCandidate } from "./match";
import { log } from "../logger";
import { isPauseRequested } from "../pauseState";

export interface QrLoginSession {
  unikey: string;
  qrimgBase64: string; // "data:image/png;base64,...."，前端直接当 img src 用
}

export async function startQrLogin(): Promise<QrLoginSession> {
  const keyResp = await http.get(`${NETEASE_API_BASE}/login/qr/key`, {
    params: { timestamp: Date.now() },
  });
  const unikey = keyResp.data.data.unikey;

  const createResp = await http.get(`${NETEASE_API_BASE}/login/qr/create`, {
    params: { key: unikey, qrimg: true, timestamp: Date.now() },
  });

  return { unikey, qrimgBase64: createResp.data.data.qrimg };
}

export async function checkQrLogin(
  unikey: string
): Promise<NeteaseLoginStatus & { cookie?: string }> {
  const resp = await http.get(`${NETEASE_API_BASE}/login/qr/check`, {
    params: { key: unikey, timestamp: Date.now() },
  });
  return { code: resp.data.code, message: resp.data.message, cookie: resp.data.cookie };
}

// 可中断的等待：正常等到时间就结束，但每 150ms 会检查一次有没有被要求暂停，
// 有的话立刻提前结束，不用傻等完整个延迟时间
function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const checkInterval = setInterval(() => {
      if (isPauseRequested() || Date.now() - start >= ms) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 150);
  });
}

// 自适应节流：正常情况下按 BASE_DELAY 走，一旦命中限流就翻倍拉长后续所有请求的间隔，
// 顶到 MAX_DELAY 封顶；连续成功之后再慢慢降回 BASE_DELAY。模块级状态，整个搜索过程共享。
const BASE_DELAY_MS = 600;
const MAX_DELAY_MS = 20_000;
let currentDelayMs = BASE_DELAY_MS;

// 每次实际等待的时间不用固定值，在当前节流间隔基础上加随机抖动（1.0x ~ 1.8x），
// 别让请求节奏太规律——规律的间隔本身也是容易被识别成机器人请求的特征之一
function randomizedDelay(baseMs: number): number {
  const jitterFactor = 1 + Math.random() * 0.8; // 1.0 ~ 1.8
  return Math.round(baseMs * jitterFactor);
}

function isRateLimited(err: any): boolean {
  const data = err.response?.data;
  return (
    err.response?.status === 405 ||
    data?.code === 405 ||
    (typeof data?.msg === "string" && data.msg.includes("频繁")) ||
    (typeof data?.message === "string" && data.message.includes("频繁"))
  );
}

// 没有 response（请求根本没到、或者到了但没收到回应）通常意味着网络本身有问题——
// 超时、断网、待机没醒透之类的，跟"服务器明确拒绝了"（限流）性质不一样，得分开处理
function isNetworkError(err: any): boolean {
  return !err.response;
}

export type FailureKind = "rateLimited" | "network" | null;

export interface SearchResult {
  candidates: NeteaseCandidate[];
  // 彻底失败时是哪种原因；null 表示没失败（哪怕搜索结果是空的，只要请求本身成功就是 null）
  failureKind: FailureKind;
  // true = 是因为用户点了暂停被提前打断的，不是真的搜索失败，上层不该把这首算作"处理过"
  paused?: boolean;
}

export async function searchCandidates(
  cookie: string,
  track: SpotifyTrack,
  limit = 5
): Promise<SearchResult> {
  const keyword = `${track.name} ${track.artists[0] ?? ""}`;

  const maxAttempts = 4;
  let lastFailureKind: FailureKind = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isPauseRequested()) {
      return { candidates: [], failureKind: null, paused: true };
    }

    await interruptibleSleep(randomizedDelay(currentDelayMs)); // 节流等待（带随机抖动），随时能被暂停打断

    if (isPauseRequested()) {
      return { candidates: [], failureKind: null, paused: true };
    }

    // 等待期间没被暂停，但请求可能正好卡在网络里迟迟不返回——起个轮询，
    // 一旦这时候点了暂停就直接把这个请求砍掉，不用等它超时或者重试完
    const controller = new AbortController();
    const abortWatcher = setInterval(() => {
      if (isPauseRequested()) controller.abort();
    }, 150);

    try {
      const resp = await http.get(`${NETEASE_API_BASE}/search`, {
        params: { keywords: keyword, limit, cookie, timestamp: Date.now() },
        signal: controller.signal,
      });

      // 网易云接口有时候 HTTP 200 但 body 里的 code 字段才是真实状态（比如 -462 是需要验证码，
      // 这种通常就是被风控了），这种情况日志里也记一下，不然只看 HTTP 状态码会漏掉
      if (resp.data?.code && resp.data.code !== 200) {
        log("warn", `网易云搜索返回非200业务码: ${keyword}`, {
          bodyCode: resp.data.code,
          bodyMessage: resp.data.message,
        });
      }

      // 请求顺利成功，把节流间隔慢慢降回去，别一直卡在拉长之后的慢速度
      if (currentDelayMs > BASE_DELAY_MS) {
        currentDelayMs = Math.max(BASE_DELAY_MS, currentDelayMs - 300);
      }

      const songs = resp.data?.result?.songs ?? [];
      const candidates: NeteaseCandidate[] = songs.map((s: any) => {
        const artistNames = s.artists.map((a: any) => a.name);
        return {
          id: s.id,
          name: s.name,
          artists: artistNames.join("/"),
          score: scoreCandidate(track, s.name, artistNames),
        };
      });

      return { candidates: candidates.sort((a, b) => b.score - a.score), failureKind: null };
    } catch (err: any) {
      if (isPauseRequested()) {
        // 是被我们自己 abort 掉的（或者 abort 和真实网络错误前后脚发生），
        // 当成暂停处理，不要算进限流/网络错误的失败统计里
        return { candidates: [], failureKind: null, paused: true };
      }

      const rateLimited = isRateLimited(err);
      const networkError = !rateLimited && isNetworkError(err);
      lastFailureKind = rateLimited ? "rateLimited" : networkError ? "network" : null;

      if (rateLimited) {
        currentDelayMs = Math.min(MAX_DELAY_MS, currentDelayMs * 2);
        log("warn", `触发网易云限流，节流间隔拉长到 ${currentDelayMs}ms: ${keyword}`);
      }

      log("error", `网易云搜索失败（第${attempt}次尝试）: ${keyword}`, {
        httpStatus: err.response?.status,
        responseData: err.response?.data,
        message: err.message,
        failureKind: lastFailureKind,
        currentDelayMs,
      });
    } finally {
      clearInterval(abortWatcher);
    }
  }

  log("error", `网易云搜索彻底失败，已重试 ${maxAttempts} 次: ${keyword}`, { currentDelayMs });
  // 搜索彻底失败就当没搜到，交给后面的"未匹配清单"处理；failureKind 交给上层判断要不要整体中止
  return { candidates: [], failureKind: lastFailureKind };
}

async function getCurrentUserId(cookie: string): Promise<number | null> {
  const resp = await http.get(`${NETEASE_API_BASE}/login/status`, {
    params: { cookie, timestamp: Date.now() },
  });
  return resp.data?.data?.profile?.userId ?? resp.data?.profile?.userId ?? null;
}

/**
 * 按名字找当前用户已有的歌单，找到了返回它的 id，找不到返回 null。
 * 用来判断"这次导入该新建歌单，还是往已经建过的同名歌单里加"。
 */
export async function findPlaylistByName(cookie: string, name: string): Promise<number | null> {
  const uid = await getCurrentUserId(cookie);
  if (!uid) {
    log("warn", "拿不到当前用户 uid，没法按名字查已有歌单，会直接新建");
    return null;
  }

  const resp = await http.get(`${NETEASE_API_BASE}/user/playlist`, {
    params: { uid, cookie, timestamp: Date.now() },
  });

  const playlists = resp.data?.playlist ?? [];
  const found = playlists.find((p: any) => p.name === name);
  return found ? found.id : null;
}

/**
 * 拉一个歌单里所有曲目的网易云 id，用来导入前过滤掉已经在里面的歌，避免重复加入。
 * 用 /playlist/track/all 而不是 /playlist/detail，后者对超过一定数量的歌单会截断。
 */
export async function getPlaylistTrackIds(cookie: string, playlistId: number): Promise<Set<number>> {
  const resp = await http.get(`${NETEASE_API_BASE}/playlist/track/all`, {
    params: { id: playlistId, cookie, timestamp: Date.now() },
  });
  const songs = resp.data?.songs ?? [];
  return new Set(songs.map((s: any) => s.id));
}

export interface TargetPlaylist {
  playlistId: number;
  existingTrackIds: Set<number>;
  reused: boolean; // true = 用的是已有同名歌单，false = 新建的
}

/**
 * 找同名歌单就复用（顺便把里面已有的曲目 id 拉出来去重），找不到就新建一个空的。
 */
export async function getOrCreatePlaylist(cookie: string, name: string): Promise<TargetPlaylist> {
  const existingId = await findPlaylistByName(cookie, name);

  if (existingId) {
    log("info", `找到同名歌单，复用: ${name} (id=${existingId})`);
    const existingTrackIds = await getPlaylistTrackIds(cookie, existingId);
    return { playlistId: existingId, existingTrackIds, reused: true };
  }

  const resp = await http.get(`${NETEASE_API_BASE}/playlist/create`, {
    params: { name, cookie, timestamp: Date.now() },
  });
  const playlistId = resp.data.id ?? resp.data.playlist.id;
  log("info", `没找到同名歌单，新建: ${name} (id=${playlistId})`);
  return { playlistId, existingTrackIds: new Set(), reused: false };
}

export async function addTracksToPlaylist(
  cookie: string,
  playlistId: number,
  trackIds: number[]
): Promise<void> {
  const chunkSize = 100;
  for (let i = 0; i < trackIds.length; i += chunkSize) {
    const chunk = trackIds.slice(i, i + chunkSize);
    await http.get(`${NETEASE_API_BASE}/playlist/tracks`, {
      params: { op: "add", pid: playlistId, tracks: chunk.join(","), cookie, timestamp: Date.now() },
    });
    await new Promise((r) => setTimeout(r, 500));
  }
}
