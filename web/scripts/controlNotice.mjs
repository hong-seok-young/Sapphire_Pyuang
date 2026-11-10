// 시리온 통제 리스트 공지 (제작자 2026-11-10 '우리 길드는 중립길드야, 이 몹들을 잡으면 안 되는 통제 리스트, 길드의 공지사항에 넣어줘, 글쓴이는 사파이어로').
// 비공개 자료 길드/통제_리스트.json (표를 옮긴 것)과 이미지/길드/통제_리스트_시리온.webp (표 그림, 제작 니노)로 공지사항 글 하나와 그림 첨부, 모두에게 알림을 넣는 SQL.
// scripts/ci-d1.mjs 가 setup 'control_notice_20261110' 로 한 번 부른다. 그림은 D1 의 SQL 한 줄 한도(100KB) 때문에 조각으로 나눠 이어 붙인다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTROL_KEY = "control_notice_20261110";
export const CONTROL_AUTHOR = "사파이어";
export const CONTROL_TITLE = "시리온 통제 리스트 (중립 길드 · 잡지 않는 몹)";
const CHUNK = 40_000;

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export function controlBody(list) {
  const lines = ["우리 길드는 중립 길드예요. 아래 몹은 잡지 않아요.", ""];
  for (const g of list["목록"]) {
    lines.push(`■ ${g["곳"]}${g["표시"] ? " · " + g["표시"] : ""}`);
    for (const m of g["몹"]) lines.push(`- ${m}`);
    lines.push("");
  }
  lines.push(`표 제작: ${list["제작"]} · 수정 ${String(list["수정"]).replace(/-/g, "/")}`);
  return lines.join("\n");
}

/** 자료 폴더(…/자료)에서 공지 SQL 줄들. 자료가 없으면 null */
export function controlNoticeSql(dataDir, now) {
  const jsonPath = join(dataDir, "길드", "통제_리스트.json");
  if (!existsSync(jsonPath)) return null;
  const list = JSON.parse(readFileSync(jsonPath, "utf8"));
  const post = `(SELECT MAX(id) FROM board_posts WHERE cat = 'notice' AND title = ${q(CONTROL_TITLE)} AND author = ${q(CONTROL_AUTHOR)})`;
  const lines = [
    `INSERT INTO board_posts (cat, author, title, body, pinned, created_at) VALUES ('notice', ${q(CONTROL_AUTHOR)}, ${q(CONTROL_TITLE)}, ${q(controlBody(list))}, 1, ${now});`,
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
