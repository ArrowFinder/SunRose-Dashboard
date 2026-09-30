import { useEffect, useState } from "react";
import type { WorkItem } from "../lib/types";
import type { User, TimeEntry } from "../lib/types";
import { useAppState } from "../context/AppStateContext";
import { effectiveActualHours, minutesLoggedForWorkItem } from "../lib/hours";
import { taskSummary, subtasksFor } from "../lib/taskTree";
import { isOwnerOrAdmin } from "../lib/permissions";
import { currentYearMonth } from "../lib/month";

export type WorkItemSaveOptions = {
  saveAsTemplate?: boolean;
  /** Label for the saved template (defaults to task title) */
  templateName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (item: Omit<WorkItem, "id" | "createdAt" | "updatedAt">, opts?: WorkItemSaveOptions) => void | Promise<void>;
  initial?: WorkItem | null;
  parentTask?: WorkItem | null;
  clientId: string;
  clientName: string;
  /** Show “save as template for this client” (internal staff only) */
  allowSaveAsTemplate: boolean;
  defaultYearMonth: string;
  assignableUsers: User[];
};

export function WorkItemModal({
  open,
  onClose,
  onSave,
  initial,
  parentTask,
  clientId,
  clientName,
  allowSaveAsTemplate,
  defaultYearMonth,
  assignableUsers,
}: Props) {
  const { currentUser, data, correctTimeEntry } = useAppState();
  const hasChildren = initial ? subtasksFor(initial,data.workItems).length > 0 : false;
  const canOverride = (currentUser?.role === "owner" || currentUser?.role === "admin") && !hasChildren;
  const [showCorrectionWarning, setShowCorrectionWarning] = useState(false);
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [correctionEntries, setCorrectionEntries] = useState<TimeEntry[]>([]);
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const taskEntries = data.timeEntries.filter(e => e.workItemId === initial?.id && !e.voidedAt).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  const displayedHours = initial ? taskSummary(initial, data.workItems, data.timeEntries).actual : 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientVisible, setClientVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [estimatedHours, setEstimatedHours] = useState(1);
  const [actualHours, setActualHours] = useState(0);
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateLabel, setTemplateLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOverrideEditing(false); setShowCorrectionWarning(false); setCorrectionSaved(false);
    setSelectedEntryId(data.timeEntries.filter(e => e.workItemId === initial?.id && !e.voidedAt).sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0]?.id ?? "");
    setClientVisible(initial?.clientVisible ?? false);
    if (initial) {
      setTitle(initial.title);
      setDescription(initial.description);
      setYearMonth(initial.yearMonth);
      setEstimatedHours(initial.estimatedHours);
      setActualHours(effectiveActualHours(initial, data.timeEntries));
      setDueDate(initial.dueDate && initial.dueDate.length >= 10 ? initial.dueDate.slice(0, 10) : "");
      setAssignedUserId(initial.assignedUserId ?? "");
      setSaveAsTemplate(false);
      setTemplateLabel("");
    } else {
      setTitle("");
      setDescription("");
      setYearMonth(defaultYearMonth);
      setEstimatedHours(1);
      setActualHours(0);
      setDueDate("");
      setAssignedUserId("");
      setSaveAsTemplate(false);
      setTemplateLabel("");
    }
  }, [open, initial, defaultYearMonth]);

  if (!open) return null;

  async function applyCorrection() {
    if (!canOverride || !correctTimeEntry || busy || !initial) return;
    const entry = correctionEntries.find(e => e.id === selectedEntryId);
    if (!entry || !Number.isFinite(actualHours) || actualHours < 0) { setError("Choose a session and enter a nonnegative number of hours."); return; }
    const total = minutesLoggedForWorkItem(initial.id, correctionEntries);
    const minutes = Math.round(actualHours * 60) - (total - entry.durationMinutes);
    if (minutes < 0 || minutes > 1440) { setError("The selected session must be between 0 and 24 hours. Choose the session that needs correcting."); return; }
    setBusy(true); setError(null);
    try {
      await correctTimeEntry(entry.id, minutes, entry.durationMinutes, total);
      setOverrideEditing(false); setCorrectionSaved(true);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not correct time."); }
    finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (overrideEditing) { setError("Apply or cancel the time correction before saving the task."); return; }
    const payload: Omit<WorkItem, "id" | "createdAt" | "updatedAt"> = {
      clientId,
      parentId: initial?.parentId ?? parentTask?.id ?? null,
      clientVisible,
      yearMonth: yearMonth || currentYearMonth(),
      title: title.trim(),
      description: description.trim(),
      source: initial?.source ?? "internal",
      status: initial?.status ?? "backlog",
      scopeCategory: initial?.scopeCategory ?? "in_scope",
      estimatedHours: Math.max(0, estimatedHours),
      actualHours: initial?.actualHours ?? 0,

      priority: initial?.priority ?? 10,
      dueDate: dueDate ? dueDate : null,
      assignedUserId: assignedUserId || null,
      templateId: initial?.templateId ?? null,
    };

    const opts: WorkItemSaveOptions | undefined =
      allowSaveAsTemplate && saveAsTemplate
        ? {
            saveAsTemplate: true,
            templateName: (templateLabel.trim() || title.trim()).slice(0, 120),
          }
        : undefined;

    if (busy) return;
    setBusy(true); setError(null);
    try { await onSave(payload, opts); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal onClick={() => { if (!busy) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? "Edit task" : parentTask ? "Add subtask" : "Add work item"}</h2>
        {parentTask && <p className="muted">Part of: <strong>{parentTask.title}</strong></p>}
        <form onSubmit={submit}>
          {error && <p role="alert">{error}</p>}
          <fieldset disabled={busy} style={{border:0,padding:0,margin:0}}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea
              id="desc"
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: "120px" }}>
              <label htmlFor="ym">Month</label>
              <input
                id="ym"
                className="input"
                type="month"
                value={yearMonth.length >= 7 ? yearMonth.slice(0, 7) : yearMonth}
                onChange={(e) => setYearMonth(`${e.target.value}`)}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: "120px" }}>
              <label htmlFor="due">Due date</label>
              <input
                id="due"
                className="input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: "160px" }}>
              <label htmlFor="as">Assigned</label>
              <select
                id="as"
                className="input text-input"
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
              >
                <option value="">—</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="est">Est. hours</label>
              <input
                id="est"
                className="input"
                type="number"
                min={0}
                step={0.25}
                readOnly={hasChildren}
                value={hasChildren && initial ? taskSummary(initial,data.workItems,data.timeEntries).estimated : estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="act">Actual Hours</label>
              <input
                id="act"
                className="input"
                type="number"
                min={0}
                step="any"
                value={overrideEditing ? (Number.isFinite(actualHours) ? actualHours : "") : displayedHours}
                readOnly={!canOverride || !overrideEditing}
                onFocus={() => {
                  if (!canOverride || overrideEditing || !taskEntries.length || !correctTimeEntry) return;
                  setShowCorrectionWarning(true);
                }}
                onChange={(e) => { setActualHours(e.target.value === "" ? NaN : Number(e.target.value));  }}
                title={canOverride ? "Click to override clock tracking" : "Only an owner or admin can override clock tracking"}
              />
              <p className="muted" style={{fontSize:"0.8rem"}}>{hasChildren ? "Combined subtask hours, including earlier time recorded on this parent. Correct subtask time within that subtask." : "From saved clock time. Only an owner/admin can correct a time session."}</p>
              {showCorrectionWarning && <div role="alertdialog" aria-label="Override clock tracking" className="card">
                <p><strong>This will override the clock tracking</strong> for the selected time session on this task. Future clock time will keep adding normally.</p>
                <button type="button" className="btn btn-primary" onClick={() => { setActualHours(displayedHours); setCorrectionEntries(taskEntries); setOverrideEditing(true); setCorrectionSaved(false); setShowCorrectionWarning(false); }}>Continue with correction</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCorrectionWarning(false)}>Keep clock time</button>
              </div>}
              {correctionSaved && <p role="status">Time corrected. Future clock time will add normally.</p>}
              {overrideEditing && <div>
                <label htmlFor="correction-session">Time session to correct</label>
                <select id="correction-session" className="input" value={selectedEntryId} onChange={e => setSelectedEntryId(e.target.value)}>
                  {correctionEntries.map(entry => <option key={entry.id} value={entry.id}>{new Date(entry.startedAt).toLocaleString()} — {data.users.find(u => u.id === entry.userId)?.name ?? "Team member"} — {(entry.durationMinutes/60).toFixed(2)}h</option>)}
                </select>
                <p className="muted">Adjust the task total above. The difference applies only to this session. Stop any running clock on this task first.</p>
                <button type="button" className="btn btn-primary" onClick={() => void applyCorrection()}>Apply time correction</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setOverrideEditing(false); setError(null); }}>Cancel correction</button>
              </div>}
            </div>
          </div>

          <label><input type="checkbox" disabled={!isOwnerOrAdmin(currentUser)} checked={clientVisible} onChange={e => setClientVisible(e.target.checked)} /> {parentTask ? "Share this subtask (its parent must also be shared)" : "Show this task in the client view"}</label>
          {!isOwnerOrAdmin(currentUser) && <p className="muted">An owner or admin controls what clients can see.</p>}
          {allowSaveAsTemplate && (
            <div
              className="card"
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--bg)",
              }}
            >
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSaveAsTemplate(on);
                    if (on && !templateLabel.trim() && title.trim()) setTemplateLabel(title.trim());
                  }}
                />
                <span>
                  <strong>Save as reusable template for {clientName}</strong>
                  <span className="muted" style={{ display: "block", fontSize: "0.85rem", fontWeight: 400 }}>
                    This template can only be used when adding tasks for this client.
                  </span>
                </span>
              </label>
              {saveAsTemplate && (
                <div className="field" style={{ marginTop: "0.65rem", marginBottom: 0 }}>
                  <label htmlFor="tl">Template label</label>
                  <input
                    id="tl"
                    className="input"
                    value={templateLabel}
                    onChange={(e) => setTemplateLabel(e.target.value)}
                    placeholder={title.trim() || "Short name for the template"}
                  />
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
