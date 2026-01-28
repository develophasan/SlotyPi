import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true, // 0.0.0.0, ağdan erişim
    port: 5173,
  },
});


