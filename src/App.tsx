import { TasksPage } from "./pages/TasksPage";
import { SupportView } from "./pages/SupportView";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { PasswordRecovery } from "./components/PasswordRecovery";
import { AuthProvider } from "./context/AuthContext";
import { AppStateProvider } from "./context/AppStateContext";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { SotPage } from "./pages/SotPage";
import { Overview } from "./pages/Overview";
import { ClientHome } from "./pages/ClientHome";
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
      <PasswordRecovery>
      <AppStateProvider>
      <HashRouter>
        <Routes>
          <Route path="/c/:token" element={<ClientSharePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="sot" element={<SotPage />} />
              <Route path="client/:clientId" element={<ClientHome />} />
              <Route path="client/:clientId/projects" element={<ClientHome projects />} />
              <Route path="client/:clientId/details" element={<ClientHome details />} />
              <Route path="client/:clientId/tasks" element={<ClientWorkspace />} />
              <Route path="client/:clientId/task/:taskId" element={<ClientWorkspace />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="support/:userId/*" element={<SupportView />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="templates" element={<Navigate to="/clients" replace />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
      </AppStateProvider>
      </PasswordRecovery>
    </AuthProvider>
  );
}
