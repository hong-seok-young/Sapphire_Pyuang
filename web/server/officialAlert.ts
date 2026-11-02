// 아이모 소식 새 글 알림 (제작자 요청 2026-11-02: '새 이벤트 수집했으니 게시판 배지 다시 띄워 줘, 웹 알림도 띄워야 함').
// 공식 글은 여러 곳에서 들어온다 (GitHub Actions·배포의 fetch-official.mjs, 서버의 refreshMaint·refreshEvents). 어디서 들어왔든
// 우리 표에 처음 들어온 때(official_news.added_at)가 지난번 알린 때(setup 'official_announced') 뒤인 글을 /api/news 가 찾아 여기서 모두에게 한 번 알린다.
// 한국 PC 파일로 늦게 들어온 예전 글은 올린 날이 최근 3일 안인 것만 (새 글 배지와 같은 기준). 공식 홈페이지 글일 뿐 게임은 읽지 않는다.
import type { Env } from "./auth";
import { notify } from "./alerts";

const TYPE_NAME: Record<string, string> = { N: "공지사항", I: "안내", D: "오류", C: "점검", E: "이벤트" };
/** 한 번에 이보다 많으면 한 알림으로 묶는다 (패치 날 이벤트 글이 한꺼번에 올라와도 알림이 줄줄이 오지 않게) */
const MAX_EACH = 3;

export interface NewOfficial {
  id: number;
  type: string;
  title: string;
  added_at: number;
  /** 지난번 알린 때 */
  mark: number;
}

/** /api/news 의 묶음 쿼리에 넣는 문장: 알릴 새 글 (?1 = 이 날 이후에 올린 글만, 'YYYY-MM-DD') */
export const NEW_OFFICIAL_SQL =
  "SELECT n.id AS id, n.type AS type, n.title AS title, n.added_at AS added_at, s.done_at AS mark FROM setup s " +
  "JOIN official_news n ON n.added_at > s.done_at WHERE s.key = 'official_announced' AND (n.start_date IS NULL OR n.start_date >= ?1) " +
  "ORDER BY n.added_at, n.id LIMIT 20";

/** 새 글을 알린다. 여럿이 같이 와도 지난번 알린 때를 먼저 바꾼 한 곳만 보낸다 */
export async function announceOfficial(env: Env, rows: NewOfficial[]): Promise<void> {
  if (!rows.length) return;
  const mark = rows[0].mark;
  const last = Math.max(...rows.map((r) => r.added_at));
  const took = await env.DB.prepare("UPDATE setup SET done_at = ? WHERE key = 'official_announced' AND done_at = ?").bind(last, mark).run();
  if (!took.meta.changes) return;
  const line = (r: NewOfficial) => `[${TYPE_NAME[r.type] ?? "공지"}] ${r.title}`;
  if (rows.length > MAX_EACH) {
    await notify(env, "all", "imo_news", `새 글 ${rows.length}개 · ${line(rows[0])} 외`, "#/board?cat=imo&t=all", "");
    return;
  }
  for (const r of rows) await notify(env, "all", "imo_news", line(r), `#/official/${r.id}`, "");
}
