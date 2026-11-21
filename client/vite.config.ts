import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev only: the standalone API server (see ../server) runs on :3000.
    // In production /api/* is served by the hosting rewrite (vercel.json).
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
