// 챗봇의 길드 앱 자료 더하기 (제작자 요청 2026-11-02: '내가 지금 할 것' 치면 내 레벨, 직업 등 내 데이터를 다 읽고 대답,
// 이 웹에서 볼 수 있는 모든 정보(아이모 소식, 장비대여 포함)를 챗봇이 읽게. 대신 권한: 오피서나 개발자만 보는 메뉴를 다 대답하면 안 된다).
// server/chatapp.ts 의 appContext 가 부른다. 규칙은 같다: 묻는 사람이 앱에서 볼 수 있는 것만 넣는다.
// - 장비대여: 2026-11-02 열었다 (rental.ts canEnter). To do 는 개발 중이라 미리 보는 사람만. 장비대여의 줄 명단, 남의 보증금, 마일리지 표는 운영진만
// - 아이디 생성·캐릭터 추가 요청: 길드원 관리를 하는 오피서 이상만
// - 알림, 즐겨찾기, 내 신청: 본인(묶은 캐릭터 모두) 것만
import { RANK } from "./auth";
import type { Env, Job, User } from "./auth";
import { activeMaint } from "./maint";
import { TYPE_NAME, officialUrl } from "./official";
import { effective, loadCatalog, loadRules, loadSettings, wallet } from "./platshop";
import { DIA_GOLD, TERM_DAYS, canEnter, isManager, manText, mileageOf } from "./rental";
import type { RentTerm } from "./rentalParse";

const KST = 9 * 3_600_000;
const DAY = 86_400_000;
const JOB: Record<Job, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const TERM: Record<RentTerm, string> = { none: "기한 없음", "4w": "4주", "2w": "2주" };
const REQ_STATUS: Record<string, string> = { wait: "확인 전", ok: "수락", done: "대여 완료", no: "거절", cancel: "취소" };
const LEDGER: Record<string, string> = { donate: "기부 적립", rent: "대여 보증금", adjust: "고침", return: "반납 · 보증금 돌려받음" };

/** 이런 말이 있으면 그 칸을 붙인다 */
export const ASK_MORE = {
  /** '내가 지금 할 것', '뭐 하지', '추천' */
  doNow: /할 ?것|할 ?거|할 ?일|해야|뭐 ?(하|해|할)|뭘 ?(하|해|할)|추천|다음 ?(목표|단계|할)|챙길|챙겨|숙제|투두|to ?do/i,
  rental: /대여|빌려|빌리|빌릴|빌린|마일리지|보증금|반납|장비 ?기부|기부/,
  alerts: /알림|알람/,
  history: /추이|그래프|성장 ?기록|레벨 ?기록|히스토리|언제 ?(레벨|렙)|올랐|기록/,
  signup: /가입|아이디|승낙|캐릭터 ?추가|요청/,
  favorites: /즐겨 ?찾기|즐찾|찜/,
  news: /소식|뉴스|점검|이벤트|공지|패치|업데이트|쿠폰/,
  shop: /플티|플래티넘|상점|지갑|할인|패키지/,
};

const two = (n: number) => String(n).padStart(2, "0");
function when(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
const md = (ms: number) => {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
function section(title: string, lines: string[], cap: number): string {
  if (!lines.length) return "";
  let out = `[${title}]`;
  for (let i = 0; i < lines.length; i++) {
    if (out.length + lines[i].length + 1 > cap) return `${out}\n(나머지 ${lines.length - i}개는 길이 때문에 뺐다)`;
    out += `\n${lines[i]}`;
  }
  return out;
}

/** 묻는 사람의 캐릭터들 (본캐와 부캐) */
export interface MyChar {
  id: string;
  main: boolean;
  job: Job | null;
  level: number | null;
}

/**
 * 아이모 소식 지금 (늘 짧게): 진행 중인 공식 이벤트 제목과 끝나는 날, 지금이나 곧 있을 점검. 게시판 '아이모 소식'과 홈 점검 전광판과 같은 자료라 모두에게.
 * 본문은 server/official.ts officialContext 가 질문에 맞는 글만 붙인다
 */
export async function newsNow(env: Env, now: number): Promise<string> {
  const today = new Date(now + KST).toISOString().slice(0, 10);
  const since = new Date(now + KST - 45 * DAY).toISOString().slice(0, 10);
  const [eventsR, maintR] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, kind, type, title, start_date, end_date FROM official_news WHERE kind = 'event' AND " +
        "((end_date IS NOT NULL AND end_date >= ?1) OR (end_date IS NULL AND start_date >= ?2)) ORDER BY id DESC LIMIT 25",
    ).bind(today, since),
    env.DB.prepare("SELECT id, title, body, start_date FROM official_news WHERE type = 'C' ORDER BY id DESC LIMIT 3"),
  ]);
  const lines: string[] = [];
  for (const m of activeMaint(maintR.results as { id: number; title: string; body: string; start_date: string | null }[], now)) {
    const on = m.start <= now;
    lines.push(
      `${on ? "지금" : "예정"} 아이모 ${m.label}${m.servers ? ` (${m.servers})` : ""}: ${when(m.start)} ~ ${m.end ? when(m.end) : "종료 시까지"}${m.extended ? " (연장)" : ""} · ${officialUrl("notice", m.id)}`,
    );
  }
  for (const e of eventsR.results as { id: number; kind: string; type: string; title: string; start_date: string | null; end_date: string | null }[]) {
    const started = !e.start_date || e.start_date <= today;
    lines.push(`진행 ${started ? "중" : "예정"} 이벤트: ${e.title} · ${e.start_date ?? ""}${e.end_date ? ` ~ ${e.end_date}` : ""} · ${officialUrl(e.kind, e.id)}`);
  }
  return section("아이모 소식 지금 (컴투스 공식 홈페이지, 게시판 '아이모 소식'과 같은 자료): 점검과 진행 중인 이벤트", lines.length ? lines : ["진행 중인 이벤트와 점검 없음"], 2500);
}

/**
 * 내 정보 더하기: 묶은 캐릭터, 안 읽은 알림 수, 중개인·골드·의뢰소에서 내가 한 것은 chatapp.ts 가 이미 가진 자료로 만들고,
 * 여기서는 따로 읽어야 하는 것 (장비대여 내 것, 알림, 즐겨찾기, 레벨 기록)
 */
export async function mineExtras(
  env: Env,
  me: User,
  q: string,
  chars: MyChar[],
  mentioned: string[],
  now: number,
): Promise<{ me: string[]; parts: string[] }> {
  const owner = me.owner ?? me.id;
  const ids = chars.length ? chars.map((c) => c.id) : [me.id];
  const marks = ids.map(() => "?").join(",");
  const meLines: string[] = [];
  const parts: string[] = [];
  const officer = RANK[me.role] >= 1;

  const askAlerts = ASK_MORE.alerts.test(q) || ASK_MORE.doNow.test(q);
  const askHistory = ASK_MORE.history.test(q);
  const [unreadR, alertsR, favR, ...histR] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE user_id IN (${marks}) AND read_at IS NULL`).bind(...ids),
    env.DB.prepare(`SELECT user_id, kind, text, created_at, read_at FROM alerts WHERE user_id IN (${marks}) ORDER BY id DESC LIMIT ${askAlerts ? 15 : 0}`).bind(...ids),
    env.DB.prepare(`SELECT kind, name FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ${ASK_MORE.favorites.test(q) ? 40 : 0}`).bind(me.id),
    // 레벨·경험치 기록 (랭킹의 닉네임을 누르면 모두에게 보이는 그래프와 같은 자료): 나, 또는 물어본 사람 둘까지
    ...(askHistory ? (mentioned.length ? mentioned.slice(0, 2) : [me.id]) : []).map((id) =>
      env.DB.prepare("SELECT ? AS who, at, level, exp FROM level_log WHERE user_id = ? ORDER BY at DESC LIMIT 25").bind(id, id),
    ),
  ]);
  const unread = (unreadR.results[0] as { n: number } | undefined)?.n ?? 0;
  meLines.push(`안 읽은 알림 ${unread}개 (위 줄 🔔)`);
  if (chars.length > 1)
    meLines.push(
      `묶은 캐릭터 (같은 사람, 👤 단추로 바꾼다): ${chars.map((c) => `${c.id}${c.main ? "(본캐)" : "(부캐)"}${c.level !== null && c.job ? ` ${JOB[c.job]} Lv.${c.level}` : ""}${c.id === me.id ? " ← 지금" : ""}`).join(", ")}`,
    );

  const alerts = alertsR.results as { user_id: string; kind: string; text: string; created_at: number; read_at: number | null }[];
  if (alerts.length)
    parts.push(
      section(
        `${me.id}의 최근 알림 (🔔 알림함, 묶은 캐릭터 것 모두, 새 것 먼저)`,
        alerts.map((a) => `${when(a.created_at)}${a.read_at ? "" : " (안 읽음)"}${a.user_id !== me.id ? ` [${a.user_id}]` : ""} ${oneLine(a.text).slice(0, 160)}`),
        2500,
      ),
    );
  const favs = favR.results as { kind: string; name: string }[];
  if (favs.length) parts.push(`[${me.id}의 즐겨찾기 (검색 화면)] ${favs.map((f) => `${f.name}(${f.kind === "item" ? "아이템" : f.kind === "monster" ? "몬스터" : "사냥터"})`).join(", ")}`);
  for (const h of histR) {
    const rows = h.results as { who: string; at: number; level: number; exp: number | null }[];
    if (!rows.length) continue;
    parts.push(
      section(
        `${rows[0].who}의 레벨·경험치 기록 (랭킹에서 닉네임을 누르면 보이는 그래프, 새 것 먼저)`,
        rows.map((r) => `${when(r.at)} Lv.${r.level}${r.exp !== null ? ` ${(r.exp / 1000).toFixed(3)}%` : ""}`),
        1500,
      ),
    );
  }

  // ---------- 장비대여 (2026-11-02 열었다, canEnter) ----------
  if (canEnter(me)) {
    const manager = isManager(me);
    const full = ASK_MORE.rental.test(q);
    const [myReqR, heldR, ledgerR] = await env.DB.batch([
      env.DB.prepare(
        `SELECT r.item_id, r.user_id, r.status, r.created_at, i.weapon, i.enhance FROM rental_requests r JOIN rental_items i ON i.id = r.item_id ` +
          `WHERE r.user_id IN (${marks}) AND r.status IN ('wait', 'ok') ORDER BY r.created_at`,
      ).bind(...ids),
      env.DB.prepare(
        `SELECT i.id, i.weapon, i.enhance, i.term, i.renter, i.rented_at, ` +
          `(SELECT COUNT(*) FROM rental_requests q WHERE q.item_id = i.id AND q.status IN ('wait', 'ok')) AS queue, ` +
          `(SELECT r.use_dia FROM rental_requests r WHERE r.item_id = i.id AND r.status = 'done' AND r.returned_at IS NULL ORDER BY r.done_at DESC LIMIT 1) AS use_dia, ` +
          `(SELECT r.gold FROM rental_requests r WHERE r.item_id = i.id AND r.status = 'done' AND r.returned_at IS NULL ORDER BY r.done_at DESC LIMIT 1) AS gold, i.price ` +
          `FROM rental_items i WHERE i.status = 'open' AND i.renter IN (${marks})`,
      ).bind(...ids),
      env.DB.prepare(`SELECT who, delta, gold, reason, note, created_at FROM rental_mileage WHERE who IN (${marks}) ORDER BY created_at DESC LIMIT ${full ? 10 : 0}`).bind(...ids),
    ]);
    const mileage = await mileageOf(env, owner);
    const held = heldR.results as { id: number; weapon: string; enhance: number; term: RentTerm; renter: string; rented_at: number | null; queue: number; use_dia: number | null; gold: number | null; price: number }[];
    const myReqs = myReqR.results as { item_id: number; user_id: string; status: string; created_at: number; weapon: string; enhance: number }[];
    meLines.push(
      `장비대여: 마일리지 💎${mileage} (💎1 = 10만 골드)` +
        (held.length
          ? ` · 대여 중 ${held
              .map((h) => {
                const days = TERM_DAYS[h.term];
                const due = h.rented_at && days ? h.rented_at + days * DAY : null;
                const dia = h.use_dia ?? 0;
                const gold = h.gold ?? (h.price - dia) * DIA_GOLD;
                return `${h.weapon} +${h.enhance}${h.renter !== me.id ? `(${h.renter})` : ""} ${due ? `기한 ${md(due)}${h.queue ? `, 대기 ${h.queue}명이라 기한에 반납` : ", 대기 없음"}` : "기한 없음"} 보증금 ${[dia ? `💎${dia}` : "", gold ? `골드 ${manText(gold)}` : ""].filter(Boolean).join(" + ") || "없음"}`;
              })
              .join(", ")}`
          : "") +
        (myReqs.length ? ` · 신청 ${myReqs.map((r) => `${r.weapon} +${r.enhance} ${REQ_STATUS[r.status] ?? r.status}`).join(", ")}` : ""),
    );
    if (full || ASK_MORE.doNow.test(q)) parts.push(await rentalSection(env, me, manager, mentioned, ledgerR.results as LedgerRow[]));
  }

  // ---------- 아이디 생성·캐릭터 추가 요청 (길드원 관리: 오피서 이상) ----------
  if (officer && ASK_MORE.signup.test(q)) {
    const { results } = await env.DB.prepare("SELECT id, owner, created_at FROM signup_requests ORDER BY created_at LIMIT 50").all<{ id: string; owner: string | null; created_at: number }>();
    parts.push(
      section(
        "길드원 관리 (오피서 이상): 승낙 기다리는 요청",
        results.length ? results.map((r) => `${r.owner ? `캐릭터 추가 ${r.id} (${r.owner}의 부캐로)` : `아이디 생성 ${r.id}`} · ${when(r.created_at)}`) : ["없음"],
        1500,
      ),
    );
  }
  return { me: meLines, parts };
}

interface LedgerRow {
  who: string;
  delta: number;
  gold: number | null;
  reason: string;
  note: string | null;
  created_at: number;
}

/** 장비대여 목록 (화면 '목록'과 같은 값). 쓰는 사람과 기한은 모두에게, 줄 명단·신청서·사람마다 마일리지는 운영진만 */
async function rentalSection(env: Env, me: User, manager: boolean, mentioned: string[], ledger: LedgerRow[]): Promise<string> {
  const [itemsR, queueR, balR] = await env.DB.batch([
    env.DB.prepare("SELECT id, job, level, weapon, options, enhance, term, price, donor, renter, rented_at, note FROM rental_items WHERE status = 'open' ORDER BY job, level, weapon, enhance, id"),
    env.DB.prepare("SELECT item_id, user_id, status FROM rental_requests WHERE status IN ('wait', 'ok') ORDER BY created_at, id"),
    // 사람마다 (묶은 캐릭터는 본캐로 합쳐서, mileageOf 와 같은 셈)
    env.DB.prepare(
      `SELECT COALESCE(u.main_id, m.who) AS who, SUM(m.delta) AS dia FROM rental_mileage m LEFT JOIN users u ON u.id = m.who GROUP BY 1 HAVING dia != 0 ORDER BY dia DESC LIMIT ${manager ? 40 : 0}`,
    ),
  ]);
  const line = new Map<number, { user_id: string; status: string }[]>();
  for (const r of queueR.results as { item_id: number; user_id: string; status: string }[]) line.set(r.item_id, [...(line.get(r.item_id) ?? []), r]);
  const items = itemsR.results as { id: number; job: Job; level: number; weapon: string; options: string; enhance: number; term: RentTerm; price: number; donor: string | null; renter: string | null; rented_at: number | null; note: string | null }[];
  const lines = items.map((i) => {
    const days = TERM_DAYS[i.term];
    const due = i.renter && i.rented_at && days ? i.rented_at + days * DAY : null;
    const q = line.get(i.id) ?? [];
    return (
      `#${i.id} ${JOB[i.job]} Lv.${i.level} ${i.weapon} +${i.enhance}${i.options ? ` ${i.options}` : ""} · ${TERM[i.term]} · 보증금 💎${i.price}(${manText(i.price * DIA_GOLD)} 골드)` +
      `${i.renter ? ` · 대여 중 ${i.renter}${due ? ` ${md(due)}까지` : ""}` : ""}${q.length ? ` · 대기 ${q.length}명${manager ? ` (${q.map((x) => `${x.user_id} ${REQ_STATUS[x.status]}`).join(", ")})` : ""}` : ""}` +
      `${i.donor ? ` · 기부 ${i.donor}` : ""}${i.note ? ` · "${oneLine(i.note)}"` : ""}`
    );
  });
  const out = [
    section(
      "장비대여 (길드가 기부받은 무기를 빌려준다. 💎 가격은 보증금이고 반납하면 마일리지와 골드를 돌려받는다. 1인 1개가 원칙, 실제 주고받기는 게임 안에서 대여 담당자와. 목록에서 골라 '대여 신청')",
      lines.length ? lines : ["대여 무기 없음"],
      5000,
    ),
  ];
  if (ledger.length)
    out.push(
      section(
        `${me.id}의 마일리지 장부 (신청함 '장부')`,
        ledger.map((l) => `${when(l.created_at)} ${LEDGER[l.reason] ?? l.reason} ${l.delta > 0 ? "+" : ""}${l.delta}💎${l.gold ? ` 골드 ${manText(l.gold)}` : ""}${l.note ? ` ${oneLine(l.note)}` : ""}`),
        1200,
      ),
    );
  if (manager) {
    const bal = (balR.results as { who: string; dia: number }[]).map((b) => `${b.who} 💎${b.dia}`);
    if (bal.length) out.push(`[장비대여 운영진 전용: 사람마다 남은 마일리지] ${bal.join(", ")}`);
    for (const who of mentioned.slice(0, 2)) {
      const { results } = await env.DB.prepare("SELECT delta, gold, reason, note, created_at FROM rental_mileage WHERE who = ? ORDER BY created_at DESC LIMIT 10").bind(who).all<LedgerRow>();
      if (results.length)
        out.push(section(`장비대여 운영진 전용: ${who}의 마일리지 장부`, results.map((l) => `${when(l.created_at)} ${LEDGER[l.reason] ?? l.reason} ${l.delta > 0 ? "+" : ""}${l.delta}💎${l.note ? ` ${oneLine(l.note)}` : ""}`), 800));
    }
  }
  return out.filter(Boolean).join("\n\n");
}

/**
 * 플래티넘 상점 물건과 내 이용한도 (상점 화면과 같은 값: 1군 전용, 오픈 전에는 운영진만). 판매 중지한 물건은 운영진에게만.
 * 지갑을 읽으면 밀린 주의 지급이 들어간다 (상점을 연 것과 같다)
 */
export async function shopCatalog(env: Env, request: Request, me: User, main: boolean, high: boolean, now: number): Promise<string> {
  const officer = RANK[me.role] >= 1;
  const [catalog, s, rules] = await Promise.all([loadCatalog(env, request), loadSettings(env), loadRules(env)]);
  if (!catalog.length) return "";
  const lines = catalog
    .map((it) => ({ it, e: effective(it, s, rules.get(it.id)) }))
    .filter(({ e }) => e.enabled || officer)
    .map(({ it, e }) => `${it.name}${it.count > 1 ? ` x${it.count}` : ""} · 플래티넘 ${it.plat} · 1군 ${manText(e.gold)} 골드 · 고스펙 ${manText(e.highGold)} 골드 (시중 ${manText(e.marketGold)})${e.enabled ? "" : " · 판매 중지(운영진만 보임)"}`);
  const out = [section("플래티넘 할인 상점 물건 (게임 상점 첫 탭, 거래 되는 것만)", lines, 2500)];
  if (main) {
    const w = await wallet(env, me.id, main, high, s, now);
    out.push(`[${me.id}의 플래티넘 이용한도] 남은 플래티넘 ${w.balance} · 매주 목요일 오전 10시 +${w.weekly} (다음 ${when(w.nextAt)})`);
  }
  return out.filter(Boolean).join("\n");
}
