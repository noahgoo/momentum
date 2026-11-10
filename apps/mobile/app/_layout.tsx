import { useEffect } from "react";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  useFonts as useFraunces,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold_Italic,
} from "@expo-google-fonts/fraunces";
import {
  useFonts as useInter,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { AuthProvider } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { PERSIST_BUSTER, persister, queryClient } from "../lib/queryClient";
import { TimezoneSyncGate } from "../components/TimezoneSyncGate";

void SplashScreen.preventAutoHideAsync();

// Without a handler iOS silently drops a push that arrives while the app is
// open. Show it as a banner like any other.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The Supabase client has detectSessionInUrl disabled (there's no browser
// URL to parse in React Native), so a password-recovery deep link has to be
// caught here and traded for a session by hand. Once exchanged, auth.tsx's
// onAuthStateChange fires PASSWORD_RECOVERY and routes to /reset-password.
//
// Only PKCE `?code=` links are accepted: a code is useless without the
// verifier stored on the device that requested the reset. Raw
// `#access_token=` fragments are deliberately ignored — any app or web page
// can open a momentum:// URL, and honoring one would sign this device into
// whatever account the tokens belong to.
function handleAuthDeepLink(url: string | null) {
  if (!url) return;
  const { queryParams } = Linking.parse(url);
  const code = queryParams?.code;
  if (typeof code === "string") {
    void supabase.auth.exchangeCodeForSession(code);
  }
}

/**
 * A tapped push opens the Workout tab. The payload carries a kind, not a
 * destination, and the tab resolves the live schedule when it opens, so a
 * notification delivered hours ago still shows what is true now.
 */
function openFromNotification(response: Notifications.NotificationResponse | null) {
  const kind = response?.notification.request.content.data?.kind;
  if (typeof kind !== "string") return;
  // Moves await the coach; everything else a client is told about is on the
  // workout tab.
  router.push("/(tabs)/workout");
}

export default function RootLayout() {
  const [frauncesLoaded] = useFraunces({
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold_Italic,
  });
  const [interLoaded] = useInter({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const fontsLoaded = frauncesLoaded && interLoaded;

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    // Cold start from a tap, and taps while the app is running.
    openFromNotification(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then(handleAuthDeepLink);
    const subscription = Linking.addEventListener("url", ({ url }) => handleAuthDeepLink(url));
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, buster: PERSIST_BUSTER }}
      // Fires once the persisted cache has been restored. Writes made offline
      // are paused mutations until something resumes them; without this a
      // client's logged workout would sit in storage indefinitely.
      onSuccess={() => {
        void queryClient.resumePausedMutations();
      }}
    >
      <AuthProvider>
        <TimezoneSyncGate />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="accept-invite" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" />
        </Stack>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
