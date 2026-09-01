import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { NAV_ITEMS } from "./lib/navigation";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

const queryClient = new QueryClient();

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
              {NAV_ITEMS.map(({ to, label }) => (
                <Route
                  key={to}
                  path={to === "/" ? undefined : to.slice(1)}
                  index={to === "/"}
                  element={to === "/" ? <DashboardPage /> : <PlaceholderPage title={label} />}
                />
              ))}
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
