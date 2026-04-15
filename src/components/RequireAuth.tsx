import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppState } from "../context/AppStateContext";

/** Any logged-in user (owner, employee, or client profile). */
export function RequireAuth() {
  const auth = useAuth();
  const { ready, sessionUserId, currentUser } = useAppState();

  if (!ready) {
    return (
      <div className="layout">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (auth.isConfigured) {
    if (!auth.session || !currentUser) {
      return <Navigate to="/login" replace />;
    }
  } else if (!sessionUserId || !currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
