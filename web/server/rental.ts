// 장비대여 (제작자 요청 2026-11-01, 대여 담당 성민 님의 카카오톡 목록과 마일리지 방식 그대로):
// 길드가 기부받은 무기를 기한(없음, 4주, 2주)마다 💎 가격으로 빌려준다 (💎 1개 = 10만 골드). 길드원은 무기 여러 개를 한 번에 신청하고(신청서),
// 운영진이 무기마다 수락·거절한 뒤 게임 안에서 건네면 '건네줌', 돌려받으면 '반납'. 신청서마다 대화창이 있다 (2026-11-02 제작자 요청).
// 무기마다 선착순으로 줄을 선다: 앞사람이 받은 날 + 기한 뒤에 받는다. 줄이 없으면 기한이 지나도 계속 쓰고, 줄이 생기면 기한이 끝나는 날 담당자에게 돌려준다.
// 장비를 기부하면 운영진이 옵션 시세로 마일리지 💎 를 적립하고, 빌릴 때(건넬 때) 골드 대신 쓴다 (D1 rental_mileage).
// 실제 주고받기는 게임 안에서 하고 앱은 목록과 장부만 둔다 (게임을 읽거나 게임에 무엇을 보내지 않는다, CLAUDE.md 게임 안전 규칙).
// 지금은 개발 중이라 앱개발자만 들어간다 (RENT_OPEN, 화면 src/launcher.ts 의 locked 와 같이 바꾼다).
import { RANK } from "./auth";
import type { Env, User } from "./auth";
import { notify } from "./alerts";
import type { RentJob, RentTerm } from "./rentalParse";

/** 길드원에게 열었는지. false 면 앱개발자만 쓰고, 운영진 알림도 앱개발자에게만 간다 */
export const RENT_OPEN = false;
/** 💎 1개의 골드 */
export const DIA_GOLD = 100_000;
/** 기한마다 대여 날 수 */
export const TERM_DAYS: Record<RentTerm, number | null> = { none: null, "4w": 28, "2w": 14 };
export const JOBS: RentJob[] = ["warrior", "ranger", "mage", "monk"];
export const TERMS: RentTerm[] = ["none", "4w", "2w"];
/** 신청서 하나에 담는 무기 수, 한 사람(묶은 캐릭터 모두)이 동시에 줄 서는 무기 수 */
export const MAX_APP_ITEMS = 5;
export const MAX_WAIT = 10;
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
  const days = TERM_DAYS[item.term];
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
export const canEnter = (me: User) => RENT_OPEN || me.role === "developer";
/** 목록, 신청, 마일리지를 다루는 사람: 길드마스터·오피서·앱개발자 */
export const isManager = (me: User) => RANK[me.role] >= 1;

/** 표 rental_items 한 줄 */
export interface RentalRow {
  id: number;
  job: RentJob;
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

/** 닉네임(앱 계정이면 그 사람의 묶은 캐릭터 모두)의 마일리지 💎 */
export async function mileageOfName(env: Env, who: string): Promise<number> {
  const u = await env.DB.prepare("SELECT COALESCE(main_id, id) AS owner FROM users WHERE id = ?").bind(who).first<{ owner: string }>();
  if (u) return mileageOf(env, u.owner);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS dia FROM rental_mileage WHERE who = ?").bind(who).first<{ dia: number }>();
  return r?.dia ?? 0;
}

/** 운영진에게 알림 (개발 중에는 앱개발자에게만). 사람마다 한 번 (본캐에게) */
export async function notifyManagers(env: Env, text: string, from: string): Promise<void> {
  const roles = RENT_OPEN ? "('developer', 'master', 'officer')" : "('developer')";
  const { results } = await env.DB.prepare(`SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ${roles}`).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "rent", text, "#/rent", from);
}

/** 돌려줄 때 (기한 없음이면 null) */
export const dueOf = (term: RentTerm, from: number) => (TERM_DAYS[term] ? from + TERM_DAYS[term]! * 86_400_000 : null);

/** 물건 고치기·더하기 값 검사. 맞지 않으면 오류 글 */
export function checkItem(b: Record<string, unknown>): { error: string } | { item: Omit<RentalRow, "id" | "renter" | "rented_at" | "due_at" | "status"> } {
  const job = b.job as RentJob;
  const term = b.term as RentTerm;
  const level = Number(b.level);
  const enhance = Number(b.enhance);
  const price = Number(b.price);
  const weapon = typeof b.weapon === "string" ? b.weapon.trim() : "";
  const options = typeof b.options === "string" ? b.options.replace(/\s+/g, "") : "";
  const donor = typeof b.donor === "string" ? b.donor.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!JOBS.includes(job)) return { error: "직업을 골라 주세요" };
  if (!TERMS.includes(term)) return { error: "기한을 골라 주세요" };
  if (!weapon || weapon.length > 30) return { error: "무기 이름을 적어 주세요" };
  if (!Number.isInteger(level) || level < 1 || level > 200) return { error: "레벨이 맞지 않아요" };
  if (!Number.isInteger(enhance) || enhance < 0 || enhance > 20) return { error: "강화는 0~20 이에요" };
  if (!Number.isInteger(price) || price < 0 || price > 9999) return { error: "💎 가격이 맞지 않아요" };
  if (options.length > 30 || donor.length > 20 || note.length > 100) return { error: "글이 너무 길어요" };
  return { item: { job, level, weapon, options, enhance, term, price, donor: donor || null, note: note || null } };
}
