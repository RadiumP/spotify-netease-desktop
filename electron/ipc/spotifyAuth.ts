/**
 * PKCE 授权码流程（Spotify 官方推荐给桌面/移动端这种"没法安全保管 Client Secret"的应用用的方式）。
 * 好处：朋友只要填一个 Client ID 就能用，不需要 Client Secret，也就不用担心 Secret 跟着安装包
 * 一起分发出去被人看到。
 *
 * 走法跟之前一样，本地起个临时 HTTP 服务收 Spotify 的回调，只是多了 code_verifier/code_challenge
 * 这一对，用来证明"发起授权请求的和来换 token 的是同一个客户端"，替代了 Client Secret 的作用。
 */
import * as http from "http";
import * as crypto from "crypto";
import axios from "axios";
import { shell } from "electron";
import { SpotifyTokenData, SPOTIFY_REDIRECT_URI } from "../../shared/types";

const REDIRECT_PORT = 8888;
const SCOPES = "playlist-read-private playlist-read-collaborative";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function buildAuthUrl(clientId: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function waitForCallback(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", SPOTIFY_REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error || !code || returnedState !== state) {
        res.end("<h2>登录失败，回到应用里重试一下。这个页面可以关掉了。</h2>");
      } else {
        res.end("<h2>登录成功，回到应用继续操作吧。这个页面可以关掉了。</h2>");
      }

      server.close();

      if (error) return reject(new Error(`Spotify 拒绝了授权: ${error}`));
      if (!code || returnedState !== state) return reject(new Error("state 不匹配，可能是安全问题，重新登录一次"));
      resolve(code);
    });

    server.on("error", reject);
    server.listen(REDIRECT_PORT);

    setTimeout(() => {
      server.close();
      reject(new Error("登录超时（5分钟），请重新点登录"));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCodeForToken(
  clientId: string,
  code: string,
  codeVerifier: string
): Promise<SpotifyTokenData> {
  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return {
    accessToken: resp.data.access_token,
    refreshToken: resp.data.refresh_token,
    expiresAt: Date.now() + resp.data.expires_in * 1000,
  };
}

export async function loginWithBrowser(clientId: string): Promise<SpotifyTokenData> {
  if (!clientId) {
    throw new Error("请先在设置页填好 Spotify Client ID");
  }

  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const callbackPromise = waitForCallback(state);

  await shell.openExternal(buildAuthUrl(clientId, state, codeChallenge));

  const code = await callbackPromise;
  return exchangeCodeForToken(clientId, code, codeVerifier);
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string
): Promise<SpotifyTokenData> {
  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return {
    accessToken: resp.data.access_token,
    refreshToken: resp.data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + resp.data.expires_in * 1000,
  };
}
