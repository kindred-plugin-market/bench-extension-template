import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "assets",
    emptyOutDir: true,
  },
  resolve: {
    dedupe: ["react", "react-dom", "i18next", "react-i18next"],
  },
});
