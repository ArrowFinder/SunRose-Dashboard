import type { MonthSnapshot } from "../lib/scopeMath";

type Props = {
  snap: MonthSnapshot;
};

export function ScopeAlert({ snap }: Props) {
  const lines: string[] = [];
  if (snap.overCommitted) {
    lines.push(
      `Committed work exceeds what’s left on the retainer by about ${Math.abs(snap.remainingAfterCommitted).toFixed(1)} hours. Reprioritize or approve overage.`
    );
  }
  if (snap.pendingApprovalHours > 0 && snap.remainingAfterCommitted - snap.pendingApprovalHours < 0) {
    lines.push(
      `New requests waiting for approval need ~${snap.pendingApprovalHours.toFixed(1)}h; there isn’t enough room without dropping or adding hours.`
    );
  }
  if (lines.length === 0) return null;
  const severity = snap.overCommitted ? "danger" : "warn";
  return (
    <div className={`share-banner ${severity}`}>
      {lines.map((line, i) => (
        <p key={i} style={{ margin: i ? "0.5rem 0 0" : 0 }}>
          {line}
        </p>
      ))}
    </div>
  );
}
