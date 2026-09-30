import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { isOwnerOrAdmin } from "../lib/permissions";
import { downloadBackup } from "../lib/storage";
import { hexOrDefault } from "../lib/color";
import type { Client } from "../lib/types";
function ClientEditor({ client }: { client: Client }) {
  const {
    updateClient,
    deleteClient,
    regenerateShareToken,
    saving,
    currentUser,
  } = useAppState();
  const [name, setName] = useState(client.name);
  const [hours, setHours] = useState(client.retainerHoursPerMonth);
  const [color, setColor] = useState(hexOrDefault(client));
  const [notice, setNotice] = useState("");
  const manage = isOwnerOrAdmin(currentUser);
  const url = `${location.origin}${location.pathname}#/c/${client.shareToken}`;
  async function run(
    action: () => unknown | Promise<unknown>,
    success: string,
  ) {
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save.");
    }
  }
  return (
    <section className="card">
      <h2>
        <Link to={`/client/${client.id}`}>{client.name}</Link>
      </h2>
      {manage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                updateClient(client.id, {
                  name,
                  retainerHoursPerMonth: hours,
                  color,
                }),
              "Client saved.",
            );
          }}
        >
          <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
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
                Monthly retainer hours
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.25"
                  required
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </label>
              <label>
                Calendar color
                <input
                  className="input"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
              <button className="btn" type="submit">
                Save changes
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {manage && (
        <>
          <p>
            Only tasks marked “Show this task in the client view” appear at this
            link. Anyone with the link can view them and submit requests. Keep
            internal details out of shared task titles.
          </p>
          <button
            className="btn"
            disabled={saving}
            onClick={() =>
              void run(
                () => navigator.clipboard.writeText(url),
                "Client link copied.",
              )
            }
          >
            Copy client link
          </button>{" "}
          <button
            className="btn"
            disabled={saving}
            onClick={() => {
              if (
                confirm(
                  "Replace the client link? The old link will stop working.",
                )
              )
                void run(
                  () => regenerateShareToken(client.id),
                  "Link replaced. Copy the new link.",
                );
            }}
          >
            Replace link
          </button>{" "}
          <button
            className="btn btn-danger"
            disabled={saving}
            onClick={() => {
              if (
                confirm(
                  `Delete ${client.name}? Clients with tasks are protected from deletion.`,
                )
              )
                void run(() => deleteClient(client.id), "Client deleted.");
            }}
          >
            Delete empty client
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export function CloudClientsPage() {
  const { data, currentUser, addClient, saving } = useAppState();
  const [name, setName] = useState("");
  const [hours, setHours] = useState(40);
  const [error, setError] = useState("");
  if (currentUser?.role === "client") return <Navigate to="/" replace />;
  const manage = isOwnerOrAdmin(currentUser);
  return (
    <div className="stack">
      <h1>Clients</h1>
      {manage && (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await addClient(name, hours);
              setName("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not add client.",
              );
            }
          }}
        >
          <h2>Add client</h2>
          <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
            <div className="row">
              <label>
                Client name
                <input
                  className="input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Monthly retainer hours
                <input
                  className="input"
                  required
                  type="number"
                  min="0"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </label>
              <button className="btn btn-primary">Add client</button>
            </div>
          </fieldset>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {data.clients.map((c) => (
        <ClientEditor key={c.id} client={c} />
      ))}
      {manage && (
        <section className="card">
          <h2>Backup</h2>
          <p>
            Download a copy of the currently loaded clients, tasks, team,
            templates, and time entries (including voided entries). This does
            not include login credentials or the database audit history.
          </p>
          <button className="btn" onClick={() => downloadBackup(data)}>
            Download workspace copy
          </button>
          <p>
            Browser-only backups must be migrated deliberately so they cannot
            overwrite the shared team’s work.
          </p>
        </section>
      )}
    </div>
  );
}
