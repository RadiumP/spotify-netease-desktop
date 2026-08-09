import { PreloadApi } from "../electron/preload";

declare global {
  interface Window {
    api: PreloadApi;
  }
}

export {};
