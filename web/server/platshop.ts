// 1군 전용 플래티넘 할인 상점 (제작자 요청): 길드 관계자가 게임 상점에서 플래티넘 물건을 사서 길드원과 게임 안에서 거래하고,
// 할인된 비율만큼 골드를 받는다. 비율은 '플래티넘 100당 몇 만 골드' (시중 7:100, 길드 할인 처음 5:100).
// 물건 목록은 제작자의 게임 상점 스샷에서 잘라 낸 칸과 이름, 플래티넘 값 (비공개 자료 이미지/상점/items.json -> /data/shop/items.json).
// 1군 길드원에게 매주(목요일 오전 10시, server/week.ts) 가상 플래티넘을 웹 지갑에 지급하고 쌓인다 (제작자 요청: 1군 주당 300, 고스펙은 따로).
// 구매 신청하면 물건의 플래티넘 값만큼 지갑에서 빠지고(취소하면 돌아온다), 골드는 할인 비율로 낸다.
// 오피서 이상이 비율, 주당 지급, 판매 여부를 정한다.
import type { Env } from "./auth";
import { WEEK, weekStart } from "./week";

export interface ShopItem {
  id: string;
  name: string;
  plat: number;
  count: number;
  tile: string;
}

export interface ShopSettings {
  ratio: number;
  /** 고스펙 길드원의 할인 비율 (제작자 요청: 고스펙에게 더 할인) */
  highRatio: number;
  market: number;
  limitCount: number;
  limitWeeks: number;
  /** 1군 한 사람의 주당 플래티넘 */
  weekPlat: number;
  /** 고스펙 한 사람의 주당 플래티넘 */
  highWeekPlat: number;
  /** 길드원에게 열었는지 (제작자 요청: 열기 전에는 앱개발자, 길드마스터, 오피서만 들어가고 길드원은 '준비 중') */
  open: boolean;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  ratio: 5, highRatio: 4, market: 7, limitCount: 1, limitWeeks: 2, weekPlat: 300, highWeekPlat: 300, open: false,
};

/** 물건 목록 (사이트에 올라간 정적 파일, 로그인 검사 없이 서버 안에서 읽는다) */
export async function loadCatalog(env: Env, request: Request): Promise<ShopItem[]> {
  const res = await env.ASSETS.fetch(new Request(new URL("/data/shop/items.json", request.url)));
  if (!res.ok) return [];
  return (await res.json()) as ShopItem[];
}

export async function loadSettings(env: Env): Promise<ShopSettings> {
  const row = await env.DB.prepare(
    "SELECT ratio, high_ratio, market, limit_count, limit_weeks, week_plat, high_week_plat, open FROM plat_settings WHERE id = 1",
  ).first<{
    ratio: number; high_ratio: number; market: number; limit_count: number; limit_weeks: number; week_plat: number; high_week_plat: number; open: number;
  }>();
  return row
    ? {
        ratio: row.ratio, highRatio: row.high_ratio, market: row.market, limitCount: row.limit_count, limitWeeks: row.limit_weeks,
        weekPlat: row.week_plat, highWeekPlat: row.high_week_plat, open: row.open === 1,
      }
    : DEFAULT_SETTINGS;
}

export interface ItemRule {
  enabled: boolean;
  ratio: number | null;
  highRatio: number | null;
  limitCount: number | null;
  limitWeeks: number | null;
}

export async function loadRules(env: Env): Promise<Map<string, ItemRule>> {
  const rows = await env.DB.prepare("SELECT item_id, enabled, ratio, high_ratio, limit_count, limit_weeks FROM plat_items")
    .all<{ item_id: string; enabled: number; ratio: number | null; high_ratio: number | null; limit_count: number | null; limit_weeks: number | null }>();
  return new Map(
    rows.results.map((r) => [
      r.item_id,
      { enabled: r.enabled === 1, ratio: r.ratio, highRatio: r.high_ratio, limitCount: r.limit_count, limitWeeks: r.limit_weeks },
    ]),
  );
}

/** 플래티넘을 골드로: 비율이 5 면 플래티넘 100 = 5만 골드 */
export const goldOf = (plat: number, ratio: number) => Math.round((plat / 100) * ratio * 10_000);

/** 한 물건의 실제 값 (물건마다 정한 게 없으면 통 설정) */
export function effective(item: ShopItem, s: ShopSettings, rule: ItemRule | undefined) {
  const ratio = rule?.ratio ?? s.ratio;
  const highRatio = rule?.highRatio ?? s.highRatio;
  return {
    enabled: rule?.enabled ?? true,
    ratio,
    highRatio,
    highGold: goldOf(item.plat, highRatio),
    limitCount: rule?.limitCount ?? s.limitCount,
    limitWeeks: rule?.limitWeeks ?? s.limitWeeks,
    gold: goldOf(item.plat, ratio),
    marketGold: goldOf(item.plat, s.market),
    custom: !!rule && (rule.ratio !== null || rule.highRatio !== null || rule.limitCount !== null || rule.limitWeeks !== null),
  };
}

/**
 * 내 플래티넘 지갑. 밀린 주의 지급을 먼저 넣는다 (1군일 때만, 그 주의 고스펙 여부로). 처음 열면 이번 주 몫을 바로 준다.
 * 남은 플래티넘 = 지급 합 - 지갑을 연 뒤 취소하지 않은 신청의 플래티넘 합
 */
export async function wallet(env: Env, userId: string, main: boolean, high: boolean, s: ShopSettings, now = Date.now()) {
  const week = weekStart(now);
  const weekly = high ? s.highWeekPlat : s.weekPlat;
  let w = await env.DB.prepare("SELECT granted, granted_until, started_at FROM plat_wallets WHERE user_id = ?")
    .bind(userId)
    .first<{ granted: number; granted_until: number; started_at: number }>();
  if (!w) {
    w = { granted: main ? weekly : 0, granted_until: week, started_at: now };
    await env.DB.prepare("INSERT OR IGNORE INTO plat_wallets (user_id, granted, granted_until, started_at) VALUES (?, ?, ?, ?)")
      .bind(userId, w.granted, w.granted_until, w.started_at)
      .run();
  } else if (w.granted_until < week) {
    const weeks = Math.round((week - w.granted_until) / WEEK);
    const add = main ? weeks * weekly : 0;
    // 두 곳에서 동시에 열어도 한 번만 (granted_until 이 그대로일 때만 바꾼다)
    const res = await env.DB.prepare("UPDATE plat_wallets SET granted = granted + ?, granted_until = ? WHERE user_id = ? AND granted_until = ?")
      .bind(add, week, userId, w.granted_until)
      .run();
    if (res.meta.changes) w = { ...w, granted: w.granted + add, granted_until: week };
  }
  const spent = await env.DB.prepare(
    "SELECT COALESCE(SUM(plat), 0) AS n FROM plat_orders WHERE user_id = ? AND status != 'cancelled' AND created_at >= ?",
  )
    .bind(userId, w.started_at)
    .first<{ n: number }>();
  const used = spent?.n ?? 0;
  return { balance: Math.max(0, w.granted - used), granted: w.granted, spent: used, weekly: main ? weekly : 0, nextAt: week + WEEK };
}

export const validPlat = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000;

export const validRatio = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100;
export const validCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 99;
export const validWeeks = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 52;
