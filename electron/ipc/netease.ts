import axios from "axios";
import { NETEASE_API_BASE } from "../neteaseServer";
import { NeteaseCandidate, NeteaseLoginStatus, SpotifyTrack } from "../../shared/types";
import { scoreCandidate } from "./match";
import { log } from "../logger";

export interface QrLoginSession {
  unikey: string;
  qrimgBase64: string; // "data:image/png;base64,...."，前端直接当 img src 用
}

export async function startQrLogin(): Promise<QrLoginSession> {
  const keyResp = await axios.get(`${NETEASE_API_BASE}/login/qr/key`, {
    params: { timestamp: Date.now() },
  });
  const unikey = keyResp.data.data.unikey;

  const createResp = await axios.get(`${NETEASE_API_BASE}/login/qr/create`, {
    params: { key: unikey, qrimg: true, timestamp: Date.now() },
  });

  return { unikey, qrimgBase64: createResp.data.data.qrimg };
}

export async function checkQrLogin(
  unikey: string
): Promise<NeteaseLoginStatus & { cookie?: string }> {
  const resp = await axios.get(`${NETEASE_API_BASE}/login/qr/check`, {
    params: { key: unikey, timestamp: Date.now() },
  });
  return { code: resp.data.code, message: resp.data.message, cookie: resp.data.cookie };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function searchCandidates(
  cookie: string,
  track: SpotifyTrack,
  limit = 5
): Promise<NeteaseCandidate[]> {
  const keyword = `${track.name} ${track.artists[0] ?? ""}`;

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await axios.get(`${NETEASE_API_BASE}/search`, {
        params: { keywords: keyword, limit, cookie, timestamp: Date.now() },
      });

      // 网易云接口有时候 HTTP 200 但 body 里的 code 字段才是真实状态（比如 -462 是需要验证码，
      // 这种通常就是被风控了），这种情况日志里也记一下，不然只看 HTTP 状态码会漏掉
      if (resp.data?.code && resp.data.code !== 200) {
        log("warn", `网易云搜索返回非200业务码: ${keyword}`, {
          bodyCode: resp.data.code,
          bodyMessage: resp.data.message,
        });
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

      return candidates.sort((a, b) => b.score - a.score);
    } catch (err: any) {
      log("error", `网易云搜索失败（第${attempt}次尝试）: ${keyword}`, {
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

  log("error", `网易云搜索彻底失败，已重试 ${maxAttempts} 次: ${keyword}`);
  return []; // 搜索彻底失败就当没搜到，交给后面的"未匹配清单"处理，不中断整批导出
}

export async function createPlaylist(cookie: string, name: string): Promise<number> {
  const resp = await axios.get(`${NETEASE_API_BASE}/playlist/create`, {
    params: { name, cookie, timestamp: Date.now() },
  });
  return resp.data.id ?? resp.data.playlist.id;
}

export async function addTracksToPlaylist(
  cookie: string,
  playlistId: number,
  trackIds: number[]
): Promise<void> {
  const chunkSize = 100;
  for (let i = 0; i < trackIds.length; i += chunkSize) {
    const chunk = trackIds.slice(i, i + chunkSize);
    await axios.get(`${NETEASE_API_BASE}/playlist/tracks`, {
      params: { op: "add", pid: playlistId, tracks: chunk.join(","), cookie, timestamp: Date.now() },
    });
    await new Promise((r) => setTimeout(r, 500));
  }
}
