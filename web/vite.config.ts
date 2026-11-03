import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// PAGES_BASE=/tenor/ when building for https://harrymove-ctrl.github.io/tenor/.
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5178, strictPort: true },
});
