"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.dataDir = dataDir;
exports.cookiePath = cookiePath;
exports.loadCookie = loadCookie;
exports.saveCookie = saveCookie;
exports.loadSpotifyToken = loadSpotifyToken;
exports.saveSpotifyToken = saveSpotifyToken;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const DEFAULT_CONFIG = {
    spotifyClientId: "",
    spotifyPlaylistId: "",
    neteasePlaylistName: "从Spotify搬来的歌单",
};
function configPath() {
    return path.join(electron_1.app.getPath("userData"), "config.json");
}
function loadConfig() {
    const p = configPath();
    if (!fs.existsSync(p))
        return DEFAULT_CONFIG;
    try {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        return { ...DEFAULT_CONFIG, ...raw };
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
function saveConfig(config) {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}
function dataDir() {
    const dir = path.join(electron_1.app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function cookiePath() {
    return path.join(dataDir(), "netease-cookie.txt");
}
function loadCookie() {
    const p = cookiePath();
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : null;
}
function saveCookie(cookie) {
    fs.writeFileSync(cookiePath(), cookie, "utf-8");
}
function spotifyTokenPath() {
    return path.join(dataDir(), "spotify-token.json");
}
function loadSpotifyToken() {
    const p = spotifyTokenPath();
    if (!fs.existsSync(p))
        return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    catch {
        return null;
    }
}
function saveSpotifyToken(token) {
    fs.writeFileSync(spotifyTokenPath(), JSON.stringify(token, null, 2), "utf-8");
}
