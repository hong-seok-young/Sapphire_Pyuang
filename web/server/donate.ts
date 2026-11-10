// 기부함 (개발중, 제작자 2026-11-10 길드 톡방: 마을모금함 '모든 템을 골드로 환산하고 마일리지 환산하는 거라', 퓨앙 '모든 템 기부하게 따로 기부함 만들게',
// 마을모금함 '마일리지 순위표 뭐 이런 거 명예의 전당'). 화면 src/pages/Donate.tsx, API functions/api/donate.
// - 길드원이 게임 안에서 운영진에게 템을 넘기면, 길드원이 웹으로 기부 신청(골드 가치를 적어서)하거나 운영진이 직접 적는다.
//   운영진이 골드 가치를 고쳐 확정하면 장비대여와 같은 마일리지(💎 1 = 10만 골드, rental_mileage reason 'donate')로 쌓인다.
// - 마일리지는 기부 골드 가치의 0.6 (10만 골드당 💎1, MILEAGE_RATE). 소수점은 줄마다 버리지 않고 그 사람이 확정받은 골드 합으로 누적하고 정수 부분만 쓴다
//   (10만 + 10만 + 10만 + 10만 + 10만 = 💎3). donate_items.dia 는 그 줄로 장부에 넣은 몫이고, 한 사람의 dia 합 = floor(확정 골드 합 x 0.6 / 10만) 을 늘 지킨다 (syncDia).
// - 장비대여 쪽은 건드리지 않는다 (제작자): 장비대여 '물건 추가·기부 현황'에서 적립한 기부는 그대로 두고 여기 명예의 전당·내역에 같이 보인다.
//   여기서 넣은 장부 줄은 note 가 '기부함 · ' 으로 시작해서 장비대여 기부와 가린다.
// - 받은 템을 장비대여용으로 쓰면 '장비대여로' 로 rental_items 에 물건을 만든다 (마일리지는 여기서 이미 줬으니 장비대여 기부 💎 는 0).
// 게임을 읽거나 게임에 무엇을 보내지 않는다 (사람이 적는 장부).
import type { Env, User } from "./auth";
import { RANK, TEST_IDS } from "./auth";
import { notify } from "./alerts";
import { DIA_GOLD, mileageOfName } from "./rental";

/** 모두에게 열기 전에는 길드마스터·오피서·앱개발자(와 테스트 계정)만 (제작자 2026-11-10 '개발 중 (운영진만)'). 화면 launcher.ts 의 DONATE_OPEN 과 같이 바꾼다 */
export const DONATE_OPEN = false;
export const canUseDonate = (me: User) => DONATE_OPEN || RANK[me.role] >= 1 || TEST_IDS.includes(me.id);
/** 확정·고치기·장비대여로 넘기기: 운영진 (제작자 '그 운영진이나 길마가 골드값을 매겨서 마일리지를 지급') */
export const canManageDonate = (me: User) => RANK[me.role] >= 1;
/**
 * 기부 골드 가치의 0.6 이 마일리지 (10만 골드당 💎1. 제작자 2026-11-10 '장비 기부든 뭐 기부든 기부한 골드 가치의 x 0.6 이 마일리지로 쌓이는 거임,
 * 소수점은 누적시켜 놓고 정수 부분만 사용 가능하게'). 소수점은 사람마다 확정 골드 합으로 누적되고, 장부(rental_mileage)에는 정수 부분만 들어간다
 */
export const MILEAGE_RATE = 0.6;
/** 골드 합 -> 쓸 수 있는 💎 (정수, 내림). 정수로만 셈해 소수 오차가 없게 */
export const usableDia = (gold: number) => Math.floor((gold * 6) / 1_000_000);
/** 골드 -> 쌓인 마일리지 (소수 그대로) */
export const earnedDia = (gold: number) => (gold * MILEAGE_RATE) / DIA_GOLD;
/** 장부 줄 note 머리 (장비대여 기부와 가린다) */
export const NOTE_HEAD = "기부함 · ";

export type DonateStatus = "request" | "done" | "rejected" | "removed";
export type DonatePlace = "keep" | "rent" | "used";
export interface DonateRow {
  id: number;
  who: string;
  item: string;
  qty: number;
  enhance: number;
  note: string | null;
  gold_ask: number | null;
  gold: number | null;
  dia: number;
  status: DonateStatus;
  place: DonatePlace;
  rental_id: number | null;
  created_at: number;
  created_by: string;
  done_at: number | null;
  done_by: string | null;
}

/** '+7 헌터보우 x3' */
export const donateLabel = (r: { item: string; qty: number; enhance: number }) =>
  `${r.enhance > 0 ? `+${r.enhance} ` : ""}${r.item}${r.qty > 1 ? ` x${r.qty}` : ""}`;
/** 골드를 '12만', '1.5억' 으로 */
export const goldText = (g: number) =>
  g >= 100_000_000 ? `${Math.round(g / 10_000_000) / 10}억` : g >= 10_000 ? `${Math.round(g / 1000) / 10}만` : `${g}`;

/** 신청·등록 값 검사 */
export function readDonate(b: Record<string, unknown>): { error: string } | { item: string; qty: number; enhance: number; note: string | null; gold: number | null } {
  const item = typeof b.item === "string" ? b.item.trim() : "";
  const qty = b.qty === undefined || b.qty === null || b.qty === "" ? 1 : Number(b.qty);
  const enhance = b.enhance === undefined || b.enhance === null || b.enhance === "" ? 0 : Number(b.enhance);
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  const gold = b.gold === undefined || b.gold === null || b.gold === "" ? null : Number(b.gold);
  if (!item || item.length > 40) return { error: "아이템 이름을 적어 주세요" };
  if (!Number.isInteger(qty) || qty < 1 || qty > 99_999) return { error: "개수가 맞지 않아요" };
  if (!Number.isInteger(enhance) || enhance < 0 || enhance > 20) return { error: "강화는 0~20 이에요" };
  if (note && note.length > 100) return { error: "메모가 너무 길어요" };
  if (gold !== null && (!Number.isInteger(gold) || gold < 0 || gold > 100_000_000_000)) return { error: "골드 가치가 맞지 않아요" };
  return { item, qty, enhance, note, gold };
}

/**
 * 그 사람의 마일리지를 확정 골드 합에 맞춘다: 목표 💎 = floor(확정 골드 합 x 0.6 / 10만), 지금까지 이 기부함으로 넣은 💎 = dia 합.
 * 차이를 장부(rental_mileage)에 한 줄로 넣고 그 차이를 바뀐 줄(rowId)의 dia 에 더한다. 빼서 남는 마일리지가 0 아래가 되면(이미 대여에 썼으면) 오류 글
 */
export async function syncDia(env: Env, who: string, rowId: number, label: string, by: string): Promise<{ error?: string; diff: number; mileage: number }> {
  const s = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status = 'done' THEN gold ELSE 0 END), 0) AS gold, COALESCE(SUM(dia), 0) AS dia FROM donate_items WHERE who = ?",
  )
    .bind(who)
    .first<{ gold: number; dia: number }>();
  const target = usableDia(s?.gold ?? 0);
  const diff = target - (s?.dia ?? 0);
  const now = await mileageOfName(env, who);
  if (diff === 0) return { diff, mileage: now };
  if (now + diff < 0) return { error: `${who} 님은 마일리지를 이미 써서 💎${-diff} 를 뺄 수 없어요 (지금 💎${now})`, diff, mileage: now };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rental_mileage (who, delta, reason, note, by_user, created_at) VALUES (?, ?, 'donate', ?, ?, ?)").bind(
      who,
      diff,
      `${NOTE_HEAD}${label}${diff < 0 ? " (고침)" : ""}`,
      by,
      Date.now(),
    ),
    env.DB.prepare("UPDATE donate_items SET dia = dia + ? WHERE id = ?").bind(diff, rowId),
  ]);
  return { diff, mileage: now + diff };
}

/** 운영진(오피서 이상)에게 알림. 사람마다 한 번 (본캐에게) */
export async function notifyDonateStaff(env: Env, text: string, from: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ('officer', 'master', 'developer')",
  ).all<{ id: string }>();
  await notify(env, results.map((r) => r.id), "donate", text, "#/donate?t=staff", from);
}

/** 기부한 사람에게 알림 (앱 계정일 때만) */
export async function notifyDonor(env: Env, who: string, text: string, from: string): Promise<void> {
  const u = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(who).first<{ id: string }>();
  if (u) await notify(env, [u.id], "donate", text, "#/donate?t=mine", from);
}

export interface HallRow {
  /** 보이는 이름 (앱 계정이면 본캐) */
  name: string;
  /** 합친 닉네임들 */
  names: string[];
  /** 기부 골드 가치 합 (장비대여 기부는 💎 / 0.6 x 10만 으로 되돌려 센다) */
  gold: number;
  /** 기부로 쌓인 마일리지 (소수 그대로: 기부함은 골드 x 0.6 / 10만, 장비대여 기부는 적은 💎). 순위는 이것으로 */
  earned: number;
  count: number;
  /** 지금 남은 마일리지 💎 */
  mileage: number;
  last: number;
  job: string | null;
  avatar: number | null;
  highSpec: boolean;
}

/** 기부 한 건 (기부함 확정 줄과 장비대여 기부 줄을 같은 모양으로) */
export interface GiftLine {
  id: string;
  who: string;
  label: string;
  gold: number;
  /** 이 기부로 쌓인 마일리지 (소수) */
  dia: number;
  at: number;
  from: "box" | "rent";
  place?: DonatePlace;
}

/**
 * 명예의 전당: 사람마다 기부한 골드 가치 합 (기부함 확정 + 장비대여 기부 💎 x 10만). since 를 주면 그때부터.
 * 같은 사람의 캐릭터는 본캐 이름으로 합친다
 */
export async function hallOfFame(env: Env, since = 0): Promise<{ rows: HallRow[]; lines: GiftLine[] }> {
  const [box, rent] = await Promise.all([
    env.DB.prepare(
      "SELECT id, who, item, qty, enhance, gold, dia, place, COALESCE(done_at, created_at) AS at FROM donate_items WHERE status = 'done' AND COALESCE(done_at, created_at) >= ? ORDER BY at DESC",
    )
      .bind(since)
      .all<{ id: number; who: string; item: string; qty: number; enhance: number; gold: number; dia: number; place: DonatePlace; at: number }>(),
    // 장비대여 기부 (물건 추가의 기부 💎, 기부 현황의 기부 적립). 고침(-) 줄도 같이 더해 순수한 합으로
    env.DB.prepare(
      "SELECT id, who, delta, note, created_at AS at FROM rental_mileage WHERE reason = 'donate' AND (note IS NULL OR note NOT LIKE ?) AND created_at >= ? ORDER BY created_at DESC",
    )
      .bind(`${NOTE_HEAD}%`, since)
      .all<{ id: number; who: string; delta: number; note: string | null; at: number }>(),
  ]);
  const lines: GiftLine[] = [
    ...box.results.map((r) => ({ id: `b${r.id}`, who: r.who, label: donateLabel(r), gold: r.gold ?? 0, dia: earnedDia(r.gold ?? 0), at: r.at, from: "box" as const, place: r.place })),
    // 장비대여 기부는 운영진이 💎 를 바로 적었다: 마일리지는 그대로, 골드 가치는 0.6 으로 되돌려 어림한다
    ...rent.results.map((r) => ({ id: `r${r.id}`, who: r.who, label: (r.note ?? "장비 기부").replace(/ 기부( \(고침\))?$/, "$1"), gold: Math.round((r.delta * DIA_GOLD) / MILEAGE_RATE), dia: r.delta, at: r.at, from: "rent" as const })),
  ].sort((a, b) => b.at - a.at);

  const who = [...new Set(lines.map((l) => l.who))];
  const { results: users } = who.length
    ? await env.DB.prepare(
        "SELECT u.id, COALESCE(u.main_id, u.id) AS owner, u.high_spec AS high, p.job, a.updated_at AS avatar FROM users u LEFT JOIN profiles p ON p.user_id = COALESCE(u.main_id, u.id) " +
          "LEFT JOIN avatars a ON a.user_id = COALESCE(u.main_id, u.id) WHERE u.id IN (SELECT value FROM json_each(?))",
      )
        .bind(JSON.stringify(who))
        .all<{ id: string; owner: string; high: number | null; job: string | null; avatar: number | null }>()
    : { results: [] };
  const byId = new Map(users.map((u) => [u.id, u]));
  const owners = new Map(users.filter((u) => u.id === u.owner).map((u) => [u.owner, u]));
  const hall = new Map<string, HallRow>();
  for (const l of lines) {
    const u = byId.get(l.who);
    const key = u?.owner ?? l.who;
    const head = owners.get(key) ?? u;
    const h = hall.get(key) ?? {
      name: key,
      names: [],
      gold: 0,
      earned: 0,
      count: 0,
      mileage: 0,
      last: 0,
      job: head?.job ?? null,
      avatar: head?.avatar ?? null,
      highSpec: head?.high === 1,
    };
    if (!h.names.includes(l.who)) h.names.push(l.who);
    h.gold += l.gold;
    h.earned += l.dia;
    if (l.gold > 0) h.count++;
    h.last = Math.max(h.last, l.at);
    hall.set(key, h);
  }
  for (const h of hall.values()) h.earned = Math.round(h.earned * 100) / 100;
  const rows = [...hall.values()].filter((h) => h.earned > 0).sort((a, b) => b.earned - a.earned || b.gold - a.gold || a.last - b.last);
  // 남은 마일리지 (앞 30명만, D1 읽기를 아끼려고)
  await Promise.all(rows.slice(0, 30).map(async (h) => (h.mileage = await mileageOfName(env, h.name))));
  return { rows, lines };
}
