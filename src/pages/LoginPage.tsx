import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppState } from "../context/AppStateContext";

export function LoginPage() {
  const auth = useAuth();
  const { ready, data, sessionUserId, currentUser, login } = useAppState();
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [err, setErr] = useState<string | null>(null);

  const cloud = auth.isConfigured;
  const internalUsers = data.users.filter(
    (u) => u.role === "owner" || u.role === "admin" || u.role === "employee"
  );

  if (ready && sessionUserId && currentUser && currentUser.role !== "client") {
    return <Navigate to="/" replace />;
  }

  if (ready && sessionUserId && currentUser?.role === "client" && currentUser.clientId) {
    return <Navigate to={`/client/${currentUser.clientId}`} replace />;
  }

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!userId) return;
    const ok = await login(userId, pin);
    if (!ok) {
      setErr("Wrong PIN or user.");
      return;
    }
  }

  async function submitCloud(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim() || !password) {
      setErr("Email and password are required.");
      return;
    }
    const fn = mode === "signin" ? auth.signIn : auth.signUp;
    const { error } = await fn(email.trim(), password);
    if (error) {
      setErr(error);
      return;
    }
  }

  if (!ready) {
    return (
      <div className="layout">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (cloud) {
    return (
      <div className="layout" style={{ maxWidth: "420px" }}>
        <h1>
          Sun<span style={{ color: "var(--accent)" }}>Rose</span>
        </h1>
        <p className="muted">Sign in with your team account (email).</p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Public client views use the shared link; clients don’t need this login.
        </p>

        <form className="card" style={{ marginTop: "1.25rem" }} onSubmit={submitCloud}>
          <div className="field">
            <label htmlFor="em">Email</label>
            <input
              id="em"
              type="email"
              className="input"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              className="input"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {auth.error && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem", marginTop: 0 }}>{auth.error}</p>
          )}
          {err && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem", marginTop: 0 }}>{err}</p>
          )}
          <div className="row" style={{ marginTop: "0.5rem", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary">
              {mode === "signin" ? "Sign in" : "Sign up"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setErr(null);
              }}
            >
              {mode === "signin" ? "Need an account?" : "Have an account? Sign in"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="layout" style={{ maxWidth: "420px" }}>
      <h1>
        Sun<span style={{ color: "var(--accent)" }}>Rose</span>
      </h1>
      <p className="muted">Sign in with your team profile (owner or employee).</p>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Clients use the shared link your agency sends; they don’t sign in here.
      </p>

      <form className="card" style={{ marginTop: "1.25rem" }} onSubmit={submitLocal}>
        <div className="field">
          <label htmlFor="u">Who’s working?</label>
          <select
            id="u"
            className="input text-input"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPin("");
              setErr(null);
            }}
            required
          >
            <option value="">Select…</option>
            {internalUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
        {userId && data.users.find((x) => x.id === userId)?.pinHash ? (
          <div className="field">
            <label htmlFor="p">PIN</label>
            <input
              id="p"
              type="password"
              className="input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        ) : null}
        {err && (
          <p style={{ color: "var(--danger)", fontSize: "0.9rem", marginTop: 0 }}>{err}</p>
        )}
        <button type="submit" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>
          Continue
        </button>
      </form>

      {internalUsers.length === 0 && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          No team users yet. Open the app once as the auto-created owner (this page should list
          them after first load), or import a backup under Clients & backup after signing in.
        </p>
      )}
    </div>
  );
}
