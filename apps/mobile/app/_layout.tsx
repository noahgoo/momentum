import { useEffect } from "react";
import * as Linking from "expo-linking";
import { Stack } from "expo-router";
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

// The Supabase client has detectSessionInUrl disabled (there's no browser
// URL to parse in React Native), so a password-recovery deep link has to be
// caught here and traded for a session by hand. Once exchanged, auth.tsx's
// onAuthStateChange fires PASSWORD_RECOVERY and routes to /reset-password.
function handleAuthDeepLink(url: string | null) {
  if (!url) return;
  const { queryParams } = Linking.parse(url);
  const code = queryParams?.code;
  if (typeof code === "string") {
    void supabase.auth.exchangeCodeForSession(code);
  }
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
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" />
        </Stack>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
