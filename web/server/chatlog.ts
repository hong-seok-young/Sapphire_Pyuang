// 챗봇 대화 기록 (제작자 요청: 클로드, GPT 처럼 대화 목록, 이어 하기, 이름 변경, 고정, 삭제, 검색).
// 대화(D1 chat_threads)와 말(chat_msgs)은 그 길드원만 본다. 사진은 저장하지 않고 장 수만 남긴다.
// 질문은 /api/chat 이 답을 받기 시작할 때 넣고, 답은 화면이 다 받은 뒤 넣는다 (서버는 답을 읽지 않고 그대로 흘려보내서)
import type { Env } from "./auth";
import { notify } from "./alerts";

/** 한 사람이 둘 수 있는 대화 수. 넘으면 고정하지 않은 가장 오래된 대화부터 지운다 */
export const MAX_THREADS = 300;
export const MAX_ANSWER = 16000;
export const MAX_THINKING = 8000;

export interface ThreadRow {
  id: number;
  user_id: string;
  title: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

/** 내 대화면 그 줄, 아니면 null */
export async function ownThread(env: Env, userId: string, id: unknown): Promise<ThreadRow | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const row = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(n).first<ThreadRow>();
  return row && row.user_id === userId ? row : null;
}

/** 대화 이름: 첫 질문 앞부분 */
export const titleOf = (question: string) => {
  const t = question.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 40) : "사진 질문";
};

export async function deleteThreads(env: Env, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const q = ids.map(() => "?").join(",");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM chat_msgs WHERE thread_id IN (${q})`).bind(...ids),
    env.DB.prepare(`DELETE FROM chat_threads WHERE id IN (${q})`).bind(...ids),
  ]);
}

export async function newThread(env: Env, userId: string, title: string): Promise<number> {
  const now = Date.now();
  const row = await env.DB.prepare("INSERT INTO chat_threads (user_id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?) RETURNING id")
    .bind(userId, title, now, now)
    .first<{ id: number }>();
  return row!.id;
}

export interface MsgExtra {
  photos?: number;
  thinking?: string | null;
  thinkMs?: number | null;
  found?: string | null;
  attach?: string[] | null;
  steps?: string | null;
  sources?: string | null;
}

/** 말 하나 넣고 대화를 맨 위로 (최근 순) */
export async function addMsg(env: Env, threadId: number, role: "user" | "assistant", text: string, extra: MsgExtra = {}): Promise<number> {
  const now = Date.now();
  const [row] = await env.DB.batch<{ id: number }>([
    env.DB.prepare(
      "INSERT INTO chat_msgs (thread_id, role, text, photos, thinking, think_ms, found, attach, steps, sources, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    ).bind(
      threadId,
      role,
      text,
      extra.photos ?? 0,
      extra.thinking ?? null,
      extra.thinkMs ?? null,
      extra.found ?? null,
      extra.attach?.length ? JSON.stringify(extra.attach) : null,
      extra.steps ?? null,
      extra.sources ?? null,
      now,
    ),
    env.DB.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").bind(now, threadId),
  ]);
  return row.results[0].id;
}

/** 답 안의 '모르는 부분' 표시 (functions/api/chat/index.ts 의 SYSTEM 이 쓰게 한다) */
export const GAP_TOKEN = /\[\[모름:([^\]\n]{1,200})\]\]/g;

/**
 * 챗봇이 모르는 질문을 남기고 앱개발자에게 알린다 (제작자 요청: 보고 고칠 수 있게). 질문은 그 답 바로 앞의 질문
 */
export async function recordGap(
  env: Env,
  userId: string,
  threadId: number,
  msgId: number,
  answer: string,
  reason: string,
  kind: "bot" | "user",
): Promise<void> {
  try {
    const q = await env.DB.prepare("SELECT text FROM chat_msgs WHERE thread_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1")
      .bind(threadId, msgId)
      .first<{ text: string }>();
    const question = q?.text || "(사진 질문)";
    await env.DB.prepare(
      "INSERT INTO chat_gaps (user_id, thread_id, msg_id, question, answer, reason, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
    )
      .bind(userId, threadId, msgId, question.slice(0, 2000), answer.slice(0, 6000), reason.slice(0, 200), kind, Date.now())
      .run();
    const devs = await env.DB.prepare("SELECT id FROM users WHERE role = 'developer'").all<{ id: string }>();
    const tag = kind === "user" ? "👎" : "🤔";
    await notify(
      env,
      devs.results.map((d) => d.id),
      "chat_gap",
      `${tag} ${userId}: “${question.replace(/\s+/g, " ").slice(0, 50)}” · ${reason}`,
      "#/gaps",
      userId,
    );
  } catch (e) {
    console.error("chat gap failed", e);
  }
}

/**
 * SSE 글에서 답과 생각만 뽑는다 (화면 src/chat.ts askChat 과 같은 규칙: 웹 찾기 뒤에 이어지는 답은 줄을 띄운다).
 * 화면이 답을 넣지 못했을 때 한 번만 돈다 (서버 CPU 를 아끼려고 이벤트를 다 풀지 않는다)
 */
export function answerFromSse(raw: string): { text: string; thinking: string } {
  let text = "";
  let thinking = "";
  let lastType = "";
  for (const ev of raw.split("\n\n")) {
    const at = ev.indexOf("data:");
    if (at < 0) continue;
    const data = ev.slice(at + 5).trim();
    if (data.includes('"content_block_start"')) {
      const t = data.match(/"content_block":\{"type":"([a-z_]+)"/)?.[1] ?? "";
      if (t === "text" && text && lastType !== "text" && lastType !== "thinking" && !text.endsWith("\n")) text += "\n\n";
      lastType = t;
    } else if (data.includes('"text_delta"')) {
      try {
        text += (JSON.parse(data) as { delta: { text?: string } }).delta.text ?? "";
      } catch {
        // 깨진 줄은 건너뛴다
      }
    } else if (data.includes('"thinking_delta"')) {
      try {
        thinking += (JSON.parse(data) as { delta: { thinking?: string } }).delta.thinking ?? "";
      } catch {
        // 깨진 줄은 건너뛴다
      }
    }
  }
  return { text, thinking };
}

/**
 * 화면을 닫거나 새로 고쳐도 답이 남게 (제작자 요청): 같은 답을 뒤에서 끝까지 받아 두었다가, 다 받고 3초 뒤에도 화면이 답을 넣지
 * 않았으면 서버가 넣고 '답변 완료' 알림을 보낸다. 화면이 열려 있으면 화면이 먼저 넣으므로 아무것도 하지 않는다
 */
export async function finishInBackground(
  env: Env,
  userId: string,
  threadId: number,
  questionId: number | null,
  question: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    return; // 답이 끊겼으면 화면이 다시 묻는다
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const qid =
      questionId ??
      (await env.DB.prepare("SELECT MAX(id) AS id FROM chat_msgs WHERE thread_id = ? AND role = 'user'").bind(threadId).first<{ id: number | null }>())?.id ??
      0;
    const saved = await env.DB.prepare("SELECT 1 FROM chat_msgs WHERE thread_id = ? AND role = 'assistant' AND id > ?").bind(threadId, qid).first();
    if (saved) return;
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    const { text, thinking } = answerFromSse(new TextDecoder().decode(all));
    if (!text.trim()) return;
    const id = await addMsg(env, threadId, "assistant", text.slice(0, MAX_ANSWER), { thinking: thinking.slice(0, MAX_THINKING) || null });
    const gaps = [...text.matchAll(GAP_TOKEN)].map((m) => m[1].trim()).filter(Boolean);
    if (gaps.length) await recordGap(env, userId, threadId, id, text, gaps.join(" / "), "bot");
    await notify(env, [userId], "chat_done", `답변이 준비됐어요: “${question.replace(/\s+/g, " ").slice(0, 40) || "첨부 질문"}”`, `#/chat/${threadId}`, "");
  } catch (e) {
    console.error("chat finish failed", e);
  }
}

