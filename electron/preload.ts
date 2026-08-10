import { contextBridge, ipcRenderer } from "electron";
import { AppConfig, IPC, MatchProgressEvent, TrackMatch } from "../shared/types";

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.loadConfig),
  saveConfig: (config: AppConfig): Promise<void> => ipcRenderer.invoke(IPC.saveConfig, config),

  isSpotifyLoggedIn: (): Promise<boolean> => ipcRenderer.invoke(IPC.spotifyIsLoggedIn),
  loginSpotify: (config: AppConfig): Promise<void> => ipcRenderer.invoke(IPC.spotifyLogin, config),

  isNeteaseLoggedIn: (): Promise<boolean> => ipcRenderer.invoke(IPC.neteaseIsLoggedIn),
  startNeteaseLogin: () => ipcRenderer.invoke(IPC.neteaseLoginStart),
  pollNeteaseLogin: (unikey: string) => ipcRenderer.invoke(IPC.neteaseLoginPoll, unikey),

  exportAndMatch: (config: AppConfig, resume: boolean): Promise<TrackMatch[]> =>
    ipcRenderer.invoke(IPC.exportAndMatch, config, resume),

  checkpointStatus: (playlistId: string): Promise<{ count: number } | null> =>
    ipcRenderer.invoke(IPC.checkpointStatus, playlistId),

  onMatchProgress: (cb: (e: MatchProgressEvent) => void) => {
    const listener = (_e: unknown, payload: MatchProgressEvent) => cb(payload);
    ipcRenderer.on(IPC.matchProgress, listener);
    return () => {
      ipcRenderer.removeListener(IPC.matchProgress, listener);
    };
  },

  importToNetease: (matches: TrackMatch[], playlistName: string) =>
    ipcRenderer.invoke(IPC.importToNetease, matches, playlistName),

  openLogFolder: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFolder),
};

contextBridge.exposeInMainWorld("api", api);

export type PreloadApi = typeof api;
