import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { isOwnerOrAdmin } from "../lib/permissions";
import type { User, UserRole } from "../lib/types";
function Member({ member }: { member: User }) {
  const { data, currentUser, updateUser, deleteUser, saving } = useAppState();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<UserRole>(member.role);
  const [clientId, setClientId] = useState(member.clientId ?? "");
  const [error, setError] = useState("");
  const locked =
    member.id === currentUser?.id ||
    !isOwnerOrAdmin(currentUser) ||
    member.active === false ||
    (currentUser?.role !== "owner" && ["owner", "admin"].includes(member.role));
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await updateUser(member.id, { name, role, clientId });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save member.");
        }
      }}
    >
      <p>
        {member.name} {member.active === false ? "(inactive)" : ""}
      </p>
      <fieldset disabled={saving || locked} style={{ border: 0, padding: 0 }}>
        <div className="row">
          <label>
            Name
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Role
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="client">Client / awaiting access</option>
              <option value="employee">Employee</option>
              {currentUser?.role === "owner" && (
                <>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </>
              )}
            </select>
          </label>
          {role === "client" && (
            <label>
              Client
              <select
                className="input"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Choose client</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn">Save access</button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (
                !confirm(
                  "Deactivate this account? Historical time entries will be kept.",
                )
              )
                return;
              try {
                await deleteUser(member.id);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not deactivate.",
                );
              }
            }}
          >
            Deactivate
          </button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function CloudTeamPage() {
  const { data, currentUser } = useAppState();
  if (currentUser?.role === "client") return <Navigate to="/" replace />;
  return (
    <div className="stack">
      <h1>Team</h1>
      <p>
        Team members create an account from the app’s sign-in page. The owner
        then grants employee or client access here. New accounts cannot see
        business work until assigned access.
      </p>
      {data.users.map((u) => (
        <Member key={u.id} member={u} />
      ))}
    </div>
  );
}
