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

export interface Me {
  id: string;
  role: Role;
  mustChange: boolean;
}

export interface Account {
  id: string;
  role: Role;
  mustChange: boolean;
  createdAt: number;
  createdBy: string | null;
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
