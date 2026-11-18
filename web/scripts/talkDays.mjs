// 카카오톡 대화 내보내기 글을 날짜마다 나눈다 (톡방 올리기 = 자료 저장소 scripts/talk_import.mjs 에 같은 파일, 고치면 둘 다, 챗봇 자료 scripts/library-sync.mjs 가 같이 쓴다).
// 폰 내보내기: '2026년 10월 13일 오전 8:43, 닉네임 : 글' (날짜 줄 '2026년 10월 13일 오전 8:43' 도), PC 내보내기: '--------------- 2026년 11월 10일 월요일 ---------------' 아래 '[닉네임] [오전 2:44] 글'.
// 시세 동향(build_trend.py)의 날짜 읽기와 같다: 같은 방 파일이 여럿이면 날짜마다 가장 새 파일의 글만 쓴다.
const DAY_PC = /^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+요일 -+$/;
const DAY_PHONE = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (?:오전|오후) \d{1,2}:\d{2}/;
const MSG_PC = /^\[.+?\] \[(?:오전|오후) \d{1,2}:\d{2}\]/;
const MSG_PHONE = /^\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}, .+? : /;
const ROOM = /^﻿?(.+?) (?:\d+ )?님과 카카오톡 대화/;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 글 -> { header: 날짜 앞 줄들, blocks: [{ day, lines }] } (날짜가 바뀔 때마다 새 덩어리) */
export function splitDays(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const header = [];
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(DAY_PC) ?? line.match(DAY_PHONE);
    const day = m ? iso(m[1], m[2], m[3]) : null;
    if (day && (!cur || cur.day !== day)) {
      cur = { day, lines: [] };
      blocks.push(cur);
    }
    if (cur) cur.lines.push(line);
    else header.push(line);
  }
  return { header, blocks };
}

/** 글 줄 중 메시지 수 */
export const messageCount = (lines) => lines.filter((l) => MSG_PC.test(l) || MSG_PHONE.test(l)).length;

/** 방 이름 (첫 줄 '❤️시리온거래톡방❤️ 405 님과 카카오톡 대화' -> '❤️시리온거래톡방❤️', 사람 수는 뺀다) */
export function roomTitle(text) {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return (first.match(ROOM)?.[1] ?? "").trim();
}

/**
 * 같은 방의 여러 파일 [{ date, text }] -> 날짜마다 가장 새 파일의 글만 이어 붙인 글 (머리는 가장 새 파일 것).
 * 톡방 올리기는 앞 파일 이후 날짜만 새 파일로 더하므로, 챗봇 자료는 이것으로 한 방을 한 글로 본다
 */
export function mergeRoom(files) {
  const newest = [...files].sort((a, b) => (a.date < b.date ? 1 : -1));
  const taken = new Map();
  for (const f of newest) for (const b of splitDays(f.text).blocks) if (!taken.has(b.day)) taken.set(b.day, b.lines);
  const head = splitDays(newest[0]?.text ?? "").header;
  return [...head, ...[...taken.keys()].sort().flatMap((d) => taken.get(d))].join("\n");
}
