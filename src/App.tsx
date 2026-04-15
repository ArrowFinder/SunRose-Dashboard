import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { AppStateProvider } from "./context/AppStateContext";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { Overview } from "./pages/Overview";
import { ClientWorkspace } from "./pages/ClientWorkspace";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamPage } from "./pages/TeamPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientSharePage } from "./pages/ClientSharePage";
import { LoginPage } from "./pages/LoginPage";
import { CalendarPage } from "./pages/CalendarPage";

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
      <HashRouter>
        <Routes>
          <Route path="/c/:token" element={<ClientSharePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="client/:clientId" element={<ClientWorkspace />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="templates" element={<Navigate to="/clients" replace />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
      </AppStateProvider>
    </AuthProvider>
  );
}
