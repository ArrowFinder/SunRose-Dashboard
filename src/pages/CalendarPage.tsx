import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { hexOrDefault } from "../lib/color";
import { clientsVisibleToUser } from "../lib/permissions";
import { STATUS_LABELS, SCOPE_LABELS } from "../lib/labels";
import type { Client, WorkItem } from "../lib/types";

function startOfCalendarMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function formatDue(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "—";
  try {
    const d = new Date(iso.slice(0, 10) + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function CalendarTaskChip({
  w,
  client,
  color,
}: {
  w: WorkItem;
  client: Client | undefined;
  color: string;
}) {
  const label = client?.name ?? "Unknown client";
  return (
    <div className="calendar-chip-wrap">
      <Link
        to={`/client/${w.clientId}`}
        className="calendar-chip"
        style={{ background: color, color: "#fff" }}
      >
        {w.title.length > 22 ? `${w.title.slice(0, 20)}…` : w.title}
      </Link>
      <div className="calendar-tooltip" role="tooltip">
        <div className="calendar-tooltip-title">{w.title}</div>
        <div className="calendar-tooltip-row">
          <span className="muted">Client</span>
          <span>{label}</span>
        </div>
        <div className="calendar-tooltip-swatch" style={{ background: color }} aria-hidden />
        <div className="calendar-tooltip-row">
          <span className="muted">Due</span>
          <span>{formatDue(w.dueDate)}</span>
        </div>
        <div className="calendar-tooltip-row">
          <span className="muted">Status</span>
          <span>{STATUS_LABELS[w.status]}</span>
        </div>
        <div className="calendar-tooltip-row">
          <span className="muted">Scope</span>
          <span>{SCOPE_LABELS[w.scopeCategory]}</span>
        </div>
        <div className="calendar-tooltip-row">
          <span className="muted">Estimate</span>
          <span>{w.estimatedHours}h</span>
        </div>
        {w.description ? (
          <p className="calendar-tooltip-desc">{w.description}</p>
        ) : null}
      </div>
    </div>
  );
}

export function CalendarPage() {
  const { data, currentUser } = useAppState();
  const [cursor, setCursor] = useState(() => new Date());

  if (currentUser?.role === "client") {
    return currentUser.clientId ? (
      <Navigate to={`/client/${currentUser.clientId}`} replace />
    ) : (
      <Navigate to="/" replace />
    );
  }

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstDow = startOfCalendarMonth(cursor).getDay();
  const totalDays = daysInMonth(y, m);
  const label = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const legendClients = useMemo(() => {
    const list = clientsVisibleToUser(currentUser, data.clients);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUser, data.clients]);

  const itemsByDay = useMemo(() => {
    const map = new Map<number, typeof data.workItems>();
    const ymPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
    for (const w of data.workItems) {
      if (!w.dueDate || !w.dueDate.startsWith(ymPrefix)) continue;
      const day = Number(w.dueDate.slice(8, 10));
      if (!day) continue;
      const list = map.get(day) ?? [];
      list.push(w);
      map.set(day, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
    }
    return map;
  }, [data.workItems, y, m]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  function shiftMonth(delta: number) {
    setCursor(new Date(y, m + delta, 1));
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
        <h1 style={{ margin: 0 }}>Calendar</h1>
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <button type="button" className="btn" onClick={() => shiftMonth(-1)}>
            ←
          </button>
          <strong>{label}</strong>
          <button type="button" className="btn" onClick={() => shiftMonth(1)}>
            →
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Tasks with a due date; colors match clients. Hover a task for details.
        </p>
      </div>

      <div className="calendar-page-layout">
        <aside className="calendar-sidebar card">
          <h2 className="calendar-sidebar-heading">Clients</h2>
          <p className="muted calendar-sidebar-hint">Legend matches chip colors on the grid.</p>
          {legendClients.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Add clients under <Link to="/clients">Clients</Link>.
            </p>
          ) : (
            <ul className="calendar-legend">
              {legendClients.map((c) => {
                const col = hexOrDefault(c);
                return (
                  <li key={c.id}>
                    <span className="calendar-legend-swatch" style={{ background: col }} aria-hidden />
                    <Link to={`/client/${c.id}`} className="calendar-legend-link">
                      {c.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="calendar-main">
          <div className="card calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((h) => (
              <div key={h} className="calendar-dow">
                {h}
              </div>
            ))}
            {cells.map((d, i) => (
              <div key={i} className={`calendar-cell ${d ? "" : "calendar-cell-empty"}`}>
                {d ? (
                  <>
                    <div className="calendar-daynum">{d}</div>
                    <div className="calendar-items">
                      {(itemsByDay.get(d) ?? []).map((w) => {
                        const client = data.clients.find((cl) => cl.id === w.clientId);
                        const color = client ? hexOrDefault(client) : "#78716c";
                        return <CalendarTaskChip key={w.id} w={w} client={client} color={color} />;
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
