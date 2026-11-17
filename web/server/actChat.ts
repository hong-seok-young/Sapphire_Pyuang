// 사용 기록의 챗봇 질문과 답 (제작자 2026-11-17 '챗봇을 썼으면 그 챗봇에서 질문과 답변도 보이게').
// 사용 기록 DB 에는 질문 글만 남으니 답은 계정 DB 의 챗봇 대화(chat_msgs)에서 읽는다. 대화는 지우지 않는다 (CLAUDE.md '기록은 평생'), 길드원이 직접 지운 대화는 없다.
import type { Env } from "./auth";
import { TEST_IDS } from "./auth";

export interface ChatQA {
  /** 질문 글 번호 (chat_msgs.id) */
  id: number;
  user: string;
  thread: number;
  q: string;
  photos: number;
  /** 첨부 이름 (사진·파일) */
  attach: string[];
  at: number;
  /** 답 (질문 바로 다음 글이 답일 때만, 끊긴 질문은 null) */
  a: string | null;
  aAt: number | null;
}

interface Raw {
  k?: string;
  id: number;
  user: string;
  thread: number;
  q: string;
  photos: number;
  attach: string | null;
  at: number;
  arole: string | null;
  a: string | null;
  aAt: number | null;
}

const shape = (r: Raw): ChatQA => {
  let attach: string[] = [];
  try {
    const v = r.attach ? (JSON.parse(r.attach) as unknown) : [];
    if (Array.isArray(v)) attach = v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean);
  } catch {
    // 모양이 다르면 이름 없이
  }
  return {
    id: r.id,
    user: r.user,
    thread: r.thread,
    q: r.q,
    photos: r.photos ?? 0,
    attach,
    at: r.at,
    a: r.arole === "assistant" ? r.a : null,
    aAt: r.arole === "assistant" ? r.aAt : null,
  };
};

/** 질문 다음 글 (같은 대화에서 번호가 바로 다음인 글) */
const NEXT =
  "LEFT JOIN chat_msgs a ON a.id = (SELECT MIN(y.id) FROM chat_msgs y WHERE y.thread_id = m.thread_id AND y.id > m.id)";
const COLS = "m.id AS id, t.user_id AS user, m.thread_id AS thread, m.text AS q, m.photos AS photos, m.attach AS attach, m.created_at AS at, a.role AS arole, a.text AS a, a.created_at AS aAt";

/**
 * 챗봇 질문과 답 목록 (새것부터, 30개씩). ids 를 주면 그 사람(묶은 캐릭터 모두)만, 아니면 모두 (테스트 계정 빼고).
 * before 는 질문 글 번호
 */
export async function chatFeed(env: Env, ids: string[] | null, before: number, limit = 30): Promise<{ list: ChatQA[]; more: boolean }> {
  // 무료 한도 (docs/무료한도.md): 사람을 고르면 그 사람의 대화(색인 chat_threads_user)부터 그 대화의 글(색인 chat_msgs_thread)만 읽는다.
  // 모두면 글 번호 역순으로 30개만 (다음 글은 색인으로 한 줄씩)
  const binds: (string | number)[] = [];
  let sql: string;
  if (ids) {
    sql = `SELECT ${COLS} FROM chat_threads t CROSS JOIN chat_msgs m ON m.thread_id = t.id ${NEXT} WHERE t.user_id IN (SELECT value FROM json_each(?)) AND m.role = 'user'`;
    binds.push(JSON.stringify(ids));
  } else {
    sql = `SELECT ${COLS} FROM chat_msgs m JOIN chat_threads t ON t.id = m.thread_id ${NEXT} WHERE m.role = 'user' AND t.user_id NOT IN (SELECT value FROM json_each(?))`;
    binds.push(JSON.stringify(TEST_IDS));
  }
  if (before > 0) {
    sql += " AND m.id < ?";
    binds.push(before);
  }
  const { results } = await env.DB.prepare(`${sql} ORDER BY m.id DESC LIMIT ${limit}`)
    .bind(...binds)
    .all<Raw>();
  return { list: results.map(shape), more: results.length === limit };
}

/**
 * 사용 기록의 '챗봇에 질문' 줄마다 그 질문과 답 (기록 번호 -> 질문과 답).
 * 기록은 서버가 답을 돌려준 뒤에 적어서 질문 글보다 조금 늦다: 그 사람 대화 중 기록 때 앞 5분 ~ 뒤 1분의 질문 글 중 가장 가까운 것
 */
export async function chatForRows(env: Env, rows: { id: number; user: string; kind: string; what: string; at: number }[]): Promise<Record<string, ChatQA>> {
  const want: Record<string, [string, number]> = {};
  for (const r of rows) if (r.kind === "act" && r.what === "POST /api/chat") want[String(r.id)] = [r.user, r.at];
  if (!Object.keys(want).length) return {};
  const U = "json_extract(j.value, '$[0]')";
  const T = "json_extract(j.value, '$[1]')";
  const { results } = await env.DB.prepare(
    `SELECT j.key AS k, ${COLS} FROM json_each(?1) j ` +
      "JOIN chat_msgs m ON m.id = (SELECT x.id FROM chat_msgs x WHERE x.role = 'user' " +
      `AND x.thread_id IN (SELECT id FROM chat_threads WHERE user_id = ${U} AND updated_at >= ${T} - 300000) ` +
      `AND x.created_at BETWEEN ${T} - 300000 AND ${T} + 60000 ORDER BY abs(x.created_at - ${T}) LIMIT 1) ` +
      `JOIN chat_threads t ON t.id = m.thread_id ${NEXT}`,
  )
    .bind(JSON.stringify(want))
    .all<Raw>();
  const out: Record<string, ChatQA> = {};
  for (const r of results) if (r.k) out[r.k] = shape(r);
  return out;
}

/** 질문 하나와 그 답 (사용 기록의 '답 전체' 화면, 질문 글 번호로) */
export async function chatOne(env: Env, id: number): Promise<ChatQA | null> {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM chat_msgs m JOIN chat_threads t ON t.id = m.thread_id ${NEXT} WHERE m.id = ? AND m.role = 'user'`)
    .bind(id)
    .first<Raw>();
  return r ? shape(r) : null;
}
