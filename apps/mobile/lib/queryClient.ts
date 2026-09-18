import NetInfo from "@react-native-community/netinfo";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OWNED_CACHE } from "./queries/cachePolicy";
import { registerMutationDefaults } from "./queries/mutationDefaults";

/**
 * React Query has no idea whether a React Native device is online — without
 * this it fires requests that fail instead of pausing, which in a gym (the
 * app's primary environment) is most of the time. Wiring onlineManager to
 * NetInfo is what makes queries pause and queued mutations resume.
 *
 * `isInternetReachable` is null while NetInfo is still probing; treating that
 * as offline would blank the app on every cold start, so it falls back to
 * `isConnected`.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(Boolean(state.isInternetReachable ?? state.isConnected));
  })
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      ...OWNED_CACHE,
      retry: 1,
      // A persisted query is worth rendering immediately even if it was
      // written days ago; the background refetch corrects it.
      refetchOnReconnect: true,
    },
    mutations: {
      // Queued mutations must survive a restart, so they are retried rather
      // than failed outright. Their mutationFns are registered in
      // mutationDefaults.ts so resumePausedMutations can replay them.
      retry: 2,
    },
  },
});

/**
 * Registered at module load, before the persisted cache is restored: a
 * replayed mutation needs its fn to already exist when it is rehydrated.
 */
registerMutationDefaults(queryClient);

/**
 * The cache is written to AsyncStorage so a cold start with no signal paints
 * the last-known workout instead of a spinner (violation S-2).
 */
/**
 * Bump when a persisted query's SHAPE changes incompatibly. A stored cache
 * whose buster differs is discarded instead of rehydrated.
 *
 * v2: dashboard/history/week results held a Set, a Map and Date objects.
 * JSON.stringify writes those as `{}`, `{}` and a string, so a cold start
 * restored them without their methods and the dashboard crashed on
 * `completedGoalIds.has`. The shapes are plain JSON now, but caches written
 * by the old build are still on devices and would crash the fixed code the
 * same way — this is what drops them.
 */
export const PERSIST_BUSTER = "v2-json-safe-query-data";

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "momentum.queryCache",
  // Writing on every cache mutation would thrash storage during a workout.
  throttleTime: 2_000,
});
