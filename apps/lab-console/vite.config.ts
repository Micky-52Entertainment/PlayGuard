import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The hub's port, when it is not the default one (HUB_PORT moves the hub too).
const hub = `127.0.0.1:${process.env.HUB_PORT || 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CONSOLE_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": `http://${hub}`,
      "/playables": `http://${hub}`,
      "/play": `http://${hub}`,
      "/view": `http://${hub}`,
      "/reports": `http://${hub}`,
      "/ws": {
        target: `ws://${hub}`,
        ws: true,
      },
    },
  },
});
