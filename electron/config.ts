import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { AppConfig, SpotifyTokenData, TrackMatch } from "../shared/types";

const DEFAULT_CONFIG: AppConfig = {
  spotifyClientId: "",
  spotifyPlaylistId: "",
  neteasePlaylistName: "从Spotify搬来的歌单",
};

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function loadConfig(): AppConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}

export function dataDir(): string {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cookiePath(): string {
  return path.join(dataDir(), "netease-cookie.txt");
}

export function loadCookie(): string | null {
  const p = cookiePath();
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : null;
}

export function saveCookie(cookie: string): void {
  fs.writeFileSync(cookiePath(), cookie, "utf-8");
}

function spotifyTokenPath(): string {
  return path.join(dataDir(), "spotify-token.json");
}

export function loadSpotifyToken(): SpotifyTokenData | null {
  const p = spotifyTokenPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function saveSpotifyToken(token: SpotifyTokenData): void {
  fs.writeFileSync(spotifyTokenPath(), JSON.stringify(token, null, 2), "utf-8");
}

export function clearSpotifyToken(): void {
  const p = spotifyTokenPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function checkpointPath(playlistId: string): string {
  // 文件名里可能有 / 之类的字符（虽然一般不会），保险起见处理一下
  const safeId = playlistId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dataDir(), `checkpoint-${safeId}.json`);
}

export function loadCheckpoint(playlistId: string): TrackMatch[] | null {
  const p = checkpointPath(playlistId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function saveCheckpoint(playlistId: string, results: TrackMatch[]): void {
  fs.writeFileSync(checkpointPath(playlistId), JSON.stringify(results), "utf-8");
}

export function clearCheckpoint(playlistId: string): void {
  const p = checkpointPath(playlistId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
