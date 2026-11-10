// 새 글·새 물건 숫자 배지 (제작자 요청 2026-11-01: 개발 업데이트 'UPDATE' 와 따로, 사람들이 쓰면서 생긴 새 것은 숫자로).
// 2026-11-02 제작자 요청 '큰 버튼 -> 들어가면 어느 버튼에서 신규인지도 그 안에서도 뜨게 (장비대여에 뱃지 -> 안에서 신청함에 뱃지)':
// 칸 안의 단추마다 따로 센다 (KEYS: 'board.notice', 'market.gold', 'rent.apps' …). 홈 칸과 아래 탭은 그 칸 안의 수를 더한다 (GROUPS).
// 단추마다 마지막으로 본 때를 이 기기에 계정별로 적어 두고 그 뒤로 다른 사람이 올린 수를 서버에 묻는다 (/api/news).
// 아이모 소식(imo.*)은 공식 글이 우리 앱에 처음 들어온 때로 센다 (2026-11-02: 글 번호로 세다가 번호가 먼저 매겨진 예약 글을 놓쳤다).
// 처음 쓰는 기기는 지금부터 센다. 그 단추의 화면을 열면 0 이 된다 (useNewsSeen). 홈으로 올 때, 앱으로 돌아올 때, 2분마다 다시 묻는다.
// 2026-11-06 제작자 '들어가면 어디에 뭐가 달린지를 모르겠음, 누가 토론방에 글을 쓰면 버튼에만 배지 달게 아니라 끝까지 배지가 추적해서 계속 붙어서
// 마지막까지 사용자가 들어가서 봐야 배지가 없어지게': 게시판·아이모 소식·중개인·의뢰소·장비대여 목록(THING_KEYS)은 단추를 연다고 지우지 않고,
// 서버가 주는 글·물건마다의 새 일(things: 새 글, 댓글, 토론방 글, 내 의뢰 수락 …)을 그 글·물건을 열 때 지운다 (markThingSeen, 이 기기에 계정별로).
// 단추의 수 = 그 안에서 아직 안 본 일의 합, 줄에는 그 줄의 수(ThingDot), 토론방 단추에는 토론방 글 수. 14일 지난 것은 본 것으로 (서버).
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./auth";
import { SUGGEST_OPEN } from "./board";

export const KEYS = [
  "board.notice",
  "board.event",
  "board.free",
  "board.suggest",
  "imo.notice",
  "imo.maint",
  "imo.event",
  "market.items",
  "market.gold",
  "requests",
  "rent.list",
  "rent.apps",
  "rent.staff",
  // 성장코인샵 담당자: 기다리는 구매 신청 수 (처리하면 줄어든다, 서버가 본 때와 상관없이 센다)
  "gcoin.staff",
] as const;
export type NewsKey = (typeof KEYS)[number];
/** 홈 칸(launcher.ts 의 key)마다 더하는 단추들 */
// 건의함(suggest)은 게시판의 건의 사항 수. 건의함을 열면(SUGGEST_OPEN) 게시판 칸에서는 뺀다
const GROUPS: Record<string, string[]> = {
  board: SUGGEST_OPEN ? ["board.notice", "board.event", "board.free", "imo."] : ["board.", "imo."],
  suggest: ["board.suggest"],
  market: ["market."],
  requests: ["requests"],
  rent: ["rent."],
  gcoin: ["gcoin."],
};
const POLL_MS = 120_000;
/**
 * 아이모 소식을 글 번호로 세던 기기(예전 값이 글 번호)는 이때부터 센다 (2026-11-02 11/2 17:00 KST): 번호로 세다 놓친 새 글을 다시 보이게
 * (제작자 요청 '아까 안 떴으니 게시판 배지 다시 띄워 줘', 배포가 그 글을 지금 들어온 것으로 적는다, scripts/ci-d1.mjs)
 */
const IMO_FROM = 1793606400000;

/** 단추를 열어도 지우지 않고 그 안의 글·물건을 열어야 지우는 단추 (위) */
export const THING_KEYS: NewsKey[] = [
  "board.notice",
  "board.event",
  "board.free",
  "board.suggest",
  "imo.notice",
  "imo.maint",
  "imo.event",
  "market.items",
  "market.gold",
  "requests",
  "rent.list",
];
const isThingKey = (k: NewsKey) => THING_KEYS.includes(k);
/** 글·물건 하나의 새 일: 단추, 때, 쪽(물건·골드의 sell|buy, 장비대여의 직업) */
type Act = { c: NewsKey; t: number; s: string | null };
let acts = new Map<string, Act[]>();
/** 글·물건마다 마지막으로 연 때 */
let thingSeen: Record<string, number> = {};
const THING_KEEP = 15 * 86_400_000;

type Counts = Record<NewsKey, number>;
const zero = (): Counts => Object.fromEntries(KEYS.map((k) => [k, 0])) as Counts;
let counts: Counts = zero();

/** 아이모 점검 하나 (홈 점검 전광판, 제작자 요청 2026-11-01. 서버 server/maint.ts 가 공식 점검 글에서 읽은 것) */
export interface Maint {
  /** 공식 글 번호 (#/official/번호) */
  id: number;
  /** '정기 점검', '임시 점검', '긴급 점검', '점검' */
  label: string;
  start: number;
  /** 모르면 null ('종료 시까지') */
  end: number | null;
  /** 일부 서버만이면 그 서버 */
  servers: string | null;
  extended: boolean;
  /** 인스턴스 던전 입장 제한이 시작되는 때 */
  dungeonFrom: number | null;
  /** 점검 내용 (띠의 아랫줄, 없으면 null) */
  content?: string | null;
}
let maint: Maint[] = [];
let user = "";
let timer: number | undefined;
let listening = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useNews = () => useSyncExternalStore(subscribe, () => counts);
/** 지금 띄울 아이모 점검 (새 글 수와 같이 2분마다 온다) */
export const useMaint = () => useSyncExternalStore(subscribe, () => maint);

const storeKey = () => "sapphire.newsSeen." + user;
function seenAll(): Record<NewsKey, number> {
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(storeKey()) ?? "{}") as Record<string, number>;
  } catch {
    // 못 읽으면 지금부터 센다
  }
  const now = Date.now();
  // 때가 아닌 값(예전에 아이모 소식에 적던 공식 글 번호)은 없는 것으로
  const at = (v: number | undefined) => (typeof v === "number" && v > 1e12 ? v : undefined);
  // 예전에 적은 칸 하나짜리 때('board', 'market')는 그 안의 단추들이 이어받는다
  const oldId = (k: string) => (k.startsWith("imo.") && typeof seen[k] === "number" && seen[k] > 0 && seen[k] < 1e12 ? IMO_FROM : undefined);
  const out = Object.fromEntries(KEYS.map((k) => [k, at(seen[k]) ?? oldId(k) ?? at(seen[k.split(".")[0]]) ?? now])) as Record<NewsKey, number>;
  if (KEYS.some((k) => at(seen[k]) === undefined)) save(out);
  return out;
}
function save(seen: Record<NewsKey, number>) {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(seen));
  } catch {
    // 못 적으면 배지가 남을 뿐이다
  }
}

const thingKey = () => "sapphire.newsThing." + user;
function loadThings() {
  try {
    thingSeen = JSON.parse(localStorage.getItem(thingKey()) ?? "{}") as Record<string, number>;
  } catch {
    thingSeen = {};
  }
}
function saveThings() {
  const old = Date.now() - THING_KEEP;
  for (const k of Object.keys(thingSeen)) if (!(thingSeen[k] > old)) delete thingSeen[k];
  try {
    localStorage.setItem(thingKey(), JSON.stringify(thingSeen));
  } catch {
    // 못 적으면 배지가 남을 뿐이다
  }
}
/** 이 글·물건에서 이때까지는 본 것 (단추를 처음 본 때와 그 글·물건을 연 때 중 늦은 때) */
function seenUntil(k: string, c: NewsKey, base: Record<NewsKey, number>) {
  return Math.max(base[c] ?? 0, thingSeen[k] ?? 0);
}
/** 받은 새 일과 본 때로 단추마다 수를 다시 센다 */
function recount() {
  const base = seenAll();
  const next = { ...counts };
  for (const k of THING_KEYS) next[k] = 0;
  for (const [k, list] of acts) for (const a of list) if (a.t > seenUntil(k, a.c, base)) next[a.c]++;
  counts = next;
}

/** 글·물건 하나(키 'post:12', 'item:3', 'talk:3' …)에서 아직 안 본 새 일의 수 */
export function thingNew(k: string): number {
  const list = acts.get(k);
  if (!list) return 0;
  const base = seenAll();
  return list.filter((a) => a.t > seenUntil(k, a.c, base)).length;
}
/** 이 글·물건을 마지막으로 본 때 (열었을 때 그 뒤에 달린 댓글·토론방 글에 'N' 을 붙인다) */
export function thingSince(k: string): number {
  const list = acts.get(k);
  const base = seenAll();
  return Math.max(thingSeen[k] ?? 0, list?.length ? (base[list[0].c] ?? 0) : 0);
}
/** 한 단추 안에서 쪽(팝니다·삽니다, 직업)마다의 수 */
export function newsSide(c: NewsKey, side: (s: string | null) => boolean): number {
  const base = seenAll();
  let n = 0;
  for (const [k, list] of acts) for (const a of list) if (a.c === c && side(a.s) && a.t > seenUntil(k, a.c, base)) n++;
  return n;
}
/** 글·물건을 열었을 때: 지금까지 본 것으로 (위 단추들의 수도 같이 준다) */
export function markThingSeen(...ks: string[]) {
  if (!user || !ks.length) return;
  const had = ks.some((k) => thingNew(k) > 0);
  const now = Date.now();
  for (const k of ks) thingSeen[k] = now;
  saveThings();
  if (had) {
    recount();
    emit();
  }
}
/** 그 글·물건의 새 일 수 (본 것으로 적으면 다시 그린다) */
export function useThingNew(k: string): number {
  useNews();
  return thingNew(k);
}

let inflight: { q: string; p: Promise<void> } | null = null;

/** 서버에 새 것의 수를 묻는다 (실패하면 그대로). 같은 것을 이미 묻는 중이면 그 답을 같이 쓴다 (앱을 열 때 두 번 물었다) */
export function refreshNews(): Promise<void> {
  if (!user) return Promise.resolve();
  const seen = seenAll();
  const q = KEYS.map((k) => `${k}=${seen[k]}`).join("&");
  if (inflight?.q === q) return inflight.p;
  const p = api<{ counts?: Partial<Counts>; things?: [string, NewsKey, number, string | null][]; maint?: Maint[] }>(`/api/news?${q}`)
    .catch(() => null)
    .then((r) => {
      if (r && user) {
        counts = Object.fromEntries(KEYS.map((k) => [k, r.counts?.[k] ?? 0])) as Counts;
        // 글·물건마다의 새 일 (예전 서버면 없어서 단추 수만 그대로)
        if (Array.isArray(r.things)) {
          const next = new Map<string, Act[]>();
          for (const [k, c, t, s] of r.things) {
            if (!KEYS.includes(c)) continue;
            const list = next.get(k) ?? [];
            list.push({ c, t, s });
            next.set(k, list);
          }
          acts = next;
          recount();
        }
        // 점검은 바뀌었을 때만 새로 (전광판이 흐르다가 처음부터 다시 흐르지 않게)
        if (Array.isArray(r.maint) && JSON.stringify(r.maint) !== JSON.stringify(maint)) maint = r.maint;
        emit();
      }
    })
    .finally(() => {
      if (inflight?.p === p) inflight = null;
    });
  inflight = { q, p };
  return p;
}

/** 로그인한 사람으로 시작 (2분마다, 앱으로 돌아올 때 다시 묻는다) */
export function startNews(id: string) {
  if (user === id) return;
  user = id;
  counts = zero();
  acts = new Map();
  loadThings();
  maint = [];
  emit();
  void refreshNews();
  window.clearInterval(timer);
  timer = window.setInterval(() => !document.hidden && void refreshNews(), POLL_MS);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshNews();
  });
}

/** 단추의 화면을 볼 때: 지금까지 본 것으로 적고 그 배지를 지운다 */
export function markNewsSeen(...all: NewsKey[]) {
  // 글·물건마다 따라가는 단추는 그 글·물건을 열 때 지운다 (markThingSeen)
  const keys = all.filter((k) => !isThingKey(k));
  if (!user || !keys.length) return;
  const seen = seenAll();
  for (const k of keys) seen[k] = Date.now();
  save(seen);
  if (keys.some((k) => counts[k])) {
    counts = { ...counts, ...Object.fromEntries(keys.map((k) => [k, 0])) };
    emit();
  }
}

/**
 * 화면 안에서 지금 보고 있는 단추들을 본 것으로 (열 때와, 보는 동안 새 것이 오면 다시). 아무것도 안 보면 빈 배열
 */
export function useNewsSeen(keys: NewsKey[]) {
  const c = useNews();
  const join = keys.join(",");
  const waiting = keys.some((k) => c[k] > 0);
  useEffect(() => {
    if (join) markNewsSeen(...(join.split(",") as NewsKey[]));
  }, [join, waiting]);
}

/** 단추 하나, 또는 홈 칸(launcher.ts 의 key)이면 그 안의 수를 더한 것 */
export function newsFor(c: Counts, key: string): number {
  if (key in c) return c[key as NewsKey];
  const prefixes = GROUPS[key];
  if (!prefixes) return 0;
  return KEYS.filter((k) => prefixes.some((p) => (p.endsWith(".") ? k.startsWith(p) : k === p))).reduce((n, k) => n + c[k], 0);
}

/** 여러 단추의 합 (게시판 '전체', 아이모 소식 '전체' 같은 단추) */
export const newsSum = (c: Counts, keys: NewsKey[]) => keys.reduce((n, k) => n + c[k], 0);
