// 자료 저장소(sapphire-imo-data)의 Actions(.github/workflows/talk-import.yml)만 부른다. 로그인 대신 GitHub OIDC 토큰 (server/ghOidc.ts).
// GET  /api/talk-upload/pending        -> 기다리는 것 [{ id, title }] (5개까지)
// GET  /api/talk-upload/pending?id=N   -> 그 글 (gzip 그대로)
// POST /api/talk-upload/pending { results: [{ id, status: done|same|fail|wait, note }] } -> 상태를 고치고 조각을 지우고 올린 사람에게 알림
import { json } from "../../../server/auth";
import type { Env } from "../../../server/auth";
import { notify } from "../../../server/alerts";
import { verifyGithubOidc } from "../../../server/ghOidc";

const GH = { audience: "sapphire-talk", repository: "hong-seok-young/sapphire-imo-data", workflow: "hong-seok-young/sapphire-imo-data/.github/workflows/talk-import.yml", ref: "refs/heads/main" };
const DENY = () => json({ error: "권한이 없어요" }, 403);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifyGithubOidc(request, GH))) return DENY();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) {
    const { results } = await env.DB.prepare("SELECT id, title FROM talk_uploads WHERE status = 'wait' ORDER BY id LIMIT 5").all();
    return json({ uploads: results });
  }
  const { results } = await env.DB.prepare("SELECT data FROM talk_parts WHERE upload_id = ? ORDER BY n").bind(id).all<{ data: ArrayBuffer | number[] }>();
  if (!results.length) return json({ error: "조각이 없어요" }, 404);
  const chunks = results.map((r) => (r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : Uint8Array.from(r.data)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) out.set(c, (at += c.length) - c.length);
  return new Response(out, { headers: { "content-type": "application/gzip", "cache-control": "no-store" } });
};

const NAME = { done: "자료 저장소에 더했어요", same: "새 글이 없어요", fail: "올리지 못했어요", wait: "아직 못 올렸어요" } as const;
type Status = keyof typeof NAME;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifyGithubOidc(request, GH))) return DENY();
  const body = (await request.json().catch(() => null)) as { results?: { id?: unknown; status?: unknown; note?: unknown }[] } | null;
  const now = Date.now();
  let n = 0;
  for (const r of (body?.results ?? []).slice(0, 10)) {
    const id = Number(r.id);
    const status = String(r.status) as Status;
    if (!id || !(status in NAME)) continue;
    const note = String(r.note ?? "").slice(0, 160);
    const row = await env.DB.prepare("SELECT user_id, note FROM talk_uploads WHERE id = ? AND status = 'wait'").bind(id).first<{ user_id: string; note: string | null }>();
    if (!row) continue;
    await env.DB.batch([
      env.DB.prepare("UPDATE talk_uploads SET status = ?, note = ?, done_at = ? WHERE id = ?").bind(status, note, status === "wait" ? null : now, id),
      ...(status === "done" || status === "same" ? [env.DB.prepare("DELETE FROM talk_parts WHERE upload_id = ?").bind(id)] : []),
    ]);
    // 기다림은 처음 한 번만 알린다
    if (status !== "wait" || row.note !== note) await notify(env, [row.user_id], "talk_up", `[톡방 올리기] ${NAME[status]} · ${note}`, "#/talk", "Sapphire");
    n++;
  }
  return json({ ok: true, n });
};
