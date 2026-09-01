import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Database } from "@momentum/shared";

/**
 * expo-secure-store caps individual values at 2048 bytes. Supabase auth
 * sessions (access + refresh token + user metadata) regularly exceed that,
 * so we can't hand SecureStore the session blob directly.
 *
 * Pattern used here ("chunked SecureStore", the common community approach
 * predating supabase's own large-secure-store helper): store the *value*
 * in AsyncStorage (unbounded size, unencrypted-at-rest) and store an
 * AES-256 key for that value in SecureStore (small, hardware-backed).
 * We roll a lightweight version by splitting large values into
 * SecureStore-sized chunks instead of introducing an AES dependency —
 * simplest reliable option that keeps everything inside SecureStore's
 * encrypted keychain/keystore, at the cost of a few extra key reads on
 * cold start. Chunk count is tiny (sessions are a few KB), so this is
 * cheap in practice.
 */
const CHUNK_SIZE = 1800; // stay under the 2048-byte SecureStore value limit with headroom
const CHUNK_COUNT_SUFFIX = "_chunks";

async function setChunkedItem(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }

  await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks.length));
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(`${key}_${index}`, chunk))
  );
}

async function getChunkedItem(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (!countRaw) return null;

  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${key}_${index}`))
  );

  if (chunks.some((chunk) => chunk === null)) return null;
  return chunks.join("");
}

async function removeChunkedItem(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  const count = countRaw ? Number.parseInt(countRaw, 10) : 0;

  await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (Number.isFinite(count) && count > 0) {
    await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${key}_${index}`))
    );
  }
}

// Platform.OS (not a `document`/`window` runtime check) is what correctly
// distinguishes the web bundle from the native bundle in every context
// that matters here, including `expo export`'s static-rendering pass,
// which runs the web bundle under Node before any DOM exists.
const isWeb = Platform.OS === "web";

// Node's global scope has neither `window` (so no localStorage, which
// AsyncStorage's web shim needs) nor SecureStore's native module. Static
// export renders the web bundle there to prerender HTML, and the Supabase
// client is constructed at module scope, so the storage adapter must be a
// safe no-op in that specific case rather than one that throws.
const hasBrowserStorage = isWeb && typeof window !== "undefined";

/**
 * SecureStore-backed storage adapter for supabase-js, chunked to work
 * around the 2048-byte-per-value limit. Falls back to AsyncStorage on web
 * (SecureStore is native-only), and to a no-op when neither is available
 * (Node/SSR during static export) so `expo export --platform web` still
 * works for bundle verification.
 */
const secureStorageAdapter: SupportedStorage = {
  getItem: (key: string) => {
    if (isWeb) return hasBrowserStorage ? AsyncStorage.getItem(key) : Promise.resolve(null);
    return getChunkedItem(key);
  },
  setItem: (key: string, value: string) => {
    if (isWeb) return hasBrowserStorage ? AsyncStorage.setItem(key, value) : Promise.resolve();
    return setChunkedItem(key, value);
  },
  removeItem: (key: string) => {
    if (isWeb) return hasBrowserStorage ? AsyncStorage.removeItem(key) : Promise.resolve();
    return removeChunkedItem(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_KEY. Copy .env.example to .env and fill in values."
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
