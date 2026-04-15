import type { MonthSnapshot as MS } from "../lib/scopeMath";

type Props = {
  snap: MS;
};

export function MonthSnapshot({ snap }: Props) {
  return (
    <div className="snapshot-grid">
      <div className="snapshot-cell">
        <span>Retainer</span>
        <strong>{snap.retainer}h</strong>
      </div>
      <div className="snapshot-cell">
        <span>Used (actual)</span>
        <strong>{snap.used.toFixed(1)}h</strong>
      </div>
      <div className="snapshot-cell">
        <span>Committed (est.)</span>
        <strong>{snap.committed.toFixed(1)}h</strong>
      </div>
      <div className="snapshot-cell">
        <span>Left after commitments</span>
        <strong
          style={{
            color:
              snap.remainingAfterCommitted < 0
                ? "var(--danger)"
                : snap.remainingAfterCommitted < snap.retainer * 0.15
                  ? "var(--warn)"
                  : "var(--ok)",
          }}
        >
          {snap.remainingAfterCommitted.toFixed(1)}h
        </strong>
      </div>
    </div>
  );
}
