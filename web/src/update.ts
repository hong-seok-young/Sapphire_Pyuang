// 쓰는 동안 새 버전이 올라오면 아래쪽 막대에 무엇을 하는지와 %를 보이며 새 코드를 받고, 100%가 되면 새로고침한다 (제작자 요청:
// 가만히 있으니 답답하다). 받은 코드는 브라우저가 들고 있어서 새로고침은 금방이다. 글을 쓰는 중이면 저절로 하지 않고 단추를 보인다.
import { useEffect, useState } from "react";

/** 새 버전 확인 간격. 웹과 앱(같은 사이트를 띄운다)에 배포가 거의 바로 같이 들어가게 1분마다 (제작자 요청) */
const CHECK_MS = 60_000;

/** 지금 화면의 코드 파일 (빌드마다 이름이 바뀐다). 개발 서버면 null */
export function currentBuild(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;
  return src ? new URL(src).pathname : null;
}

/** 서버의 첫 페이지에서 지금 코드와 스타일 파일 이름 */
async function latestBuild(): Promise<{ js: string; css: string | null } | null> {
  const res = await fetch(`/?update-check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return null;
  const html = await res.text();
  const js = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
  return js ? { js, css: html.match(/\/assets\/index-[\w-]+\.css/)?.[0] ?? null } : null;
}

/** 파일 하나를 받으며 0~1 로 알려 준다. 크기를 모르면 지금 코드 크기로 어림한다 */
async function download(url: string, guess: number, onPart: (part: number) => void): Promise<void> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok || !res.body) throw new Error(String(res.status));
  const total = Number(res.headers.get("content-length")) || guess;
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    onPart(Math.min(0.99, got / total));
  }
  onPart(1);
}

/** 글을 쓰는 중인지 (칸에 글이 있거나 손가락이 칸에 있다): 그러면 저절로 새로고침하지 않는다 */
function typing(): boolean {
  const a = document.activeElement;
  if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && (a as HTMLInputElement).type !== "search"))) return true;
  return [...document.querySelectorAll("textarea")].some((t) => t.value.trim() !== "");
}

export interface UpdateState {
  /** 0~100. null 이면 막대를 숨긴다 */
  pct: number | null;
  label: string;
  /** 다 받았는데 글을 쓰는 중이라 기다린다 */
  waiting: boolean;
}

export function useUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ pct: null, label: "", waiting: false });
  useEffect(() => {
    const found = currentBuild();
    if (!found) return;
    const mine: string = found;
    let busy = false;
    let stopped = false;
    async function check() {
      if (busy || stopped || document.hidden) return;
      busy = true;
      try {
        const latest = await latestBuild();
        if (!latest || latest.js === mine) return;
        setState({ pct: 2, label: "새 버전이 있어요", waiting: false });
        const entry = performance.getEntriesByType("resource").find((e) => e.name.includes(mine)) as PerformanceResourceTiming | undefined;
        const guess = entry?.decodedBodySize || entry?.encodedBodySize || 900_000;
        await download(latest.js, guess, (p) => setState({ pct: Math.round(5 + p * 85), label: "새 화면 받는 중", waiting: false }));
        if (latest.css) await download(latest.css, 60_000, (p) => setState({ pct: Math.round(90 + p * 9), label: "모양 받는 중", waiting: false }));
        setState({ pct: 100, label: "다 받았어요", waiting: false });
        const reload = () => {
          if (typing()) {
            setState({ pct: 100, label: "업데이트 준비 끝", waiting: true });
            return;
          }
          setState({ pct: 100, label: "새 버전으로 여는 중…", waiting: false });
          window.setTimeout(() => location.reload(), 400);
        };
        window.setTimeout(reload, 300);
        stopped = true;
      } catch {
        // 다음에 다시 본다
      } finally {
        busy = false;
      }
    }
    const first = window.setTimeout(check, 20_000);
    const timer = window.setInterval(check, CHECK_MS);
    const onVisible = () => !document.hidden && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return state;
}
