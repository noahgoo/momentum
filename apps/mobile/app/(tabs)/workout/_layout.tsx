import { Stack } from "expo-router";

/**
 * The Workout tab is a directory route (index / [date] / history) rather
 * than a single screen — this Stack hosts navigation between them while
 * staying inside the "Workout" tab (the outer (tabs)/_layout.tsx Tabs
 * navigator treats this whole directory as one tab entry, keyed by
 * `name="workout"` there).
 */
export default function WorkoutStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[date]" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
