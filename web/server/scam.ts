// 아이모 사기꾼 명단 (제작자 2026-11-11 '거래 전 더치트 조회 & 실물 확인, 사기꾼 리스트 우리 DB 에 넣고 업데이트되면 반영').
// D1 scam_list 한 줄 (scripts/scam-list.mjs 가 채운다: 배포는 비공개 자료의 사람이 옮긴 것, 30분마다 카카오 포스트 그림이 바뀌면 AI 가 옮긴 것).
// 쓰는 곳: 챗봇(chatapp.ts scamContext), 검색 화면, 시세 동향 '사기꾼' 칸 (src/pages/Scam.tsx, GET /api/scam). 로그인한 길드원만.
import type { Env } from "./auth";

export interface ScamRow {
  no: number;
  name: string;
  nicks: string[];
  phones: string[];
  accounts: string[];
  note: string;
  note2: string;
}
export interface ScamList {
  title: string;
  by: string;
  post: string;
  rule: string;
  rows: ScamRow[];
  made: "person" | "ai";
  updatedAt: number;
  checkedAt: number;
}

export async function readScam(env: Env): Promise<ScamList | null> {
  const r = await env.DB.prepare("SELECT title, by, post, rule, rows, made, updated_at, checked_at FROM scam_list WHERE id = 1")
    .first<{ title: string; by: string | null; post: string | null; rule: string | null; rows: string; made: string; updated_at: number; checked_at: number }>()
    .catch(() => null);
  if (!r) return null;
  let rows: ScamRow[] = [];
  try {
    rows = JSON.parse(r.rows);
  } catch {}
  return {
    title: r.title,
    by: r.by ?? "",
    post: r.post ?? "",
    rule: r.rule ?? "",
    rows,
    made: r.made === "ai" ? "ai" : "person",
    updatedAt: r.updated_at,
    checkedAt: r.checked_at,
  };
}

const ASK = /사기|먹튀|더치트|블랙|명단|추방|계좌|입금|선입금|안전 ?거래|믿을 ?만|믿어도|조심|현거래|월거|월드 ?거래/;
const digits = (s: string) => s.replace(/\D/g, "");

/** 챗봇: 사기·거래 안전을 묻거나 질문에 명단의 닉네임·폰 뒷자리·계좌 숫자가 나오면 명단을 붙인다 */
export async function scamContext(env: Env, question: string): Promise<string> {
  const q = question.replace(/\s+/g, " ");
  const qd = digits(q);
  const list = await readScam(env);
  if (!list?.rows.length) return "";
  const hit = (r: ScamRow) =>
    r.nicks.some((n) => n.length >= 2 && q.includes(n)) ||
    r.phones.some((p) => new RegExp(`(^|\\D)${p}(\\D|$)`).test(q)) ||
    r.accounts.some((a) => {
      const d = digits(a);
      return d.length >= 6 && qd.length >= 6 && (qd.includes(d.slice(0, 8)) || d.includes(qd.slice(0, 8)));
    });
  const hits = list.rows.filter(hit);
  if (!hits.length && !ASK.test(q)) return "";
  const line = (r: ScamRow) =>
    [
      `${r.no}. ${r.name}`,
      r.nicks.length ? `인게임 닉네임 ${r.nicks.join(", ")}` : "",
      r.phones.length ? `폰 뒷자리 ${r.phones.join(", ")}` : "",
      r.accounts.length ? `계좌 ${r.accounts.join(" / ")}` : "",
      [r.note, r.note2].filter(Boolean).join(" · "),
    ]
      .filter(Boolean)
      .join(" | ");
  const date = new Date(list.updatedAt + 9 * 3600_000).toISOString().slice(0, 10);
  return (
    `<아이모 사기꾼 명단>\n` +
    `[${list.title}] 거래 톡방에서 돌려 보는 명단 (Made by. ${list.by}, ${date} 반영, ${list.made === "ai" ? "AI 가 원본 그림을 옮김" : "사람이 원본 그림을 옮김"}). ` +
    `원본 ${list.post}. 앱 검색에서 이름·닉네임·폰 뒷자리·계좌로도 찾아진다. ${list.rule}. 이름·계좌 일부는 원본에서 가려져 있다(x).\n` +
    (hits.length ? `질문에 나온 것과 맞는 줄: ${hits.map((r) => r.no).join(", ")}번\n` : "") +
    list.rows.map(line).join("\n") +
    `\n답할 때: 명단에 있으면 거래하지 말라고, 없어도 '명단에 없다고 안전한 것은 아니다'라며 더치트(thecheat.co.kr) 조회와 아이템 실물 확인, 선입금 주의를 함께 말한다. 명단에 없는 사람을 사기꾼이라고 짐작하지 않는다.\n` +
    `</아이모 사기꾼 명단>`
  );
}
