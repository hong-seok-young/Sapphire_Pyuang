// 둘째 Cloudflare 계정의 사용 기록 DB (제작자 2026-11-14 '사용 기록 쪽에서 쓰는 건 새로운 계정으로 옮겨').
// 계정이 다르면 Pages 가 D1 에 바로 붙지 못해서 그 계정의 일꾼(web/logworker)을 HTTP 로 부른다. 여기서는 D1Database 처럼 보이게 감싸서
// server/logdb.ts 와 사용 기록을 읽는 곳(activity, actDash, chatapp)이 그대로 쓴다: prepare().bind().all() / first() / run(), batch().
// 주소 LOG_REMOTE_URL, 열쇠 LOG_REMOTE_KEY 는 자동 배포가 Pages 비밀값으로 넣는다 (.github/workflows/deploy-web.yml 'Log worker'). 없으면 쓰지 않는다.
import type { Env } from "./auth";

type Sent = { sql: string; params: unknown[] };

class RemoteStmt {
  constructor(
    private db: RemoteD1,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]): RemoteStmt {
    return new RemoteStmt(this.db, this.sql, params.map((p) => (p === undefined ? null : p)));
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return (await this.db.send([this]))[0] as D1Result<T>;
  }
  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>();
  }
  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    return (col ? (row[col] ?? null) : row) as T | null;
  }
  async raw<T = unknown[]>(): Promise<T[]> {
    return (await this.all<Record<string, unknown>>()).results.map((r) => Object.values(r)) as T[];
  }
  toJSON(): Sent {
    return { sql: this.sql, params: this.params };
  }
}

export class RemoteD1 {
  constructor(
    private url: string,
    private key: string,
  ) {}
  prepare(sql: string): RemoteStmt {
    return new RemoteStmt(this, sql);
  }
  batch<T = Record<string, unknown>>(stmts: RemoteStmt[]): Promise<D1Result<T>[]> {
    return this.send(stmts) as Promise<D1Result<T>[]>;
  }
  async exec(sql: string) {
    await this.send([this.prepare(sql)]);
    return { count: 1, duration: 0 };
  }
  async send(stmts: RemoteStmt[]): Promise<D1Result[]> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-log-key": this.key },
      body: JSON.stringify({ batch: stmts }),
    });
    if (!res.ok) throw new Error(`사용 기록 일꾼 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as D1Result[];
  }
}

let memo: { id: string; db: D1Database } | null = null;

/** 둘째 계정의 사용 기록 DB (설정이 없으면 undefined) */
export function remoteLog(env: Env): D1Database | undefined {
  const e = env as unknown as { LOG_REMOTE_URL?: string; LOG_REMOTE_KEY?: string };
  if (!e.LOG_REMOTE_URL || !e.LOG_REMOTE_KEY) return undefined;
  const id = e.LOG_REMOTE_URL + "\n" + e.LOG_REMOTE_KEY;
  if (memo?.id !== id) memo = { id, db: new RemoteD1(e.LOG_REMOTE_URL, e.LOG_REMOTE_KEY) as unknown as D1Database };
  return memo.db;
}
