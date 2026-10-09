import { SotReview } from "../components/SotReview";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { currentYearMonth, labelYearMonth } from "../lib/month";
import { monthSnapshot } from "../lib/scopeMath";
import { clientsVisibleToUser } from "../lib/permissions";
import { hexOrDefault } from "../lib/color";

export function Overview() {
  const { data, currentUser } = useAppState();
  const ym = currentYearMonth();

  if (currentUser?.role === "client" && currentUser.clientId) {
    return <Navigate to={`/client/${currentUser.clientId}`} replace />;
  }

  if (currentUser?.role === "client") return <div className="card"><h1>Welcome</h1><p>Your account is waiting for the owner to assign access.</p></div>;

  const clients = clientsVisibleToUser(currentUser, data.clients);

  const rows = clients
    .map((c) => {
      const snap = monthSnapshot(c, data.workItems, ym, data.timeEntries);
      return { client: c, snap };
    })
    .sort((a, b) => a.snap.remainingAfterCommitted - b.snap.remainingAfterCommitted);

  if (clients.length === 0) {
    return (
      <div className="stack"><SotReview/><div className="empty card">
        <p>No clients yet.</p>
        <p className="muted">Add a client under Clients to get started.</p>
        <Link to="/clients" className="btn btn-primary" style={{ marginTop: "1rem" }}>
          Go to Clients
        </Link>
      </div></div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Overview</h1>
        <p className="muted">
          {labelYearMonth(ym)} — sorted by lowest headroom first (scope risk). Used hours include
          billable time worked in this month (UTC).
        </p>
      </div>
      <SotReview />
      <div className="grid-2">
        {rows.map(({ client, snap }) => (
          <Link
            key={client.id}
            to={`/client/${client.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              className="card"
              style={{
                height: "100%",
                borderLeft: `4px solid ${hexOrDefault(client)}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                }}
              >
                <h2 style={{ margin: 0 }}>{client.name}</h2>
                {snap.overCommitted ? (
                  <span className="badge badge-danger">Over committed</span>
                ) : snap.hasHourLimit && snap.remainingAfterCommitted < client.retainerHoursPerMonth * 0.2 ? (
                  <span className="badge badge-warn">Tight</span>
                ) : (
                  <span className="badge badge-ok">OK</span>
                )}
              </div>
              <p className="muted" style={{ margin: "0.5rem 0 0" }}>
                {snap.billingType==="hourly"?"Hourly":"Retainer"} · {snap.hasHourLimit?`${snap.retainer}h allowance`:"No hour limit"} · Used {snap.used.toFixed(1)}h · Committed{" "}
                {snap.committed.toFixed(1)}h
              </p>
              <p style={{ margin: "0.75rem 0 0", fontWeight: 600 }}>
                <span className="muted" style={{ fontWeight: 400 }}>
                  Left after commitments:{" "}
                </span>
                <span
                  style={{
                    color:
                      !snap.hasHourLimit ? "var(--muted)" : snap.remainingAfterCommitted < 0
                        ? "var(--danger)"
                        : snap.remainingAfterCommitted < snap.retainer * 0.15
                          ? "var(--warn)"
                          : "var(--ok)",
                  }}
                >
                  {snap.hasHourLimit?`${snap.remainingAfterCommitted.toFixed(1)}h`:"No hour limit"}
                </span>
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
