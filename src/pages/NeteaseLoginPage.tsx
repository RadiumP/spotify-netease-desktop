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
    // 点"重新登录"的时候先把旧二维码清掉，保证马上就能看到"生成中"的状态，
    // 而不是卡在上一屏什么都不动
    setQrimg(null);
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
        setQrimg(null); // 登录成功了，二维码状态清掉，回到"已登录"这一屏
        onLoggedIn();
      } else {
        setStatusText(message || "等待扫码...");
      }
    }, 2000);
  }

  // 只要正在生成/展示二维码（不管之前是不是已经登录过），就优先显示这个，
  // 不然点"重新登录"永远进不了扫码流程
  if (qrimg || statusText === "生成二维码中...") {
    const expired = statusText === "二维码已过期，请重新生成";
    return (
      <div className="panel">
        <h2>网易云登录</h2>
        <div className="qr-box">
          {qrimg && <img src={qrimg} alt="网易云登录二维码" width={200} height={200} />}
          <p>{statusText}</p>
          {expired && <button onClick={startLogin}>重新生成二维码</button>}
        </div>
      </div>
    );
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
      <button onClick={startLogin}>生成二维码</button>
    </div>
  );
}
