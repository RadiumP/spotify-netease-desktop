import { useEffect, useRef, useState } from "react";

interface Props {
  loggedIn: boolean;
  onLoggedIn: () => void;
}

export default function NeteaseLoginPage({ loggedIn, onLoggedIn }: Props) {
  const [qrimg, setQrimg] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function startLogin() {
    setStatusText("生成二维码中...");
    const { unikey, qrimgBase64 } = await window.api.startNeteaseLogin();
    setQrimg(qrimgBase64);
    setStatusText("请用网易云音乐 App 扫码");

    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      const { code, message } = await window.api.pollNeteaseLogin(unikey);
      if (code === 800) {
        setStatusText("二维码已过期，请重新生成");
        if (pollTimer.current) clearInterval(pollTimer.current);
      } else if (code === 802) {
        setStatusText("已扫码，请在手机上确认登录");
      } else if (code === 803) {
        setStatusText("登录成功");
        if (pollTimer.current) clearInterval(pollTimer.current);
        onLoggedIn();
      } else {
        setStatusText(message || "等待扫码...");
      }
    }, 2000);
  }

  if (loggedIn) {
    return (
      <div className="panel">
        <h2>网易云登录</h2>
        <p>已登录，可以进入下一步了。</p>
        <button onClick={startLogin}>重新登录（换账号）</button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>网易云登录</h2>
      {!qrimg && <button onClick={startLogin}>生成二维码</button>}
      {qrimg && (
        <div className="qr-box">
          <img src={qrimg} alt="网易云登录二维码" width={200} height={200} />
          <p>{statusText}</p>
        </div>
      )}
    </div>
  );
}
