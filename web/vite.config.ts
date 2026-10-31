import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `natter -dev` listens on 4280 and trusts this dev server's origin.
const backend = "http://127.0.0.1:4280"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/launch": backend,
      "/api": backend,
      "/ws": { target: backend, ws: true },
    },
  },
})
