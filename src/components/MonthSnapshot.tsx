import type { MonthSnapshot as MS } from "../lib/scopeMath";

type Props = {
  snap: MS;
};

export function MonthSnapshot({ snap }: Props) {
  return (
    <div className="snapshot-grid">
      <div className="snapshot-cell">
        <span>{snap.billingType==="hourly"?"Monthly hour budget":"Included hours"}</span>
        <strong>{snap.hasHourLimit?`${snap.retainer}h`:"Not set"}</strong>
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
              !snap.hasHourLimit ? "var(--muted)" : snap.remainingAfterCommitted < 0
                ? "var(--danger)"
                : snap.remainingAfterCommitted < snap.retainer * 0.15
                  ? "var(--warn)"
                  : "var(--ok)",
          }}
        >
          {snap.hasHourLimit?`${snap.remainingAfterCommitted.toFixed(1)}h`:"No hour limit"}
        </strong>
      </div>
    </div>
  );
}
