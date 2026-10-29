import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' keeps every path relative, so the same build works on a web host and inside the Android app's WebView.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true },
});
