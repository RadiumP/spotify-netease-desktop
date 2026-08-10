// electron 主进程和 renderer 都会引用这个文件，别放任何依赖具体环境（node/dom）的代码进来

export interface AppConfig {
  spotifyClientId: string;
  spotifyPlaylistId: string;
  neteasePlaylistName: string;
}

// PKCE 授权码流程用的本地回调地址，设置页和主进程都要用到这个值
export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8888/callback";

export interface SpotifyTrack {
  spotifyId: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

// 一首歌在网易云的候选结果，用于人工换选
export interface NeteaseCandidate {
  id: number;
  name: string;
  artists: string;
  score: number; // 0~1
}

export type MatchStatus = "matched" | "uncertain" | "notfound" | "skipped";

export interface TrackMatch {
  spotifyTrack: SpotifyTrack;
  candidates: NeteaseCandidate[];
  // 当前选中的候选（默认是分数最高的那个），null 表示跳过/没有可用候选
  selectedNeteaseId: number | null;
  status: MatchStatus;
}

// main -> renderer 的匹配进度事件
export interface MatchProgressEvent {
  done: number;
  total: number;
  currentTrackName: string;
}

// exportAndMatch 跑完（或者自动暂停）之后的结果。以前是"失败就整批 throw 掉"，
// 现在改成正常返回，aborted=true 表示是自动暂停（限流/网络问题），results 里已经
// 匹配到的部分照样可以拿去导入，不用等真正跑完
export interface ExportMatchOutcome {
  results: TrackMatch[];
  aborted: boolean;
  abortReason?: string;
}

// 网易云登录状态：801 等待扫码 / 802 已扫码待确认 / 803 登录成功 / 800 二维码过期
export interface NeteaseLoginStatus {
  code: 800 | 801 | 802 | 803;
  message: string;
}

export interface ImportSummary {
  playlistId: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatchedTracks: SpotifyTrack[];
}

export interface SpotifyTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // 毫秒时间戳
}

export const IPC = {
  loadConfig: "config:load",
  saveConfig: "config:save",
  spotifyLogin: "spotify:login",
  spotifyIsLoggedIn: "spotify:is-logged-in",
  neteaseLoginStart: "netease:login-start",
  neteaseLoginPoll: "netease:login-poll",
  neteaseLoginStatusCheck: "netease:login-check",
  neteaseIsLoggedIn: "netease:is-logged-in",
  exportAndMatch: "flow:export-and-match",
  checkpointStatus: "flow:checkpoint-status",
  matchProgress: "flow:match-progress", // main -> renderer 推送
  matchResult: "flow:match-result", // main -> renderer 推送，每首歌处理完就推一条
  importToNetease: "flow:import",
  openLogFolder: "log:open-folder",
} as const;
