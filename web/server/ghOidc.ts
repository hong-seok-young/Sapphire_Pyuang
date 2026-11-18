// GitHub Actions OIDC 토큰 확인 (톡방 올리기, 제작자 2026-11-18 '너가 해'): 자료 저장소(sapphire-imo-data)의 Actions 가 비밀값 없이
// GitHub 이 서명한 토큰으로 이 사이트를 부른다. 서명(RS256, GitHub 공개키 JWKS)과 저장소·브랜치·작업 파일을 본다.
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = `${ISSUER}/.well-known/jwks`;

interface Claims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  job_workflow_ref?: string;
  workflow_ref?: string;
}

let keys: { at: number; list: (JsonWebKey & { kid?: string })[] } | null = null;
async function jwks(force = false) {
  if (!force && keys && Date.now() - keys.at < 3_600_000) return keys.list;
  const res = await fetch(JWKS, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  keys = { at: Date.now(), list: ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys };
  return keys.list;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** 맞으면 claims, 아니면 null. workflow 는 '저장소/.github/workflows/파일' */
export async function verifyGithubOidc(req: Request, opt: { audience: string; repository: string; workflow: string; ref: string }): Promise<Claims | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return null;
    let jwk = (await jwks()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await jwks(true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(b64url(p))) as Claims;
    const now = Date.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss !== ISSUER || !aud.includes(opt.audience) || !c.exp || c.exp < now || (c.nbf && c.nbf > now + 60)) return null;
    if (c.repository !== opt.repository || c.ref !== opt.ref) return null;
    if (!(c.workflow_ref ?? "").startsWith(`${opt.workflow}@`)) return null;
    return c;
  } catch {
    return null;
  }
}
