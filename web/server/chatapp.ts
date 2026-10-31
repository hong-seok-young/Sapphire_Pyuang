// 챗봇의 '길드 앱 자료' (제작자 요청 2026-11-01: '마을모금함이 누군지 알아?'에 답을 못 했다. 앱 자료를 다 읽고, 로그까지 읽고 답하게).
// 질문할 때마다 D1 에서 지금 자료를 읽어 질문 앞에 붙인다 (functions/api/chat/index.ts). 묻는 사람이 앱에서 볼 수 있는 것만 넣는다:
// - 늘: 길드 현황, 길드원 명단(닉네임, 1군/2군, 직업, 레벨, 경험치, 길드마스터·오피서, 고스펙, 이번 주 레벨업. 랭킹 화면과 같은 값),
//   중개인·골드·의뢰소·게시판을 한 줄씩 줄인 것
// - 질문에 맞으면 (ASK, 또는 질문에 나온 닉네임·물건 이름): 성장 랭킹, 중개인 매물, 골드 거래, 의뢰소, 게시판, 플래티넘 상점.
//   살래요·입찰·골드 글의 명단과 흥정 가격은 올린 본인에게만 (화면과 같은 규칙)
// - 오피서 이상: 비밀번호 바꾸기 전, 폰 알림 상태 ('길드원 관리'에서 보이는 값)
// - 앱개발자만: 사용 기록(접속, 화면, 한 일, IP, 위치, 기기), 챗봇 개선 목록과 오늘 질문 수.
//   사용 기록은 앱개발자만 보는 기능이라 (CLAUDE.md '사용 기록') 다른 사람의 질문에는 붙이지 않는다
// 칸마다 글자 수를 정해 두어 질문이 너무 길어지지 않게 한다.
import { RANK, TEST_IDS } from "./auth";
import type { Env, Guild, Job, Role, User } from "./auth";
import { CAT_NAME } from "./board";
import type { Cat } from "./board";
import { growthEntries } from "./growth";
import type { Period } from "./growth";
import { ACCEPT_MS } from "./requests";
import { weekStart } from "./week";

/** 길드 앱 자료 전체 글자 수 */
export const MAX_APP = 24000;
const KST = 9 * 3_600_000;
const DAY = 86_400_000;
const JOB: Record<Job, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const GUILD: Record<Guild, string> = { main: "1군 Sapphire", second: "2군 FairyTale" };
/** 앱개발자는 길드 직책이 아니라 길드원으로 보인다 (제작자 요청) */
const ROLE: Partial<Record<Role, string>> = { master: "길드마스터", officer: "오피서" };
const ENCHANT: Record<string, string> = { str: "힘", dex: "민첩", int: "지능", hp: "체력", mp: "마나" };
const PUSH: Record<string, string> = { on: "폰 알림 켬", app_off: "폰 알림 앱에서 끔", denied: "폰 알림 거부", ask: "폰 알림 묻기 전", none: "폰 알림 안 되는 기기" };
const VIA: Record<string, string> = { app: "안드로이드 앱", float: "게임 위 창", ios: "아이폰 웹", android: "안드로이드 웹", pc: "PC 웹" };

/** 이런 말이 있으면 그 칸을 자세히 붙인다 */
const ASK = {
  growth: /성장|주간|이번 ?주|오늘|이번 ?달|월간|많이 ?올|랭킹|순위|등수|1등|일등|레벨업|렙업/,
  market: /중개인|매물|판매|팔[아고려리면았았]|팔래|살래|사[고려]|구매|경매|입찰|낙찰|흥정|얼마|가격|시세|거래|물건|올라온|토론/,
  gold: /골드|현금|원화|만 ?원|시세|현거래/,
  requests: /의뢰|부탁|구해|구함|수락/,
  board: /게시판|공지|이벤트|게시글|글 ?(올|썼|쓴|쓰)|댓글|좋아요|자유/,
  shop: /플티|플래티넘|상점|지갑|할인|신청/,
  logs: /로그|기록|접속|활동|들어(왔|온|와|오)|방문|누가|언제|아이피|\bip\b|어디서|위치|기기|폰|몇 ?번|뭐 ?했|했(어|냐|니|나|는지)|최근|요즘/i,
  gaps: /챗봇|질문|개선|모름|별로/,
};

interface Person {
  id: string;
  role: Role;
  high_spec: number;
  must_change: number;
  push_perm: string | null;
  job: Job | null;
  level: number | null;
  prev_level: number | null;
  level_at: number | null;
  exp: number | null;
  guild: Guild | null;
}

const two = (n: number) => String(n).padStart(2, "0");
/** 한국 시간 '11/1 14:05' */
function when(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
function gold(n: number): string {
  if (n >= 100_000_000) {
    const man = Math.round((n % 100_000_000) / 10_000);
    return `${Math.floor(n / 100_000_000)}억${man ? ` ${man.toLocaleString("ko-KR")}만` : ""} 골드`;
  }
  if (n >= 10_000) return `${(Math.round(n / 1000) / 10).toLocaleString("ko-KR")}만 골드`;
  return `${n.toLocaleString("ko-KR")} 골드`;
}
const expText = (e: number | null) => (e === null ? "경험치 안 적음" : `경험치 ${(e / 1000).toFixed(3)}%`);
/** 성장량 (레벨 1 = 100%) */
const growthText = (g: number) => `+${Number((g / 1000).toFixed(3))}%`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** 제목 + 줄들, cap 글자를 넘으면 나머지는 수만 알린다 */
function section(title: string, lines: string[], cap: number): string {
  if (!lines.length) return "";
  let out = `[${title}]`;
  for (let i = 0; i < lines.length; i++) {
    if (out.length + lines[i].length + 1 > cap) return `${out}\n(나머지 ${lines.length - i}개는 길이 때문에 뺐다)`;
    out += `\n${lines[i]}`;
  }
  return out;
}

function optionsText(raw: string | null): string {
  if (!raw) return "";
  try {
    const list = JSON.parse(raw) as { name: string; value: number; unit?: string }[];
    return list.length ? ` · 옵션 ${list.map((o) => `${o.name} ${o.value}${o.unit ?? ""}`).join(", ")}` : "";
  } catch {
    return "";
  }
}

/** 이 질문(앞 질문 포함)에 붙일 길드 앱 자료. 묻는 사람(me)이 앱에서 볼 수 있는 것만 */
export async function appContext(env: Env, me: User, question: string, now = Date.now()): Promise<string> {
  const officer = RANK[me.role] >= 1;
  const dev = me.role === "developer";
  const q = question;
  const k = new Date(now + KST);
  const today = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST;
  const week = weekStart(now);

  const [peopleR, listingsR, myWantersR, myBidsR, myWantsR, rateR, goldR, myGoldWantsR, requestsR, boardR, platR, myOrdersR, openOrdersR] =
    await env.DB.batch([
      env.DB.prepare(
        "SELECT u.id AS id, u.role AS role, u.high_spec AS high_spec, u.must_change AS must_change, u.push_perm AS push_perm, " +
          "p.job AS job, p.level AS level, p.prev_level AS prev_level, p.level_at AS level_at, p.exp AS exp, p.guild AS guild " +
          "FROM users u LEFT JOIN profiles p ON p.user_id = u.id " +
          "ORDER BY p.level IS NULL, p.level DESC, p.exp IS NULL, p.exp DESC, p.level_at ASC, u.id ASC",
      ),
      env.DB.prepare(
        "SELECT l.id, l.seller, l.item, l.category, l.enhance, l.enchant, l.enchant_value, l.qty, l.price, l.note, l.options, l.mode, l.ends_at, l.created_at, " +
          "(SELECT COUNT(*) FROM listing_wants w WHERE w.listing_id = l.id) AS wants, " +
          "(SELECT COUNT(*) FROM listing_bids b WHERE b.listing_id = l.id) AS bids, " +
          "(SELECT MAX(amount) FROM listing_bids b WHERE b.listing_id = l.id) AS top_bid, " +
          "(SELECT COUNT(*) FROM listing_talk t WHERE t.listing_id = l.id) AS talk " +
          "FROM listings l WHERE l.status = 'selling' ORDER BY l.created_at DESC LIMIT 80",
      ),
      // 내 물건에 살래요 누른 사람과 흥정 가격, 입찰 (판 사람 본인에게만)
      env.DB.prepare(
        "SELECT w.listing_id AS listing_id, w.user_id AS user_id, w.note AS note, w.offer AS offer FROM listing_wants w " +
          "JOIN listings l ON l.id = w.listing_id WHERE l.seller = ? AND l.status = 'selling' ORDER BY w.created_at",
      ).bind(me.id),
      env.DB.prepare(
        "SELECT b.listing_id AS listing_id, b.user_id AS user_id, b.amount AS amount FROM listing_bids b " +
          "JOIN listings l ON l.id = b.listing_id WHERE l.seller = ? AND l.status = 'selling' ORDER BY b.amount DESC",
      ).bind(me.id),
      // 내가 남의 물건에 한 것
      env.DB.prepare(
        "SELECT listing_id, offer, NULL AS amount FROM listing_wants WHERE user_id = ?1 " +
          "UNION ALL SELECT listing_id, NULL AS offer, MAX(amount) AS amount FROM listing_bids WHERE user_id = ?1 GROUP BY listing_id",
      ).bind(me.id),
      env.DB.prepare("SELECT AVG(rate) AS rate FROM gold_offers WHERE status = 'open' AND side = 'sell'"),
      env.DB.prepare(
        "SELECT o.id, o.owner, o.side, o.gold, o.rate, o.note, o.created_at, (SELECT COUNT(*) FROM gold_wants w WHERE w.offer_id = o.id) AS wants " +
          "FROM gold_offers o WHERE o.status = 'open' ORDER BY o.created_at DESC LIMIT 40",
      ),
      env.DB.prepare(
        "SELECT w.offer_id AS offer_id, w.user_id AS user_id, w.note AS note FROM gold_wants w JOIN gold_offers o ON o.id = w.offer_id " +
          "WHERE o.owner = ? AND o.status = 'open' ORDER BY w.created_at",
      ).bind(me.id),
      env.DB.prepare(
        "SELECT id, owner, title, detail, reward_gold, reward_text, status, accepter, accepted_at, created_at FROM requests " +
          "WHERE status != 'done' ORDER BY created_at DESC LIMIT 40",
      ),
      env.DB.prepare(
        "SELECT p.id, p.cat, p.author, p.title, substr(p.body, 1, 400) AS body, p.pinned, p.created_at, " +
          "(SELECT COUNT(*) FROM board_comments c WHERE c.post_id = p.id) AS comments, (SELECT COUNT(*) FROM board_likes k WHERE k.post_id = p.id) AS likes, " +
          "(SELECT COUNT(*) FROM board_views v WHERE v.post_id = p.id) AS views FROM board_posts p ORDER BY p.pinned DESC, p.id DESC LIMIT 20",
      ),
      env.DB.prepare("SELECT ratio, high_ratio, market, open, week_plat, high_week_plat FROM plat_settings WHERE id = 1"),
      env.DB.prepare("SELECT item_name, plat, gold, status, created_at FROM plat_orders WHERE user_id = ? ORDER BY id DESC LIMIT 10").bind(me.id),
      env.DB.prepare("SELECT user_id, item_name, plat, gold, created_at FROM plat_orders WHERE status = 'requested' ORDER BY id DESC LIMIT 20"),
    ]);

  const people = (peopleR.results as Person[]).filter((p) => !TEST_IDS.includes(p.id));
  const ranked = people.filter((p) => p.level !== null);
  const unset = people.filter((p) => p.level === null);
  const mentioned = people.map((p) => p.id).filter((n) => n.length >= 2 && q.includes(n));
  const parts: string[] = [];

  // ---------- 지금, 묻는 사람, 길드 현황 ----------
  const weekday = "일월화수목금토"[k.getUTCDay()];
  const meP = people.find((p) => p.id === me.id);
  const meLine = meP?.level
    ? `${me.id} (${meP.guild ? GUILD[meP.guild] : "길드 안 정함"} ${ROLE[me.role] ?? "길드원"}${dev ? ", 이 앱의 앱개발자" : ""}, ${JOB[meP.job as Job]} Lv.${meP.level})`
    : `${me.id} (${ROLE[me.role] ?? "길드원"}${dev ? ", 이 앱의 앱개발자" : ""})`;
  const byGuild = (g: Guild) => ranked.filter((p) => p.guild === g);
  const avg = (list: Person[]) => (list.length ? (list.reduce((s, p) => s + (p.level ?? 0), 0) / list.length).toFixed(1) : "-");
  const roleList = (r: Role) => people.filter((p) => p.role === r).map((p) => p.id);
  parts.push(
    [
      `[지금] ${k.getUTCFullYear()}-${two(k.getUTCMonth() + 1)}-${two(k.getUTCDate())}(${weekday}) ${two(k.getUTCHours())}:${two(k.getUTCMinutes())} 한국 시간 · 묻는 사람: ${meLine}`,
      `[길드 현황] 아이모 길드 Sapphire(사파이어). 1군 Sapphire ${byGuild("main").length}명 평균 Lv.${avg(byGuild("main"))} · 2군 FairyTale ${byGuild("second").length}명 평균 Lv.${avg(byGuild("second"))} · 앱 계정 모두 ${people.length}개`,
      `길드마스터: ${roleList("master").join(", ") || "없음"} · 오피서: ${roleList("officer").join(", ") || "없음"}`,
      `이 길드 앱(Sapphire web)은 길드원 ${roleList("developer").join(", ")}이(가) 만들었다. 주마다 리셋·지급은 목요일 오전 10시(한국 시간).`,
    ].join("\n"),
  );

  // ---------- 물어본 길드원 ----------
  const rankIn = (list: Person[], id: string) => list.findIndex((p) => p.id === id) + 1;
  for (const id of mentioned.slice(0, 5)) {
    const p = people.find((x) => x.id === id)!;
    const facts = [
      p.guild ? GUILD[p.guild] : "길드 안 정함",
      ROLE[p.role] ?? "길드원",
      p.level !== null ? `${JOB[p.job as Job]} Lv.${p.level} ${expText(p.exp)}` : "직업·레벨 아직 안 정함",
      p.level !== null ? `레벨 랭킹 통합 ${rankIn(ranked, id)}위${p.guild ? `, ${p.guild === "main" ? "1군" : "2군"} ${rankIn(byGuild(p.guild), id)}위` : ""}` : "",
      p.high_spec ? "고스펙" : "",
      p.prev_level !== null && p.level !== null && p.prev_level < p.level && p.level_at !== null && p.level_at >= week ? `이번 주 Lv.${p.prev_level}→${p.level}` : "",
      p.role === "developer" ? "이 앱을 만든 사람" : "",
    ].filter(Boolean);
    parts.push(`[물어본 길드원: ${id}] 이 길드의 길드원(게임 닉네임)이다. ${facts.join(" · ")}`);
  }

  // ---------- 성장 랭킹 ----------
  if (ASK.growth.test(q) || mentioned.length) {
    const periods: [Period, string][] = [["week", "이번 주(목요일 오전 10시부터)"]];
    if (/오늘/.test(q)) periods.unshift(["day", "오늘(0시부터)"]);
    if (/이번 ?달|월간|한 ?달/.test(q)) periods.push(["month", "이번 달(1일 0시부터)"]);
    for (const [period, label] of periods) {
      const { entries } = await growthEntries(env, period, now);
      const lines = entries.map(
        (e, i) => `${i + 1}. ${e.id} (${e.guild ? GUILD[e.guild] : "-"}, ${JOB[e.job]}) Lv.${e.fromLevel}→${e.level} ${growthText(e.growth)}`,
      );
      parts.push(section(`성장 랭킹 ${label}, 오른 사람만 (레벨 1 = 100%)`, lines.length ? lines : ["아직 오른 사람 없음"], 2500));
    }
  }

  // ---------- 중개인 ----------
  type Listing = {
    id: number; seller: string; item: string; category: string; enhance: number; enchant: string | null; enchant_value: number | null;
    qty: number; price: number; note: string | null; options: string | null; mode: string; ends_at: number | null; created_at: number;
    wants: number; bids: number; top_bid: number | null; talk: number;
  };
  const listings = listingsR.results as Listing[];
  const rate = (rateR.results[0] as { rate: number | null } | undefined)?.rate ?? 75;
  const itemHit = listings.some((l) => l.item.length >= 2 && q.includes(l.item));
  const sellerHit = listings.some((l) => mentioned.includes(l.seller));
  if (listings.length && (ASK.market.test(q) || itemHit || sellerHit)) {
    const wantersBy = new Map<number, string[]>();
    for (const w of myWantersR.results as { listing_id: number; user_id: string; note: string | null; offer: number | null }[]) {
      const list = wantersBy.get(w.listing_id) ?? [];
      list.push(`${w.user_id}${w.offer ? ` 흥정 ${gold(w.offer)}` : ""}${w.note ? ` "${oneLine(w.note)}"` : ""}`);
      wantersBy.set(w.listing_id, list);
    }
    const bidsBy = new Map<number, string[]>();
    for (const b of myBidsR.results as { listing_id: number; user_id: string; amount: number }[]) {
      const list = bidsBy.get(b.listing_id) ?? [];
      list.push(`${b.user_id} ${gold(b.amount)}`);
      bidsBy.set(b.listing_id, list);
    }
    const mine = new Map<number, string>();
    for (const m of myWantsR.results as { listing_id: number; offer: number | null; amount: number | null }[]) {
      mine.set(m.listing_id, [mine.get(m.listing_id), m.amount ? `내 입찰 ${gold(m.amount)}` : `내가 살래요${m.offer ? `(흥정 ${gold(m.offer)})` : ""}`].filter(Boolean).join(", "));
    }
    const lines = listings.map((l) => {
      const what = `${l.item}${l.enhance ? ` +${l.enhance}` : ""}${l.enchant ? ` (속성부여 ${ENCHANT[l.enchant] ?? l.enchant} ${l.enchant_value})` : ""}${l.qty > 1 ? ` ${l.qty}개` : ""} [${l.category}]`;
      const price =
        l.mode === "auction"
          ? `경매 시작가 ${gold(l.price)}, ${l.top_bid ? `최고가 ${gold(l.top_bid)} (입찰 ${l.bids}번)` : "입찰 없음"}, ${l.ends_at ? `${when(l.ends_at)}${l.ends_at < now ? " 끝남" : " 끝"}` : ""}`
          : `${gold(l.price)} (≈ ${(l.price / rate / 10_000).toFixed(1)}만 원)`;
      const own = l.seller === me.id ? [wantersBy.get(l.id)?.length ? ` · 살래요 명단: ${wantersBy.get(l.id)!.join("; ")}` : "", bidsBy.get(l.id)?.length ? ` · 입찰 명단: ${bidsBy.get(l.id)!.join("; ")}` : ""].join("") : "";
      return `#${l.id} ${what} · ${price} · 판매 ${l.seller}${l.wants ? ` · 살래요 ${l.wants}명` : ""}${l.talk ? ` · 토론방 글 ${l.talk}` : ""}${l.note ? ` · 한마디 "${oneLine(l.note)}"` : ""}${optionsText(l.options)}${mine.has(l.id) ? ` · ${mine.get(l.id)}` : ""}${own} · ${when(l.created_at)} 올림`;
    });
    parts.push(section(`사파이어 중개인: 판매 중 ${listings.length}개 (새 글 먼저, 골드 시세 1만 원 = ${Math.round(rate)}만 골드). 살래요·입찰한 사람과 흥정 가격은 판 사람만 본다`, lines, 6000));
  }

  // ---------- 골드 거래 ----------
  type GoldOffer = { id: number; owner: string; side: string; gold: number; rate: number; note: string | null; created_at: number; wants: number };
  const goldOffers = goldR.results as GoldOffer[];
  if (goldOffers.length && (ASK.gold.test(q) || goldOffers.some((o) => mentioned.includes(o.owner)))) {
    const wantBy = new Map<number, string[]>();
    for (const w of myGoldWantsR.results as { offer_id: number; user_id: string; note: string | null }[]) {
      const list = wantBy.get(w.offer_id) ?? [];
      list.push(`${w.user_id}${w.note ? ` "${oneLine(w.note)}"` : ""}`);
      wantBy.set(w.offer_id, list);
    }
    const lines = goldOffers.map(
      (o) =>
        `${o.side === "sell" ? "골드 팝니다" : "골드 삽니다"} ${o.gold.toLocaleString("ko-KR")}만 골드 · 1만 원 = ${o.rate}만 골드 (≈ ${(o.gold / o.rate).toFixed(1)}만 원) · ${o.owner}` +
        `${o.wants ? ` · ${o.side === "sell" ? "살래요" : "팔래요"} ${o.wants}명` : ""}${o.note ? ` · "${oneLine(o.note)}"` : ""}` +
        `${o.owner === me.id && wantBy.get(o.id)?.length ? ` · 명단: ${wantBy.get(o.id)!.join("; ")}` : ""} · ${when(o.created_at)}`,
    );
    parts.push(section("골드 거래: 올라와 있는 글 (현금 거래는 게임 운영정책상 계정 정지 위험이 있다)", lines, 2500));
  }

  // ---------- 의뢰소 ----------
  type Req = {
    id: number; owner: string; title: string; detail: string | null; reward_gold: number | null; reward_text: string | null;
    status: string; accepter: string | null; accepted_at: number | null; created_at: number;
  };
  const reqs = requestsR.results as Req[];
  if (reqs.length && (ASK.requests.test(q) || reqs.some((r) => mentioned.includes(r.owner) || (r.accepter !== null && mentioned.includes(r.accepter))))) {
    const lines = reqs.map((r) => {
      const late = r.status === "accepted" && r.accepted_at !== null && r.accepted_at + ACCEPT_MS < now;
      const state = r.status === "accepted" && !late ? `진행 중 (수락: ${r.accepter}, ${when((r.accepted_at ?? 0) + ACCEPT_MS)}까지)` : "모집 중";
      const reward = r.reward_gold ? gold(r.reward_gold) : r.reward_text ?? "";
      return `#${r.id} ${oneLine(r.title)}${reward ? ` · 보상 ${reward}` : ""} · 의뢰 ${r.owner} · ${state}${r.detail ? ` · "${oneLine(r.detail).slice(0, 120)}"` : ""} · ${when(r.created_at)}`;
    });
    parts.push(section("길드원 의뢰소: 끝나지 않은 의뢰", lines, 3000));
  }

  // ---------- 게시판 ----------
  type Post = { id: number; cat: Cat; author: string; title: string; body: string; pinned: number; created_at: number; comments: number; likes: number; views: number };
  const posts = boardR.results as Post[];
  if (posts.length && (ASK.board.test(q) || posts.some((p) => mentioned.includes(p.author)))) {
    const lines = posts.map(
      (p) =>
        `#${p.id} [${CAT_NAME[p.cat] ?? p.cat}]${p.pinned ? " (고정)" : ""} "${oneLine(p.title)}" · ${p.author} · ${when(p.created_at)} · 댓글 ${p.comments} · 좋아요 ${p.likes} · 본 사람 ${p.views}` +
        ` · 내용: ${oneLine(p.body).slice(0, p.cat === "free" ? 120 : 300)}`,
    );
    parts.push(section("게시판: 고정 글과 최근 글", lines, 4000));
  }

  // ---------- 플래티넘 상점 ----------
  const plat = platR.results[0] as { ratio: number; high_ratio: number; market: number; open: number; week_plat: number; high_week_plat: number } | undefined;
  if (plat && ASK.shop.test(q) && (plat.open || officer)) {
    const lines = [
      `${plat.open ? "열려 있음" : "아직 오픈 전 (운영진만 들어감)"} · 1군 전용. 비율은 플래티넘 100당 몇 만 골드: 1군 할인 ${plat.ratio}, 고스펙 할인 ${plat.high_ratio}, 시중 ${plat.market}`,
      `매주 목요일 오전 10시에 1군 한 사람에게 가상 플래티넘 ${plat.week_plat} (고스펙 ${plat.high_week_plat}) 지급, 안 쓴 것은 쌓인다. 구매 신청하면 플래티넘이 빠지고, 게임 안에서 할인된 골드를 내고 거래한다`,
      ...(myOrdersR.results as { item_name: string; plat: number; gold: number; status: string; created_at: number }[]).map(
        (o) => `내 신청: ${o.item_name} · 플래티넘 ${o.plat} · ${gold(o.gold)} · ${o.status === "requested" ? "신청" : o.status === "done" ? "거래 완료" : "취소"} · ${when(o.created_at)}`,
      ),
      ...(officer
        ? (openOrdersR.results as { user_id: string; item_name: string; plat: number; gold: number; created_at: number }[]).map(
            (o) => `처리할 신청(운영진): ${o.user_id} · ${o.item_name} · 플래티넘 ${o.plat} · ${gold(o.gold)} · ${when(o.created_at)}`,
          )
        : []),
    ];
    parts.push(section("플래티넘 할인 상점", lines, 2000));
  }

  // ---------- 앱개발자만: 사용 기록, 챗봇 개선 ----------
  if (dev && (ASK.logs.test(q) || mentioned.length)) parts.push(...(await activityParts(env, mentioned, now, today)));
  if (dev && ASK.gaps.test(q)) {
    const day = new Date(now + KST).toISOString().slice(0, 10);
    const [gapsR, usageR] = await env.DB.batch([
      env.DB.prepare("SELECT id, user_id, question, reason, kind, created_at FROM chat_gaps WHERE status = 'open' ORDER BY id DESC LIMIT 15"),
      env.DB.prepare("SELECT user_id, count FROM chat_usage WHERE day = ? AND count > 0 ORDER BY count DESC").bind(day),
    ]);
    const gaps = (gapsR.results as { id: number; user_id: string; question: string; reason: string; kind: string; created_at: number }[]).map(
      (g) => `#${g.id} ${g.user_id} · "${oneLine(g.question).slice(0, 80)}" · ${g.kind === "user" ? "👎 별로" : "모름"}: ${oneLine(g.reason).slice(0, 80)} · ${when(g.created_at)}`,
    );
    const usage = (usageR.results as { user_id: string; count: number }[]).map((u) => `${u.user_id} ${u.count}번`).join(", ");
    parts.push(section("앱개발자 전용: 챗봇 개선 목록 (아직 안 고친 것)", gaps.length ? gaps : ["없음"], 2000));
    parts.push(`[앱개발자 전용: 오늘 챗봇 질문 수] ${usage || "아직 없음"}`);
  }

  // ---------- 길드원 명단 (늘) ----------
  const lines = ranked.map((p, i) => {
    const extra = [
      ROLE[p.role] ?? "",
      p.high_spec ? "고스펙" : "",
      p.prev_level !== null && p.level !== null && p.prev_level < p.level && p.level_at !== null && p.level_at >= week ? `이번 주 Lv.${p.prev_level}→${p.level}` : "",
      officer && p.must_change ? "비밀번호 바꾸기 전" : "",
      officer && p.push_perm ? PUSH[p.push_perm] ?? "" : "",
    ].filter(Boolean);
    return `${i + 1}. ${p.id} | ${p.guild ? GUILD[p.guild] : "길드 안 정함"} | ${JOB[p.job as Job]} Lv.${p.level} ${expText(p.exp)}${extra.length ? ` | ${extra.join(" | ")}` : ""}`;
  });
  if (unset.length) lines.push(`직업·레벨 아직 안 정한 계정: ${unset.map((p) => `${p.id}${ROLE[p.role] ? `(${ROLE[p.role]})` : ""}`).join(", ")}`);
  parts.push(section("길드원 명단: 레벨 랭킹 순서 (같은 레벨이면 경험치, 그다음 먼저 오른 사람). 닉네임 | 길드 | 직업 레벨 경험치 | 표시", lines, 8000));

  // ---------- 한 줄 요약 (자세히 붙이지 않은 칸) ----------
  const summary = [
    `중개인 판매 중 ${listings.length}개 (경매 ${listings.filter((l) => l.mode === "auction").length}개)`,
    `골드 글 ${goldOffers.length}개`,
    `의뢰 ${reqs.length}개`,
    posts[0] ? `게시판 최근 글 "${oneLine(posts.find((p) => !p.pinned)?.title ?? posts[0].title)}"` : "게시판 글 없음",
  ];
  parts.push(`[앱 한눈에] ${summary.join(" · ")}. 더 자세한 것은 그 메뉴를 물으면 붙는다.`);

  return parts.filter(Boolean).join("\n\n").slice(0, MAX_APP);
}

/** 앱개발자 전용 사용 기록: 7일 동안 사람마다 접속·화면·한 일 수와 마지막 접속, 최근 한 일, 물어본 사람의 기록 */
async function activityParts(env: Env, mentioned: string[], now: number, today: number): Promise<string[]> {
  const since = now - 7 * DAY;
  const people = mentioned.slice(0, 2);
  const [sumR, lastR, recentR, ...personR] = await env.DB.batch([
    env.DB.prepare(
      "SELECT user_id, SUM(kind = 'visit') AS visits, SUM(kind = 'view') AS views, SUM(kind = 'act') AS acts, " +
        "SUM(kind = 'visit' AND at >= ?2) AS today_visits, MAX(at) AS last FROM activity WHERE at > ?1 GROUP BY user_id ORDER BY last DESC LIMIT 100",
    ).bind(since, today),
    env.DB.prepare(
      "SELECT a.user_id AS user_id, a.via AS via, a.place AS place, a.device AS device FROM activity a " +
        "JOIN (SELECT user_id, MAX(at) AS at FROM activity WHERE at > ? GROUP BY user_id) m ON m.user_id = a.user_id AND m.at = a.at",
    ).bind(since),
    env.DB.prepare("SELECT user_id, kind, what, detail, via, at FROM activity WHERE kind != 'view' ORDER BY at DESC LIMIT 50"),
    ...people.map((id) =>
      env.DB.prepare("SELECT kind, what, detail, via, place, ip, device, at FROM activity WHERE user_id = ? ORDER BY at DESC LIMIT 40").bind(id),
    ),
  ]);
  const last = new Map<string, { via: string | null; place: string | null; device: string | null }>();
  for (const r of lastR.results as { user_id: string; via: string | null; place: string | null; device: string | null }[]) last.set(r.user_id, r);
  const sum = (sumR.results as { user_id: string; visits: number; views: number; acts: number; today_visits: number; last: number }[]).map((r) => {
    const l = last.get(r.user_id);
    return `${r.user_id} · 접속 ${r.visits}번 (오늘 ${r.today_visits}) · 화면 ${r.views} · 한 일 ${r.acts} · 마지막 ${when(r.last)}${l?.via ? ` ${VIA[l.via] ?? l.via}` : ""}${l?.place ? ` ${l.place}` : ""}${l?.device ? ` (${l.device})` : ""}`;
  });
  const row = (r: { kind: string; what: string; detail: string | null; via: string | null; at: number }) =>
    `${when(r.at)} ${r.kind === "visit" ? "접속" : r.kind === "view" ? "화면" : "한 일"} ${r.what}${r.detail ? ` ${oneLine(r.detail).slice(0, 100)}` : ""}${r.via ? ` [${VIA[r.via] ?? r.via}]` : ""}`;
  const out = [
    section(
      "앱개발자 전용: 사용 기록 7일 요약 (최근 접속 순). 화면 주소: #/ranking 랭킹, #/market 중개인, #/requests 의뢰소, #/board 게시판, #/shop 상점, #/chat 챗봇, #/me 내 정보, #/admin 길드원 관리, #/alerts 알림, #/info 정보",
      sum.length ? sum : ["7일 동안 기록 없음"],
      3500,
    ),
    section(
      "앱개발자 전용: 최근 접속과 한 일 50개 (새 것 먼저)",
      (recentR.results as { user_id: string; kind: string; what: string; detail: string | null; via: string | null; at: number }[]).map((r) => `${r.user_id} ${row(r)}`),
      4500,
    ),
  ];
  people.forEach((id, i) => {
    const rows = personR[i].results as { kind: string; what: string; detail: string | null; via: string | null; place: string | null; ip: string | null; device: string | null; at: number }[];
    const first = rows[0];
    out.push(
      section(
        `앱개발자 전용: ${id} 의 최근 기록 40개${first ? ` (마지막 IP ${first.ip ?? "-"}, ${first.place ?? "위치 모름"}, ${first.device ?? "기기 모름"})` : ""}`,
        rows.length ? rows.map(row) : ["기록 없음"],
        3500,
      ),
    );
  });
  return out;
}
