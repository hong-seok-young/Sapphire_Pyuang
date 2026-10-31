// PUT /api/shop/items/:id { enabled, ratio, limitCount, limitWeeks } -> (오피서 이상) 물건 하나의 판매 여부와 따로 정한 비율, 한도.
//     ratio, limitCount, limitWeeks 가 null 이면 통 설정을 따른다
import { FORBIDDEN, NEED_LOGIN, RANK, currentUser, json, paramId, readJson } from "../../../../server/auth";
import type { Env } from "../../../../server/auth";
import { loadCatalog, validCount, validRatio, validWeeks } from "../../../../server/platshop";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  if (RANK[me.role] < 1) return FORBIDDEN();
  const id = paramId(params);
  if (!(await loadCatalog(env, request)).some((it) => it.id === id)) return json({ error: "없는 물건이에요" }, 404);
  const b = await readJson<{ enabled: unknown; ratio: unknown; limitCount: unknown; limitWeeks: unknown }>(request);
  const ok =
    typeof b.enabled === "boolean" &&
    (b.ratio === null || validRatio(b.ratio)) &&
    (b.limitCount === null || validCount(b.limitCount)) &&
    (b.limitWeeks === null || validWeeks(b.limitWeeks));
  if (!ok) return json({ error: "비율은 0보다 크게, 한도는 0~99개, 1~52주로 적어 주세요" }, 400);
  await env.DB.prepare(
    "INSERT INTO plat_items (item_id, enabled, ratio, limit_count, limit_weeks) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT (item_id) DO UPDATE SET enabled = ?2, ratio = ?3, limit_count = ?4, limit_weeks = ?5",
  )
    .bind(id, b.enabled ? 1 : 0, b.ratio, b.limitCount, b.limitWeeks)
    .run();
  return json({ ok: true });
};
