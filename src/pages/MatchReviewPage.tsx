import { useEffect, useState } from "react";
import { AppConfig, ImportSummary, MatchProgressEvent, TrackMatch } from "../../shared/types";

interface Props {
  config: AppConfig;
  loggedIn: boolean;
  matches: TrackMatch[];
  onMatchesChange: (matches: TrackMatch[]) => void;
}

export default function MatchReviewPage({ config, loggedIn, matches, onMatchesChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MatchProgressEvent | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return window.api.onMatchProgress(setProgress);
  }, []);

  async function runExportAndMatch() {
    setError(null);
    setSummary(null);
    setLoading(true);
    setProgress(null);
    try {
      const result = await window.api.exportAndMatch(config);
      onMatchesChange(result);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  function selectCandidate(trackIndex: number, neteaseId: number | null) {
    const next = matches.slice();
    next[trackIndex] = { ...next[trackIndex], selectedNeteaseId: neteaseId };
    onMatchesChange(next);
  }

  async function runImport() {
    setError(null);
    setImporting(true);
    try {
      const result = await window.api.importToNetease(matches, config.neteasePlaylistName);
      setSummary(result);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setImporting(false);
    }
  }

  if (!loggedIn) {
    return (
      <div className="panel">
        <h2>匹配 & 导入</h2>
        <p>还没登录网易云，先回到上一步扫码登录。</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>匹配 & 导入</h2>

      <div className="toolbar">
        <button onClick={runExportAndMatch} disabled={loading}>
          {loading ? "正在导出并匹配..." : "从 Spotify 导出并匹配"}
        </button>
        <button type="button" className="secondary" onClick={() => window.api.openLogFolder()}>
          查看日志
        </button>
      </div>

      {progress && (
        <div className="progress">
          <progress value={progress.done} max={progress.total} />
          <span>
            {progress.done}/{progress.total} — {progress.currentTrackName}
          </span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {matches.length > 0 && (
        <>
          <table className="match-table">
            <thead>
              <tr>
                <th>Spotify 曲目</th>
                <th>匹配结果</th>
                <th>置信度</th>
                <th>换一个</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => {
                const selected = m.candidates.find((c) => c.id === m.selectedNeteaseId);
                return (
                  <tr key={m.spotifyTrack.spotifyId} className={`row-${m.status}`}>
                    <td>
                      {m.spotifyTrack.name}
                      <div className="artist">{m.spotifyTrack.artists.join("/")}</div>
                    </td>
                    <td>
                      {selected ? (
                        <>
                          {selected.name}
                          <div className="artist">{selected.artists}</div>
                        </>
                      ) : (
                        <span className="artist">跳过/未匹配</span>
                      )}
                    </td>
                    <td>{selected ? selected.score.toFixed(2) : "-"}</td>
                    <td>
                      <select
                        value={m.selectedNeteaseId ?? ""}
                        onChange={(e) =>
                          selectCandidate(i, e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">跳过这首</option>
                        {m.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} - {c.artists} ({c.score.toFixed(2)})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button onClick={runImport} disabled={importing}>
            {importing ? "正在导入..." : `导入到网易云《${config.neteasePlaylistName}》`}
          </button>
        </>
      )}

      {summary && (
        <div className="summary">
          <p>
            导入完成：成功 {summary.matchedCount} 首，跳过/未匹配 {summary.unmatchedCount} 首。
          </p>
          {summary.unmatchedTracks.length > 0 && (
            <details>
              <summary>查看未匹配清单</summary>
              <ul>
                {summary.unmatchedTracks.map((t) => (
                  <li key={t.spotifyId}>
                    {t.name} - {t.artists.join("/")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
