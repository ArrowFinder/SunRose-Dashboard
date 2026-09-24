import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { isInternalUser } from "../lib/permissions";
import { elapsedMs } from "../lib/timer";

function formatElapsed(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TimerBar() {
  const { activeTimer, data, stopTimer, currentUser, saving, correctTimer } =
    useAppState();
  const [correcting, setCorrecting] = useState(false);
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
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
      {ms > 8 * 3600000 && (
        <span role="status">
          This timer has been running for over 8 hours. Check it before saving.
        </span>
      )}
      <strong style={{ color: "var(--accent)" }}>Timer</strong>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {formatElapsed(ms)}
      </span>
      {item && (
        <span>
          {item.title}
          {client ? <span className="muted"> · {client.name}</span> : null}
        </span>
      )}
      {item && (
        <Link
          to={`/client/${item.clientId}`}
          className="btn btn-ghost"
          style={{ padding: "0.25rem 0.5rem" }}
        >
          Open task
        </Link>
      )}
      {correctTimer && (
        <button
          className="btn"
          disabled={saving}
          onClick={() => {
            const now = new Date();
            setEndTime(
              new Date(now.getTime() - now.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16),
            );
            setReason("");
            setError("");
            setCorrecting(true);
          }}
        >
          Correct timer
        </button>
      )}
      {correcting && correctTimer && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Correct timer"
        >
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                await correctTimer(
                  new Date(endTime).toISOString(),
                  reason.trim(),
                );
                setCorrecting(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not correct timer.",
                );
              }
            }}
          >
            <h2>Correct a forgotten timer</h2>
            <p>
              Started {new Date(activeTimer.startedAt).toLocaleString()}. Choose
              when work actually ended. Times use your device’s timezone.
            </p>
            <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
              <label>
                Actual end time
                <input
                  className="input"
                  type="datetime-local"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
              <label>
                Reason
                <input
                  className="input"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCorrecting(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary">Save corrected time</button>
              </div>
            </fieldset>
          </form>
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        style={{ padding: "0.35rem 0.75rem" }}
        disabled={saving}
        onClick={() => {
          void stopTimer().catch(() => {});
        }}
      >
        Stop & save
      </button>
    </div>
  );
}
