import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Swaps the two modules that need a live backend for the harness stubs.
 *
 * Resolution is intercepted by resolved path rather than by specifier, because
 * every importer reaches these through a different relative path
 * ("../lib/auth", "../../lib/auth"), which a plain alias cannot match.
 */
function stubs(): Plugin {
  return {
    name: "harness-stubs",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || source.includes("/harness/")) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      if (resolved.id.endsWith("/src/lib/supabase.ts")) {
        return path.join(dir, "harness/stub-supabase.ts");
      }
      if (resolved.id.endsWith("/src/lib/auth.tsx")) {
        return path.join(dir, "harness/stub-auth.tsx");
      }
      return null;
    },
  };
}

export default defineConfig({
  root: path.join(dir, "harness"),
  plugins: [stubs(), react(), tailwindcss()],
  // fs.allow: the entry lives in harness/ but imports everything from ../src.
  server: { port: 5199, strictPort: true, fs: { allow: [dir, path.join(dir, "..", "..")] } },
  appType: "spa",
});
