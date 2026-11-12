// 새 기능 알림 (제작자 요청 2026-11-05 '새로운 기능 생겼다고 알림도 한번 줘야지 웹알림'): 메뉴를 새로 열면 모두에게 한 번 앱 알림과 폰 알림.
// /api/news (모두가 2분마다 부른다)가 부른다. setup 키를 먼저 적은 한 곳만 보내고(INSERT OR IGNORE), 알릴 때(at)부터 이틀 안에만 본다
// (그 뒤에는 읽기도 안 한다. 배포가 늦어 한참 지나서 뜬금없이 가지 않게). 새 메뉴를 열면 APP_NEWS 에 한 줄 더한다 (key 는 새로)
import type { Env } from "./auth";
import { notify } from "./alerts";

export interface AppNews {
  key: string;
  at: number;
  text: string;
  link: string;
}

export const APP_NEWS: AppNews[] = [
  {
    key: "app_news_enhance_20261105",
    at: Date.parse("2026-11-05T16:30:00+09:00"),
    text: "강화 비교 기능 추가 · 지금 무기와 바꿀 무기를 고르면 몇 % 강해지는지 바로 보여요",
    link: "#/enhance",
  },
  {
    key: "app_news_devreq_20261106",
    at: Date.parse("2026-11-06T09:15:00+09:00"),
    text: "개발 요청 기능 추가 · 필요한 기능을 앱개발자에게 무료로 신청하고 결재 단계를 모두 함께 볼 수 있어요",
    link: "#/devreq",
  },
  {
    key: "app_news_suggest_20261110",
    at: Date.parse("2026-11-10T19:20:00+09:00"),
    text: "건의함 추가 · 실명이나 익명으로 건의하고 내 건의함에서 결재 진행 상황을 볼 수 있어요",
    link: "#/suggest",
  },
  {
    key: "app_news_gcoin_20261111",
    at: Date.parse("2026-11-11T11:00:00+09:00"),
    text: "성장코인샵 추가 · 2군 본캐는 주간 목표 레벨을 먼저 찍으면 성장코인, 코인으로 도핑템 교환",
    link: "#/gcoin",
  },
  {
    key: "app_news_hall_20261112",
    at: Date.parse("2026-11-12T22:35:00+09:00"),
    text: "명예의 전당 추가 · 기부로 쌓인 마일리지 순위, 안의 기부함 단추로 어떤 템이든 기부 신청하면 마일리지가 쌓여요",
    link: "#/hall",
  },
];

const WINDOW = 2 * 86_400_000;

export async function announceApp(env: Env, now = Date.now()): Promise<void> {
  for (const n of APP_NEWS) {
    if (now < n.at || now - n.at > WINDOW) continue;
    const done = await env.DB.prepare("SELECT 1 AS x FROM setup WHERE key = ?").bind(n.key).first();
    if (done) continue;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?, ?)").bind(n.key, now).run();
    if (r.meta.changes) await notify(env, "all", "app_news", n.text, n.link, "");
  }
}
