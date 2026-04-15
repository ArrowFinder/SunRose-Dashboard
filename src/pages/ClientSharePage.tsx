import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { MonthSnapshot } from "../components/MonthSnapshot";
import { ScopeAlert } from "../components/ScopeAlert";
import { currentYearMonth, labelYearMonth } from "../lib/month";
import { itemsForMonth, monthSnapshot } from "../lib/scopeMath";
import { STATUS_LABELS } from "../lib/labels";
import type { WorkItem } from "../lib/types";

function sortForClientView(items: WorkItem[]): WorkItem[] {
  const order: WorkItem["status"][] = ["in_progress", "planned", "backlog", "done"];
  return [...items].sort((a, b) => {
    const io = order.indexOf(a.status) - order.indexOf(b.status);
    if (io !== 0) return io;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.title.localeCompare(b.title);
  });
}

export function ClientSharePage() {
  const { token } = useParams<{ token: string }>();
  const { data, addWorkItem } = useAppState();
  const [yearMonth] = useState(currentYearMonth);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [est, setEst] = useState(2);
  const [submitted, setSubmitted] = useState(false);

  const client = useMemo(
    () => data.clients.find((c) => c.shareToken === token),
    [data.clients, token]
  );

  const snap = useMemo(() => {
    if (!client) return null;
    return monthSnapshot(client, data.workItems, yearMonth, data.timeEntries);
  }, [client, data.workItems, data.timeEntries, yearMonth]);

  const items = useMemo(() => {
    if (!client) return [];
    return sortForClientView(itemsForMonth(data.workItems, client.id, yearMonth)).filter(
      (w) => w.status !== "done"
    );
  }, [client, data.workItems, yearMonth]);

  if (!client) {
    return (
      <div className="client-share">
        <div className="card empty">
          <h1>Dashboard</h1>
          <p>
            This link doesn’t match any client on <strong>this</strong> device. If you’re the
            client, ask your agency to send the page while they’re logged in, or use a published
            backup.
          </p>
        </div>
      </div>
    );
  }

  function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !client) return;
    addWorkItem({
      clientId: client.id,
      yearMonth,
      title: title.trim(),
      description: description.trim(),
      source: "client",
      status: "backlog",
      scopeCategory: "needs_approval",
      estimatedHours: Math.max(0.25, est),
      actualHours: 0,
      priority: 50,
      dueDate: null,
      assignedUserId: null,
      templateId: null,
    });
    setTitle("");
    setDescription("");
    setEst(2);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
  }

  return (
    <div className="client-share">
      <header style={{ marginBottom: "1rem" }}>
        <p className="muted" style={{ margin: 0 }}>
          Shared scope view
        </p>
        <h1>{client.name}</h1>
        <p className="muted" style={{ margin: "0.25rem 0 0" }}>
          {labelYearMonth(yearMonth)}
        </p>
      </header>

      {snap && (
        <div className="card">
          <MonthSnapshot snap={snap} />
          <ScopeAlert snap={snap} />
        </div>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem" }}>What we’re focused on</h2>
        {items.length === 0 ? (
          <p className="muted">Nothing queued for this month yet.</p>
        ) : (
          <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {items.map((w) => (
              <li key={w.id} style={{ marginBottom: "0.5rem" }}>
                <strong>{w.title}</strong>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {" "}
                  · {STATUS_LABELS[w.status]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem" }}>New request</h2>
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: 0 }}>
          Adds to our backlog as &quot;needs approval&quot; so we can align with your retainer.
        </p>
        <form onSubmit={submitRequest}>
          <div className="field">
            <label htmlFor="rt">What do you need?</label>
            <input
              id="rt"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rd">Details (optional)</label>
            <textarea
              id="rd"
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field" style={{ maxWidth: "140px" }}>
            <label htmlFor="re">Rough hours (guess)</label>
            <input
              id="re"
              className="input"
              type="number"
              min={0.25}
              step={0.25}
              value={est}
              onChange={(e) => setEst(Number(e.target.value))}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Submit request
          </button>
          {submitted && (
            <p style={{ color: "var(--ok)", marginTop: "0.75rem", marginBottom: 0 }}>
              Received — we’ll follow up.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
