import { useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { getSupabase } from "../lib/supabaseClient";

/** Keep recovery outside the hash router: Supabase uses the URL fragment too. */
export function PasswordRecovery({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!auth.passwordRecovery) return children;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) setError(error.message);
      else { setSaved(true); setPassword(""); setConfirm(""); }
    } catch { setError("Could not save your password. Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="layout" style={{ maxWidth: 420 }}>
    <h1>{saved ? "Password updated" : "Choose a new password"}</h1>
    {saved ? <><p role="status">Your new password is saved.</p><button className="btn btn-primary" onClick={() => { window.location.hash = "/"; auth.finishPasswordRecovery(); }}>Continue to dashboard</button></> :
      auth.loading ? <p>Checking your reset link…</p> : !auth.session ? <><p>This reset link has expired or is invalid. Request a new link from the sign-in page.</p><button className="btn btn-primary" onClick={() => { window.location.hash = "/login"; auth.finishPasswordRecovery(); }}>Back to sign in</button></> :
      <form className="card" onSubmit={submit}>
        <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
        <div className="field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
        {error && <p role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>}
  </main>;
}
