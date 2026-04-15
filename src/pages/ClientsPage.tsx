import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { downloadBackup } from "../lib/storage";

export function ClientsPage() {
  const {
    data,
    addClient,
    updateClient,
    deleteClient,
    regenerateShareToken,
    importData,
    currentUser,
  } = useAppState();
  const [name, setName] = useState("");
  const [hours, setHours] = useState(40);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (currentUser?.role === "client") {
    return currentUser.clientId ? (
      <Navigate to={`/client/${currentUser.clientId}`} replace />
    ) : (
      <Navigate to="/" replace />
    );
  }

  function shareUrl(token: string) {
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#/c/${token}`;
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setMsg("Copied to clipboard.");
    setTimeout(() => setMsg(null), 2000);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(String(reader.result));
        setMsg("Import successful.");
      } catch {
        setMsg("Could not import that file.");
      }
      e.target.value = "";
    };
    reader.readAsText(f);
  }

  return (
    <div className="stack">
      <div>
        <h1>Clients</h1>
        <p className="muted">
          Retainers, shared links, and colors (for the calendar). Reusable task templates are
          managed per client when you add or edit tasks.
        </p>
        <p>
          <Link to="/team">← Team</Link>
        </p>
      </div>

      {msg && (
        <div className="card" style={{ padding: "0.65rem 1rem", background: "var(--accent-soft)" }}>
          {msg}
        </div>
      )}

      <div className="card">
        <h2>Add client</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addClient(name.trim(), hours);
            setName("");
            setHours(40);
          }}
        >
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: "200px" }}>
              <label htmlFor="cn">Client name</label>
              <input
                id="cn"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Co."
              />
            </div>
            <div className="field" style={{ width: "140px" }}>
              <label htmlFor="rh">Retainer hrs / mo</label>
              <input
                id="rh"
                className="input"
                type="number"
                min={1}
                step={1}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>&nbsp;</label>
              <button type="submit" className="btn btn-primary">
                Add client
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Your clients</h2>
        {data.clients.length === 0 ? (
          <p className="muted">No clients yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Retainer</th>
                  <th>Color (#hex)</th>
                  <th>Client link</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        className="input"
                        value={c.name}
                        onChange={(e) => updateClient(c.id, { name: e.target.value })}
                      />
                    </td>
                    <td style={{ maxWidth: "100px" }}>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        value={c.retainerHoursPerMonth}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v) && v > 0)
                            updateClient(c.id, { retainerHoursPerMonth: v });
                        }}
                      />
                    </td>
                    <td style={{ maxWidth: "120px" }}>
                      <input
                        className="input"
                        placeholder="#c2410c"
                        value={c.color ?? ""}
                        onChange={(e) => updateClient(c.id, { color: e.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        <input
                          className="input"
                          readOnly
                          value={shareUrl(c.shareToken)}
                          onFocus={(e) => e.target.select()}
                        />
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => copy(shareUrl(c.shareToken))}
                          >
                            Copy link
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              regenerateShareToken(c.id);
                              setMsg("New link generated — copy again.");
                            }}
                          >
                            New link
                          </button>
                        </div>
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link to={`/client/${c.id}`} className="btn">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                          if (confirm(`Delete ${c.name} and all their work items?`))
                            deleteClient(c.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
          Client links only resolve where this data exists (this browser or after import).
        </p>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Exports include clients, tasks, users, time entries, and per-client templates (version 2).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" className="btn btn-primary" onClick={() => downloadBackup(data)}>
            Download JSON backup
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportFile}
          />
        </div>
      </div>
    </div>
  );
}
