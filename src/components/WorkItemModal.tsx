import { useEffect, useState } from "react";
import type { ScopeCategory, WorkItem, WorkSource, WorkStatus } from "../lib/types";
import type { User } from "../lib/types";
import { SCOPE_LABELS, SOURCE_LABELS, STATUS_LABELS } from "../lib/labels";
import { currentYearMonth } from "../lib/month";

export type WorkItemSaveOptions = {
  saveAsTemplate?: boolean;
  /** Label for the saved template (defaults to task title) */
  templateName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (item: Omit<WorkItem, "id" | "createdAt" | "updatedAt">, opts?: WorkItemSaveOptions) => void;
  initial?: WorkItem | null;
  clientId: string;
  clientName: string;
  /** Show “save as template for this client” (internal staff only) */
  allowSaveAsTemplate: boolean;
  defaultYearMonth: string;
  assignableUsers: User[];
};

const statuses: WorkStatus[] = ["backlog", "planned", "in_progress", "done"];
const scopes: ScopeCategory[] = [
  "in_scope",
  "needs_approval",
  "approved_overage",
  "out_of_scope",
];
const sources: WorkSource[] = ["internal", "client"];

export function WorkItemModal({
  open,
  onClose,
  onSave,
  initial,
  clientId,
  clientName,
  allowSaveAsTemplate,
  defaultYearMonth,
  assignableUsers,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [status, setStatus] = useState<WorkStatus>("backlog");
  const [scopeCategory, setScopeCategory] = useState<ScopeCategory>("in_scope");
  const [source, setSource] = useState<WorkSource>("internal");
  const [estimatedHours, setEstimatedHours] = useState(1);
  const [actualHours, setActualHours] = useState(0);
  const [priority, setPriority] = useState(10);
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateLabel, setTemplateLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setDescription(initial.description);
      setYearMonth(initial.yearMonth);
      setStatus(initial.status);
      setScopeCategory(initial.scopeCategory);
      setSource(initial.source);
      setEstimatedHours(initial.estimatedHours);
      setActualHours(initial.actualHours);
      setPriority(initial.priority);
      setDueDate(initial.dueDate && initial.dueDate.length >= 10 ? initial.dueDate.slice(0, 10) : "");
      setAssignedUserId(initial.assignedUserId ?? "");
      setSaveAsTemplate(false);
      setTemplateLabel("");
    } else {
      setTitle("");
      setDescription("");
      setYearMonth(defaultYearMonth);
      setStatus("backlog");
      setScopeCategory("in_scope");
      setSource("internal");
      setEstimatedHours(1);
      setActualHours(0);
      setPriority(10);
      setDueDate("");
      setAssignedUserId("");
      setSaveAsTemplate(false);
      setTemplateLabel("");
    }
  }, [open, initial, defaultYearMonth]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const payload: Omit<WorkItem, "id" | "createdAt" | "updatedAt"> = {
      clientId,
      yearMonth: yearMonth || currentYearMonth(),
      title: title.trim(),
      description: description.trim(),
      source,
      status,
      scopeCategory,
      estimatedHours: Math.max(0, estimatedHours),
      actualHours: Math.max(0, actualHours),
      priority,
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

    onSave(payload, opts);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? "Edit work item" : "Add work item"}</h2>
        <form onSubmit={submit}>
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
            <div className="field" style={{ flex: 1, minWidth: "120px" }}>
              <label htmlFor="pri">Priority</label>
              <input
                id="pri"
                className="input"
                type="number"
                min={1}
                max={999}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
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
              <label htmlFor="st">Status</label>
              <select
                id="st"
                className="text-input input"
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkStatus)}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="sc">Scope</label>
              <select
                id="sc"
                className="text-input input"
                value={scopeCategory}
                onChange={(e) => setScopeCategory(e.target.value as ScopeCategory)}
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="src">Source</label>
              <select
                id="src"
                className="text-input input"
                value={source}
                onChange={(e) => setSource(e.target.value as WorkSource)}
              >
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="est">Est. hours</label>
              <input
                id="est"
                className="input"
                type="number"
                min={0}
                step={0.25}
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="act">Actual hours (manual)</label>
              <input
                id="act"
                className="input"
                type="number"
                min={0}
                step={0.25}
                value={actualHours}
                onChange={(e) => setActualHours(Number(e.target.value))}
                title="Used when you have no timer entries on this task"
              />
            </div>
          </div>

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
        </form>
      </div>
    </div>
  );
}
