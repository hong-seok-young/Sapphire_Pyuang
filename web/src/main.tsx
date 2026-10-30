import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// 안드로이드 앱(v1.16 이상)은 이 표시가 있으면 앱의 맨 윗줄을 숨기고, 앱 기능을 아래 탭 '앱'으로 쓴다
(window as unknown as { __sapphireAppMenu?: boolean }).__sapphireAppMenu = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
