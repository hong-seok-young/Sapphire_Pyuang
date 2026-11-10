// POST /api/board/:id/suggest { act, note? } -> 건의 결재선 (server/suggest.ts, 제작자 2026-11-10)
//   agree    오피서: 합의 (자기 건의는 안 됨, 한 번). 처음 합의면 길드마스터에게 결재 차례 알림
//   approve  길드마스터: 합의가 1명 이상이면 결재 -> 건의 접수 완료 (올린 사람에게 알림)
//   skip     길드마스터 직권: 오피서 합의 없이 결재 -> 접수 완료
//   force    길드마스터 직권: 반려된 건의를 강제 결재 -> 접수 완료 (반려한 사람에게도 알림)
//   reject   오피서·길드마스터: 반려 의견을 꼭 적는다 -> 반려 (올린 사람에게 알림)
//   done     운영진 누구나: 접수 완료 -> 건의 반영 완료 (올린 사람에게 알림)
//   resubmit 올린 사람: 반려된 건의를 (수정으로 고친 뒤) 다시 올린다 -> 합의 대기, 새 차례 (제작자 2026-11-10 '다시 올리기 ㄱ'). 오피서들에게 알림
import { FORBIDDEN, NEED_LOGIN, currentUser, json, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { ANON_NAME, canSeePost, loadPost, postLink } from "../../../../server/board";
import { SG_NOTE_MAX, currentRound, peopleWithRoles, sgRole, sgStatusOf, sgSteps, sgTell } from "../../../../server/suggest";
import type { SgKind, SgStatus } from "../../../../server/suggest";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  const id = Number(params.id);
  const post = await loadPost(env, id);
  if (!post || post.cat !== "suggest" || !canSeePost(me, post)) return json({ error: "없는 건의예요" }, 404);
  const row = await env.DB.prepare("SELECT sg_status FROM board_posts WHERE id = ?").bind(id).first<{ sg_status: string | null }>();
  const status = sgStatusOf(row?.sg_status);
  const b = await readJson<{ act: unknown; note: unknown }>(request);
  const note = typeof b.note === "string" ? b.note.trim().slice(0, SG_NOTE_MAX) : "";
  const role = sgRole(me);
  // 이번 차례만 센다 (반려 뒤 다시 올리면 합의를 새로 받는다)
  const steps = currentRound(await sgSteps(env, id));
  const agrees = steps.filter((s) => s.kind === "agree");
  const link = postLink("suggest", id);
  const title = `“${post.title}”`;
  const who = post.anon ? ANON_NAME : post.author;
  const owner = [post.author];
  let next: SgStatus;
  let kind: SgKind;
  const after: (() => Promise<void>)[] = [];

  if (b.act === "agree") {
    if (!role.agree) return FORBIDDEN();
    if (status !== "agree") return json({ error: "합의할 차례가 아니에요" }, 409);
    if ((me.chars ?? [me.id]).includes(post.author)) return json({ error: "내 건의에는 합의할 수 없어요" }, 409);
    if (agrees.some((s) => (me.chars ?? [me.id]).includes(s.user_id))) return json({ error: "이미 합의했어요" }, 409);
    next = "agree";
    kind = "agree";
    after.push(() => sgTell(env, me, owner, `[건의] ${me.id} 님이 합의했어요 · ${title}${note ? ` · ${note}` : ""}`, link));
    if (!agrees.length)
      after.push(async () =>
        sgTell(env, me, await peopleWithRoles(env, ["master"]), `[길마 결재] ${me.id} 님이 건의에 합의했어요 · 결재하거나 반려해 주세요 · ${who}: ${title}${note ? ` · 합의 의견: ${note}` : ""}`, link),
      );
  } else if (b.act === "approve" || b.act === "skip") {
    if (!role.approve) return FORBIDDEN();
    if (status !== "agree") return json({ error: "결재할 차례가 아니에요" }, 409);
    if (b.act === "approve" && !agrees.length) return json({ error: "합의가 한 명 이상 있어야 결재할 수 있어요 (직권 결재는 따로)" }, 409);
    if (b.act === "skip" && agrees.length) return json({ error: "합의가 이미 있어요. 결재를 눌러 주세요" }, 409);
    next = "accepted";
    kind = b.act;
    after.push(() => sgTell(env, me, owner, `[건의 접수 완료] 건의가 받아들여졌어요 · ${title}${note ? ` · ${note}` : ""}`, link));
    after.push(async () =>
      sgTell(env, me, await peopleWithRoles(env, ["officer", "master", "developer"]), `[건의 접수 완료] ${b.act === "skip" ? "길마 직권 결재" : "길마 결재"} · 반영되면 '반영 완료'를 눌러 주세요 · ${title}`, link),
    );
  } else if (b.act === "force") {
    if (!role.approve) return FORBIDDEN();
    if (status !== "rejected") return json({ error: "반려된 건의가 아니에요" }, 409);
    next = "accepted";
    kind = "force";
    const rejecter = [...steps].reverse().find((s) => s.kind === "reject")?.user_id;
    after.push(() => sgTell(env, me, owner, `[건의 접수 완료] 반려됐던 건의를 길드마스터가 받아들였어요 · ${title}${note ? ` · ${note}` : ""}`, link));
    if (rejecter) after.push(() => sgTell(env, me, [rejecter], `[강제 결재] 반려하신 건의를 길드마스터가 결재했어요 · ${title}${note ? ` · ${note}` : ""}`, link));
  } else if (b.act === "reject") {
    if (!role.agree && !role.approve) return FORBIDDEN();
    if (status !== "agree") return json({ error: "반려할 수 있는 때가 아니에요" }, 409);
    if (!note) return json({ error: "반려 의견을 적어 주세요 (올린 사람이 봐요)" }, 400);
    next = "rejected";
    kind = "reject";
    after.push(() => sgTell(env, me, owner, `[건의 반려] ${title} · ${note}`, link));
  } else if (b.act === "done") {
    if (!role.done) return FORBIDDEN();
    if (status !== "accepted") return json({ error: "접수 완료된 건의가 아니에요" }, 409);
    next = "done";
    kind = "done";
    after.push(() => sgTell(env, me, owner, `[건의 반영 완료] 건의가 반영됐어요 · ${title}${note ? ` · ${note}` : ""}`, link));
  } else if (b.act === "resubmit") {
    if (!(me.chars ?? [me.id]).includes(post.author)) return FORBIDDEN();
    if (status !== "rejected") return json({ error: "반려된 건의가 아니에요" }, 409);
    next = "agree";
    kind = "resubmit";
    after.push(async () =>
      sgTell(
        env,
        me,
        await peopleWithRoles(env, ["officer", "master", "developer"]),
        `[건의 다시 접수 · 오피서 합의] ${who}: ${title} · 반려 뒤 고쳐서 다시 올렸어요${note ? ` · ${note}` : ""}`,
        link,
      ),
    );
  } else return json({ error: "모르는 결재예요" }, 400);

  const now = Date.now();
  // 같은 때 두 사람이 누르면 먼저 바꾼 쪽만 (상태가 그대로일 때만)
  const upd = await env.DB.prepare("UPDATE board_posts SET sg_status = ? WHERE id = ? AND COALESCE(sg_status, 'agree') = ?").bind(next, id, status).run();
  if (!upd.meta.changes) return json({ error: "그새 다른 사람이 결재했어요. 새로고침해 주세요" }, 409);
  await env.DB.prepare("INSERT INTO suggest_steps (post_id, user_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, me.id, kind, note || null, now).run();
  for (const f of after) await f();
  return json({ ok: true, status: next });
};
