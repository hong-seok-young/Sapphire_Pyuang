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

interface Keys {
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

/** 방금 만든 알림을 받은 사람들의 폰에 신호를 보낸다. 실패해도 하던 일은 그대로. 없어진 구독은 지운다 */
export async function pushNew(env: Env, kind: string, createdAt: number): Promise<void> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT s.endpoint FROM push_subs s JOIN alerts a ON a.user_id = s.user_id WHERE a.created_at = ?1 AND a.kind = ?2 " +
        // 이 종류의 폰 알림을 끈 사람은 뺀다 (앱 알림함에는 그대로 남는다. 제작자 요청: 폰 알림은 따로 설정)
        "AND COALESCE((SELECT p.push FROM alert_prefs p WHERE p.user_id = s.user_id AND p.kind = ?2), 1) = 1 LIMIT ?3",
    )
      .bind(createdAt, kind, MAX_SENDS)
      .all<{ endpoint: string }>();
    if (!results.length) return;
    const keys = await vapidKeys(env);
    await Promise.all(
      results.map(async ({ endpoint }) => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { TTL: "86400", Urgency: "normal", Authorization: await vapid(keys, endpoint), "Content-Length": "0" },
            signal: AbortSignal.timeout(5000),
          });
          if (res.status === 404 || res.status === 410) {
            await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
          }
        } catch {
          // 이 폰은 다음에
        }
      }),
    );
  } catch (e) {
    console.error("push failed", e);
  }
}
