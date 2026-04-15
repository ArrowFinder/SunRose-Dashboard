import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { MonthSnapshot } from "../components/MonthSnapshot";
import { ScopeAlert } from "../components/ScopeAlert";
import { WorkItemModal } from "../components/WorkItemModal";
import { TemplatePickModal } from "../components/TemplatePickModal";
import { ManualTimeModal } from "../components/ManualTimeModal";
import { currentYearMonth, labelYearMonth } from "../lib/month";
import { itemsForMonth, monthSnapshot } from "../lib/scopeMath";
import { STATUS_LABELS, SCOPE_LABELS } from "../lib/labels";
import type { TaskTemplate, WorkItem } from "../lib/types";
import { userCanAccessClient } from "../lib/permissions";
import { isInternalUser, isOwnerOrAdmin } from "../lib/permissions";
import { effectiveActualHours, hoursLoggedForWorkItem } from "../lib/hours";

export function ClientWorkspace() {
  const { clientId } = useParams<{ clientId: string }>();
  const {
    data,
    currentUser,
    sessionUserId,
    addWorkItem,
    updateWorkItem,
    deleteWorkItem,
    startTimer,
    activeTimer,
    addTimeEntryManual,
    deleteTimeEntry,
    addTemplate,
    deleteTemplate,
  } = useAppState();
  const [yearMonth, setYearMonth] = useState(currentYearMonth);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [manualFor, setManualFor] = useState<WorkItem | null>(null);

  const staff = isInternalUser(currentUser);
  const canEdit = currentUser && userCanAccessClient(currentUser, clientId ?? "") && staff;

  const client = data.clients.find((c) => c.id === clientId);

  const assignableUsers = useMemo(
    () =>
      data.users.filter(
        (u) => u.role === "owner" || u.role === "admin" || u.role === "employee"
      ),
    [data.users]
  );

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    data.workItems
      .filter((w) => w.clientId === clientId)
      .forEach((w) => set.add(w.yearMonth));
    set.add(yearMonth);
    return Array.from(set).sort().reverse();
  }, [data.workItems, clientId, yearMonth]);

  const snap = useMemo(() => {
    if (!client) return null;
    return monthSnapshot(client, data.workItems, yearMonth, data.timeEntries);
  }, [client, data.workItems, data.timeEntries, yearMonth]);

  const items = useMemo(() => {
    if (!clientId) return [];
    return itemsForMonth(data.workItems, clientId, yearMonth).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.title.localeCompare(b.title);
    });
  }, [data.workItems, clientId, yearMonth]);

  const entriesThisMonth = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    return data.timeEntries.filter((e) => ids.has(e.workItemId));
  }, [data.timeEntries, items]);

  const clientTemplates = useMemo(
    () => data.taskTemplates.filter((t) => t.clientId === client?.id),
    [data.taskTemplates, client?.id]
  );

  const canManageTemplates = isOwnerOrAdmin(currentUser);

  if (!client) {
    return (
      <div className="empty card">
        <p>Client not found.</p>
        <Link to="/">Back to overview</Link>
      </div>
    );
  }

  if (currentUser && !userCanAccessClient(currentUser, client.id)) {
    return (
      <div className="empty card">
        <p>You don’t have access to this client.</p>
        <Link to="/">Back</Link>
      </div>
    );
  }

  function applyTemplate(t: TaskTemplate) {
    if (!client) return;
    addWorkItem({
      clientId: client.id,
      yearMonth,
      title: t.defaultTitle || t.name,
      description: t.defaultDescription,
      source: "internal",
      status: "backlog",
      scopeCategory: t.defaultScopeCategory,
      estimatedHours: t.defaultEstimatedHours,
      actualHours: 0,
      priority: 10,
      dueDate: null,
      assignedUserId: null,
      templateId: t.id,
    });
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <Link to="/">← Overview</Link>
        <h1 style={{ flex: "1 1 auto", margin: 0 }}>{client.name}</h1>
        <div className="field" style={{ margin: 0, minWidth: "160px" }}>
          <label htmlFor="m">Month</label>
          <input
            id="m"
            type="month"
            className="input"
            value={yearMonth.length >= 7 ? yearMonth.slice(0, 7) : yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            list="month-suggestions"
          />
          <datalist id="month-suggestions">
            {monthOptions.map((m) => (
              <option key={m} value={m.slice(0, 7)} />
            ))}
          </datalist>
        </div>
        {canEdit && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTemplateOpen(true);
              }}
            >
              From template
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add work item
            </button>
          </>
        )}
      </div>

      {snap && (
        <div className="card">
          <h2 style={{ marginBottom: "0.75rem" }}>{labelYearMonth(yearMonth)}</h2>
          <MonthSnapshot snap={snap} />
          <ScopeAlert snap={snap} />
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: "0.75rem" }}>Work this month</h2>
        {items.length === 0 ? (
          <p className="muted">No items for this month. Add one or pick another month.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Pri</th>
                  <th>Title</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Scope</th>
                  <th>Est</th>
                  <th>Actual</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((w) => {
                  const logged = hoursLoggedForWorkItem(w.id, data.timeEntries);
                  const display = effectiveActualHours(w, data.timeEntries);
                  const running =
                    activeTimer?.workItemId === w.id && activeTimer.userId === sessionUserId;
                  return (
                    <tr key={w.id}>
                      <td>{w.priority}</td>
                      <td>
                        <strong>{w.title}</strong>
                        {w.description ? (
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {w.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{w.dueDate ? w.dueDate.slice(0, 10) : "—"}</td>
                      <td>{STATUS_LABELS[w.status]}</td>
                      <td>{SCOPE_LABELS[w.scopeCategory]}</td>
                      <td>{w.estimatedHours}</td>
                      <td>
                        {display.toFixed(2)}h
                        {logged > 0 && (
                          <span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>
                            from timer
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {canEdit && staff && (
                          <>
                            {running ? (
                              <span className="badge badge-warn">Running</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: "0.25rem 0.4rem" }}
                                onClick={() => void startTimer(w.id)}
                              >
                                Start timer
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: "0.25rem 0.4rem" }}
                              onClick={() => setManualFor(w)}
                            >
                              Log time
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: "0.25rem 0.4rem" }}
                              onClick={() => {
                                setEditing(w);
                                setModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: "0.25rem 0.4rem" }}
                              onClick={() => {
                                if (confirm(`Delete “${w.title}”?`)) deleteWorkItem(w.id);
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {staff && entriesThisMonth.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: "0.75rem" }}>Time entries (this month’s tasks)</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Task</th>
                  <th>User</th>
                  <th>Min</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entriesThisMonth
                  .slice()
                  .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                  .map((e) => {
                    const wi = data.workItems.find((x) => x.id === e.workItemId);
                    const u = data.users.find((x) => x.id === e.userId);
                    return (
                      <tr key={e.id}>
                        <td className="muted" style={{ fontSize: "0.8rem" }}>
                          {e.startedAt.slice(0, 16).replace("T", " ")}
                        </td>
                        <td>{wi?.title ?? e.workItemId}</td>
                        <td>{u?.name ?? "—"}</td>
                        <td>{e.durationMinutes}</td>
                        <td>{e.note || "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: "0.2rem 0.4rem" }}
                            onClick={() => {
                              if (confirm("Remove this time entry?")) deleteTimeEntry(e.id);
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {staff && clientTemplates.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: "0.5rem" }}>Reusable templates for {client.name}</h2>
          <p className="muted" style={{ fontSize: "0.9rem", marginTop: 0 }}>
            Created from the task form. Only appear when adding tasks for this client.
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {clientTemplates.map((t) => (
              <li key={t.id} style={{ marginBottom: "0.35rem" }}>
                <strong>{t.name}</strong>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {" "}
                  · {t.defaultEstimatedHours}h · {SCOPE_LABELS[t.defaultScopeCategory]}
                </span>
                {canManageTemplates && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ marginLeft: "0.5rem", padding: "0.15rem 0.45rem" }}
                    onClick={() => {
                      if (confirm(`Remove template “${t.name}”?`)) deleteTemplate(t.id);
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!canManageTemplates && (
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Only the owner or admin can remove templates.
            </p>
          )}
        </div>
      )}

      <WorkItemModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        initial={editing}
        clientId={client.id}
        clientName={client.name}
        allowSaveAsTemplate={!!canEdit && staff}
        defaultYearMonth={yearMonth}
        assignableUsers={assignableUsers}
        onSave={(payload, opts) => {
          if (editing) updateWorkItem(editing.id, payload);
          else addWorkItem(payload);
          if (opts?.saveAsTemplate) {
            addTemplate({
              name: opts.templateName ?? payload.title,
              defaultTitle: payload.title,
              defaultDescription: payload.description,
              defaultEstimatedHours: payload.estimatedHours,
              defaultScopeCategory: payload.scopeCategory,
              clientId: client.id,
            });
          }
        }}
      />

      <TemplatePickModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        templates={clientTemplates}
        onPick={applyTemplate}
      />

      {manualFor && sessionUserId && (
        <ManualTimeModal
          open={!!manualFor}
          onClose={() => setManualFor(null)}
          taskTitle={manualFor.title}
          onSave={(minutes, note, day) => {
            const start = new Date(`${day}T12:00:00`).toISOString();
            const end = new Date(new Date(start).getTime() + minutes * 60000).toISOString();
            addTimeEntryManual({
              workItemId: manualFor.id,
              userId: sessionUserId,
              startedAt: start,
              endedAt: end,
              durationMinutes: minutes,
              note,
              billable: true,
            });
          }}
        />
      )}
    </div>
  );
}
