import { useEffect, useState } from "react";
import { AppConfig, TrackMatch } from "../shared/types";
import SettingsPage from "./pages/SettingsPage";
import NeteaseLoginPage from "./pages/NeteaseLoginPage";
import MatchReviewPage from "./pages/MatchReviewPage";

type Step = "settings" | "login" | "match";

const EMPTY_CONFIG: AppConfig = {
  spotifyClientId: "",
  spotifyPlaylistId: "",
  neteasePlaylistName: "从Spotify搬来的歌单",
};

export default function App() {
  const [step, setStep] = useState<Step>("settings");
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [loggedIn, setLoggedIn] = useState(false);
  const [matches, setMatches] = useState<TrackMatch[]>([]);

  useEffect(() => {
    window.api.loadConfig().then(setConfig);
    window.api.isNeteaseLoggedIn().then(setLoggedIn);
  }, []);

  const steps: { key: Step; label: string }[] = [
    { key: "settings", label: "1. 设置" },
    { key: "login", label: "2. 网易云登录" },
    { key: "match", label: "3. 匹配 & 导入" },
  ];

  return (
    <div className="app">
      <nav className="steps">
        {steps.map((s) => (
          <button
            key={s.key}
            className={step === s.key ? "step active" : "step"}
            onClick={() => setStep(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {step === "settings" && (
          <SettingsPage
            config={config}
            onChange={(next) => setConfig(next)}
            onSave={async (next) => {
              await window.api.saveConfig(next);
              setConfig(next);
              setStep("login");
            }}
          />
        )}

        {step === "login" && (
          <NeteaseLoginPage
            loggedIn={loggedIn}
            onLoggedIn={() => {
              setLoggedIn(true);
              setStep("match");
            }}
          />
        )}

        {step === "match" && (
          <MatchReviewPage
            config={config}
            loggedIn={loggedIn}
            matches={matches}
            onMatchesChange={setMatches}
          />
        )}
      </main>
    </div>
  );
}
