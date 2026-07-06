import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "/admin-v2/",
  build: {
    outDir: path.resolve(__dirname, "../admin-v2"),
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:8765", changeOrigin: true }
    }
  }
});
