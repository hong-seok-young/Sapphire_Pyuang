// 배포가 끝난 뒤에 한 번 하는 일 (.github/workflows/deploy-web.yml 'After deploy'): 새 화면·서버와 그림 글자(공식 글 그림)가 다 올라간 뒤에 해야 하는 일.
// 예: 챗봇 개선 완료 알림 (scripts/ci-d1.mjs 의 '밀가루' 처럼 배포 앞에서 보내면, 알림을 바로 누른 사람이 고치기 전 챗봇의 답을 받는다).
// 일마다 setup 키로 한 번만 한다. 공개 저장소라 실행 기록에는 개수만 찍는다 (닉네임, SQL 은 찍지 않는다).
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const DB = "sapphire-accounts";
function wrangler(...args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
const queryFirst = (sql) => parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", sql))[0]?.results?.[0];
function runSql(lines) {
  writeFileSync("after-deploy.sql", lines.join("\n") + "\n");
  try {
    wrangler("d1", "execute", DB, "--remote", "--yes", "--file=after-deploy.sql");
  } finally {
    rmSync("after-deploy.sql", { force: true });
  }
}

// 유복 님께 챗봇 개선 완료 (제작자 2026-11-06 '유물깡 … 챗봇에 이거에 대해서 물어보면 싹 정리해서 완벽하게 답해 주게 개선하고 유복님한테 개선완료 보내').
// 유물 이벤트 교환표가 공식 글 그림에만 있어서 못 읽었다 -> 그림 글자 옮기기(scripts/read-official-images.mjs)와 유물깡 은어. 위 '밀가루'와 같은 일:
// 유복 님(묶은 캐릭터 포함)의 유물·전리품·스킬북 질문 중 열린 항목을 완료로 바꾸고 '챗봇이 개선됐어요' 알림(누르면 그 대화에서 다시 묻기).
// 열린 항목이 없으면 유복 님의 가장 최근 유물 질문으로 항목을 만들어 같은 알림을, 그런 질문도 없으면 챗봇으로 가는 알림만. setup 'gap_fix_relic_20261106' 로 한 번만.
// 실행 기록에는 개수만 (닉네임은 공개 저장소 기록에 찍지 않는다)
{
  const KEY = "gap_fix_relic_20261106";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    let who = queryFirst("SELECT id FROM users WHERE id = '유복'")?.id;
    if (!who) {
      const like = parseJson(wrangler("d1", "execute", DB, "--remote", "--json", "--command", "SELECT id FROM users WHERE id LIKE '%유복%'"))[0]?.results ?? [];
      if (like.length === 1) who = like[0].id;
    }
    const now = Date.now();
    if (!who) {
      console.log("챗봇 개선 완료(유물): 받을 사람 계정을 찾지 못했어요 (앱개발자 알림)");
      runSql([
        `INSERT INTO alerts (user_id, kind, text, link, created_at) SELECT id, 'account', '유물깡 챗봇 개선 완료 알림을 보낼 유복 님 계정을 찾지 못했어요. 닉네임을 알려 주세요', '#/gaps', ${now} FROM users WHERE role = 'developer';`,
        `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
      ]);
    } else {
      const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
      const GROUP = `(SELECT u.id FROM users u WHERE u.id = ${q(who)} OR u.main_id = ${q(who)} OR u.id = (SELECT main_id FROM users WHERE id = ${q(who)}) OR u.main_id = (SELECT main_id FROM users WHERE id = ${q(who)}))`;
      const REL = (col) => `(${col} LIKE '%유물%' OR ${col} LIKE '%전리품%' OR ${col} LIKE '%글러트%' OR ${col} LIKE '%스킬북%')`;
      const OPEN = `g.status = 'open' AND g.user_id IN ${GROUP} AND (${REL("g.question")} OR ${REL("g.reason")})`;
      // 열린 항목이 없으면 가장 최근 유물 질문으로 항목을 만든다 (다시 묻기 단추가 그 질문을 찾는다)
      runSql([
        "INSERT INTO chat_gaps (user_id, thread_id, msg_id, question, answer, reason, kind, status, created_at) " +
          `SELECT t.user_id, m.thread_id, m.id, m.text, NULL, '유물깡(용사의 유물) 교환표·확률이 공식 글 그림에만 있어서 못 읽음', 'user', 'open', ${now} ` +
          `FROM chat_msgs m JOIN chat_threads t ON t.id = m.thread_id WHERE m.role = 'user' AND t.user_id IN ${GROUP} AND ${REL("m.text")} ` +
          `AND NOT EXISTS (SELECT 1 FROM chat_gaps g WHERE ${OPEN}) ORDER BY m.id DESC LIMIT 1;`,
      ]);
      const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
      const NOTE = "공식 글 그림(교환표·확률표)을 글자로 옮겨 읽고, 유물깡을 용사의 유물 이벤트로 알아듣게 고침";
      runSql([
        // 같은 사람에게 알림은 하나: 가장 최근 항목으로
        "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
          "SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · 유물깡 교환표(스킬북 포함)·확률까지 정리해서 답해요', " +
          "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
          `${now} FROM chat_gaps g WHERE g.id = (SELECT MAX(g.id) FROM chat_gaps g WHERE ${OPEN}) AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;`,
        // 물어본 적이 없으면 챗봇으로 가는 알림만
        "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
          `SELECT ${q(who)}, 'chat_fixed', '챗봇이 개선됐어요 · 유물깡(용사의 유물) 교환표(스킬북 포함)·확률·기간을 물어보면 정리해서 답해요', '#/chat', ${now} ` +
          `WHERE NOT EXISTS (SELECT 1 FROM chat_gaps g WHERE ${OPEN}) AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = ${q(who)} AND p.kind = 'chat_fixed'), 1) = 1;`,
        `UPDATE chat_gaps SET status = 'fixed', note = ${q(NOTE)}, fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
        `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
      ]);
      console.log(`챗봇 개선 완료(유물 질문) ${n}건`);
    }
  }
}
