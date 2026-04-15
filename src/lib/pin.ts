/** SHA-256 hex of UTF-8 string (for local PIN checks only). */
export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPin(pin: string, pinHash: string | undefined): Promise<boolean> {
  if (!pinHash) return true;
  const h = await hashPin(pin);
  return h === pinHash;
}
