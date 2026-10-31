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
  /** 챗봇(functions/api/chat.ts)이 쓰는 Claude API 키. Cloudflare Pages 비밀값 (자동 배포가 넣는다) */
  ANTHROPIC_API_KEY?: string;
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
/**
 * 로그인은 직접 로그아웃하기 전까지 이어진다. 브라우저가 쿠키를 400일보다 길게 두지 않아서(크롬)
 * 세션과 쿠키를 400일로 주고, 위키에 들어올 때마다(/api/me) 다시 400일로 늘린다 (renewSession).
 */
const SESSION_DAYS = 400;
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

/**
 * 새 계정과 비밀번호 초기화에 쓸 처음 비밀번호. 관리자가 정했으면(123123 등) 그것, 비웠으면 임시 비밀번호를 만든다.
 * 정했는데 규칙에 안 맞으면 null. 어느 쪽이든 처음 로그인하면 바꾸게 한다(must_change).
 */
export function firstPassword(chosen: unknown): string | null {
  if (chosen === undefined || chosen === null || chosen === "") return tempPassword();
  return validPassword(chosen) ? chosen : null;
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 6 && pw.length <= 64;
}

/** 아이디는 게임 닉네임: 한글, 영문, 숫자와 _ . - 만, 20자까지 */
export function validId(id: unknown): id is string {
  return typeof id === "string" && /^[\p{L}\p{N}_.-]{1,20}$/u.test(id);
}

// ---------- 직업과 레벨 (길드 랭킹) ----------

export type Job = "warrior" | "ranger" | "mage" | "monk";
export const JOBS: Job[] = ["warrior", "ranger", "mage", "monk"];
/** 레벨 범위. 아이모 만렙이 올라도 그대로 쓸 수 있게 넉넉히 */
export const MAX_LEVEL = 99;

export function isJob(j: unknown): j is Job {
  return typeof j === "string" && (JOBS as string[]).includes(j);
}

export function validLevel(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_LEVEL;
}

/**
 * 경험치 %. 게임처럼 소수점 3자리까지라 1000을 곱한 정수로 둔다 (12.345% -> 12345, 0 ~ 99999).
 * 본인만 알고 본인만 적는다 (제작자 요청). 랭킹에서 같은 레벨이면 높은 쪽이 위이고, 숫자는 본인에게만 보인다.
 */
export const EXP_MAX = 99_999;

export function validExp(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= EXP_MAX;
}

/** 길드: 1군 Sapphire(main), 2군 FairyTale(second). 둘 다 사파이어 길드원이다. 화면 web/src/auth.ts 와 같다 */
export type Guild = "main" | "second";
export const GUILDS: Guild[] = ["main", "second"];

export function isGuild(g: unknown): g is Guild {
  return g === "main" || g === "second";
}

/** 저장할 직업, 레벨과 (보냈으면) 경험치, 길드 */
export interface ProfileInput {
  job: Job;
  level: number;
  exp?: number | null;
  guild?: Guild;
}

/**
 * 직업과 레벨(과 경험치, 길드) 저장. 레벨이 바뀌면 바로 전 레벨과 바뀐 때를 남긴다.
 * exp, guild 를 안 주면(예전 화면, 오피서가 남의 경험치는 못 고침) 그대로 둔다.
 * 저장할 때마다 level_log 에 레벨과 경험치를 남긴다 (성장 랭킹). 기록이 처음이면 저장 전 상태도 먼저 남긴다.
 */
export async function saveProfile(env: Env, userId: string, by: string, p: ProfileInput): Promise<void> {
  const keepExp = p.exp === undefined;
  const keepGuild = p.guild === undefined;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO level_log (user_id, at, level, exp) SELECT user_id, level_at, level, exp FROM profiles " +
        "WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM level_log WHERE user_id = ?)",
    ).bind(userId, userId),
    env.DB.prepare(
      "INSERT INTO profiles (user_id, job, level, prev_level, level_at, updated_by, exp, guild) VALUES (?, ?, ?, NULL, ?, ?, ?, ?) " +
        "ON CONFLICT (user_id) DO UPDATE SET " +
        "prev_level = CASE WHEN excluded.level != profiles.level THEN profiles.level ELSE profiles.prev_level END, " +
        "level_at = CASE WHEN excluded.level != profiles.level THEN excluded.level_at ELSE profiles.level_at END, " +
        "job = excluded.job, level = excluded.level, updated_by = excluded.updated_by" +
        (keepExp ? "" : ", exp = excluded.exp") +
        (keepGuild ? "" : ", guild = excluded.guild"),
    ).bind(userId, p.job, p.level, now, by, keepExp ? null : p.exp, keepGuild ? null : p.guild),
    env.DB.prepare(
      "INSERT OR REPLACE INTO level_log (user_id, at, level, exp) SELECT user_id, ?, level, exp FROM profiles WHERE user_id = ?",
    ).bind(now, userId),
  ]);
}

/**
 * 화면이 보낸 { job, level, exp?, guild? } 를 검사한다. 맞지 않으면 null.
 * exp, guild 를 안 보냈으면 결과에도 없다(그대로 둔다). exp 를 비웠으면 null.
 */
export function readProfile(body: { job?: unknown; level?: unknown; exp?: unknown; guild?: unknown }): ProfileInput | null {
  if (!isJob(body.job) || !validLevel(body.level)) return null;
  const out: ProfileInput = { job: body.job, level: body.level };
  if (body.exp !== undefined) {
    if (body.exp !== null && !validExp(body.exp)) return null;
    out.exp = body.exp as number | null;
  }
  if (body.guild !== undefined) {
    if (!isGuild(body.guild)) return null;
    out.guild = body.guild;
  }
  return out;
}

/** 로그인한 사람의 정보 (/api/me, /api/login 이 같은 모양으로 준다). exp, avatar 는 본인 것이라 여기서만 준다 */
export async function meInfo(env: Env, user: User) {
  const p = await env.DB.prepare(
    "SELECT p.job AS job, p.level AS level, p.exp AS exp, p.guild AS guild, a.updated_at AS avatar FROM users u " +
      "LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN avatars a ON a.user_id = u.id WHERE u.id = ?",
  )
    .bind(user.id)
    .first<{ job: Job | null; level: number | null; exp: number | null; guild: Guild | null; avatar: number | null }>();
  return {
    id: user.id, role: user.role, mustChange: user.must_change === 1,
    job: p?.job ?? null, level: p?.level ?? null, exp: p?.exp ?? null, guild: p?.guild ?? null, avatar: p?.avatar ?? null,
  };
}

// ---------- 캐릭터 그림 (랭킹 시상대) ----------
// 길드원이 '내 정보'에서 직접 고른 자기 캐릭터 스샷을 화면에서 잘라 PNG 로 올린다.
// 앱은 화면을 찍지 않고 게임에 아무것도 보내지 않는다 (CLAUDE.md 게임 안전 규칙, 챗봇 스샷과 같은 조건).

/** 올리는 그림은 PNG, 300KB, 가로세로 640 까지 (화면이 잘라 줄여서 보낸다) */
export const AVATAR_MAX_BYTES = 300_000;
const AVATAR_MAX_SIDE = 640;

/** PNG 인지, 크기가 맞는지. 맞으면 null, 아니면 이유 */
export function checkPng(bytes: Uint8Array): string | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return "PNG 그림만 올릴 수 있어요";
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return "PNG 그림만 올릴 수 있어요";
  if (bytes.length > AVATAR_MAX_BYTES) return "그림이 너무 커요";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  if (!w || !h || w > AVATAR_MAX_SIDE || h > AVATAR_MAX_SIDE) return "그림이 너무 커요";
  return null;
}

/** D1 이 돌려준 BLOB (ArrayBuffer, 바이트 배열, 숫자 배열) -> 바이트 */
export function blobBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return Uint8Array.from(v as number[]);
}

export function isRole(r: unknown): r is Role {
  return typeof r === "string" && (ROLES as string[]).includes(r);
}

/** actor 가 target 역할의 계정을 다룰 수 있는지 (만들기, 지우기, 초기화, 그 역할 주기) */
export function canManage(actor: Role, target: Role): boolean {
  return RANK[actor] >= 1 && RANK[actor] > RANK[target];
}

/** 앱개발자가 혼자 시험할 때 바꿔 들어가는 테스트 계정 (functions/api/dev/switch.ts). 랭킹과 성장 랭킹에는 나오지 않는다 */
export const TEST_IDS = ["테스트1", "테스트2"];

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

export function readCookie(request: Request, name: string): string | null {
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
  return token ? userOfToken(env, token) : null;
}

/** 세션 토큰의 사람 (테스트 계정 전환에서 앱개발자 세션을 되돌릴 때도 쓴다) */
export async function userOfToken(env: Env, token: string): Promise<User | null> {
  const row = await env.DB.prepare(
    "SELECT u.id AS id, u.role AS role, u.must_change AS must_change, s.expires_at AS expires_at " +
      "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  )
    .bind(await sha256(token))
    .first<User & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, role: row.role, must_change: row.must_change };
}

/**
 * 로그인을 이어 준다: 세션이 끝나는 날과 쿠키를 다시 400일 뒤로 미룬다. DB 에는 하루에 한 번까지만 쓴다.
 * 늘렸으면 새 Set-Cookie 값, 아니면 null.
 */
export async function renewSession(env: Env, request: Request): Promise<string | null> {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const res = await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at < ?")
    .bind(expires, await sha256(token), expires - 86_400_000)
    .run();
  return res.meta.changes > 0 ? sessionCookie(token) : null;
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
