// 폰 자체 알림 (웹 푸시, 제작자 요청: 앱 안 🔔 뿐 아니라 갤럭시·아이폰 알림으로 간략 내용과 함께).
// 알림(server/alerts.ts notify)이 생기면 받는 사람의 폰(D1 push_subs)에 '새 알림' 신호만 보낸다 (내용 없는 푸시, VAPID 서명).
// 폰의 서비스 워커(public/sw.js)가 신호를 받으면 /api/alerts 에서 가장 새 알림 글을 가져와 알림으로 띄운다.
// 내용을 푸시에 싣지 않으므로 암호화가 필요 없고, 글은 로그인한 본인만 가져간다.
// 서명 키는 처음 쓸 때 서버가 만들어 D1 push_keys 에 둔다 (따로 넣을 비밀값이 없다). 화면은 공개 키를 GET /api/push 로 받는다.
// 아이폰은 홈 화면에 설치한 웹앱에서만 된다 (애플 규칙). 무료 요금제는 요청 하나에 바깥 요청 50개까지라 한 번에 40개까지만 보낸다
import type { Env } from "./auth";

const MAX_SENDS = 40;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text = (s: string) => new TextEncoder().encode(s);

export interface Keys {
  publicKey: string;
  sign: CryptoKey;
}
let cached: Promise<Keys> | null = null;

/** 서명 키 (없으면 만들어 둔다). 공개 키는 0x04||x||y 를 base64url 로 */
export function vapidKeys(env: Env): Promise<Keys> {
  if (!cached) {
    cached = (async () => {
      let row = await env.DB.prepare("SELECT public_key, private_jwk FROM push_keys WHERE id = 1").first<{ public_key: string; private_jwk: string }>();
      if (!row) {
        const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
        const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
        const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
        // 두 곳에서 동시에 만들면 먼저 넣은 것을 쓴다
        await env.DB.prepare("INSERT OR IGNORE INTO push_keys (id, public_key, private_jwk) VALUES (1, ?, ?)").bind(b64url(raw), JSON.stringify(jwk)).run();
        row = await env.DB.prepare("SELECT public_key, private_jwk FROM push_keys WHERE id = 1").first<{ public_key: string; private_jwk: string }>();
      }
      const sign = await crypto.subtle.importKey("jwk", JSON.parse(row!.private_jwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      return { publicKey: row!.public_key, sign };
    })().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

/** 푸시 서버(주소의 origin)에 보낼 VAPID 서명 (ES256 JWT, 12시간) */
async function vapid(keys: Keys, endpoint: string): Promise<string> {
  const head = b64url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(
    text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://sapphire-guild.pages.dev" })),
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.sign, text(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** 폰 하나에 신호 보내기. 푸시 서버의 답 코드를 돌려준다 (0 = 연결 실패). 없어진 구독(404·410)은 지우고, 결과는 push_subs 에 적는다 (어느 폰이 안 받는지 보려고) */
export async function pushOne(env: Env, keys: Keys, endpoint: string, auth?: string): Promise<number> {
  let status = 0;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { TTL: "86400", Urgency: "high", Authorization: auth ?? (await vapid(keys, endpoint)), "Content-Length": "0" },
      signal: AbortSignal.timeout(5000),
    });
    status = res.status;
  } catch {
    // 이 폰은 다음에
  }
  try {
    if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
    else await env.DB.prepare("UPDATE push_subs SET last_status = ?, last_at = ? WHERE endpoint = ?").bind(status, Date.now(), endpoint).run();
  } catch {
    // 기록은 못 해도 된다
  }
  return status;
}

/** 그 알림을 받은 사람들의 폰 중 after 다음(주소 순서) 40대에 보낸다. { 보낸 수, 마지막 주소 } */
async function sendBatch(env: Env, kind: string, createdAt: number, after: string, offset: number): Promise<{ n: number; last: string }> {
  const { results } = await env.DB.prepare(
    // 받는 캐릭터와 같은 사람(부캐 묶기)의 어느 캐릭터로 켠 폰이든 보낸다
    "SELECT DISTINCT s.endpoint FROM alerts a JOIN users ua ON ua.id = a.user_id " +
      "JOIN users us ON COALESCE(us.main_id, us.id) = COALESCE(ua.main_id, ua.id) JOIN push_subs s ON s.user_id = us.id " +
      "WHERE a.created_at = ?1 AND a.kind = ?2 AND s.endpoint > ?5 " +
      // 이 종류의 폰 알림을 끈 사람은 뺀다 (앱 알림함에는 그대로 남는다. 제작자 요청: 폰 알림은 따로 설정)
      "AND COALESCE((SELECT p.push FROM alert_prefs p WHERE p.user_id = a.user_id AND p.kind = ?2), 1) = 1 ORDER BY s.endpoint LIMIT ?3 OFFSET ?4",
  )
    .bind(createdAt, kind, MAX_SENDS, offset, after)
    .all<{ endpoint: string }>();
  if (!results.length) return { n: 0, last: after };
  const keys = await vapidKeys(env);
  // 같은 푸시 서버(구글, 애플 …)에는 같은 서명을 쓴다 (서명은 CPU 를 쓴다)
  const signs = new Map<string, Promise<string>>();
  const signFor = (endpoint: string) => {
    const origin = new URL(endpoint).origin;
    if (!signs.has(origin)) signs.set(origin, vapid(keys, endpoint));
    return signs.get(origin)!;
  };
  await Promise.all(results.map(async ({ endpoint }) => pushOne(env, keys, endpoint, await signFor(endpoint))));
  return { n: results.length, last: results[results.length - 1].endpoint };
}

/** 방금 만든 알림을 받은 사람들의 폰에 신호를 보낸다. 실패해도 하던 일은 그대로. 없어진 구독은 지운다.
 *  무료 요금제는 요청 하나에 바깥 요청 50개까지라 한 번에 40대까지. 더 있으면 push_queue 에 적어 두고 /api/news(쓰는 사람마다 2분마다)가 40대씩 이어 보낸다
 *  (2026-11-10 제작자 '갤럭시 아이폰 둘다 폰 자체 알림 뜨게 한 거 맞지?': 전에는 모두에게 가는 알림이 주소 순서로 앞의 40대에만 가서, 주소가 web.push.apple.com 인 아이폰이 늘 빠졌다).
 *  offset 은 예전 생일 알림 방식 (queue false). 보낸(보내려 한) 폰 수를 돌려준다 */
export async function pushNew(env: Env, kind: string, createdAt: number, offset = 0, queue = true): Promise<number> {
  try {
    const r = await sendBatch(env, kind, createdAt, "", offset);
    if (queue && r.n === MAX_SENDS) {
      await env.DB.prepare("INSERT INTO push_queue (kind, created_at, last, claimed_at) VALUES (?, ?, ?, NULL)").bind(kind, createdAt, r.last).run();
    }
    return r.n;
  } catch (e) {
    console.error("push failed", e);
    return 0;
  }
}

/** 밀린 폰 알림 40대 보내기 (/api/news 가 답한 뒤에 부른다). 한 줄을 맡아(claimed_at, 1분 지나면 다른 곳이 다시 맡는다) 보내고, 다 보냈으면 지운다 */
export async function drainPushQueue(env: Env, now = Date.now()): Promise<number> {
  const row = await env.DB.prepare(
    "UPDATE push_queue SET claimed_at = ?1 WHERE id = (SELECT id FROM push_queue WHERE claimed_at IS NULL OR claimed_at < ?2 ORDER BY id LIMIT 1) " +
      "RETURNING id, kind, created_at, last",
  )
    .bind(now, now - 60_000)
    .first<{ id: number; kind: string; created_at: number; last: string }>();
  if (!row) return 0;
  // 하루 넘게 밀린 것은 버린다 (푸시 TTL 도 하루)
  if (now - row.created_at > 86_400_000) {
    await env.DB.prepare("DELETE FROM push_queue WHERE id = ?").bind(row.id).run();
    return 0;
  }
  const r = await sendBatch(env, row.kind, row.created_at, row.last, 0);
  if (r.n < MAX_SENDS) await env.DB.prepare("DELETE FROM push_queue WHERE id = ?").bind(row.id).run();
  else await env.DB.prepare("UPDATE push_queue SET last = ?, claimed_at = NULL WHERE id = ?").bind(r.last, row.id).run();
  return r.n;
}
