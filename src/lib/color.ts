/** Stable pastel-ish hex from id for calendar bars when client.color missing */
export function colorForClientId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 55% 42%)`;
}

export function hexOrDefault(client: { id: string; color?: string }): string {
  if (client.color && /^#[0-9A-Fa-f]{6}$/.test(client.color)) return client.color;
  return colorForClientId(client.id);
}
