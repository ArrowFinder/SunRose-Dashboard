import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { TimerBar } from "./TimerBar";
import { isInternalUser } from "../lib/permissions";

export function Layout() {
  const { currentUser, logout } = useAppState();
  const navigate = useNavigate();
  const staff = isInternalUser(currentUser);

  return (
    <>
      <TimerBar />
      <div className="layout">
        <header className="topnav">
          <NavLink to={staff ? "/" : currentUser?.clientId ? `/client/${currentUser.clientId}` : "/"} className="topnav-brand">
            Sun<span>Rose</span> scope
          </NavLink>
          <nav className="topnav-links">
            {staff ? (
              <>
                <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
                  Overview
                </NavLink>
                <NavLink to="/calendar" className={({ isActive }) => (isActive ? "active" : "")}>
                  Calendar
                </NavLink>
                <NavLink to="/team" className={({ isActive }) => (isActive ? "active" : "")}>
                  Team
                </NavLink>
                <NavLink to="/clients" className={({ isActive }) => (isActive ? "active" : "")}>
                  Clients
                </NavLink>
              </>
            ) : currentUser?.clientId ? (
              <NavLink to={`/client/${currentUser.clientId}`} className={({ isActive }) => (isActive ? "active" : "")}>
                My scope
              </NavLink>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Sign out ({currentUser?.name})
            </button>
          </nav>
        </header>
        <Outlet />
      </div>
    </>
  );
}
