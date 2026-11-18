// 톡방 올리기 (제작자 2026-11-18): 카톡 '대화 내보내기'로 폰에 저장한 글(여러 개)을 읽어 보이고 gzip 으로 서버에 보낸다 (server/talkUpload.ts).
// 자료 저장소에 더하는 일은 자료 저장소(sapphire-imo-data)의 Actions(talk-import.yml, scripts/talk_import.mjs) (같은 날짜 읽기 규칙, scripts/talkDays.mjs)
import { api } from "./auth";

export interface TalkFile {
  name: string;
  text: string;
  /** 방 이름 (글 첫 줄 '… 님과 카카오톡 대화') */
  title: string;
  first: string | null;
  last: string | null;
  /** 글(메시지) 수 */
  lines: number;
  size: number;
}
export interface TalkUploadRow {
  id: number;
  user_id: string;
  name: string | null;
  title: string | null;
  size: number;
  first_day: string | null;
  last_day: string | null;
  lines: number | null;
  status: "wait" | "done" | "same" | "fail";
  note: string | null;
  created_at: number;
  done_at: number | null;
}

const ROOM = /^﻿?(.+?) (?:\d+ )?님과 카카오톡 대화/;
const DAY_PC = /^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+요일 -+$/;
const DAY_PHONE = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (?:오전|오후) \d{1,2}:\d{2}/;
const MSG_PC = /^\[.+?\] \[(?:오전|오후) \d{1,2}:\d{2}\]/;
const MSG_PHONE = /^\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}, .+? : /;
const iso = (y: string, m: string, d: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

/** 내보낸 글 -> 방 이름, 처음·마지막 날짜, 글 수. 카톡 내보내기 글이 아니면 null */
export function readTalk(name: string, text: string): TalkFile | null {
  const lines = text.split(/\r?\n/);
  const title = (lines[0]?.match(ROOM)?.[1] ?? "").trim();
  let first: string | null = null;
  let last: string | null = null;
  let n = 0;
  for (const line of lines) {
    const d = line.match(DAY_PC) ?? line.match(DAY_PHONE);
    if (d) {
      const day = iso(d[1], d[2], d[3]);
      first ??= day;
      last = day;
    }
    if (MSG_PC.test(line) || MSG_PHONE.test(line)) n++;
  }
  if (!title || !first) return null;
  return { name, text, title, first, last, lines: n, size: new Blob([text]).size };
}

/** zip 안의 .txt 모두 (카톡이 압축해서 줄 때). 압축 없음(0)·deflate(8)만 */
async function txtFromZip(buf: ArrayBuffer): Promise<{ name: string; bytes: Uint8Array }[]> {
  const out: { name: string; bytes: Uint8Array }[] = [];
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return out;
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count && v.getUint32(at, true) === 0x02014b50; k++) {
    const method = v.getUint16(at + 10, true);
    const csize = v.getUint32(at + 20, true);
    const nlen = v.getUint16(at + 28, true);
    const xlen = v.getUint16(at + 30, true);
    const clen = v.getUint16(at + 32, true);
    const off = v.getUint32(at + 42, true);
    const name = dec.decode(new Uint8Array(buf, at + 46, nlen));
    at += 46 + nlen + xlen + clen;
    if (!/\.txt$/i.test(name)) continue;
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = new Uint8Array(buf, start, csize);
    if (method === 0) out.push({ name, bytes: raw });
    else if (method === 8) {
      const ab = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      out.push({ name, bytes: new Uint8Array(ab) });
    }
  }
  return out;
}

/** 고른 파일 -> 글들 (zip 이면 안의 txt 모두) */
export async function fileTexts(name: string, blob: Blob): Promise<{ name: string; text: string }[]> {
  const buf = await blob.arrayBuffer();
  const b = new Uint8Array(buf);
  const dec = new TextDecoder();
  if (b[0] === 0x50 && b[1] === 0x4b)
    return (await txtFromZip(buf)).map((t) => ({ name: t.name.split("/").pop() ?? t.name, text: dec.decode(t.bytes) }));
  return [{ name, text: dec.decode(b) }];
}

/** 같은 방이 여럿이면 하나만 (마지막 날짜가 늦은 것, 같으면 글이 많은 것) */
export function oneEachRoom(files: TalkFile[]): TalkFile[] {
  const by = new Map<string, TalkFile>();
  for (const f of files) {
    const o = by.get(f.title);
    if (!o || (f.last ?? "") > (o.last ?? "") || ((f.last ?? "") === (o.last ?? "") && f.lines > o.lines)) by.set(f.title, f);
  }
  return [...by.values()];
}

/** 서버로 (gzip) */
export async function uploadTalk(f: TalkFile): Promise<number> {
  const gz = await new Response(new Blob([f.text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const res = await fetch("/api/talk-upload", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/gzip",
      "x-file-name": encodeURIComponent(f.name),
      "x-title": encodeURIComponent(f.title),
      "x-first": f.first ?? "",
      "x-last": f.last ?? "",
      "x-lines": String(f.lines),
      "x-size": String(f.size),
    },
    body: gz,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
  if (!res.ok) throw new Error(data.error ?? `올리지 못했어요 (${res.status})`);
  return data.id ?? 0;
}

export const listTalkUploads = () => api<{ uploads: TalkUploadRow[] }>("/api/talk-upload");
