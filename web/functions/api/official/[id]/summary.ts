// GET /api/official/:id/summary -> { lines, jobs } 아이모 소식 글의 핵심 요약과 패치노트 직업별 변경점 (제작자 요청 2026-11-02, server/officialSummary.ts).
// 본문은 그림 속 표·글자까지 (server/officialImages.ts richBody, 그림이 다 옮겨지면 다시 만든다).
// 처음 연 사람이면 여기서 만든다 (몇 초). 다른 곳이 만드는 중이면 { pending: true } (화면이 잠시 뒤 다시 묻는다). 못 만들면 { none: true }
import { NEED_LOGIN, currentUser, json, paramId } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { RICH_IMG_SQL, richBody } from "../../../../server/officialImages";
import { makeSummary, storedSummary, summaryKey } from "../../../../server/officialSummary";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(paramId(params));
  if (!Number.isInteger(id)) return json({ error: "없는 글이에요" }, 404);
  const post = await env.DB.prepare("SELECT id, title, type, body, src, start_date, end_date FROM official_news WHERE id = ?")
    .bind(id)
    .first<{ id: number; title: string; type: string; body: string; src: string | null; start_date: string | null; end_date: string | null }>();
  if (!post) return json({ error: "없는 글이에요" }, 404);
  const [rich, imgs] = await Promise.all([
    env.DB.prepare("SELECT text, keys FROM official_rich WHERE id = ?").bind(id).first<{ text: string | null; keys: string | null }>().catch(() => null),
    env.DB.prepare(RICH_IMG_SQL)
      .bind(id)
      .all<{ key: string; text: string }>()
      .then((r) => r.results)
      .catch(() => []),
  ]);
  const full = richBody(post.body, rich, new Map(imgs.map((g) => [g.key, g.text])));
  const key = summaryKey(post.src, full.complete);
  const stored = await storedSummary(env, id, key);
  if (stored === "pending") return json({ pending: true });
  if (stored) return json(stored);
  // 그림 속 글자까지 합쳐도 본문이 거의 없는 글은 요약하지 않는다
  if (!env.ANTHROPIC_API_KEY || full.body.trim().length < 80) return json({ none: true });
  try {
    const made = await makeSummary(env, { ...post, body: full.body, src: key });
    return json(made === "pending" ? { pending: true } : made);
  } catch (e) {
    console.error("official summary failed", id, e instanceof Error ? e.message : e);
    return json({ none: true });
  }
};
