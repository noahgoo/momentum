import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * A warm cache can refetch in ~10ms; without a floor the spinner flashes and
 * reads as a glitch instead of a refresh (mirrors mindful-miya's web version).
 */
const MIN_SPINNER_MS = 500;

/** Drop onto any screen's ScrollView/FlatList as `refreshControl`. Refetches
 * every query currently mounted on the screen, so pages need no wiring
 * beyond the RefreshControl itself. */
export function usePullToRefresh() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SPINNER_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS - elapsed));
      }
      setRefreshing(false);
    }
  }, [queryClient]);

  return { refreshing, onRefresh };
}
