// 장비대여 (제작자 요청 2026-11-01, 대여 담당 성민 님의 카카오톡 목록과 마일리지 방식 그대로):
// 길드가 기부받은 무기를 기한(없음, 1~52주)마다 💎 가격으로 빌려준다 (💎 1개 = 10만 골드). 길드원은 무기 여러 개를 한 번에 신청하고(신청서),
// 운영진이 무기마다 수락·거절한 뒤 게임 안에서 건네면 '대여 완료', 돌려받으면 '반납'. 신청서마다 대화창이 있다 (2026-11-02 제작자 요청).
// 가격은 보증금이다 (제작자 요청 2026-11-02): 대여 완료 때 마일리지와 골드로 받고, 반납하면 마일리지는 장부로 저절로, 골드는 게임 안에서 돌려준다.
// 무기마다 선착순으로 줄을 선다: 앞사람이 받은 날 + 기한 뒤에 받는다. 줄이 없으면 기한이 지나도 계속 쓰고, 줄이 생기면 기한이 끝나는 날 담당자에게 돌려준다.
// 장비를 기부하면 운영진이 옵션 시세로 마일리지 💎 를 적립하고, 빌릴 때(건넬 때) 골드 대신 쓴다 (D1 rental_mileage).
// 실제 주고받기는 게임 안에서 하고 앱은 목록과 장부만 둔다 (게임을 읽거나 게임에 무엇을 보내지 않는다, CLAUDE.md 게임 안전 규칙).
// 2026-11-02 제작자 요청으로 길드원에게 열었다 (RENT_OPEN, 화면 src/launcher.ts 의 rent 칸과 같이).
import { RANK, TEST_IDS } from "./auth";
import type { Env, User } from "./auth";
import { notify } from "./alerts";
import { isTerm, normalizeOptions, termDays } from "./rentalParse";
import type { RentJob, RentTerm } from "./rentalParse";
export { termDays, termName } from "./rentalParse";

/** 길드원에게 열었는지 (2026-11-02 열었다). false 면 미리 보는 사람만 쓰고, 운영진 알림도 앱개발자에게만 간다 */
export const RENT_OPEN = true;
/** 💎 1개의 골드 (마일리지 1 = 10만 골드) */
export const DIA_GOLD = 100_000;
/** 보증금으로 받은 골드 칸 값 (0 ~ 💎 가격만큼의 골드, 맞지 않으면 null). 비우면 가격에서 마일리지를 뺀 나머지 */
export function goldOf(v: unknown, price: number, useDia: number): number | null {
  if (v === undefined || v === null || v === "") return (price - useDia) * DIA_GOLD;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= price * DIA_GOLD * 10 ? n : null;
}
/** 골드 -> '80만' */
export const manText = (gold: number) => (gold >= 100_000_000 ? `${(gold / 100_000_000).toLocaleString()}억` : `${Math.round(gold / 10_000).toLocaleString()}만`);
export const JOBS: RentJob[] = ["warrior", "ranger", "mage", "monk"];
/**
 * 물건의 직업 칸 (제작자 요청 2026-11-02: '아이템이 공용일 수도 있고 전사·레인저처럼 여럿일 수도'): 'warrior' 하나, 'warrior,ranger' 여럿,
 * 네 직업 모두면 공용. 배열이나 쉼표 글을 받아 정한 순서로 잇는다. 맞지 않으면 null
 */
export function readJobs(v: unknown): string | null {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const set = new Set(list.map((x) => String(x).trim()));
  const jobs = JOBS.filter((j) => set.has(j));
  return jobs.length && jobs.length === set.size ? jobs.join(",") : null;
}
/** 'warrior,ranger' -> ['warrior', 'ranger'] */
export const jobsOf = (s: string) => JOBS.filter((j) => s.split(",").includes(j));
/** 신청서 하나에 담는 무기 수, 한 사람(묶은 캐릭터 모두)이 동시에 줄 서는 무기 수 */
export const MAX_APP_ITEMS = 30;
export const MAX_WAIT = 30;
const DAY = 86_400_000;

/** 표 rental_requests 의 줄 서는 신청 (wait 확인 전, ok 수락) */
export interface QueueRow {
  id: number;
  item_id: number;
  user_id: string;
  status: "wait" | "ok";
  created_at: number;
  app_id: number | null;
}

/**
 * 줄의 차례마다 받을 수 있는 때 (ms, 모르면 null): 지금 쓰는 사람이 있으면 그 사람이 받은 날 + 기한(지났으면 지금), 없으면 지금.
 * 그 뒤 차례는 앞사람이 받을 때 + 기한. 기한 없는 무기는 앞사람이 반납해야 받으므로 null. count: 몇 번째 차례까지
 */
export function expectedTimes(item: { term: RentTerm; renter: string | null; rented_at: number | null }, count: number, now = Date.now()): (number | null)[] {
  const days = termDays(item.term);
  const t = days ? days * DAY : null;
  let at: number | null = item.renter ? (t !== null && item.rented_at !== null ? Math.max(now, item.rented_at + t) : null) : now;
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    out.push(at);
    at = at !== null && t !== null ? at + t : null;
  }
  return out;
}

/** 들어올 수 있는 사람 (개발 중에는 앱개발자만) */
/** 들어갈 수 있는지: 열기 전에는 운영진(길드마스터, 오피서)과 앱개발자, 테스트 계정(길드원 권한으로)만 미리 본다 (제작자 요청 2026-11-02, 화면 src/launcher.ts canPreview) */
export const canEnter = (me: User) => RENT_OPEN || RANK[me.role] >= 1 || TEST_IDS.includes(me.id);
/**
 * 장비대여 담당 (제작자 요청 2026-11-02: '성민 님 ID 가 멍멍이야. 길드마스터와 멍멍 님만 있으면 돼, 다른 오피서는 필요 없어').
 * 게임 닉네임(아이디)이라 담당이 바뀌거나 닉네임을 바꾸면 여기를 고친다. 그 사람의 어느 캐릭터로 들어와도 담당이다
 */
export const RENT_STAFF = ["멍멍"];
/** 목록, 신청, 마일리지를 다루는 사람(운영): 길드마스터·장비대여 담당·앱개발자. 다른 오피서는 아니다 */
export const isManager = (me: User) =>
  me.role === "developer" || me.role === "master" || (me.chars ?? [me.id, me.owner ?? me.id]).some((c) => RENT_STAFF.includes(c));
/** 운영을 볼 사람을 고르는 SQL 조건 (users 표, 담당은 그 사람의 캐릭터 모두로 찾는다) */
const STAFF_WHERE =
  "role IN ('developer', 'master') OR COALESCE(main_id, id) IN (SELECT COALESCE(main_id, id) FROM users WHERE id IN (" +
  RENT_STAFF.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ") +
  "))";

/** 표 rental_items 한 줄 */
export interface RentalRow {
  id: number;
  /** 직업 하나나 여럿 (쉼표, 네 직업 모두면 공용). readJobs */
  job: string;
  level: number;
  weapon: string;
  options: string;
  enhance: number;
  term: RentTerm;
  price: number;
  donor: string | null;
  renter: string | null;
  rented_at: number | null;
  due_at: number | null;
  note: string | null;
  status: string;
  /** 빌린 사람이 '반납 신청'을 누른 때 */
  return_req_at?: number | null;
  /** 반납 날짜를 정하는 대화창 (rental_apps) */
  return_app_id?: number | null;
}

/** 알림에 쓰는 이름: '카타나 +7' */
export const itemLabel = (r: { weapon: string; enhance: number }) => `${r.weapon} +${r.enhance}`;

/** 그 사람(묶은 캐릭터 모두)의 마일리지 💎. owner: 본캐 아이디 */
export async function mileageOf(env: Env, owner: string): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS dia FROM rental_mileage WHERE who IN (SELECT id FROM users WHERE id = ?1 OR main_id = ?1) OR who = ?1",
  )
    .bind(owner)
    .first<{ dia: number }>();
  return r?.dia ?? 0;
}

/**
 * 여러 닉네임의 마일리지를 한 번에 (mileageOfName 과 같은 셈). 사람마다 따로 부르면 DB 를 사람 수만큼 다녀오고
 * 무료 요금제의 요청 하나 D1 50번 한도에도 닿는다 (2026-11-10 렉 검토)
 */
export async function mileageOfNames(env: Env, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!names.length) return out;
  const { results } = await env.DB.prepare(
    "WITH o AS (SELECT n.value AS name, (SELECT COALESCE(main_id, id) FROM users WHERE id = n.value) AS owner FROM json_each(?) n) " +
      "SELECT o.name AS name, COALESCE((SELECT SUM(m.delta) FROM rental_mileage m WHERE CASE WHEN o.owner IS NULL THEN m.who = o.name " +
      "ELSE (m.who = o.owner OR m.who IN (SELECT id FROM users WHERE main_id = o.owner)) END), 0) AS dia FROM o",
  )
    .bind(JSON.stringify([...new Set(names)]))
    .all<{ name: string; dia: number }>();
  for (const r of results) out.set(r.name, r.dia);
  return out;
}

/** 닉네임(앱 계정이면 그 사람의 묶은 캐릭터 모두)의 마일리지 💎 */
export async function mileageOfName(env: Env, who: string): Promise<number> {
  const u = await env.DB.prepare("SELECT COALESCE(main_id, id) AS owner FROM users WHERE id = ?").bind(who).first<{ owner: string }>();
  if (u) return mileageOf(env, u.owner);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS dia FROM rental_mileage WHERE who = ?").bind(who).first<{ dia: number }>();
  return r?.dia ?? 0;
}

/** 운영(길드마스터·장비대여 담당·앱개발자)에게 알림 (열기 전에는 앱개발자에게만). 사람마다 한 번 (본캐에게) */
export async function notifyManagers(env: Env, text: string, from: string): Promise<void> {
  const where = RENT_OPEN ? STAFF_WHERE : "role = 'developer'";
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE ${where}`).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "rent", text, "#/rent?v=staff", from);
}

/** 돌려줄 때 (기한 없음이면 null) */
export const dueOf = (term: RentTerm, from: number) => {
  const days = termDays(term);
  return days ? from + days * 86_400_000 : null;
};

/** 물건 고치기·더하기 값 검사. 맞지 않으면 오류 글 */
export function checkItem(b: Record<string, unknown>): { error: string } | { item: Omit<RentalRow, "id" | "renter" | "rented_at" | "due_at" | "status"> } {
  const job = readJobs(b.job);
  const term = b.term as RentTerm;
  const level = Number(b.level);
  const enhance = Number(b.enhance);
  const price = Number(b.price);
  const weapon = typeof b.weapon === "string" ? b.weapon.trim() : "";
  // 옵션은 줄임말로 통일 ('지능3 마나재생 2' -> '지3마재2', server/rentalParse.ts normalizeOptions)
  const options = typeof b.options === "string" ? normalizeOptions(b.options) : "";
  const donor = typeof b.donor === "string" ? b.donor.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!job) return { error: "직업을 골라 주세요" };
  if (!isTerm(term)) return { error: "기한을 골라 주세요 (기한 없음이나 1~52주)" };
  if (!weapon || weapon.length > 30) return { error: "무기 이름을 적어 주세요" };
  if (!Number.isInteger(level) || level < 1 || level > 200) return { error: "레벨이 맞지 않아요" };
  if (!Number.isInteger(enhance) || enhance < 0 || enhance > 20) return { error: "강화는 0~20 이에요" };
  if (!Number.isInteger(price) || price < 0 || price > 9999) return { error: "💎 가격이 맞지 않아요" };
  if (options.length > 30 || donor.length > 20 || note.length > 100) return { error: "글이 너무 길어요" };
  return { item: { job, level, weapon, options, enhance, term, price, donor: donor || null, note: note || null } };
}

/** 물건 고치기·더하기의 기부 마일리지 💎 (0 이면 적립 없음). 맞지 않으면 null */
export function donorDiaOf(b: Record<string, unknown>): number | null {
  const v = b.donorDia === undefined || b.donorDia === null || b.donorDia === "" ? 0 : Number(b.donorDia);
  return Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null;
}

/** 물건마다 그 물건으로 기부 적립한 💎 (장부 rental_mileage 의 reason 'donate', item_id), 사람마다 */
export async function donations(env: Env, itemIds?: number[]): Promise<Map<number, Map<string, number>>> {
  const where = itemIds ? ` AND item_id IN (${itemIds.map(() => "?").join(",") || "NULL"})` : " AND item_id IS NOT NULL";
  const { results } = await env.DB.prepare(`SELECT item_id, who, SUM(delta) AS n FROM rental_mileage WHERE reason = 'donate'${where} GROUP BY item_id, who`)
    .bind(...(itemIds ?? []))
    .all<{ item_id: number; who: string; n: number }>();
  const out = new Map<number, Map<string, number>>();
  for (const r of results) {
    if (!out.has(r.item_id)) out.set(r.item_id, new Map());
    out.get(r.item_id)!.set(r.who, r.n);
  }
  return out;
}

/**
 * 기부 마일리지를 정한다 (제작자 요청 2026-11-02: 장비를 기부하면 대여 담당이 '이 장비는 몇 마일리지'라고 적고, 기부자에게 쌓인다).
 * 그 물건으로 이미 적립한 만큼과 견주어 차이만 장부에 더한다. 기부자를 바꾸면 예전 기부자 몫을 빼고 새 기부자에게 넣는다.
 * 빼서 남는 마일리지가 0 아래가 되면(이미 대여에 썼으면) 아무것도 하지 않고 오류 글을 돌려준다
 */
export async function setDonation(env: Env, item: { id: number; weapon: string; enhance: number }, donor: string | null, dia: number, by: string): Promise<string | null> {
  if (dia > 0 && !donor) return "기부한 사람을 적어 주세요";
  const had = (await donations(env, [item.id])).get(item.id) ?? new Map<string, number>();
  const changes: { who: string; delta: number }[] = [];
  for (const [who, n] of had) if (who !== donor && n !== 0) changes.push({ who, delta: -n });
  if (donor) {
    const diff = dia - (had.get(donor) ?? 0);
    if (diff !== 0) changes.push({ who: donor, delta: diff });
  }
  if (!changes.length) return null;
  const left = new Map<string, number>();
  for (const c of changes) {
    const now = await mileageOfName(env, c.who);
    if (now + c.delta < 0) return `${c.who} 님은 마일리지를 이미 써서 💎${-c.delta} 를 뺄 수 없어요 (지금 💎${now})`;
    left.set(c.who, now + c.delta);
  }
  const label = itemLabel(item);
  const at = Date.now();
  await env.DB.batch(
    changes.map((c) =>
      env.DB.prepare("INSERT INTO rental_mileage (who, delta, reason, item_id, note, by_user, created_at) VALUES (?, ?, 'donate', ?, ?, ?, ?)").bind(
        c.who,
        c.delta,
        item.id,
        `${label} 기부${had.size ? " (고침)" : ""}`,
        by,
        at,
      ),
    ),
  );
  for (const c of changes) {
    await notify(env, [c.who], "rent", `마일리지 💎${c.delta > 0 ? "+" : ""}${c.delta} (${label} 기부) · 지금 💎${left.get(c.who)}`, "#/rent?v=apps", by);
  }
  return null;
}
