import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { isInternalUser } from "../lib/permissions";
import { elapsedMs } from "../lib/timer";

function formatElapsed(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TimerBar() {
  const { activeTimer, data, stopTimer, currentUser } = useAppState();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!activeTimer) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  if (!activeTimer || !currentUser || !isInternalUser(currentUser)) {
    return null;
  }

  const item = data.workItems.find((w) => w.id === activeTimer.workItemId);
  const client = item ? data.clients.find((c) => c.id === item.clientId) : null;
  const ms = elapsedMs(activeTimer.startedAt);

  return (
    <div
      className="timer-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
        padding: "0.5rem 1rem",
        background: "var(--accent-soft)",
        borderBottom: "1px solid var(--border)",
        fontSize: "0.9rem",
      }}
    >
      <strong style={{ color: "var(--accent)" }}>Timer</strong>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatElapsed(ms)}</span>
      {item && (
        <span>
          {item.title}
          {client ? <span className="muted"> · {client.name}</span> : null}
        </span>
      )}
      {item && (
        <Link to={`/client/${item.clientId}`} className="btn btn-ghost" style={{ padding: "0.25rem 0.5rem" }}>
          Open task
        </Link>
      )}
      <button type="button" className="btn btn-primary" style={{ padding: "0.35rem 0.75rem" }} onClick={() => void stopTimer()}>
        Stop & save
      </button>
    </div>
  );
}
