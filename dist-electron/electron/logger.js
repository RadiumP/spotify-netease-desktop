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
exports.log = log;
exports.openLogFolder = openLogFolder;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
function logDir() {
    const dir = path.join(electron_1.app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function logFilePath() {
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD，按天分文件，别无限增长
    return path.join(logDir(), `app-${dateStr}.log`);
}
function log(level, message, extra) {
    const time = new Date().toISOString();
    let line = `[${time}] [${level.toUpperCase()}] ${message}`;
    if (extra !== undefined) {
        try {
            line += " " + JSON.stringify(extra);
        }
        catch {
            line += " " + String(extra);
        }
    }
    // 终端里（npm run dev 时）也能看到，同时落盘
    if (level === "error")
        console.error(line);
    else if (level === "warn")
        console.warn(line);
    else
        console.log(line);
    try {
        fs.appendFileSync(logFilePath(), line + "\n", "utf-8");
    }
    catch {
        // 写日志失败就算了，别因为日志本身把主流程搞挂
    }
}
function openLogFolder() {
    electron_1.shell.openPath(logDir());
}
