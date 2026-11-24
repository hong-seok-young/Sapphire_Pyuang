import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";

// 로그인 없이 보는 글 한 장(functions/p, 일지 정산서)도 앱과 같은 갈무리 글꼴을 쓰게 /fonts/ 에 이름 그대로 둔다
const fonts = () => ({
  name: "sapphire-fonts",
  writeBundle() {
    mkdirSync("dist/fonts", { recursive: true });
    for (const f of ["Galmuri11.woff2", "Galmuri11-Bold.woff2"]) copyFileSync(`node_modules/galmuri/dist/${f}`, `dist/fonts/${f}`);
  },
});

// base './' keeps every path relative, so the same build works on a web host and inside the Android app's WebView.
export default defineConfig({
  base: "./",
  plugins: [react(), fonts()],
  server: { port: 5173, host: true },
  // react 는 따로 한 조각: 배포마다 바뀌지 않아 폰이 캐시한 것을 그대로 쓴다 (업데이트 때 받는 양이 준다, 2026-11-03)
  // 일꾼(Web Worker)도 ES 모듈로 (도감 계산기 최저가 셈 dexSolve.worker.ts 가 HiGHS 를 불러온다)
  worker: { format: "es" },
  build: { rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } },
});
