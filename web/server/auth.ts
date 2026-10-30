// 길드 계정: 로그인, 세션, 권한. Cloudflare Pages Functions(functions/)가 같이 쓴다.
//
// 역할과 권한 (높은 역할이 낮은 역할의 계정을 만들고, 지우고, 비밀번호를 초기화하고, 역할을 바꾼다)
//   developer 앱개발자 (퓨앙)   : 길드마스터, 오피서, 길드원 모두
//   master    길드마스터        : 오피서 임명/해제, 오피서와 길드원 계정
//   officer   오피서            : 길드원 계정
//   member    길드원            : 없음 (자기 비밀번호만 바꾼다)
//
// 비밀번호는 원문을 저장하지 않고 PBKDF2-SHA256 해시만 저장한다.
// 세션 토큰은 쿠키에만 있고, DB 에는 토큰의 SHA-256 만 둔다.

export interface Env {
  DB: D1Database;
}

export type Role = "developer" | "master" | "officer" | "member";
export const ROLES: Role[] = ["developer", "master", "officer", "member"];
export const RANK: Record<Role, number> = { developer: 3, master: 2, officer: 1, member: 0 };

export interface User {
  id: string;
  role: Role;
  must_change: number;
}

export interface UserRow extends User {
  pw_hash: string;
  pw_salt: string;
  pw_iter: number;
}

/** Workers 무료 요금제의 요청당 CPU 시간 안에 들어가는 반복 횟수. 바꾸면 scripts/make-accounts.mjs 도 같이 */
export const PBKDF2_ITER = 10000;
const SESSION_DAYS = 30;
const COOKIE = "sid";
const enc = new TextEncoder();

// ---------- 인코딩 ----------

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64Url(buf: Uint8Array): string {
  return toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 같은 길이의 문자열을 시간 차이 없이 비교 */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- 비밀번호 ----------

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function hashPassword(password: string, salt: Uint8Array, iterations = PBKDF2_ITER): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toB64(bits);
}

export async function passwordFields(password: string): Promise<{ pw_hash: string; pw_salt: string; pw_iter: number }> {
  const salt = newSalt();
  return { pw_hash: await hashPassword(password, salt), pw_salt: toB64(salt), pw_iter: PBKDF2_ITER };
}

export async function verifyPassword(password: string, row: Pick<UserRow, "pw_hash" | "pw_salt" | "pw_iter">): Promise<boolean> {
  const hash = await hashPassword(password, fromB64(row.pw_salt), row.pw_iter);
  return sameString(hash, row.pw_hash);
}

/** 길드원에게 알려 줄 임시 비밀번호. 헷갈리는 글자(0 O 1 l I)는 뺐다 */
export function tempPassword(length = 8): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(rnd, (x) => chars[x % chars.length]).join("");
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 6 && pw.length <= 64;
}

/** 아이디는 게임 닉네임: 한글, 영문, 숫자와 _ . - 만, 20자까지 */
export function validId(id: unknown): id is string {
  return typeof id === "string" && /^[\p{L}\p{N}_.-]{1,20}$/u.test(id);
}

export function isRole(r: unknown): r is Role {
  return typeof r === "string" && (ROLES as string[]).includes(r);
}

/** actor 가 target 역할의 계정을 다룰 수 있는지 (만들기, 지우기, 초기화, 그 역할 주기) */
export function canManage(actor: Role, target: Role): boolean {
  return RANK[actor] >= 1 && RANK[actor] > RANK[target];
}

// ---------- 세션 ----------

async function sha256(s: string): Promise<string> {
  return toB64(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires)
    .run();
  return token;
}

export async function deleteSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** 로그인한 사람. 로그인 안 했거나 세션이 끝났으면 null */
export async function currentUser(env: Env, request: Request): Promise<User | null> {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, u.must_change AS must_change, s.expires_at AS expires_at " +
      "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  )
    .bind(await sha256(token))
    .first<User & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, role: row.role, must_change: row.must_change };
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ---------- 응답 ----------

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const NEED_LOGIN = () => json({ error: "로그인해 주세요" }, 401);
export const FORBIDDEN = () => json({ error: "권한이 없어요" }, 403);

/** 주소의 :id. Pages Functions 는 %EC%9E%84 처럼 인코딩된 채로 주므로 한글 아이디로 풀어 쓴다 */
export function paramId(params: Record<string, string | string[]>): string {
  const raw = String(params.id ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}
