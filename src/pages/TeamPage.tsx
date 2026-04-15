import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import type { UserRole } from "../lib/types";
import { isOwnerOrAdmin } from "../lib/permissions";

export function TeamPage() {
  const {
    data,
    addUser,
    deleteUser,
    setUserPin,
    loadDemo,
    currentUser,
  } = useAppState();
  const [msg, setMsg] = useState<string | null>(null);

  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("employee");
  const [newUserClientId, setNewUserClientId] = useState("");
  const [newUserPin, setNewUserPin] = useState("");

  if (currentUser?.role === "client") {
    return currentUser.clientId ? (
      <Navigate to={`/client/${currentUser.clientId}`} replace />
    ) : (
      <Navigate to="/" replace />
    );
  }

  const canManage = isOwnerOrAdmin(currentUser);

  return (
    <div className="stack">
      <div>
        <h1>Team</h1>
        <p className="muted">
          Owner and employee accounts use the internal dashboard and timer. Client accounts are
          optional (shared links are usually enough for clients).
        </p>
        <p>
          <Link to="/clients">Clients & backup →</Link>
        </p>
      </div>

      {msg && (
        <div className="card" style={{ padding: "0.65rem 1rem", background: "var(--accent-soft)" }}>
          {msg}
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2>People</h2>
          <form
            style={{ marginTop: "1rem" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newUserName.trim()) return;
              if (newUserRole === "client" && !newUserClientId) {
                setMsg("Pick a client for client-role users.");
                return;
              }
              await addUser(
                newUserName.trim(),
                newUserRole,
                newUserRole === "client" ? newUserClientId : undefined,
                newUserPin || undefined
              );
              setNewUserName("");
              setNewUserPin("");
              setMsg("User added.");
            }}
          >
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: "140px" }}>
                <label htmlFor="un">Name</label>
                <input id="un" className="input" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
              </div>
              <div className="field" style={{ width: "140px" }}>
                <label htmlFor="ur">Role</label>
                <select
                  id="ur"
                  className="input text-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                  <option value="client">Client</option>
                </select>
              </div>
              {newUserRole === "client" && (
                <div className="field" style={{ flex: 1, minWidth: "160px" }}>
                  <label htmlFor="uc">Client</label>
                  <select
                    id="uc"
                    className="input text-input"
                    value={newUserClientId}
                    onChange={(e) => setNewUserClientId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {data.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field" style={{ width: "120px" }}>
                <label htmlFor="up">PIN (optional)</label>
                <input
                  id="up"
                  type="password"
                  className="input"
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>&nbsp;</label>
                <button type="submit" className="btn btn-primary">
                  Add user
                </button>
              </div>
            </div>
          </form>

          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>PIN</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.role}</td>
                    <td>
                      {canManage ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: "0.2rem 0.5rem" }}
                          onClick={async () => {
                            const p = window.prompt("New PIN (leave empty to remove):");
                            if (p === null) return;
                            await setUserPin(u.id, p.length ? p : null);
                            setMsg("PIN updated.");
                          }}
                        >
                          {u.pinHash ? "Change" : "Set"}
                        </button>
                      ) : (
                        <span className="muted">{u.pinHash ? "Yes" : "No"}</span>
                      )}
                    </td>
                    <td>
                      {canManage && u.id !== currentUser?.id ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: "0.2rem 0.5rem" }}
                          onClick={() => {
                            if (confirm(`Remove user ${u.name}?`)) deleteUser(u.id);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!canManage && (
        <div className="card">
          <p className="muted">Only the owner or admin can add or remove team members.</p>
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2>Demo data</h2>
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Replaces everything in this browser with a sample team, clients, tasks, and one time
            entry.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (confirm("Replace everything with demo data?")) loadDemo();
            }}
          >
            Load demo data
          </button>
        </div>
      )}
    </div>
  );
}
