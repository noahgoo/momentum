import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { Layout } from "./components/Layout";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { WorkoutsPage } from "./pages/WorkoutsPage";
import { WorkoutBuilderPage } from "./pages/WorkoutBuilderPage";
import { ProgramsPage } from "./pages/ProgramsPage";
import { ProgramBuilderPage } from "./pages/ProgramBuilderPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { AssignPage } from "./pages/AssignPage";
import { MessagesPage } from "./pages/MessagesPage";
import { ChangeRequestsPage } from "./pages/ChangeRequestsPage";
import { MotivationPage } from "./pages/MotivationPage";
import { BroadcastPage } from "./pages/BroadcastPage";
import { ExercisesPage } from "./pages/ExercisesPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient();

/**
 * Redirects a legacy path to its new home, carrying any trailing segment
 * with it so a bookmarked builder URL (/workouts/<id>) still opens that
 * workout rather than dumping the coach on the list.
 */
function LegacyRedirect({ to }: { to: string }) {
  const rest = useParams()["*"];
  return <Navigate to={rest ? `${to}/${rest}` : to} replace />;
}

/**
 * Paths from the old twelve-tab sidebar, kept as redirects so bookmarks and
 * any link written before the Library/Inbox grouping still land somewhere.
 */
const LEGACY_REDIRECTS: [from: string, to: string][] = [
  ["/workouts", "/library/workouts"],
  ["/warmups", "/library/warmups"],
  ["/programs", "/library/programs"],
  ["/exercises", "/library/exercises"],
  ["/motivation", "/library/motivation"],
  ["/messages", "/inbox/messages"],
  ["/change-requests", "/inbox/requests"],
  ["/notifications", "/inbox/broadcast"],
];

/**
 * The route table on its own, without the providers around it.
 *
 * Exported so the harness (see harness/README.md) can mount the real routes
 * inside stubbed auth and a seeded query cache. Keeping one copy means a new
 * route is covered by the UI checks the moment it is added, instead of being
 * silently missing from a parallel list.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />

        <Route path="library">
          <Route index element={<Navigate to="/library/workouts" replace />} />
          <Route path="workouts" element={<WorkoutsPage type="workout" />} />
          <Route path="workouts/new" element={<WorkoutBuilderPage type="workout" />} />
          <Route path="workouts/:id" element={<WorkoutBuilderPage type="workout" />} />
          <Route path="warmups" element={<WorkoutsPage type="warmup" />} />
          <Route path="warmups/new" element={<WorkoutBuilderPage type="warmup" />} />
          <Route path="warmups/:id" element={<WorkoutBuilderPage type="warmup" />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="programs/new" element={<ProgramBuilderPage />} />
          <Route path="programs/:id" element={<ProgramBuilderPage />} />
          <Route path="exercises" element={<ExercisesPage />} />
          <Route path="motivation" element={<MotivationPage />} />
        </Route>

        <Route path="inbox">
          <Route index element={<Navigate to="/inbox/messages" replace />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="requests" element={<ChangeRequestsPage />} />
          <Route path="broadcast" element={<BroadcastPage />} />
        </Route>

        <Route path="assign" element={<AssignPage />} />
        <Route path="settings" element={<SettingsPage />} />

        {LEGACY_REDIRECTS.map(([from, to]) => (
          <Route key={from} path={`${from.slice(1)}/*`} element={<LegacyRedirect to={to} />} />
        ))}
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
