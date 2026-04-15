import type { TaskTemplate } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  templates: TaskTemplate[];
  onPick: (t: TaskTemplate) => void;
};

export function TemplatePickModal({ open, onClose, templates, onPick }: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>From template</h2>
        {templates.length === 0 ? (
          <p className="muted">No templates yet. Create some under Templates.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {templates.map((t) => (
              <li key={t.id} style={{ marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ textAlign: "left", height: "auto", padding: "0.35rem 0" }}
                  onClick={() => {
                    onPick(t);
                    onClose();
                  }}
                >
                  <strong>{t.name}</strong>
                  <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                    {t.defaultTitle} · {t.defaultEstimatedHours}h
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
