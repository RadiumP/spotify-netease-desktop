import axios from "axios";
import { AppConfig, SpotifyTrack } from "../../shared/types";
import { loadSpotifyToken, saveSpotifyToken } from "../config";
import { refreshAccessToken } from "./spotifyAuth";

/**
 * 兼容用户直接粘贴完整分享链接的情况，比如
 * https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=xxxx
 * 只提取 37i9dQZF1DXcBWIGoYBM5M 这段纯 ID。
 */
function extractPlaylistId(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (match) return match[1];
  return trimmed.split("?")[0];
}

async function getValidAccessToken(config: AppConfig): Promise<string> {
  const token = loadSpotifyToken();
  if (!token) {
    throw new Error("还没登录 Spotify，请先在设置页点「登录 Spotify」");
  }

  // 留 60 秒余量，快过期就提前刷新
  if (Date.now() < token.expiresAt - 60_000) {
    return token.accessToken;
  }

  const refreshed = await refreshAccessToken(config.spotifyClientId, token.refreshToken);
  saveSpotifyToken(refreshed);
  return refreshed.accessToken;
}

export async function fetchSpotifyPlaylist(config: AppConfig): Promise<SpotifyTrack[]> {
  const { spotifyPlaylistId } = config;
  if (!spotifyPlaylistId) {
    throw new Error("请先在设置页填好 Spotify 歌单 ID");
  }

  const playlistId = extractPlaylistId(spotifyPlaylistId);
  const accessToken = await getValidAccessToken(config);
  const tracks: SpotifyTrack[] = [];

  // 2026年2月的 API 变更：/tracks 端点下线，换成 /items，
  // 而且只对当前登录用户拥有或协作的歌单开放
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100`;

  while (url) {
    let resp: any;
    try {
      resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err: any) {
      const spotifyMessage = err.response?.data?.error?.message;
      const status = err.response?.status;
      throw new Error(
        `请求 Spotify 歌单失败（歌单ID: ${playlistId}${status ? `，状态码 ${status}` : ""}）：${
          spotifyMessage ?? err.message
        }。这个新端点只能读你自己拥有或协作的歌单，检查一下歌单是不是你自己账号下的`
      );
    }

    if (!resp.data || !Array.isArray(resp.data.items)) {
      throw new Error(
        `这个歌单读不到曲目内容（歌单ID: ${playlistId}）。Spotify 新规定 /playlists/{id}/items ` +
          `只对你自己拥有或协作的歌单返回曲目，公开歌单但不是你自己的也不行`
      );
    }

    for (const entry of resp.data.items) {
      const t = entry.item; // 字段从 track 改名成了 item
      if (!t) continue;
      tracks.push({
        spotifyId: t.id,
        name: t.name,
        artists: t.artists.map((a: any) => a.name),
        album: t.album?.name ?? "",
        durationMs: t.duration_ms,
      });
    }

    url = resp.data.next;
  }

  return tracks;
}
