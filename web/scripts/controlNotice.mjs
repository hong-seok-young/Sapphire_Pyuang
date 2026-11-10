// 시리온 통제 리스트 공지 (제작자 2026-11-10 '우리 길드는 중립길드야, 이 몹들을 잡으면 안 되는 통제 리스트, 길드의 공지사항에 넣어줘, 글쓴이는 사파이어로').
// 비공개 자료 길드/통제_리스트.json (표를 옮긴 것)과 이미지/길드/통제_리스트_시리온.webp (표 그림, 제작 니노)로 공지사항 글 하나와 그림 첨부, 모두에게 알림을 넣는 SQL.
// scripts/ci-d1.mjs 가 setup 'control_notice_20261110' 로 한 번 부른다. 그림은 D1 의 SQL 한 줄 한도(100KB) 때문에 조각으로 나눠 이어 붙인다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTROL_KEY = "control_notice_20261110";
export const CONTROL_AUTHOR = "사파이어";
export const CONTROL_TITLE = "시리온 통제 리스트";
/** 처음 올린 글의 제목 (본문·제목을 바꿀 때 이 글을 찾는다) */
const FIRST_TITLE = "시리온 통제 리스트 (중립 길드 · 잡지 않는 몹)";
const CHUNK = 40_000;

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export const CONTROL_CARD_KEY = "control_notice_card2_20261110";

/** 본문의 '[[통제 리스트]]' 줄은 화면이 앱 모양의 통제 리스트 칸으로 그린다 (src/pages/Control.tsx, 자료는 meta.json control).
 * 제작자 2026-11-10 '그림 저대로 올리는 것도 좋지만 앱 스타일대로 이쁘게', '이미지도 우리 DB 에서 써도 돼'. 아래 첨부 그림은 원본 표 */
// 제작자 2026-11-10 '우리 길드는 중립이에요 ~ 이 문장 빼 버려', '아래 통제 리스트를 숙지하시기 바란다고만 해'
export function controlBody() {
  return ["아래 통제 리스트를 숙지하시기 바랍니다.", "", "[[통제 리스트]]"].join("\n");
}

/** 이미 올라간 공지 글의 제목·본문을 바꾸는 SQL (setup CONTROL_CARD_KEY 로 한 번) */
export function controlCardSql(dataDir, now) {
  if (!existsSync(join(dataDir, "길드", "통제_리스트.json"))) return null;
  return [
    `UPDATE board_posts SET title = ${q(CONTROL_TITLE)}, body = ${q(controlBody())} WHERE cat = 'notice' AND title IN (${q(FIRST_TITLE)}, ${q(CONTROL_TITLE)}) AND author = ${q(CONTROL_AUTHOR)};`,
    `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('${CONTROL_CARD_KEY}', ${now});`,
  ];
}

/** 자료 폴더(…/자료)에서 공지 SQL 줄들. 자료가 없으면 null */
export function controlNoticeSql(dataDir, now) {
  const jsonPath = join(dataDir, "길드", "통제_리스트.json");
  if (!existsSync(jsonPath)) return null;
  const list = JSON.parse(readFileSync(jsonPath, "utf8"));
  const post = `(SELECT MAX(id) FROM board_posts WHERE cat = 'notice' AND title = ${q(CONTROL_TITLE)} AND author = ${q(CONTROL_AUTHOR)})`;
  const lines = [
    `INSERT INTO board_posts (cat, author, title, body, pinned, created_at) VALUES ('notice', ${q(CONTROL_AUTHOR)}, ${q(CONTROL_TITLE)}, ${q(controlBody())}, 1, ${now});`,
  ];
  const picPath = join(dataDir, list["그림"] ?? "");
  if (list["그림"] && existsSync(picPath)) {
    const bytes = readFileSync(picPath);
    const name = "시리온_통제_리스트.webp";
    lines.push(
      `INSERT INTO board_files (post_id, name, type, size, image, data, created_at) VALUES (${post}, ${q(name)}, 'image/webp', ${bytes.length}, 1, X'', ${now});`,
    );
    const file = `(SELECT MAX(id) FROM board_files WHERE post_id = ${post} AND name = ${q(name)})`;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      lines.push(`UPDATE board_files SET data = CAST(data || X'${bytes.subarray(i, i + CHUNK).toString("hex")}' AS BLOB) WHERE id = ${file};`);
    }
  }
  // 모두에게 (사람마다 본캐 한 번) 공지 알림과 폰 알림 (push_queue 를 /api/news 가 40대씩 보낸다)
  lines.push(
    `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT u.id, 'board_notice', ${q(`[공지사항] ${CONTROL_TITLE} · ${CONTROL_AUTHOR}`)}, '#/board/' || ${post}, ${now} ` +
      "FROM users u WHERE u.main_id IS NULL AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = u.id AND p.kind = 'board_notice'), 1) = 1;",
    `INSERT INTO push_queue (kind, created_at, last, claimed_at) SELECT 'board_notice', ${now}, '', NULL WHERE EXISTS (SELECT 1 FROM alerts WHERE kind = 'board_notice' AND created_at = ${now});`,
    `INSERT OR REPLACE INTO setup (key, done_at) VALUES ('${CONTROL_KEY}', ${now});`,
  );
  return lines;
}
