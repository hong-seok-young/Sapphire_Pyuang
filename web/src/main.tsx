import { StrictMode } from "react";
import { UpdateBar } from "./ui";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// 안드로이드 앱(v1.16 이상)은 이 표시가 있으면 앱의 맨 윗줄을 숨기고, 앱 기능을 아래 탭 '앱'으로 쓴다
(window as unknown as { __sapphireAppMenu?: boolean }).__sapphireAppMenu = true;

/**
 * 새 버전이 열리면 한 번 '업데이트됐어요'를 잠깐 띄운다 (제작자 요청). 코드 파일 이름(빌드마다 바뀜)을 지난번과 비교한다
 */
function noticeUpdate() {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;
  if (!src) return; // 개발 서버
  let before: string | null = null;
  try {
    before = localStorage.getItem("sapphire-build");
    localStorage.setItem("sapphire-build", src);
  } catch {
    return;
  }
  // 다음 업데이트 때 첫 화면 막대가 코드 크기를 어림하게 적어 둔다
  window.setTimeout(() => {
    const entry = performance.getEntriesByType("resource").find((e) => e.name === src) as PerformanceResourceTiming | undefined;
    if (entry?.decodedBodySize) {
      try {
        localStorage.setItem("sapphire-build-size", String(entry.decodedBodySize));
      } catch {
        // 못 적어도 어림값을 쓴다
      }
    }
  }, 3000);
  if (!before || before === src) return;
  const toast = document.createElement("div");
  toast.className = "update-toast";
  toast.textContent = "✨ 새 버전으로 업데이트됐어요";
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4500);
}
noticeUpdate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <UpdateBar />
  </StrictMode>,
);
