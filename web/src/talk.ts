// 톡방 올리기 (제작자 2026-11-18): 카톡 '대화 내보내기' 글을 읽어 보이고 gzip 으로 서버에 보낸다 (server/talkUpload.ts).
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

/** zip 안의 .txt 하나 (카톡이 압축해서 줄 때). 압축 없음(0)·deflate(8)만 */
async function txtFromZip(buf: ArrayBuffer): Promise<{ name: string; bytes: Uint8Array } | null> {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
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
    if (method === 0) return { name, bytes: raw };
    if (method === 8) {
      const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return { name, bytes: new Uint8Array(out) };
    }
  }
  return null;
}

/** 고른 파일·공유로 받은 파일 -> 글 (zip 이면 안의 txt) */
export async function fileText(name: string, blob: Blob): Promise<{ name: string; text: string } | null> {
  const buf = await blob.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const t = await txtFromZip(buf);
    return t ? { name: t.name.split("/").pop() ?? t.name, text: new TextDecoder().decode(t.bytes) } : null;
  }
  return { name, text: new TextDecoder().decode(b) };
}

/** 공유로 받아 서비스 워커가 넣어 둔 파일 (public/sw.js). 읽으면 지운다 */
export async function takeShared(): Promise<{ name: string; blob: Blob } | null> {
  if (!("caches" in window)) return null;
  const cache = await caches.open("sapphire-share");
  const keys = await cache.keys();
  for (const k of keys) {
    const res = await cache.match(k);
    await cache.delete(k);
    if (!res) continue;
    let name = "talk.txt";
    try {
      name = decodeURIComponent(res.headers.get("x-name") ?? name);
    } catch {
      /* 그대로 */
    }
    return { name, blob: await res.blob() };
  }
  return null;
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
