import { useEffect } from "react";
import { Stack, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";

/**
 * A jump from the dashboard straight to Photos or Measurements still lands on
 * top of Progress home, so Back goes there rather than leaving the sub-screen
 * as the stack's only entry.
 */
export const unstable_settings = { initialRouteName: "index" };

/**
 * The dashboard cards jump straight to a sub-screen, and the tab itself already
 * slides in; a stack push on top would be a second animation for one move.
 * Only that entry (`?from=dashboard`) skips it — Progress home still pushes.
 */
const fromDashboardNoAnimation = ({ route }: { route: { params?: object } }) => ({
  animation: (route.params as { from?: string } | undefined)?.from === "dashboard" ? ("none" as const) : ("default" as const),
});

/**
 * The Progress tab is a directory route (index / photos / measurements)
 * rather than a single screen — mirrors the Workout tab's _layout.tsx
 * pattern. This Stack hosts navigation between the three sub-screens while
 * staying inside the "Progress" tab.
 */
export default function ProgressStackLayout() {
  const navigation = useNavigation();

  // Leaving the tab drops the stack back to Progress home. Without this, a
  // sub-screen opened earlier survives under the next one, so Back from
  // Measurements would land on a stale Photos.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        const stackKey = navigation
          .getState()
          ?.routes.find((r) => r.name === "progress")?.state?.key;
        // Without the stack's key (not rendered yet) fall back to the untargeted
        // action, which the focused stack handles.
        navigation.dispatch(
          stackKey ? { ...StackActions.popToTop(), target: stackKey } : StackActions.popToTop()
        );
      }),
    [navigation]
  );

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="photos" options={fromDashboardNoAnimation} />
      <Stack.Screen name="measurements" options={fromDashboardNoAnimation} />
    </Stack>
  );
}
