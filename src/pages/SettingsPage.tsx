import { Navigate } from "react-router-dom";

/** Old URL — send people to Team. */
export function SettingsPage() {
  return <Navigate to="/team" replace />;
}
