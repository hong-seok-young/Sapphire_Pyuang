// D1 하루 읽기·쓰기 감시 (2026-11-14 제작자 '무료 한도 내에서 무조건 해결되게'). GitHub Actions d1-guard.yml 이 15분마다 부른다.
// 계정마다 오늘(UTC) 읽은 줄 / 500만, 쓴 줄 / 10만 을 재서 50%·70%·90% 를 넘을 때마다 앱개발자에게 알림을 한 번 보낸다.
// 기능은 끄지 않는다 (제작자 2026-11-14 '빼버리지 말고 무료 한도로부터 안정적인 선에서 운영, 기능 떨어트리지 마'): 알림을 받으면 무엇이 많이 읽는지(d1-usage.yml) 보고 고친다.
// 공개 실행 기록에는 % 만 찍는다.
// 계정 A: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (계정·글 DB). 계정 B: CF2_API_TOKEN / CF2_ACCOUNT_ID (사용 기록, 있으면)
const READ_LIMIT = 5_000_000;
const WRITE_LIMIT = 100_000;
const A = { tok: process.env.CLOUDFLARE_API_TOKEN, acc: process.env.CLOUDFLARE_ACCOUNT_ID, key: "d1_main", name: "계정·글" };
const B = { tok: process.env.CF2_API_TOKEN, acc: process.env.CF2_ACCOUNT_ID, key: "d1_log", name: "사용 기록" };
const day = new Date().toISOString().slice(0, 10);

async function usage({ tok, acc }) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: "query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:50,filter:{date:$d}){sum{rowsRead rowsWritten}}}}}",
      variables: { a: acc, d: day },
    }),
  });
  const j = await r.json();
  const rows = j.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (!rows) throw new Error("analytics: " + JSON.stringify(j.errors ?? j).slice(0, 300));
  return rows.reduce((t, g) => ({ read: t.read + g.sum.rowsRead, write: t.write + g.sum.rowsWritten }), { read: 0, write: 0 });
}

async function sql(text, params) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${A.acc}/d1/database`;
  const h = { authorization: `Bearer ${A.tok}`, "content-type": "application/json" };
  const list = await (await fetch(`${base}?name=sapphire-accounts`, { headers: h })).json();
  const id = list.result?.find((d) => d.name === "sapphire-accounts")?.uuid;
  if (!id) throw new Error("no sapphire-accounts db");
  const r = await (await fetch(`${base}/${id}/query`, { method: "POST", headers: h, body: JSON.stringify({ sql: text, params }) })).json();
  if (!r.success) throw new Error("d1: " + JSON.stringify(r.errors).slice(0, 300));
}

let failed = false;
for (const acct of [A, B]) {
  if (!acct.tok || !acct.acc) {
    console.log(`${acct.name}: 비밀값 없음, 건너뜀`);
    continue;
  }
  try {
    const u = await usage(acct);
    const pct = Math.max(u.read / READ_LIMIT, u.write / WRITE_LIMIT);
    const level = pct >= 0.9 ? 90 : pct >= 0.7 ? 70 : pct >= 0.5 ? 50 : 0;
    console.log(`${acct.name}: 읽기 ${((u.read / READ_LIMIT) * 100).toFixed(1)}% · 쓰기 ${((u.write / WRITE_LIMIT) * 100).toFixed(1)}%`);
    if (level) {
      const now = Date.now();
      const mark = `${acct.key}_alert_${day}_${level}`;
      const text = `[DB 사용량] ${acct.name} DB 의 오늘 무료 사용량이 ${Math.round(pct * 100)}% 를 넘었어요 · 오전 9시에 초기화돼요`;
      await sql(
        "INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT id, 'account', ?1, '#/log', ?2 FROM users WHERE role = 'developer' AND NOT EXISTS (SELECT 1 FROM setup WHERE key = ?3)",
        [text, now, mark],
      );
      await sql("INSERT OR IGNORE INTO setup (key, done_at) VALUES (?1, ?2)", [mark, now]);
    }
  } catch (e) {
    failed = true;
    console.log(`${acct.name}: 실패 ${e instanceof Error ? e.message : e}`);
  }
}
if (failed) process.exitCode = 1;
