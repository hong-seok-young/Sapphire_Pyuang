// 길드 계정: 로그인, 내 정보, 길드원 관리 (서버는 functions/api, server/auth.ts)

export type Role = "developer" | "master" | "officer" | "member";

export const ROLE_NAME: Record<Role, string> = {
  developer: "앱개발자",
  master: "길드마스터",
  officer: "오피서",
  member: "길드원",
};

export const RANK: Record<Role, number> = { developer: 3, master: 2, officer: 1, member: 0 };

/** actor 가 target 역할의 계정을 다룰 수 있는지 (서버와 같은 규칙. 화면에서 버튼을 보일지 정하는 데만 쓴다) */
export function canManage(actor: Role, target: Role): boolean {
  return RANK[actor] >= 1 && RANK[actor] > RANK[target];
}

/** 직업 (길드 랭킹). 서버 server/auth.ts 와 같다 */
export type Job = "warrior" | "ranger" | "mage" | "monk";
export const JOBS: Job[] = ["warrior", "ranger", "mage", "monk"];
export const JOB_NAME: Record<Job, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
export const MAX_LEVEL = 99;
/** 경험치 %는 1000을 곱한 정수 (12.345% -> 12345). 서버 server/auth.ts 와 같다 */
export const EXP_MAX = 99_999;

/** 12345 -> "12.345%" */
export function expText(exp: number): string {
  return (exp / 1000).toFixed(3) + "%";
}

export interface Me {
  id: string;
  role: Role;
  mustChange: boolean;
  /** 아직 안 정했으면 null: 처음 정하는 창이 뜬다 */
  job: Job | null;
  level: number | null;
  /** 경험치 % x 1000. 안 적었으면 null. 본인만 본다 */
  exp: number | null;
  /** 캐릭터 그림을 올린 때. 없으면 null */
  avatar: number | null;
}

export interface RankEntry {
  id: string;
  role: Role;
  job: Job;
  level: number;
  /** 레벨이 바뀌기 바로 전 레벨 */
  prevLevel: number | null;
  /** 레벨이 마지막으로 바뀐 때 (ms) */
  levelAt: number;
  /** 캐릭터 그림을 올린 때. 없으면 null */
  avatar: number | null;
  /** 경험치 % x 1000. 내 줄에만 온다 */
  exp?: number | null;
}

export interface Account {
  id: string;
  role: Role;
  mustChange: boolean;
  createdAt: number;
  createdBy: string | null;
  job: Job | null;
  level: number | null;
  avatar: number | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "인터넷 연결을 확인해 주세요");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `문제가 생겼어요 (${res.status})`);
  return data as T;
}

export const fetchMe = () => api<Me>("/api/me");
export const login = (id: string, password: string) => api<Me>("/api/login", "POST", { id, password });
export const logout = () => api<{ ok: boolean }>("/api/logout", "POST");
export const changePassword = (current: string, next: string) =>
  api<{ ok: boolean }>("/api/password", "POST", { current, next });

export const listAccounts = () => api<Account[]>("/api/users");
export const createAccount = (id: string, role: Role, password?: string) =>
  api<{ id: string; role: Role; tempPassword: string }>("/api/users", "POST", { id, role, password });
export const deleteAccount = (id: string) => api<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, "DELETE");
export const setRole = (id: string, role: Role) =>
  api<{ id: string; role: Role }>(`/api/users/${encodeURIComponent(id)}`, "PATCH", { role });
/** password: 관리자가 정한 처음 비밀번호. 비우면 서버가 임시 비밀번호를 만든다 */
export const resetPassword = (id: string, password?: string) =>
  api<{ id: string; tempPassword: string }>(`/api/users/${encodeURIComponent(id)}/reset`, "POST", { password });

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const saveMyProfile = (job: Job, level: number, exp: number | null) =>
  api<{ job: Job; level: number; exp: number | null }>("/api/profile", "PUT", { job, level, exp });
/** 오피서 이상: 다른 사람이 잘못 고른 직업, 레벨 고치기 */
export const saveProfileOf = (id: string, job: Job, level: number) =>
  api<{ id: string; job: Job; level: number }>(`/api/users/${encodeURIComponent(id)}/profile`, "PUT", { job, level });
export const fetchRanking = () => api<RankEntry[]>("/api/ranking");

/** 캐릭터 그림 주소. 올린 때를 붙여서 그림이 바뀌면 새로 받는다 */
export function avatarUrl(id: string, avatar: number): string {
  return `/api/avatar/${encodeURIComponent(id)}?v=${avatar}`;
}

/** 내 캐릭터 그림 올리기 (PNG). 올린 때를 돌려준다 */
export async function uploadAvatar(png: Blob): Promise<number> {
  let res: Response;
  try {
    res = await fetch("/api/avatar", { method: "PUT", credentials: "same-origin", headers: { "content-type": "image/png" }, body: png });
  } catch {
    throw new ApiError(0, "인터넷 연결을 확인해 주세요");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; avatar?: number };
  if (!res.ok || typeof data.avatar !== "number") throw new ApiError(res.status, data.error ?? `문제가 생겼어요 (${res.status})`);
  return data.avatar;
}

export const deleteMyAvatar = () => api<{ ok: boolean }>("/api/avatar", "DELETE");
/** 오피서 이상: 캐릭터가 아닌 그림이 올라왔을 때 내리기 */
export const deleteAvatarOf = (id: string) => api<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}/avatar`, "DELETE");
