import { FormEvent, useEffect, useRef, useState } from "react";
import { AppConfig, SPOTIFY_REDIRECT_URI } from "../../shared/types";

interface Props {
  config: AppConfig;
  onChange: (config: AppConfig) => void; // 每次输入都立刻同步给父组件，别只存在子组件本地
  onSave: (config: AppConfig) => void;
}

export default function SettingsPage({ config, onChange, onSave }: Props) {
  const [spotifyLoggedIn, setSpotifyLoggedIn] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    window.api.isSpotifyLoggedIn().then(setSpotifyLoggedIn);
  }, []);

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    // 直接改父组件那份状态，不是子组件自己另存一份——这样切到别的 tab 再切回来，
    // 显示的还是最新输入的值，不会因为组件重新挂载就"回退"成旧数据
    onChange({ ...config, [key]: value });
  }

  // config 变化后停顿 800ms 没再输入就自动落盘，不用非得点"保存并下一步"
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      window.api.saveConfig(config).then(() => {
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 1500);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [config]);

  async function copyRedirectUri() {
    await navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSpotifyLogin() {
    setLoginError(null);
    setLoggingIn(true);
    try {
      await window.api.saveConfig(config);
      await window.api.loginSpotify(config);
      setSpotifyLoggedIn(true);
    } catch (err: any) {
      setLoginError(err?.message ?? String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave(config);
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>设置</h2>

      <div className="setup-guide">
        <p className="hint">
          第一次用需要有一个自己的 Spotify App（只有你自己用，不是给别人开发的意思，几分钟能建好）：
        </p>
        <ol>
          <li>
            <a href="#" onClick={(e) => { e.preventDefault(); window.open("https://developer.spotify.com/dashboard"); }}>
              打开 Spotify 开发者后台
            </a>
            ，登录后点 "Create app"
          </li>
          <li>App name / description 随便填，Redirect URI 这一栏粘贴下面这个：</li>
        </ol>
        <div className="copy-row">
          <code>{SPOTIFY_REDIRECT_URI}</code>
          <button type="button" onClick={copyRedirectUri}>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <ol start={3}>
          <li>勾选 "Web API"，保存</li>
          <li>进 App 详情页，把 Client ID 复制到下面填上</li>
        </ol>
      </div>

      <label>
        Spotify Client ID
        <input
          value={config.spotifyClientId}
          onChange={(e) => update("spotifyClientId", e.target.value)}
          placeholder="App 详情页里能看到"
        />
      </label>

      <div className="spotify-login-box">
        {spotifyLoggedIn ? (
          <p className="ok">✓ 已登录 Spotify</p>
        ) : (
          <button type="button" onClick={handleSpotifyLogin} disabled={loggingIn || !config.spotifyClientId}>
            {loggingIn ? "等待浏览器授权..." : "登录 Spotify"}
          </button>
        )}
        {loginError && <p className="error">{loginError}</p>}
      </div>

      <label>
        Spotify 歌单 ID
        <input
          value={config.spotifyPlaylistId}
          onChange={(e) => update("spotifyPlaylistId", e.target.value)}
          placeholder="歌单分享链接 playlist/ 后面那串，必须是你自己拥有或协作的歌单"
        />
      </label>

      <label>
        网易云新建歌单名字
        <input
          value={config.neteasePlaylistName}
          onChange={(e) => update("neteasePlaylistName", e.target.value)}
        />
      </label>

      <div className="toolbar">
        <button type="submit">保存并下一步</button>
        {autoSaved && <span className="ok">已自动保存</span>}
      </div>
    </form>
  );
}
