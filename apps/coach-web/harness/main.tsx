import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./styles.css";
import { AppRoutes } from "../src/App";
import { seed } from "./fixtures";

/**
 * The app's real routes and real components, inside stubbed auth (see
 * vite.harness.config.ts) and a pre-seeded query cache.
 *
 * StrictMode is deliberately off. Its double-invoked effects make the
 * focus-trap and scroll-lock work in MobileSheet harder to reason about when
 * something fails, and the UI checks are about layout and persistence rather
 * than effect purity.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

seed(queryClient);

// Exposed for the UI checks: forcing a re-render of a specific page is the only
// way to exercise a bug that lives in an effect's dependency array.
(window as unknown as { __harnessQueryClient: QueryClient }).__harnessQueryClient = queryClient;

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </QueryClientProvider>
);
