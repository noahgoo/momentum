import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { NAV_ITEMS } from "./lib/navigation";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { WorkoutsPage } from "./pages/WorkoutsPage";
import { WarmupsPage } from "./pages/WarmupsPage";
import { WorkoutBuilderPage } from "./pages/WorkoutBuilderPage";
import { ProgramsPage } from "./pages/ProgramsPage";
import { ProgramBuilderPage } from "./pages/ProgramBuilderPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { AssignPage } from "./pages/AssignPage";
import { MessagesPage } from "./pages/MessagesPage";
import { ChangeRequestsPage } from "./pages/ChangeRequestsPage";
import { MotivationPage } from "./pages/MotivationPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ExercisesPage } from "./pages/ExercisesPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient();

// Every nav route now has a dedicated page component; feature slices replace
// the page bodies without touching this file.
const ROUTED_PATHS = new Set([
  "/workouts",
  "/warmups",
  "/programs",
  "/clients",
  "/assign",
  "/messages",
  "/change-requests",
  "/motivation",
  "/notifications",
  "/exercises",
  "/settings",
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              {NAV_ITEMS.filter(({ to }) => !ROUTED_PATHS.has(to)).map(({ to, label }) => (
                <Route
                  key={to}
                  path={to === "/" ? undefined : to.slice(1)}
                  index={to === "/"}
                  element={to === "/" ? <DashboardPage /> : <PlaceholderPage title={label} />}
                />
              ))}

              <Route path="workouts" element={<WorkoutsPage type="workout" />} />
              <Route path="workouts/new" element={<WorkoutBuilderPage type="workout" />} />
              <Route path="workouts/:id" element={<WorkoutBuilderPage type="workout" />} />

              <Route path="warmups" element={<WarmupsPage />} />
              <Route path="warmups/new" element={<WorkoutBuilderPage type="warmup" />} />
              <Route path="warmups/:id" element={<WorkoutBuilderPage type="warmup" />} />

              <Route path="programs" element={<ProgramsPage />} />
              <Route path="programs/new" element={<ProgramBuilderPage />} />
              <Route path="programs/:id" element={<ProgramBuilderPage />} />

              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<ClientDetailPage />} />

              <Route path="assign" element={<AssignPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="change-requests" element={<ChangeRequestsPage />} />
              <Route path="motivation" element={<MotivationPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="exercises" element={<ExercisesPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
