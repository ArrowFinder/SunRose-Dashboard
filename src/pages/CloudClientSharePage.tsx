import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import type { SharedView } from "../lib/database.types";
import { currentYearMonth } from "../lib/month";
import { STATUS_LABELS } from "../lib/labels";
import { uid } from "../lib/id";
export function CloudClientSharePage() {
  const { token = "" } = useParams();
  const [month, setMonth] = useState(currentYearMonth);
  const [view, setView] = useState<SharedView | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(uid);
  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError("");
    async function load() {
      const result = await getSupabase().rpc("shared_client_view", {
        token,
        month,
      });
      if (cancelled) return;
      if (result.error) {
        setView(null);
        setError(
          "This client link is unavailable. Ask your agency for a current link.",
        );
      } else {
        setView(result.data);
        setError("");
      }
    }
    void load().catch(() => {
      if (!cancelled) setError("Unable to connect. Please refresh.");
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, month, notice]);
  return (
    <main className="client-share">
      <h1>{view?.client.name ?? "Client workspace"}</h1>
      <label>
        Month
        <input
          className="input"
          type="month"
          required
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!view && !error && <p>Loading…</p>}
      {view && (
        <>
          <section className="card">
            <h2>Your work</h2>
            {view.items.length === 0 ? (
              <p>No shared tasks this month.</p>
            ) : (
              <ul>
                {view.items.map((w) => (
                  <li key={w.id}>
                    <strong>{w.title}</strong> · {STATUS_LABELS[w.status]}
                    {w.dueDate ? ` · Due ${w.dueDate}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const result = await getSupabase().rpc(
                  "submit_client_request",
                  {
                    token,
                    request_id: requestId,
                    request_title: title,
                    request_description: description,
                  },
                );
                if (result.error) throw result.error;
                setTitle("");
                setDescription("");
                setRequestId(uid());
                setNotice(
                  "Request received. The agency will review the scope, timing, and assignment.",
                );
              } catch {
                setError(
                  "We could not confirm your request was saved. Retry to confirm without creating a duplicate.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>New request</h2>
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <label>
                What do you need?
                <input
                  className="input"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Details
                <textarea
                  className="input"
                  maxLength={10000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button className="btn btn-primary">
                {busy ? "Sending…" : "Submit request"}
              </button>
            </fieldset>
            {notice && <p role="status">{notice}</p>}
          </form>
        </>
      )}
    </main>
  );
}
