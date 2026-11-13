// 사용 기록 일꾼 (wrangler.toml 참고). POST { batch: [{ sql, params }] } -> D1 결과 배열 ({ results, meta }).
// 사이트만 부르게 x-log-key 가 맞아야 한다 (LOG_KEY: 배포가 CF2_API_TOKEN 에서 만들어 이 일꾼과 사이트 모두에 넣는다).
// 사용 기록 표(activity)만 다루고, 무엇이든 SQL 을 받지만 이 DB 에는 사용 기록 말고 아무것도 없다.
interface Env {
  LOG: D1Database;
  LOG_KEY: string;
}

type Stmt = { sql: string; params?: unknown[] };

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("ok", { status: 200 });
    const key = request.headers.get("x-log-key") ?? "";
    if (!env.LOG_KEY || !same(key, env.LOG_KEY)) return new Response("forbidden", { status: 403 });
    let body: { batch?: Stmt[] };
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const list = Array.isArray(body.batch) ? body.batch.slice(0, 50) : [];
    if (!list.length) return new Response("empty", { status: 400 });
    try {
      const stmts = list.map((s) => env.LOG.prepare(String(s.sql)).bind(...(Array.isArray(s.params) ? s.params : [])));
      const out = stmts.length === 1 ? [await stmts[0].all()] : await env.LOG.batch(stmts);
      return Response.json(out.map((r) => ({ results: r.results ?? [], meta: r.meta ?? {}, success: r.success })));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },
};
