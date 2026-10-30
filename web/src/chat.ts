// 챗봇: 질문에 맞는 위키 자료 고르기, 고른 스샷 줄이기, /api/chat 부르기 (서버는 functions/api/chat.ts).
// 위키 자료는 이미 화면에 받아 둔 것에서 고른다. 서버는 길이만 자르고 질문 앞에 붙인다.
import type { Block, Post, Run, Wiki } from "./types";
import { search } from "./search";
import { levelText } from "./ui";

export interface ChatImage {
  type: string;
  data: string; // base64 ("data:" 머리 없이)
}
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
}

/** 위키 자료 전체 글자 수 (서버도 12000 자에서 자른다) */
const MAX_CONTEXT = 11000;
/** 글 하나(육성 공략, 사냥터 원글 등)에서 가져올 글자 수 */
const MAX_POST = 2500;
/** 답 글 뒤에 붙는 알림의 시작 글자 (functions/api/chat.ts 와 같아야 한다) */
const CONTROL = "\u001e";

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 원글 칸을 글자로 */
function blockText(b: Block): string {
  const runs = (rs: Run[]) => rs.map((r) => ("t" in r ? r.t : "")).join("");
  if (b.k === "p") return runs(b.r).trim();
  return b.rows
    .map((row) => row.map((c) => c.l.map((line) => runs(line).trim()).filter(Boolean).join(" / ")).filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");
}

function postText(post: Post, blocks?: number[]): string {
  const list = blocks ? blocks.map((i) => post.blocks[i]).filter(Boolean) : post.blocks;
  return list.map(blockText).filter(Boolean).join("\n").slice(0, MAX_POST);
}

/** 질문 낱말 (두 글자 이상) */
function words(q: string): string[] {
  return q.split(/[\s,.?!~·()[\]"'“”‘’]+/).map((w) => w.replace(/(은|는|이|가|을|를|에|에서|으로|로|랑|하고|의|도|만)$/, "")).filter((w) => w.length >= 2);
}

/**
 * 질문에 맞는 위키 자료를 짧은 글로 만든다.
 * 질문에 이름이 나온 아이템, 몬스터, 사냥터 → 없으면 낱말로 검색 → 제목이 맞는 글(육성 공략 등) → 사냥터 목록 순서로 채운다.
 */
export function wikiContext(wiki: Wiki, posts: Record<string, Post> | undefined, question: string): string {
  const q = norm(question);
  const parts: string[] = [];
  const add = (s: string) => {
    if (s && parts.join("\n").length + s.length < MAX_CONTEXT) parts.push(s);
  };

  // 1. 질문에 이름이 그대로 나온 것 (긴 이름부터, 짧은 이름이 긴 이름 안에 든 경우는 뺀다)
  const names: { kind: "item" | "monster" | "place"; name: string; id?: string }[] = [];
  for (const name of Object.keys(wiki.items)) if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "item", name });
  for (const name of new Set(Object.values(wiki.monsters).map((m) => m.name)))
    if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "monster", name });
  for (const p of Object.values(wiki.places))
    if (p.name.length >= 2 && q.includes(norm(p.name))) names.push({ kind: "place", name: p.name, id: p.id });
  names.sort((a, b) => b.name.length - a.name.length);
  const picked = names.filter((n, i) => !names.slice(0, i).some((m) => norm(m.name).includes(norm(n.name)))).slice(0, 8);

  // 2. 없으면 질문 낱말로 검색해서 맞는 것 몇 개
  if (!picked.length) {
    for (const w of words(question)) {
      for (const h of search(wiki, w, 3)) {
        if (picked.length >= 6 || picked.some((p) => p.kind === h.kind && p.name === h.name)) continue;
        picked.push({ kind: h.kind, name: h.name, id: h.kind === "place" ? h.to.split("/").pop() : undefined });
      }
    }
  }

  for (const n of picked) {
    if (n.kind === "monster") {
      for (const m of Object.values(wiki.monsters).filter((x) => x.name === n.name)) {
        const place = wiki.places[m.place];
        add(
          [
            `[몬스터] ${m.name}` + (m.level ? ` Lv.${m.level}` : "") + (m.hp ? ` HP ${m.hp}` : ""),
            place && `사냥터 ${place.name}(${place.region})`,
            m.respawn && `재부활 ${m.respawn}`,
            m.traits,
            m.drops.length && `드랍: ${m.drops.join(", ")}`,
            m.skill && `스킬: ${m.skill}`,
            m.note && `참고: ${m.note}`,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } else if (n.kind === "item") {
      const it = wiki.items[n.name];
      const from = it.from
        .map((k) => wiki.monsters[k])
        .filter(Boolean)
        .map((m) => `${m.name}(${wiki.places[m.place]?.name ?? "?"})`);
      const equip = it.equip.map((e) => `${e.slot}: ` + Object.entries(e.info).filter(([k, v]) => v && k !== "이미지").map(([k, v]) => `${k} ${v}`).join(", "));
      add([`[아이템] ${it.name}`, from.length && `떨구는 몬스터: ${[...new Set(from)].join(", ")}`, ...equip].filter(Boolean).join(" · "));
    } else if (n.id && wiki.places[n.id]) {
      const p = wiki.places[n.id];
      const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean).map((m) => m.name + (m.level ? ` Lv.${m.level}` : ""));
      add(`[사냥터] ${p.name} (${p.region}${levelText(p.level) ? ", " + levelText(p.level) : ""}) 몬스터: ${mons.join(", ")}`);
      const post = posts?.[p.id];
      if (post) add(`[${p.name} 안내]\n` + postText(post, [...p.above, ...p.below]));
    }
  }

  // 3. 제목이 질문 낱말과 맞는 글 (육성 공략, 직업별 스킬, 조합책 등). 사냥터 글은 위에서 다뤘다
  if (posts) {
    const ws = words(question);
    const scored = wiki.menu
      .flatMap((s) => s.posts)
      .filter((p) => !wiki.places[p.id] && posts[p.id])
      .map((p) => ({ p, score: ws.filter((w) => norm(p.title).includes(norm(w))).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const { p } of scored) add(`[${p.title}]\n` + postText(posts[p.id]));
  }

  // 4. 사냥터 목록 (레벨에 맞는 사냥터를 물을 때 쓴다)
  add(
    "[사냥터 목록]\n" +
      wiki.regions
        .map((r) => `${r.name}: ` + r.places.map((id) => wiki.places[id]).filter(Boolean).map((p) => p.name + (levelText(p.level) ? `(${levelText(p.level)})` : "")).join(", "))
        .join("\n"),
  );
  return parts.join("\n\n");
}

/** 갤러리에서 고른 그림을 긴 변 1568px JPEG 로 줄인다 (Claude 가 더 크면 어차피 줄이고, 보내는 양과 비용이 준다) */
export async function shrinkImage(file: File): Promise<{ image: ChatImage; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { image: { type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) }, preview: dataUrl };
}

export interface ChatResult {
  /** 안전 필터가 거절했으면 true (그동안 받은 글은 버린다) */
  refused: boolean;
  /** 답이 길어서 잘렸으면 true */
  cut: boolean;
  /** 오늘 남은 질문 수 (서버가 알려 준 것) */
  left: number | null;
}

/** 질문을 보내고, 답 글을 받는 대로 onText 로 넘긴다. 실패하면 길드원에게 보여 줄 글로 Error 를 던진다 */
export async function askChat(turns: ChatTurn[], context: string, onText: (text: string) => void): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: turns, context }),
    });
  } catch {
    throw new Error("인터넷 연결을 확인해 주세요");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `문제가 생겼어요 (${res.status})`);
  }
  const left = res.headers.get("x-chat-left");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let all = "";
  let shown = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) all += dec.decode(value, { stream: true });
    const cut = all.indexOf(CONTROL);
    const text = cut >= 0 ? all.slice(0, cut) : all;
    if (text.length > shown) {
      onText(text.slice(shown));
      shown = text.length;
    }
    if (done) break;
  }
  const at = all.indexOf(CONTROL);
  const end = at >= 0 ? (JSON.parse(all.slice(at + 1)) as { kind: string; message?: string }) : null;
  if (end?.kind === "error") throw new Error(end.message ?? "답을 받다가 문제가 생겼어요");
  return { refused: end?.kind === "refusal", cut: end?.kind === "max_tokens", left: left === null ? null : Number(left) };
}
