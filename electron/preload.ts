import { contextBridge, ipcRenderer } from "electron";
import { AppConfig, ExportMatchOutcome, IPC, MatchProgressEvent, TrackMatch } from "../shared/types";

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.loadConfig),
  saveConfig: (config: AppConfig): Promise<void> => ipcRenderer.invoke(IPC.saveConfig, config),

  isSpotifyLoggedIn: (): Promise<boolean> => ipcRenderer.invoke(IPC.spotifyIsLoggedIn),
  loginSpotify: (config: AppConfig): Promise<void> => ipcRenderer.invoke(IPC.spotifyLogin, config),

  isNeteaseLoggedIn: (): Promise<boolean> => ipcRenderer.invoke(IPC.neteaseIsLoggedIn),
  startNeteaseLogin: () => ipcRenderer.invoke(IPC.neteaseLoginStart),
  pollNeteaseLogin: (unikey: string) => ipcRenderer.invoke(IPC.neteaseLoginPoll, unikey),

  exportAndMatch: (config: AppConfig, resume: boolean): Promise<ExportMatchOutcome> =>
    ipcRenderer.invoke(IPC.exportAndMatch, config, resume),

  pauseMatch: (): Promise<void> => ipcRenderer.invoke(IPC.pauseMatch),

  checkpointStatus: (playlistId: string): Promise<{ count: number } | null> =>
    ipcRenderer.invoke(IPC.checkpointStatus, playlistId),

  onMatchProgress: (cb: (e: MatchProgressEvent) => void) => {
    const listener = (_e: unknown, payload: MatchProgressEvent) => cb(payload);
    ipcRenderer.on(IPC.matchProgress, listener);
    return () => {
      ipcRenderer.removeListener(IPC.matchProgress, listener);
    };
  },

  // 每首歌处理完就会推一条，用来实时更新界面上的表格，不用等全部跑完
  onMatchResult: (cb: (m: TrackMatch) => void) => {
    const listener = (_e: unknown, payload: TrackMatch) => cb(payload);
    ipcRenderer.on(IPC.matchResult, listener);
    return () => {
      ipcRenderer.removeListener(IPC.matchResult, listener);
    };
  },

  // 一轮跑完/暂停就会推一次，不管是手动点按钮触发的还是自动重试触发的，都走这一个事件
  onMatchOutcome: (cb: (o: ExportMatchOutcome) => void) => {
    const listener = (_e: unknown, payload: ExportMatchOutcome) => cb(payload);
    ipcRenderer.on(IPC.matchOutcome, listener);
    return () => {
      ipcRenderer.removeListener(IPC.matchOutcome, listener);
    };
  },

  // 限流/网络问题触发自动暂停之后，安排了自动重试的时间点（毫秒时间戳）
  onAutoRestartScheduled: (cb: (payload: { resumeAt: number }) => void) => {
    const listener = (_e: unknown, payload: { resumeAt: number }) => cb(payload);
    ipcRenderer.on(IPC.autoRestartScheduled, listener);
    return () => {
      ipcRenderer.removeListener(IPC.autoRestartScheduled, listener);
    };
  },

  // 自动重试本身失败了（比如这段时间里登录过期了），不会清空当前结果，只是提示一下
  onAutoRestartFailed: (cb: (payload: { message: string }) => void) => {
    const listener = (_e: unknown, payload: { message: string }) => cb(payload);
    ipcRenderer.on(IPC.autoRestartFailed, listener);
    return () => {
      ipcRenderer.removeListener(IPC.autoRestartFailed, listener);
    };
  },

  importToNetease: (matches: TrackMatch[], playlistName: string) =>
    ipcRenderer.invoke(IPC.importToNetease, matches, playlistName),

  openLogFolder: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFolder),
};

contextBridge.exposeInMainWorld("api", api);

export type PreloadApi = typeof api;
