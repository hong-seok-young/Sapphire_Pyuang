// To do (제작자 요청 2026-11-01): 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱.
// - 늘 하는 일은 여기서 만든다: 매일 길드 출석, 매주(목요일 오전 10시 초기화) 길드 임무, 들어갈 수 있는 인스턴스 던전(위키 '인스턴스 던전' 지역,
//   이름의 숫자가 들어가는 레벨), 길드던전, 헌팅 그라운드 이용 시간.
// - 이벤트 할 일은 서버가 공식 글에서 Claude 로 뽑아 둔 것 중 지금 이 캐릭터의 레벨·직업에 맞는 것 (/api/todo, server/todo.ts).
// - 체크는 계정(캐릭터)마다 서버에 두고, 그 주기 안에서만 남는다 (오늘은 한국 시간 0시, 이번 주는 목요일 오전 10시에 비워진다).
// 사용자가 직접 누르는 체크일 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙).
import { api } from "./auth";
import type { Wiki } from "./types";

/** 서버가 준 이벤트 할 일 */
export interface TodoTaskOut {
  key: string;
  text: string;
  note: string | null;
  cycle: "d" | "w" | "o";
  /** 오늘 정해진 시각에 열리는 일 ('22:30') */
  at: string | null;
  /** 끝나는 때 (ms) */
  until: number | null;
  post: { id: number; title: string };
}

export interface TodoData {
  tasks: TodoTaskOut[];
  /** 지금 주기에 체크한 것 */
  done: string[];
  /** 아직 정리 안 된 새 공식 글 (맡을 수 있는 것) / 정리하는 중인 것 */
  pending: number;
  working: number;
  /** 오늘이 끝나는 때, 이번 주가 끝나는 때 */
  dayEnd: number;
  weekEnd: number;
  now: number;
}

export const fetchTodo = () => api<TodoData>("/api/todo");
export const setTodoDone = (key: string, done: boolean) => api<{ ok: boolean }>("/api/todo", "PUT", { key, done });
/** 아직 정리 안 된 새 공식 글을 서버가 정리한다 (길면 1분쯤 걸린다) */
export const digestTodo = () => api<{ done: number }>("/api/todo/digest", "POST");

/** 화면에 보이는 할 일 한 줄 */
export interface TodoItem {
  key: string;
  text: string;
  /** 이름 옆 작은 글씨 (어디서, 무엇) */
  note?: string | null;
  /** 오른쪽 작은 글씨 (마감, 시각) */
  right?: string | null;
  /** '›' 로 여는 화면 (위키 사냥터, 공식 글) */
  to?: string | null;
}

/**
 * 길드던전과 헌팅 그라운드를 보이는 레벨. 공식 글과 위키에 입장 레벨이 없어서 몬스터 레벨로 정했다
 * (길드던전 첫 부위 Lv.35, 헌팅 그라운드 Easy 몬스터 Lv.33). 게임과 다르면 여기만 고친다
 */
const GUILD_DUNGEON_LV = 35;
const HUNTING_LV = 30;

/** 늘 하는 일: 오늘(매일)과 이번 주(매주) */
export function routineItems(wiki: Wiki, level: number | null): { today: TodoItem[]; week: TodoItem[] } {
  const lv = level ?? 0;
  const today: TodoItem[] = [{ key: "d:guild-attend", text: "길드 출석" }];
  const week: TodoItem[] = [{ key: "w:guild-mission", text: "길드 임무" }];
  const region = wiki.regions.find((r) => r.name.includes("인스턴스 던전"));
  const dungeons: { lv: number; item: TodoItem }[] = [];
  for (const id of region?.places ?? []) {
    const p = wiki.places[id];
    if (!p) continue;
    // '인던20 ： 버려진 유령선(Ghost Ship)' -> 버려진 유령선
    const name = (p.title.split(/[：:]/)[1] ?? p.name).replace(/\(.*$/, "").trim() || p.name;
    const n = /^인던\s*(\d+)/.exec(p.name);
    if (n && lv >= Number(n[1])) dungeons.push({ lv: Number(n[1]), item: { key: `w:dungeon:${id}`, text: name, note: `인던 ${n[1]}`, to: `#/place/${id}` } });
    else if (!n && /길드\s*던전|길던/.test(p.name + p.title) && lv >= GUILD_DUNGEON_LV) {
      week.push({ key: "w:guild-dungeon", text: "길드던전", note: name, to: `#/place/${id}` });
    }
  }
  // 들어갈 수 있는 인던: 높은 것부터 (지금 레벨에 맞는 것이 위로)
  week.push(...dungeons.sort((a, b) => b.lv - a.lv).map((d) => d.item));
  if (lv >= HUNTING_LV) {
    const hunting = Object.values(wiki.places).find((p) => /헌팅\s*그라운드/.test(p.name));
    week.push({ key: "w:hunting", text: "헌팅 그라운드", note: "주간 이용 시간", to: hunting ? `#/place/${hunting.id}` : null });
  }
  return { today, week };
}

const KST = 9 * 3_600_000;
/** '11/12' 또는 '11/12 10:00' (한국 시간, 자정이 아닌 시각이면 시각까지) */
export function shortDate(ms: number): string {
  const d = new Date(ms + KST);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}` + (hm === "23:59" || hm === "00:00" ? "" : ` ${hm}`);
}

/** 서버의 이벤트 할 일 -> 오늘 / 이번 주 / 이벤트(한 번) 줄 */
export function eventItems(tasks: TodoTaskOut[]): { today: TodoItem[]; week: TodoItem[]; once: TodoItem[] } {
  const out = { today: [] as TodoItem[], week: [] as TodoItem[], once: [] as TodoItem[] };
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    const item: TodoItem = {
      key: t.key,
      text: t.text,
      note: t.note,
      right: t.at ?? (t.until ? "~" + shortDate(t.until) : null),
      to: `#/official/${t.post.id}`,
    };
    (t.cycle === "d" ? out.today : t.cycle === "w" ? out.week : out.once).push(item);
  }
  // 정해진 시각에 열리는 일은 시각 순서로 맨 아래, 마감이 가까운 이벤트가 위로
  out.today.sort((a, b) => (a.right && /^\d\d:\d\d$/.test(a.right) ? 1 : 0) - (b.right && /^\d\d:\d\d$/.test(b.right) ? 1 : 0));
  return out;
}

/** '13시간 20분 뒤', '2일 3시간 뒤' (초기화까지 남은 때) */
export function leftText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m % 60}분`;
  return `${m % 60}분`;
}
