import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  taskTitle: string;
  onSave: (minutes: number, note: string, day: string) => void;
};

export function ManualTimeModal({ open, onClose, taskTitle, onSave }: Props) {
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = Math.max(1, Math.round(minutes));
    onSave(m, note.trim(), day);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Log time manually</h2>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          {taskTitle}
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="day">Day</label>
            <input id="day" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="min">Minutes</label>
            <input
              id="min"
              type="number"
              min={1}
              step={1}
              className="input"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="tnote">Note</label>
            <input id="tnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
