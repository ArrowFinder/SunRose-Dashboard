import { useState } from "react";
import { useAppState } from "../context/AppStateContext";
import { useAuth } from "../context/AuthContext";
import { getSupabase } from "../lib/supabaseClient";

export function AccountName() {
  const { currentUser, refresh } = useAppState();
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <div>
    <button className="btn btn-ghost" onClick={() => {
      setName(currentUser?.name ?? ""); setMessage(""); setEditing(!editing);
    }}>My profile</button>
    {editing && <form className="card" style={{ marginTop: "0.75rem" }} onSubmit={async e => {
      e.preventDefault();
      if (busy) return;
      if (!name.trim()) { setMessage("Enter your name."); return; }
      setBusy(true); setMessage("");
      try {
        const { error } = await getSupabase().rpc("update_my_name", { new_name: name.trim() });
        if (error) throw error;
        await auth.refreshProfile();
        await refresh?.();
        setMessage("Your name has been updated.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Could not save your name. Try again.");
      } finally { setBusy(false); }
    }}>
      <label htmlFor="account-name">Your name</label>
      <input id="account-name" className="input" required maxLength={100} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} />
      <p className="muted">This name appears on assignments, time entries, and your account.</p>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save name"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>Close</button>
      </div>
      {message && <p role="status">{message}</p>}
    </form>}
  </div>;
}
