// 답을 돌려준 뒤에 마저 할 일 (제작자 2026-11-04 '버튼 동작별로 반응이 늦다'): 폰 알림(웹 푸시)은 폰마다 푸시 서버에 보내느라 수백 ms 가 걸려서
// 누른 사람이 그만큼 기다렸다. API 미들웨어가 요청마다 waitUntil 을 기억해 두고(AsyncLocalStorage, wrangler.toml 의 nodejs_als),
// 여기에 넘긴 일은 답을 보낸 뒤에 끝난다. 요청 밖(스크립트 등)이면 그냥 기다린다
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<(p: Promise<unknown>) => void>();

export function withBackground<T>(waitUntil: (p: Promise<unknown>) => void, fn: () => T): T {
  return store.run(waitUntil, fn);
}

export async function later(work: Promise<unknown>): Promise<void> {
  const w = store.getStore();
  if (w) w(work.catch((e) => console.error("background", e instanceof Error ? e.message : e)));
  else await work;
}
