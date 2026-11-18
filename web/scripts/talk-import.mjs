// 톡방 올리기 (제작자 2026-11-18 '올라간 파일은 깃 아이모 데이터에 쌓이게, 이전 톡방 내용 제외하고 이전 톡방 일자 이후의 것만 추가되게').
// 화면(#/talk)이 D1 talk_uploads·talk_parts 에 둔 카톡 내보내기 글을 가져와 자료 저장소 카톡/<방>_<오늘>.txt 로 더한다:
//   - 방은 글 첫 줄의 방 이름으로 이미 있는 파일과 맞춘다 (없으면 새 방).
//   - 그 방 파일들의 마지막 날짜 D 부터의 글만 넣는다 (D 는 그날 하루를 통째로 다시 넣는다: 시세 동향·챗봇은 같은 방이면 날짜마다 가장 새 파일의 글만 쓴다).
//   - 새 글이 없으면 '새 글 없음'. 같은 날 두 번 올리면 그날 파일을 고쳐 쓴다.
// 커밋·올리기 뒤 D1 상태를 done 으로 바꾸고 조각을 지우고 올린 사람에게 알림. 공개 저장소의 실행 기록이라 방 이름·글은 찍지 않고 수만 찍는다.
//   node scripts/talk-import.mjs --check        -> 기다리는 것이 있으면 GITHUB_OUTPUT 에 pending=1
//   node scripts/talk-import.mjs <자료 저장소 폴더>  -> 더하고 커밋·올리기, GITHUB_OUTPUT 에 sha
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { messageCount, roomTitle, splitDays } from "./talkDays.mjs";

const DB = "sapphire-accounts";
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const wrangler = (...args) =>
  execFileSync(process.execPath, [WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
const parseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
// 로컬 시험: TALK_LOCAL=<wrangler --persist-to 폴더>
const where = process.env.TALK_LOCAL ? ["--local", "--persist-to", process.env.TALK_LOCAL] : ["--remote"];
const query = (sql) => parseJson(wrangler("d1", "execute", DB, ...where, "--json", "--command", sql))[0]?.results ?? [];
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const output = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

// wrangler.toml 의 database_id 자리표시를 채운다 (scripts/data-watch.mjs 와 같다)
const toml = readFileSync("wrangler.toml", "utf8");
if (!process.env.TALK_LOCAL && /^database_id = "0{8}-/m.test(toml)) {
  const id = parseJson(wrangler("d1", "list", "--json")).find((d) => d.name === DB)?.uuid;
  if (!id) {
    console.log("계정 DB를 찾지 못했어요");
    process.exit(0);
  }
  writeFileSync("wrangler.toml", toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`));
}

let waiting = [];
try {
  waiting = query("SELECT id, user_id, name, title, note FROM talk_uploads WHERE status = 'wait' ORDER BY id LIMIT 5");
} catch {
  console.log("톡방 올리기: 표가 아직 없어요");
  process.exit(0);
}
if (process.argv[2] === "--check") {
  console.log(`톡방 올리기: 기다리는 것 ${waiting.length}개`);
  output("pending", waiting.length ? "1" : "0");
  process.exit(0);
}

const dataDir = process.argv[2];
const talkDir = join(dataDir, "카톡");
const kstDay = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const norm = (t) => t.replace(/\s+/g, "");
const fmt = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 이미 있는 방: 방 이름 -> 파일 이름 앞부분 */
function rooms() {
  const out = new Map();
  if (!existsSync(talkDir)) return out;
  for (const f of readdirSync(talkDir)) {
    const m = f.match(/^(.+)_(\d{4}-\d{2}-\d{2})\.txt$/);
    if (!m) continue;
    const title = roomTitle(readFileSync(join(talkDir, f), "utf8").slice(0, 400));
    if (title && !out.has(norm(title))) out.set(norm(title), m[1]);
  }
  return out;
}
const filesOf = (prefix) =>
  readdirSync(talkDir)
    .map((f) => f.match(/^(.+)_(\d{4}-\d{2}-\d{2})\.txt$/))
    .filter((m) => m && m[1] === prefix)
    .map((m) => ({ path: join(talkDir, m[0]), date: m[2] }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

const results = [];
for (const u of waiting) {
  try {
    const parts = [];
    for (let n = 0; ; n++) {
      const r = query(`SELECT hex(data) AS h FROM talk_parts WHERE upload_id = ${u.id} AND n = ${n}`)[0];
      if (!r) break;
      parts.push(Buffer.from(r.h, "hex"));
    }
    if (!parts.length) throw new Error("파일 조각이 없어요");
    const text = gunzipSync(Buffer.concat(parts)).toString("utf8");
    const title = roomTitle(text);
    if (!title) throw new Error("카톡 대화 내보내기 글이 아니에요");
    const up = splitDays(text);
    if (!up.blocks.length) throw new Error("날짜가 있는 글이 없어요");
    const prefix = rooms().get(norm(title)) ?? (title.replace(/[^가-힣A-Za-z0-9]/g, "") || "톡방");
    const target = join(talkDir, `${prefix}_${kstDay}.txt`);
    const have = existsSync(talkDir) ? filesOf(prefix) : [];
    // 그 방 파일들의 마지막 날짜와 그날 글 수 (오늘 파일도 넣어서 센다)
    let lastDay = null;
    let lastDayMsgs = 0;
    for (const f of have) {
      for (const b of splitDays(readFileSync(f.path, "utf8")).blocks)
        if (!lastDay || b.day > lastDay) {
          lastDay = b.day;
          lastDayMsgs = messageCount(b.lines);
        } else if (b.day === lastDay) lastDayMsgs = Math.max(lastDayMsgs, messageCount(b.lines));
    }
    const fresh = lastDay ? up.blocks.filter((b) => b.day >= lastDay) : up.blocks;
    const newMsgs = fresh.reduce((n, b) => n + messageCount(b.lines), 0) - (lastDay && fresh[0]?.day === lastDay ? lastDayMsgs : 0);
    if (!fresh.length || newMsgs <= 0) {
      results.push({ id: u.id, user: u.user_id, status: "same", note: `${prefix} · ${lastDay ? fmt(lastDay) : ""} 뒤 새 글 없음` });
      continue;
    }
    // 오늘 파일이 이미 있으면 그 파일의 앞 날짜 글은 두고 lastDay 부터 바꾼다
    const kept = existsSync(target) ? splitDays(readFileSync(target, "utf8")).blocks.filter((b) => lastDay && b.day < lastDay) : [];
    const body = [...up.header, ...kept.flatMap((b) => b.lines), ...fresh.flatMap((b) => b.lines)].join("\n");
    writeFileSync(target, body.endsWith("\n") ? body : body + "\n");
    results.push({
      id: u.id,
      user: u.user_id,
      status: "done",
      note: `${prefix} · ${fmt(fresh[0].day)} ~ ${fmt(fresh[fresh.length - 1].day)} · 새 글 ${newMsgs.toLocaleString("ko-KR")}`,
      file: target,
    });
  } catch (e) {
    results.push({ id: u.id, user: u.user_id, status: "fail", note: e instanceof Error ? e.message.slice(0, 80) : "읽지 못했어요" });
  }
}

// 자료 저장소에 올리기
const changed = results.filter((r) => r.status === "done");
if (changed.length) {
  const git = (...a) => execFileSync("git", ["-C", dataDir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("config", "user.name", "Sapphire 톡방 올리기");
    git("config", "user.email", "talk-import@users.noreply.github.com");
    git("add", "카톡");
    git("commit", "-m", `카톡: 톡방 올리기 ${changed.length}개 (${changed.map((r) => r.note).join(" / ")})`);
    for (let i = 0; ; i++) {
      try {
        git("push", "origin", "HEAD:main");
        break;
      } catch (e) {
        if (i >= 2) throw e;
        git("pull", "--rebase", "origin", "main");
      }
    }
    output("sha", git("rev-parse", "HEAD"));
  } catch {
    // 쓰기 권한이 없으면(저장소 비밀값 DATA_REPO_WRITE_TOKEN 이 아직 없을 때) 기다림 그대로 두고 다음 실행 때 다시 (알림은 처음 한 번만)
    for (const r of changed) {
      r.status = "wait";
      r.note = "자료 저장소에 쓰기 권한이 없어 기다리는 중 (DATA_REPO_WRITE_TOKEN)";
      r.quiet = waiting.find((u) => u.id === r.id)?.note === r.note;
    }
  }
}

const now = Date.now();
const NAME = { done: "자료 저장소에 더했어요", same: "새 글이 없어요", fail: "올리지 못했어요", wait: "아직 못 올렸어요" };
for (const r of results) {
  query(
    `UPDATE talk_uploads SET status = ${sqlStr(r.status)}, note = ${sqlStr(r.note)}, done_at = ${r.status === "wait" ? "NULL" : now} WHERE id = ${r.id}; ` +
      (r.status === "done" || r.status === "same" ? `DELETE FROM talk_parts WHERE upload_id = ${r.id}; ` : "") +
      (r.quiet ? "" : `INSERT INTO alerts (user_id, kind, text, link, created_at) VALUES (${sqlStr(r.user)}, 'talk_up', ${sqlStr(`[톡방 올리기] ${NAME[r.status]} · ${r.note}`)}, '#/talk', ${now});`),
  );
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`톡방 올리기: 더함 ${count("done")} · 새 글 없음 ${count("same")} · 실패 ${count("fail")} · 권한 없어 기다림 ${count("wait")}`);
