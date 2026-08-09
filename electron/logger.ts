import * as fs from "fs";
import * as path from "path";
import { app, shell } from "electron";

function logDir(): string {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logFilePath(): string {
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD，按天分文件，别无限增长
  return path.join(logDir(), `app-${dateStr}.log`);
}

export function log(level: "info" | "warn" | "error", message: string, extra?: unknown): void {
  const time = new Date().toISOString();
  let line = `[${time}] [${level.toUpperCase()}] ${message}`;
  if (extra !== undefined) {
    try {
      line += " " + JSON.stringify(extra);
    } catch {
      line += " " + String(extra);
    }
  }

  // 终端里（npm run dev 时）也能看到，同时落盘
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  try {
    fs.appendFileSync(logFilePath(), line + "\n", "utf-8");
  } catch {
    // 写日志失败就算了，别因为日志本身把主流程搞挂
  }
}

export function openLogFolder(): void {
  shell.openPath(logDir());
}
