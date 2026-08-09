import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" 很重要 —— 打包后是用 file:// 协议加载 index.html，
// 用绝对路径 "/assets/xxx" 会找不到文件
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
