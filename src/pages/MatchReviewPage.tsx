import { useEffect, useRef, useState } from "react";
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
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [checkpointCount, setCheckpointCount] = useState<number | null>(null);

  // 实时结果用 ref 存一份，避免闭包里拿到过期的 matches；界面显示还是走 onMatchesChange 触发的 state
  const liveMatchesRef = useRef<TrackMatch[]>([]);

  useEffect(() => {
    return window.api.onMatchProgress(setProgress);
  }, []);

  useEffect(() => {
    // 每首歌处理完就实时追加到表格里，不用等全部跑完
    return window.api.onMatchResult((m) => {
      liveMatchesRef.current = [...liveMatchesRef.current, m];
      onMatchesChange(liveMatchesRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!config.spotifyPlaylistId) return;
    window.api.checkpointStatus(config.spotifyPlaylistId).then((c) => setCheckpointCount(c?.count ?? null));
  }, [config.spotifyPlaylistId]);

  async function runExportAndMatch(resume: boolean) {
    setError(null);
    setPausedReason(null);
    setSummary(null);
    setLoading(true);
    setProgress(null);
    liveMatchesRef.current = []; // 不管是不是断点续传，流式事件会把该有的（含之前处理过的）都重新推一遍
    onMatchesChange([]);
    try {
      const outcome = await window.api.exportAndMatch(config, resume);
      onMatchesChange(outcome.results); // 用最终结果对齐一次，防止个别流式事件丢失导致的不一致
      if (outcome.aborted) {
        setPausedReason(outcome.abortReason ?? "已自动暂停");
      }
      setCheckpointCount(outcome.aborted ? outcome.results.length : null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      window.api.checkpointStatus(config.spotifyPlaylistId).then((c) => setCheckpointCount(c?.count ?? null));
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

      {checkpointCount !== null && !loading && (
        <div className="checkpoint-box">
          <p>检测到上次没跑完的进度，已经处理过 {checkpointCount} 首。</p>
          <div className="toolbar">
            <button onClick={() => runExportAndMatch(true)}>从上次继续</button>
            <button type="button" className="secondary" onClick={() => runExportAndMatch(false)}>
              重新开始
            </button>
          </div>
        </div>
      )}

      {checkpointCount === null && (
        <div className="toolbar">
          <button onClick={() => runExportAndMatch(false)} disabled={loading}>
            {loading ? "正在导出并匹配..." : "从 Spotify 导出并匹配"}
          </button>
          <button type="button" className="secondary" onClick={() => window.api.openLogFolder()}>
            查看日志
          </button>
        </div>
      )}

      {progress && (
        <div className="progress">
          <progress value={progress.done} max={progress.total} />
          <span>
            {progress.done}/{progress.total} — {progress.currentTrackName}
          </span>
        </div>
      )}

      {pausedReason && (
        <div className="checkpoint-box">
          <p>⏸ 已自动暂停：{pausedReason}</p>
          <p>下面表格里已经是目前搜到的部分，可以先导入这些，剩下的等会儿再接着跑。</p>
        </div>
      )}

      {error && (
        <div className="error-box">
          <p className="error">{error}</p>
          <button type="button" className="secondary" onClick={() => window.api.openLogFolder()}>
            查看日志
          </button>
        </div>
      )}

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

          {pausedReason && (
            <p className="hint">
              现在导入会加进网易云里同名的歌单（没有就新建），已经在里面的歌会自动跳过不重复加。
              剩下的接着跑完之后再导入一次就行，不用担心变成两个歌单。
            </p>
          )}

          <button onClick={runImport} disabled={importing || loading}>
            {importing ? "正在导入..." : `导入到网易云《${config.neteasePlaylistName}》`}
          </button>
        </>
      )}

      {summary && (
        <div className="summary">
          <p>
            {summary.reusedExistingPlaylist ? "已加入到已有歌单：" : "已新建歌单并导入："}
            新增 {summary.matchedCount} 首
            {summary.duplicateCount > 0 && `，跳过 ${summary.duplicateCount} 首重复（歌单里已经有）`}
            ，跳过/未匹配 {summary.unmatchedCount} 首。
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
