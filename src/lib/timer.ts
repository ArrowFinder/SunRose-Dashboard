export function elapsedMs(startedAtIso: string): number {
  const t = Date.parse(startedAtIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Date.now() - t);
}

export function msToMinutesRounded(ms: number): number {
  return Math.max(1, Math.round(ms / 60000));
}
