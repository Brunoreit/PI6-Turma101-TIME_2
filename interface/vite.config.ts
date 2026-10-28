import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, /api vai para a API local, como o nginx faz no Docker.
// Assim a interface fala só com a API e não precisa de CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (caminho) => caminho.replace(/^\/api/, ""),
      },
    },
  },
});
