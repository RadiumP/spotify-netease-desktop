import { useEffect, useRef, useState } from "react";
import {
  AppConfig,
  ExportMatchOutcome,
  ImportSummary,
  MatchProgressEvent,
  TrackMatch,
} from "../../shared/types";

interface Props {
  config: AppConfig;
  loggedIn: boolean;
  matches: TrackMatch[];
  onMatchesChange: (matches: TrackMatch[]) => void;
  onRunningChange: (running: boolean) => void;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m} 分 ${s.toString().padStart(2, "0")} 秒`;
}

export default function MatchReviewPage({
  config,
  loggedIn,
  matches,
  onMatchesChange,
  onRunningChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MatchProgressEvent | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [checkpointCount, setCheckpointCount] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [autoRestartAt, setAutoRestartAt] = useState<number | null>(null);
  const [autoRestartCountdown, setAutoRestartCountdown] = useState<string | null>(null);

  // 实时结果用 ref 存一份，避免闭包里拿到过期的 matches；界面显示还是走 onMatchesChange 触发的 state
  const liveMatchesRef = useRef<TrackMatch[]>([]);

  // 传输计时：跑起来就开始计时，停了就停，每次开始新一轮（不管手动还是自动重试触发）都从 0 重新计
  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // 自动重试倒计时显示
  useEffect(() => {
    if (autoRestartAt === null) {
      setAutoRestartCountdown(null);
      return;
    }
    const tick = () => setAutoRestartCountdown(formatCountdown(autoRestartAt - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [autoRestartAt]);

  useEffect(() => {
    // 每次进度事件到达，如果之前不是"跑起来"的状态，说明是后台自动重试自己触发的一轮，
    // 界面这边也得跟着切到"进行中"，不用等用户点按钮
    return window.api.onMatchProgress((p) => {
      setProgress(p);
      setLoading((prev) => {
        if (!prev) {
          onRunningChange(true);
          setAutoRestartAt(null);
        }
        return true;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 一轮跑完/暂停就会收到一次，不管这一轮是手动点按钮触发的还是后台自动重试触发的，
    // 都在这里统一处理，不用在按钮点击那边单独再处理一遍
    return window.api.onMatchOutcome((outcome: ExportMatchOutcome) => {
      onMatchesChange(outcome.results);
      setLoading(false);
      onRunningChange(false);
      setPausing(false);
      if (outcome.aborted) {
        setPausedReason(outcome.abortReason ?? "已暂停");
        setCheckpointCount(outcome.results.length);
      } else {
        setPausedReason(null);
        setCheckpointCount(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.api.onAutoRestartScheduled(({ resumeAt }) => {
      setAutoRestartAt(resumeAt);
    });
  }, []);

  useEffect(() => {
    return window.api.onAutoRestartFailed(({ message }) => {
      setAutoRestartAt(null);
      setError(`自动重试失败：${message}`);
      window.api.checkpointStatus(config.spotifyPlaylistId).then((c) => setCheckpointCount(c?.count ?? null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.spotifyPlaylistId]);

  useEffect(() => {
    if (!config.spotifyPlaylistId) return;
    window.api.checkpointStatus(config.spotifyPlaylistId).then((c) => setCheckpointCount(c?.count ?? null));
  }, [config.spotifyPlaylistId]);

  async function runExportAndMatch(resume: boolean) {
    setError(null);
    setPausedReason(null);
    setSummary(null);
    setAutoRestartAt(null);
    setLoading(true);
    onRunningChange(true);
    setPausing(false);
    setProgress(null);
    liveMatchesRef.current = []; // 不管是不是断点续传，流式事件会把该有的（含之前处理过的）都重新推一遍
    onMatchesChange([]);
    try {
      await window.api.exportAndMatch(config, resume);
      // 结果通过 onMatchOutcome 广播处理，这里不用管返回值
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setLoading(false);
      onRunningChange(false);
      window.api.checkpointStatus(config.spotifyPlaylistId).then((c) => setCheckpointCount(c?.count ?? null));
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
          {autoRestartCountdown && (
            <p>已安排自动重试，预计还有 {autoRestartCountdown} 后自动继续，也可以现在就手动继续：</p>
          )}
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
          {loading && <span className="elapsed">已用时 {formatDuration(elapsedSeconds)}</span>}
          {loading && (
            <button
              type="button"
              className="secondary"
              disabled={pausing}
              onClick={async () => {
                setPausing(true);
                await window.api.pauseMatch();
              }}
            >
              {pausing ? "正在暂停..." : "暂停"}
            </button>
          )}
        </div>
      )}

      {pausedReason && (
        <div className="checkpoint-box">
          <p>⏸ 已暂停：{pausedReason}</p>
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
              {matches
                .map((m, i) => ({ m, i })) // 先把原始下标记下来，后面换候选/导入都得用这个原始下标
                .slice()
                .reverse() // 最新处理完的排最上面，不用一直往下滚才能看到最新进度
                .map(({ m, i }) => {
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
