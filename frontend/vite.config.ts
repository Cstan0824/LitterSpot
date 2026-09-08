import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendEnvPath = fileURLToPath(new URL("../backend/.env", import.meta.url));

function backendPortFromEnv() {
  if (!existsSync(backendEnvPath)) return 3000;
  const entry = readFileSync(backendEnvPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("PORT="));
  const value = Number(entry?.slice("PORT=".length).trim().replace(/^['"]|['"]$/g, ""));
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 3000;
}

const backendTarget = process.env.VITE_BACKEND_PROXY_TARGET ?? `http://127.0.0.1:${backendPortFromEnv()}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: { "/api": backendTarget },
  },
});
