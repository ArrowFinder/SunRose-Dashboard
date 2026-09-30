/** Stable pastel-ish hex from id for calendar bars when client.color missing */
export function colorForClientId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const saturation = 0.55, lightness = 0.42;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function hexOrDefault(client: { id: string; color?: string }): string {
  if (client.color && /^#[0-9A-Fa-f]{6}$/.test(client.color)) return client.color;
  return colorForClientId(client.id);
}
