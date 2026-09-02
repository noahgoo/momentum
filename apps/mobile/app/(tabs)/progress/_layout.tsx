import { Stack } from "expo-router";

/**
 * The Progress tab is a directory route (index / photos / measurements)
 * rather than a single screen — mirrors the Workout tab's _layout.tsx
 * pattern. This Stack hosts navigation between the three sub-screens while
 * staying inside the "Progress" tab.
 */
export default function ProgressStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="photos" />
      <Stack.Screen name="measurements" />
    </Stack>
  );
}
