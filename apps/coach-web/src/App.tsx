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

const queryClient = new QueryClient();

// Routes with dedicated pages (built in this slice) rather than the generic
// PlaceholderPage fallback every other nav item still uses.
const ROUTED_PATHS = new Set(["/workouts", "/warmups"]);

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
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
