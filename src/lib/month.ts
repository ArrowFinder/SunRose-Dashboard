/** Current month as YYYY-MM in local timezone */
export function currentYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parseYearMonth(ym: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) };
}

export function labelYearMonth(ym: string): string {
  const p = parseYearMonth(ym);
  if (!p) return ym;
  const d = new Date(p.y, p.m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
