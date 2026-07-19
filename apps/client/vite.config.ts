import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5175,
    strictPort: true,
    // Listen on IPv4+IPv6 so both localhost and 127.0.0.1 work (macOS often
    // binds Vite to ::1 only when host is omitted, which breaks 127.0.0.1 curls).
    host: true,
  },
  // allow importing the linked @game/shared TS source
  optimizeDeps: {
    exclude: ["@game/shared"],
  },
});
