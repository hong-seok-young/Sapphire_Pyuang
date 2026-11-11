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

// 챗봇 개선 완료 2026-11-09 (제작자 '바로 ㄱㄱ', '개선됐어요 알림 보내'): 2026-11-09 에 열려 있던 '모름' 35건(#6 ~ #42).
// - 앱에 있는데 챗봇에 안 넘어가던 자료: 무기 강화 수치표(강화 비교), 거래 톡방 시세, 줄임말 (src/chatMarket.ts)
// - 웹 찾기: 찾기 20번·읽기 15번, 네이버·다음·구글·나무위키·카페·블로그를 다 뒤지고 참고 링크를 단다 (server/chatPrompt.ts)
// - 정해 둔 답: 마녀 버프는 길드 공지방, 월거 = 월드거래, 장비 옵션 확률은 공식 확률표
// 항목마다 '챗봇이 개선됐어요' 알림(누르면 그 대화에서 같은 질문을 다시 묻기). 앱개발자 본인 항목은 알림 없이 완료로만. setup 'gap_fix_batch_20261109'
{
  const KEY = "gap_fix_batch_20261109";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const APP = [16, 29, 26, 28, 31, 35, 23, 12, 17, 36];
    const NOTE = {
      app: "무기 강화 수치표·거래 톡방 시세·줄임말을 같이 보고, 모자라면 웹을 끝까지 찾아 링크까지 달아 답해요",
      web: "아이모 자료에 없으면 네이버·다음·구글·나무위키·카페·블로그까지 웹을 끝까지 찾아 보고 참고 링크를 달아 답해요",
      25: "마녀 버프 일정은 길드 공지방에 띄운다고 안내하고, 버프 효과는 자료·웹으로 답해요",
      13: "월거를 월드거래로 알아듣고 답해요",
      12: "월거를 월드거래로 알아듣고 답해요",
      15: "장비 옵션 확률을 공식 확률표(옵션 재설정·과거의 유물)로 계산해서 답해요",
    };
    const noteOf = (id) => NOTE[id] ?? (APP.includes(id) ? NOTE.app : NOTE.web);
    const ids = Array.from({ length: 37 }, (_, i) => i + 6); // 6 ~ 42 (열린 것만 바뀐다)
    const CASE = (col) => `CASE ${col} ${ids.map((id) => `WHEN ${id} THEN ${q(noteOf(id))}`).join(" ")} END`;
    const OPEN = `g.status = 'open' AND g.id BETWEEN 6 AND 42`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        "SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ' || " + CASE("g.id") + ", " +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') ` +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = ${CASE("id")}, fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(2026-11-09 묶음) ${n}건`);
  }
}

// 챗봇 개선 완료 2026-11-10 (제작자 '힘 vs 크리 … 챗봇 개선중에 이걸로 해결가능한거 잇으면 개선 완료 시켜'): 제작자가 알려 준 힘 vs 크리 설명
// (server/chatPrompt.ts 정해 둔 답, 자료 제공/스탯_힘크리.md)으로 풀리는 #49 '전사는 크리가 좋아 힘이 좋아?', #50 '힘은 어떤 역할을 하는지?'.
// 힘·지능 1당 수치를 묻는 #51·#64 는 수치 자료가 없어 그대로 둔다. setup 'gap_fix_str_crit_20261110'
{
  const KEY = "gap_fix_str_crit_20261110";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const NOTE = "원휩이 안 나면 힘으로 최저 데미지 보완, 원휩이 나면 크포·지속딜에 유리한 크리로 답해요";
    const OPEN = `g.status = 'open' AND g.id IN (49, 50)`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        `SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ${NOTE}', ` +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') ` +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = '${NOTE}', fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(힘 vs 크리) ${n}건`);
  }
}

// 챗봇 개선 완료 2026-11-10 (제작자 '챗봇 개선중에 … 해결가능한거 잇으면 개선 완료 시켜'): 같은 날 자료 저장소에 넣은 자료로 풀리는 질문.
// 해외 팬 위키 imotwom.fandom.com 한국어 번역 4,637개(fandom/ko), 아이모 초보자도움방 카톡 정리(제공/초보자톡방_정리.md)와 톡방 링크(링크/: 조합책 리메이크, 블로그 레벨별 사냥터).
// 챗봇은 이 배포의 'Data library (chatbot)' 단계가 넣은 자료를 읽는다 (그래서 배포 끝에서 알린다). setup 'gap_fix_library_20261110'
{
  const KEY = "gap_fix_library_20261110";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const NOTE = {
      43: "레벨별 골드 벌이(44 전 우몰, 44 뒤 루나프)와 해외 위키 돈벌이 가이드를 같이 보고 답해요",
      48: "대천사·티타늄벨트·황금목걸이 조합 재료와 강철골렘장갑 얻는 곳(해외 위키 번역)으로 답해요",
      51: "힘은 3마다 근접 데미지·받는 피해 감소, 민첩 1당 크리 0.2(해외 위키·톡방)로 답하고 정확한 공식은 없다고 말해요",
      52: "요새·미로·죽늪 몬스터와 레벨별 사냥 루트(해외 위키 번역, 톡방 링크 블로그)로 답해요",
      54: "40대 초반 이슬롯신전, 44 뒤 루나프 같은 레벨별 사냥터(초보자 톡방, 블로그 루트)로 답해요",
      55: "물약·버프 소모품 효과와 파는 곳(해외 위키 번역)으로 답해요",
      61: "인던30 침묵의 제단 보스 공략(해외 위키 번역)으로 답해요",
      63: "백색레이피어는 스미드에게 한철주괴 5·고대의피 5·세르앙의눈물로 교환(해외 위키 번역)으로 답해요",
      64: "지능은 3마다 마법 데미지·2마다 힐량(해외 위키 옛 자료)으로 답하고 정확한 공식은 없다고 말해요",
    };
    const ids = Object.keys(NOTE).map(Number);
    const CASE = (col) => `CASE ${col} ${ids.map((id) => `WHEN ${id} THEN ${q(NOTE[id])}`).join(" ")} END`;
    const OPEN = `g.status = 'open' AND g.id IN (${ids.join(", ")})`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        "SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ' || " + CASE("g.id") + ", " +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') ` +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = ${CASE("id")}, fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(자료 저장소 새 자료) ${n}건`);
  }
}

// 챗봇 개선 완료 2026-11-10 (둘째 묶음, 제작자 '챗봇 개선'): 2026-11-10 저녁에 열려 있던 '모름' 20건 중 10건 (#44 #46 #47 #56 #57 #58 #59 #60 #62 #65).
// 같은 때 다른 세션이 해외 위키 번역·초보자 톡방 자료로 9건(#43 #48 #51 #52 #54 #55 #61 #63 #64)을 위 'gap_fix_library_20261110' 로 닫았다 (열린 것만 바꾸니 겹쳐도 두 번 알리지 않는다).
// - 위키 자료 고르기 (src/chat.ts wikiContext): 사냥터·인던을 물으면 몬스터마다 레벨·HP·선공·재부활·드랍·스킬, '41레인저'·'32렙부터 36렙' 읽기, 사냥터 줄임말(요새·미로·중사·타신·인던30),
//   사냥·돈벌이 질문은 물은 사람 레벨로 근처 사냥터 자세히, 직업·레벨에 맞는 공략, 조합·제작 질문은 글의 둘레를 넓게
// - 답 받기 일꾼이 위키 자료를 25초가 아니라 120초까지 기다린다 (사진 질문·느린 폰은 자료 없이 답했다, server/chatRun.ts)
// - 코스튬 시세·랜덤 코스튬 상자 확률표, 11/10 톡방까지 다시 센 시세 (반죽망·세계껍갑·죽망), [[모름]]은 핵심을 못 답했을 때만 (드랍률 없음 같은 곁가지는 아님)
// 남긴 것: #45 (마녀 버프를 받는 조건은 자료가 없다, 앱개발자 질문). 사람·대화마다 알림은 하나(가장 최근 항목), 앱개발자 본인 항목은 알림 없이 완료로만. setup 'gap_fix_batch_20261110'
{
  const KEY = "gap_fix_batch_20261110";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const NOTE = {
      44: "사냥터를 물으면 몬스터마다 레벨·HP·선공·재부활·드랍까지 붙여 답해요",
      46: "텔레포트2는 해변 유리병 드랍, 텔레포트3은 노을숲 성숙한여우·라노스평원 까막이 드랍과 해변 우파루파토템 교환으로 답해요 (드랍률은 공개 자료 없음)",
      47: "텔레포트2는 해변 유리병 드랍, 텔레포트3은 노을숲 성숙한여우·라노스평원 까막이 드랍과 해변 우파루파토템 교환으로 답해요 (드랍률은 공개 자료 없음)",
      56: "반죽음의망토 시세를 11/10 톡방까지 힘·민첩·지능 묶음마다 답하고, 노작은 톡방에 글이 없다고 말해요",
      57: "반죽음의망토 시세를 11/10 톡방까지 힘·민첩·지능 묶음마다 답하고, 노작은 톡방에 글이 없다고 말해요",
      58: "코스튬 질문에 톡방 코스튬 시세와 공식 랜덤 코스튬 상자 확률표 8개를 붙여 답해요",
      59: "반죽음의망토 시세를 11/10 톡방까지 힘·민첩·지능 묶음마다 답하고, 노작은 톡방에 글이 없다고 말해요",
      60: "세계수껍질갑옷 시세를 11/10 톡방까지 강화별로 셌어요",
      62: "죽음의망토 시세를 11/10 톡방까지 힘·민첩·지능·체력30·노작 묶음으로 셌어요",
      65: "레벨 근처 사냥터마다 몬스터 드랍까지 붙여 답해요",
    };
    const ids = Object.keys(NOTE).map(Number);
    const IN = `(${ids.join(", ")})`;
    const CASE = (col) => `CASE ${col} ${ids.map((id) => `WHEN ${id} THEN ${q(NOTE[id])}`).join(" ")} END`;
    const OPEN = `g.status = 'open' AND g.id IN ${IN}`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      // 같은 사람의 같은 대화에는 알림 하나 (가장 최근 항목으로)
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        "SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ' || " + CASE("g.id") + ", " +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND g.id = (SELECT MAX(g2.id) FROM chat_gaps g2 WHERE g2.status = 'open' AND g2.id IN ${IN} AND g2.thread_id = g.thread_id AND g2.user_id = g.user_id) ` +
        "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') " +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = ${CASE("id")}, fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(2026-11-10 둘째 묶음) ${n}건`);
  }
}

// 챗봇 개선 완료 2026-11-11 (향단 오피서 오정보 제보, 제작자 '넣어둘게얌', '개선할거 개선하고'): #68 '닼쉴 낀 전사를 때릴 때와 전사가 법사를 공격했을 때 블락 확률'.
// 챗봇이 '전사가 마법사를 칠 때 블럭 0%에 가까움'이라고 짐작했는데, PVP 에서는 모든 직업이 물리 블락 1%·회피 4% 를 가진다 (자료 저장소 제공/블락_회피.md, server/chatPrompt.ts 정해 둔 답).
// 같은 답의 표 글자 겹침도 고쳤다 (styles.css .ans-table 첫 칸). #67(방패 강화도별 블락 증가)은 자료가 없어 그대로 둔다. setup 'gap_fix_block_20261111'
{
  const KEY = "gap_fix_block_20261111";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const NOTE = "PVP 에서는 모든 직업(마법사 포함)이 물리 블락 1%·회피 4% 라 전사가 법사를 칠 때도 블락이 뜬다고 답하고, 답의 표·단추 글자가 겹치던 것도 고쳤어요";
    const OPEN = `g.status = 'open' AND g.id = 68`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        `SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ${NOTE}', ` +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') ` +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = '${NOTE}', fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(블락) ${n}건`);
  }
}

// 챗봇 개선 완료 2026-11-11 (퓨앙 '카톡 공지방에서 공지를 해줄거임 제국 차례면'): #45 마녀 버프를 받는 조건.
// 자료 저장소 제공/마녀_버프.md, 지시문 server/chatPrompt.ts. #45 는 앱개발자가 물은 것이라 알림 없이 완료만. setup 'gap_fix_witch_20261111'
{
  const KEY = "gap_fix_witch_20261111";
  const done = queryFirst(`SELECT 1 AS d FROM setup WHERE key = '${KEY}'`)?.d;
  if (!done) {
    const now = Date.now();
    const NOTE = "마녀 버프는 제국 차례가 되면 길드 카톡 공지방에서 공지해 준다고 답해요";
    const OPEN = `g.status = 'open' AND g.id = 45`;
    const n = queryFirst(`SELECT COUNT(*) AS n FROM chat_gaps g WHERE ${OPEN}`)?.n ?? 0;
    runSql([
      "INSERT INTO alerts (user_id, kind, text, link, created_at) " +
        `SELECT g.user_id, 'chat_fixed', '챗봇이 개선됐어요. 물어봤던 “' || substr(replace(replace(g.question, char(10), ' '), char(13), ' '), 1, 40) || '” · ${NOTE}', ` +
        "CASE WHEN EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = g.thread_id AND t.user_id = g.user_id) THEN '#/chat/' || g.thread_id || '?again=' || g.id ELSE '#/chat' END, " +
        `${now} FROM chat_gaps g WHERE ${OPEN} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id AND u.role = 'developer') ` +
        "AND COALESCE((SELECT p.enabled FROM alert_prefs p WHERE p.user_id = g.user_id AND p.kind = 'chat_fixed'), 1) = 1;",
      `UPDATE chat_gaps SET status = 'fixed', note = '${NOTE}', fixed_at = ${now} WHERE id IN (SELECT g.id FROM chat_gaps g WHERE ${OPEN});`,
      `INSERT OR IGNORE INTO setup (key, done_at) VALUES ('${KEY}', ${now});`,
    ]);
    console.log(`챗봇 개선 완료(마녀 버프) ${n}건`);
  }
}
