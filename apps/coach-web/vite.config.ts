import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Hoisted workspace dependencies can carry their own copy of React.
  resolve: { dedupe: ["react", "react-dom"] },
});
