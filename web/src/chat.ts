// 챗봇: 질문에 맞는 위키 자료 고르기, 고른 스샷 줄이기, /api/chat 부르기 (서버는 functions/api/chat/index.ts), 대화 기록.
// 위키 자료는 이미 화면에 받아 둔 것에서 고른다. 서버는 길이만 자르고 질문 앞에 붙인다.
import type { Block, Place, Post, Run, Wiki } from "./types";
import { api } from "./auth";
import { search } from "./search";
import { levelText } from "./ui";
import { matchedSections, oddsName } from "./odds";
import type { Odds } from "./odds";

export interface ChatImage {
  type: string;
  data: string; // base64 ("data:" 머리 없이)
}
/** 첨부 파일 (PDF 는 base64, 글 파일은 글 그대로). 서버는 내용을 저장하지 않는다 */
export interface ChatFile {
  kind: "pdf" | "text";
  name: string;
  data: string;
  size: number;
}
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  files?: ChatFile[];
}

/** 답하며 한 일 (웹 찾기, 글 읽기, 결과 거르기) */
export interface ChatStep {
  kind: "search" | "fetch" | "code";
  text: string;
}
/** 웹 출처 */
export interface ChatSource {
  url: string;
  title: string;
}

const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|xml|html?|ya?ml|ini|srt)$/i;
const MAX_PDF = 3_300_000;
const MAX_TEXT_FILE = 200_000;

/** 고른 파일을 첨부로 (PDF, 글 파일). 맞지 않으면 길드원에게 보일 글로 Error */
export async function readAttachment(file: File): Promise<ChatFile> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF) throw new Error(`${file.name}: PDF 는 3MB 까지예요`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { kind: "pdf", name: file.name, data: btoa(bin), size: file.size };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name)) {
    const text = await file.text();
    if (text.length > MAX_TEXT_FILE) throw new Error(`${file.name}: 글 파일은 20만 자까지예요`);
    return { kind: "text", name: file.name, data: text, size: file.size };
  }
  throw new Error(`${file.name}: 사진, PDF, 글 파일(txt, csv, json 등)만 올릴 수 있어요`);
}

/** 위키 자료 전체 글자 수 (서버도 16000 자에서 자른다) */
const MAX_CONTEXT = 15000;
/** 글 하나(육성 공략, 사냥터 원글 등)에서 가져올 글자 수 */
const MAX_POST = 2500;
const JOBS = ["전사", "레인저", "마법사", "무도가"];
/** 직업을 줄여 부르는 말 (챗봇 개선 2026-11-01: '35 8고봉 법사'의 '법사'를 마법사로 못 알아들었다) */
const JOB_ALIAS: [RegExp, string][] = [
  [/마법사|법사/, "마법사"],
  [/레인저|궁수/, "레인저"],
  [/무도가/, "무도가"],
  [/전사|워리어/, "전사"],
];
/** 직업 이름과 줄임말 (본문 찾기 낱말에서 뺀다) */
const JOB_WORDS = [...JOBS, "법사", "궁수", "워리어"];
const jobOf = (question: string) => JOB_ALIAS.find(([re]) => re.test(question))?.[1] ?? null;

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

/** 모든 글의 글자 (본문 찾기용, 한 번만 만든다). flat 은 띄어쓰기를 뺀 소문자 */
const textCache = new WeakMap<object, { id: string; title: string; text: string; flat: string }[]>();
function allPostTexts(wiki: Wiki, posts: Record<string, Post>) {
  let list = textCache.get(posts);
  if (!list) {
    const titles = new Map(wiki.menu.flatMap((s) => s.posts).map((p) => [p.id, p.title]));
    list = Object.entries(posts).map(([id, post]) => {
      const text = post.blocks.map(blockText).filter(Boolean).join("\n");
      // 찾은 자리를 원문과 맞추려고 띄어쓰기는 그대로 두고, 낱말 찾기만 띄어쓰기 없이 한다
      return { id, title: titles.get(id) ?? wiki.places[id]?.name ?? "글", text, flat: norm(text) };
    });
    textCache.set(posts, list);
  }
  return list;
}

/** 띄어쓰기를 뺀 글의 자리(flatAt)를 원문 자리로 */
function textPos(text: string, flatAt: number): number {
  if (flatAt <= 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    if (n === flatAt) return i;
    n++;
  }
  return 0;
}

/** 질문 낱말 (두 글자 이상) */
function words(q: string): string[] {
  return q.split(/[\s,.?!~·()[\]"'“”‘’]+/).map((w) => w.replace(/(은|는|이|가|을|를|에|에서|으로|로|랑|하고|의|도|만)$/, "")).filter((w) => w.length >= 2);
}

/** 묻는 말 (본문 찾기에 쓰지 않는다): '어디서', '사냥해', '추천해줘', '뭐가' ... */
const ASK_WORD = /^(어디|어디서|어디가|어떻게|어떤|무엇|뭐|뭐가|뭘|언제|누가|왜|좋은|좋아|추천|가면|사냥|사냥해|사냥하|사냥터|해야|해줘|알려|알려줘|있어|있나|있나요|되나|되나요|할까|하나요|가요|해요|돼|좀|지금|이제|그럼|이거|저거|이건|나|내|제)$|(해|해요|해줘|할까|하나|하나요|나요|까요|줘|요)$/;

/** 사냥터, 장비, 육성을 묻는 말. 이런 질문에서는 홀로 선 숫자를 레벨로 본다 */
const HUNT_WORD = /사냥|어디|렙업|레벨업|육성|장비|세팅|추천|스킬|퀘스트|전사|레인저|마법사|무도가|법사|궁수/;

/**
 * 질문의 레벨 ('30레벨', '30렙', 'Lv.30'). 사냥·장비를 묻는 질문이면 홀로 선 숫자도 레벨로 본다
 * (챗봇 개선 2026-11-01: '35 8고봉 법사 어디서 사냥해'의 35를 몰라 레벨에 맞는 사냥터 자료가 빠졌다. '8고봉', '1군', '100개'처럼 붙은 숫자는 아니다)
 */
function levelOf(question: string): number | null {
  const m =
    question.match(/(\d{1,3})\s*(?:레벨|렙|lv)/i) ??
    question.match(/(?:lv|레벨)\.?\s*(\d{1,3})/i) ??
    (HUNT_WORD.test(question) ? question.match(/(?:^|\s)(\d{1,2})(?=\s|$|에서|에|이면|인데|쯤|짜리)/) : null);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 200 ? n : null;
}

/** 공략 제목의 레벨 범위 ('초급 전사 육성 공략 Lv. 1～33' -> [1, 33]) */
function titleRange(title: string): [number, number] | null {
  const m = title.match(/Lv\.?\s*(\d{1,3})\s*[～~-]\s*(\d{1,3})/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 물은 사람이 스스로 적은 직업(한글)과 레벨. 질문에 없을 때 자료를 고르는 데 쓴다 */
export interface Asker {
  job: string | null;
  level: number | null;
}

/**
 * 사진 질문의 사진에서 먼저 읽은 직업, 레벨, 글자로 보이는 이름 (/api/chat/peek). 사진 속 캐릭터는 물은 사람이 적어 둔 값과
 * 다를 수 있다 (챗봇 개선 2026-11-01: 적어 둔 값은 Lv.50 인데 사진은 Lv.34 마법사라 엉뚱한 공략과 장비가 붙었다)
 */
export interface Seen {
  job: string | null;
  level: number | null;
  names: string[];
}

/** 사진에서 직업, 레벨, 이름을 먼저 읽는다. 못 읽으면 null (그러면 물은 사람의 값으로 고른다) */
export async function peekPhotos(images: ChatImage[]): Promise<Seen | null> {
  const seen = await api<Seen>("/api/chat/peek", "POST", { images }).catch(() => null);
  return seen && (seen.job || seen.level || seen.names?.length) ? seen : null;
}

export interface WikiContext {
  text: string;
  /** 화면의 '위키에서 찾음' 줄 (찾은 것 이름) */
  found: string[];
}

/**
 * 질문에 맞는 위키 자료를 짧은 글로 만든다.
 * 질문에 이름이 나온 아이템, 몬스터, 사냥터 → 레벨을 물으면 그 레벨 근처 사냥터와 직업 장비 → 없으면 낱말로 검색 →
 * 제목이 맞는 글(육성 공략 등) → 사냥터 목록 순서로 채운다.
 * 질문에 레벨이나 직업이 없으면 물은 사람의 것을 쓴다 (챗봇 개선 2026-10-31: 사진만 보낸 질문에서 레벨, 직업을 몰라
 * 맞는 공략을 못 붙였다). 레벨만 물으면 직업은 물은 사람 것, 사진만 보내면 둘 다 물은 사람 것.
 * 사진에서 먼저 읽은 값(seen)이 있으면 사진 속 캐릭터의 직업, 레벨을 먼저 쓰고, 사진에 보이는 이름도 질문 낱말처럼 찾는다.
 */
export function wikiContext(
  wiki: Wiki,
  posts: Record<string, Post> | undefined,
  question: string,
  asker?: Asker,
  photo = false,
  odds?: Odds,
  seen?: Seen,
): WikiContext {
  // 사진에서 읽은 이름도 질문 낱말처럼 쓴다 (사진만 보낸 질문은 글이 없다)
  const asked = [question, ...(seen?.names ?? [])].join(" ");
  const q = norm(asked);
  const parts: string[] = [];
  const found: string[] = [];
  const add = (s: string) => {
    if (s && parts.join("\n").length + s.length < MAX_CONTEXT) parts.push(s);
  };
  const askedLevel = levelOf(question);
  const askedJob = jobOf(question);
  const level = askedLevel ?? (photo ? (seen?.level ?? asker?.level ?? null) : null);
  const job = askedJob ?? (photo ? (seen?.job ?? asker?.job ?? null) : askedLevel !== null ? (asker?.job ?? null) : null);
  if (asker?.job || asker?.level) add(`[물은 사람] ${[asker.job, asker.level && `Lv.${asker.level}`].filter(Boolean).join(" ")} (길드원이 스스로 적은 값)`);
  if (seen) {
    const who = [seen.job, seen.level && `Lv.${seen.level}`].filter(Boolean).join(" ");
    if (who) found.push(`사진: ${who}`);
    add(`[사진에서 읽음] ${who ? `사진 속 캐릭터 ${who}` : "캐릭터 직업·레벨은 안 보임"}${seen.names.length ? ` · 보이는 이름: ${seen.names.join(", ")}` : ""} (자료는 이 값으로 골랐다)`);
  }

  // 1. 질문에 이름이 그대로 나온 것 (긴 이름부터, 짧은 이름이 긴 이름 안에 든 경우는 뺀다)
  const names: { kind: "item" | "monster" | "place"; name: string; id?: string }[] = [];
  for (const name of Object.keys(wiki.items)) if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "item", name });
  for (const name of new Set(Object.values(wiki.monsters).map((m) => m.name)))
    if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "monster", name });
  for (const p of Object.values(wiki.places))
    if (p.name.length >= 2 && q.includes(norm(p.name))) names.push({ kind: "place", name: p.name, id: p.id });
  names.sort((a, b) => b.name.length - a.name.length);
  const picked = names.filter((n, i) => !names.slice(0, i).some((m) => norm(m.name).includes(norm(n.name)))).slice(0, 8);

  // 2. 없으면 질문 낱말로 검색해서 맞는 것 몇 개 (레벨을 물으면 아래 레벨 자료로 충분하다)
  if (!picked.length && askedLevel === null) {
    for (const w of words(asked)) {
      for (const h of search(wiki, w, 3)) {
        if (picked.length >= 6 || picked.some((p) => p.kind === h.kind && p.name === h.name)) continue;
        picked.push({ kind: h.kind, name: h.name, id: h.kind === "place" ? h.to.split("/").pop() : undefined });
      }
    }
  }

  for (const n of picked) {
    found.push(n.name);
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

  // 레벨을 물으면: 그 레벨 근처 사냥터(몬스터, 장비 드랍)와 직업 장비 (제작자 요청: 답을 더 알차게)
  if (level !== null) {
    const around = Object.values(wiki.places)
      .filter((p) => p.level && p.level[0] - 3 <= level && level <= p.level[1] + 3)
      .map((p) => ({ p, gap: p.level![0] <= level && level <= p.level![1] ? 0 : Math.min(Math.abs(p.level![0] - level), Math.abs(p.level![1] - level)) }));
    // 막 들어갈 만한 곳(시작 레벨이 지금 레벨에 가까운 곳)부터
    const fromStart = (x: { p: Place }) => Math.abs(level - x.p.level![0]);
    const near = [...around].sort((a, b) => a.gap - b.gap || fromStart(a) - fromStart(b)).slice(0, 8);
    // 레벨이 딱 맞는 곳 4곳은 몬스터 드랍과 가는 길까지: 시작 레벨이 가깝고 레벨 폭이 좁은(그 레벨에 맞춘) 곳부터
    // (챗봇 개선 2026-11-01: 시작 레벨이 낮은 2곳만 골라 Lv.35 에 30~36 사막이 들고 34~40 죽늪이 빠졌다)
    const width = (x: { p: Place }) => x.p.level![1] - x.p.level![0];
    const exact = around
      .filter((x) => x.gap === 0)
      .sort((a, b) => fromStart(a) - fromStart(b) || width(a) - width(b))
      .slice(0, 4);
    if (near.length) {
      found.push(`Lv.${level} 근처 사냥터 ${near.length}곳`);
      add(
        `[레벨 ${level} 근처 사냥터]\n` +
          near
            .map(({ p }) => {
              const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
              const gear = [...new Set(mons.flatMap((m) => m.drops))].filter((d) => wiki.items[d]?.equip.length).slice(0, 8);
              return (
                `${p.name} (${p.region}, ${levelText(p.level)}) 몬스터: ` +
                mons.map((m) => m.name + (m.level ? ` Lv.${m.level}` : "")).join(", ") +
                (gear.length ? ` · 장비 드랍: ${gear.join(", ")}` : "")
              );
            })
            .join("\n"),
      );
      // 레벨이 딱 맞는 사냥터는 몬스터마다 드랍과 원글 안내까지 (챗봇 개선 2026-10-31: '정원·금서고 몬스터와 드랍 자료 없음')
      for (const { p } of exact) {
        const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
        const post = posts?.[p.id];
        add(
          `[${p.name} 자세히]\n` +
            mons.map((m) => `${m.name}${m.level ? ` Lv.${m.level}` : ""}${m.drops.length ? ` 드랍: ${m.drops.slice(0, 8).join(", ")}` : ""}`).join("\n") +
            (post ? "\n" + postText(post, [...p.above, ...p.below]).slice(0, 600) : ""),
        );
      }
    }
    if (job) {
      const gear = Object.values(wiki.items)
        .flatMap((it) => it.equip.map((e) => ({ it, e })))
        .filter(({ e }) => (e.info["직업"] === job || e.info["직업"] === "공용") && Math.abs(Number(e.info["레벨제한"]) - level) <= 5)
        .sort((a, b) => Number(b.e.info["레벨제한"]) - Number(a.e.info["레벨제한"]))
        .slice(0, 16);
      if (gear.length) {
        found.push(`${job} 장비 ${gear.length}개`);
        add(
          `[직업 장비: ${job}, Lv.${level - 5}~${level + 5}]\n` +
            gear
              .map(({ it, e }) =>
                [
                  `${it.name} (${e.slot}, Lv.${e.info["레벨제한"]})`,
                  e.info["공격"] && `공격 ${e.info["공격"]}`,
                  e.info["방어력"] && `방어 ${e.info["방어력"]}`,
                  e.info["옵션"] && `옵션 ${e.info["옵션"]}`,
                  e.info["획득처"] && `획득 ${e.info["획득처"]}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              )
              .join("\n"),
        );
      }
    }
  }

  // 3. 제목이 질문 낱말과 맞는 글 (육성 공략, 직업별 스킬, 조합책 등). 사냥터 글은 위에서 다뤘다.
  // 제목에 레벨 범위가 있는 공략(초급 Lv.1~33, 중급 34~43, 고급 44~55)은 레벨이 맞는 것만 (챗봇 개선 2026-10-31:
  // '48렙 레인저'에 초급, 중급 공략이 붙고 고급이 빠졌다)
  if (posts) {
    const ws = words(asked);
    const scored = wiki.menu
      .flatMap((s) => s.posts)
      .filter((p) => !wiki.places[p.id] && posts[p.id])
      .map((p) => {
        let score = ws.filter((w) => norm(p.title).includes(norm(w))).length;
        if (job && !askedJob && p.title.includes(job)) score++;
        const r = titleRange(p.title);
        if (r && level !== null) score = r[0] <= level && level <= r[1] ? (score > 0 ? score + 3 : 0) : -1;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, photo ? 3 : 2); // 사진 질문은 공략과 직업 스킬 글을 같이 (장비, 스킬 우선순위를 묻는 일이 많다)
    for (const { p } of scored) {
      found.push(p.title);
      add(`[${p.title}]\n` + postText(posts[p.id]));
    }

    // 3-1. 컴투스 공식 확률 (제작자 요청 2026-10-31): 확률을 묻거나, 질문의 이름(아이템, 상자, 옵션)이 공식 표에 나오면 그 표.
    // 이름이 든 섹션을 먼저, 표마다 1500자까지
    if (odds) {
      const askOdds = /확률|가챠|뽑기|상자|합성|세공|재설정|염색|퍼센트|%/.test(question);
      const terms = [...new Set([...picked.map((n) => n.name), ...ws.filter((w) => !/\d/.test(w) && !ASK_WORD.test(w) && !JOB_WORDS.includes(w) && w !== "확률")])].filter((w) => w.length >= 2);
      const scoredOdds = odds.tables
        .map((t) => {
          const name = norm(t.path.join(""));
          const nameHits = terms.filter((w) => name.includes(norm(w))).length;
          const secs = [...new Set(terms.flatMap((w) => matchedSections(t, w)))];
          return { t, secs, score: nameHits * 3 + Math.min(secs.length, 3) };
        })
        .filter((x) => x.score >= (askOdds ? 1 : 3))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      for (const { t, secs } of scoredOdds) {
        const order = [...secs, ...t.sections.map((_, i) => i).filter((i) => !secs.includes(i))];
        let body = "";
        for (const i of order) {
          const s = t.sections[i];
          const part = [s.t && `## ${s.t}`, s.d, s.c.join(" | "), ...s.r.map((r) => r.join(" | "))].filter(Boolean).join("\n");
          if (body.length + part.length > 1500) {
            if (!body) body = part.slice(0, 1500);
            break;
          }
          body += (body ? "\n" : "") + part;
        }
        found.push(`공식 확률: ${oddsName(t)}`);
        add(`[컴투스 공식 확률: ${t.path.join(" > ")}]\n${body}`);
      }
    }

    // 3-2. 제목에는 없고 본문에만 나오는 글 (제작자: '금서고 자료가 왜 없지'. 장비 획득처, 퀘스트 재료처럼 여러 글에 흩어져 있다).
    // 이름이 나온 것(아이템, 몬스터, 사냥터)과 질문 낱말 중 드문 것으로 찾아서 그 둘레만 가져온다
    // 질문 말('어디서', '사냥해')과 숫자가 든 말('48렙')로는 찾지 않는다 (챗봇 개선 2026-10-31: 상관없는 글이 끼어 사냥터 목록이 잘렸다)
    // 직업 이름도 뺀다 (직업은 위의 직업 장비와 레벨에 맞는 공략이 맡는다)
    const keys = [...new Set([...picked.map((n) => n.name), ...ws.filter((w) => !/\d/.test(w) && !ASK_WORD.test(w) && !JOB_WORDS.includes(w))])]
      .map(norm)
      .filter((k) => k.length >= 2);
    const taken = new Set([...scored.map((x) => x.p.id), ...picked.map((n) => n.id).filter(Boolean)]);
    const texts = allPostTexts(wiki, posts);
    const hits = keys
      .map((k) => ({ k, posts: texts.filter((t) => !taken.has(t.id) && t.flat.includes(k)) }))
      .filter((h) => h.posts.length > 0 && h.posts.length <= 25) // 너무 흔한 낱말은 자리를 못 짚는다
      .sort((a, b) => a.posts.length - b.posts.length);
    let more = 0;
    for (const h of hits) {
      for (const t of h.posts) {
        if (more >= 5 || taken.has(t.id)) continue;
        const at = textPos(t.text, t.flat.indexOf(h.k));
        const around = t.text.slice(Math.max(0, at - 300), at + 900);
        taken.add(t.id);
        more++;
        found.push(t.title);
        add(`[${t.title} 중에서]\n` + around);
      }
    }
  }

  // 4. 위키 메뉴 이름 (답에서 [[메뉴:이름]] 으로 보낼 수 있게)
  add("[위키 메뉴]\n" + wiki.menu.map((m) => m.title).join(", "));

  // 5. 사냥터 목록 (레벨에 맞는 사냥터를 물을 때 쓴다)
  add(
    "[사냥터 목록]\n" +
      wiki.regions
        .map((r) => `${r.name}: ` + r.places.map((id) => wiki.places[id]).filter(Boolean).map((p) => p.name + (levelText(p.level) ? `(${levelText(p.level)})` : "")).join(", "))
        .join("\n"),
  );
  return { text: parts.join("\n\n"), found };
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
  /** 안전 필터가 거절했으면 true */
  refused: boolean;
  /** 답이 길어서 잘렸으면 true */
  cut: boolean;
  /** 끝 신호(message_stop) 없이 연결이 끝났으면 true (답이 중간에서 끊김) */
  broken: boolean;
  /** 웹 찾기가 길어서 API 가 멈췄으면 true */
  paused: boolean;
  /** 멈추기를 눌렀으면 true */
  aborted: boolean;
  /** 오늘 남은 질문 수 (서버가 알려 준 것) */
  left: number | null;
}

export interface AskEvents {
  /** 서버가 답을 보내기 시작할 때: 대화 번호(새 대화면 새 번호)와 넣은 질문 번호 */
  onStart(info: { thread: number | null; msg: number | null }): void;
  /** 생각(요약) 글 조각 */
  onThinking(piece: string): void;
  /** 답 글 조각 */
  onText(piece: string): void;
  /** 웹 찾기, 글 읽기를 했을 때 */
  onStep(step: ChatStep): void;
  /** 답이 기댄 웹 출처 */
  onSource(src: ChatSource): void;
}

/** API 오류 이벤트를 길드원 글로 */
function streamError(type: string | undefined): string {
  if (type === "overloaded_error" || type === "api_error") return "AI 서버가 바빠요. 잠시 뒤에 다시 물어봐 주세요";
  if (type === "rate_limit_error") return "지금 질문이 몰렸어요. 잠시 뒤에 다시 물어봐 주세요";
  return "답을 받다가 문제가 생겼어요";
}

/** 오류 이벤트로 멈춘 것 (연결 끊김과 구별) */
class StreamError extends Error {}

interface SseEvent {
  type: string;
  index?: number;
  content_block?: {
    type: string;
    name?: string;
    content?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
    citation?: { url?: string; title?: string };
  };
  error?: { type?: string; message?: string };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * 질문을 보내고, 서버가 그대로 넘겨 주는 Claude API 의 SSE 를 읽어 생각과 답을 받는 대로 넘긴다.
 * 실패하면 길드원에게 보여 줄 글로 Error 를 던진다. 멈추기(signal)는 받은 데까지로 끝낸다
 */
export async function askChat(
  req: { turns: ChatTurn[]; context: string; thread: number | null; again?: boolean },
  on: AskEvents,
  signal: AbortSignal,
): Promise<ChatResult> {
  const result: ChatResult = { refused: false, cut: false, broken: false, paused: false, aborted: false, left: null };
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: req.turns, context: req.context, thread: req.thread, again: req.again === true }),
      signal,
    });
  } catch {
    if (signal.aborted) return { ...result, aborted: true };
    throw new Error("인터넷 연결을 확인해 주세요");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `문제가 생겼어요 (${res.status})`);
  }
  const header = (h: string) => (res.headers.get(h) === null ? null : Number(res.headers.get(h)));
  result.left = header("x-chat-left");
  on.onStart({ thread: header("x-chat-thread"), msg: header("x-chat-msg") });
  // 이 계정에서 웹 찾기를 쓸 수 없으면 (콘솔에서 꺼 둔 경우) 숨기지 않고 알린다
  if (res.headers.get("x-chat-web") === "off") on.onStep({ kind: "search", text: "꺼짐 (위키 자료로만 답해요)" });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finished = false;
  // 블록마다 종류와 도구 입력 (웹 찾기 검색어, 읽은 주소)
  const blocks = new Map<number, { type: string; name?: string; json: string }>();
  let lastType = "";
  let wrote = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let at: number;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let ev: SseEvent;
        try {
          ev = JSON.parse(data) as SseEvent;
        } catch {
          continue;
        }
        if (ev.type === "content_block_start" && ev.content_block) {
          const b = ev.content_block;
          blocks.set(ev.index ?? -1, { type: b.type, name: b.name, json: "" });
          // 웹 찾기 뒤에 이어지는 답은 줄을 띄운다 (출처가 붙은 글은 블록이 잘게 나뉘므로 글 블록 사이는 붙인다. 서버 answerFromSse 와 같은 규칙)
          if (b.type === "text" && wrote && lastType !== "text" && lastType !== "thinking") on.onText("\n\n");
          lastType = b.type;
          if (b.type === "web_fetch_tool_result" && b.content && typeof b.content === "object") {
            const r = b.content as { url?: string; content?: { title?: string } };
            if (r.url) on.onSource({ url: r.url, title: r.content?.title || host(r.url) });
          }
          if (b.type === "web_search_tool_result" && Array.isArray(b.content)) on.onStep({ kind: "search", text: `결과 ${b.content.length}개` });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          wrote = true;
          on.onText(ev.delta.text);
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) on.onThinking(ev.delta.thinking);
        else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
          const b = blocks.get(ev.index ?? -1);
          if (b) b.json += ev.delta.partial_json;
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "citations_delta" && ev.delta.citation?.url) {
          on.onSource({ url: ev.delta.citation.url, title: ev.delta.citation.title || host(ev.delta.citation.url) });
        } else if (ev.type === "content_block_stop") {
          const b = blocks.get(ev.index ?? -1);
          if (b?.type === "server_tool_use") {
            let input: { query?: string; url?: string } = {};
            try {
              input = JSON.parse(b.json || "{}") as typeof input;
            } catch {
              // 입력을 못 읽어도 한 일은 보인다
            }
            if (b.name === "web_search") on.onStep({ kind: "search", text: input.query ? `“${input.query}”` : "웹 찾기" });
            else if (b.name === "web_fetch") on.onStep({ kind: "fetch", text: input.url ? host(input.url) : "글 읽기" });
            else on.onStep({ kind: "code", text: "찾은 것 거르기" });
          }
        } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
          result.refused = ev.delta.stop_reason === "refusal";
          result.cut = ev.delta.stop_reason === "max_tokens";
          result.paused = ev.delta.stop_reason === "pause_turn";
        } else if (ev.type === "message_stop") finished = true;
        else if (ev.type === "error") throw new StreamError(streamError(ev.error?.type));
      }
      if (done) break;
    }
  } catch (e) {
    if (signal.aborted) return { ...result, aborted: true };
    if (e instanceof StreamError) throw e;
    return { ...result, broken: true };
  }
  return { ...result, broken: !finished };
}

// ---- 대화 기록 (서버 functions/api/chat/threads, 그 길드원만 본다)

export interface ThreadSummary {
  id: number;
  title: string;
  pinned: boolean;
  updated_at: number;
  /** 찾기에서 맞은 말 한 줄 */
  hit?: string | null;
}
export interface SavedMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  photos: number;
  thinking: string | null;
  think_ms: number | null;
  found: string | null;
  /** JSON: 첨부 이름 */
  attach: string | null;
  /** JSON: ChatStep[] */
  steps: string | null;
  /** JSON: ChatSource[] */
  sources: string | null;
  created_at: number;
}

export const listThreads = (q = "") => api<{ threads: ThreadSummary[] }>("/api/chat/threads" + (q ? "?q=" + encodeURIComponent(q) : ""));
export interface FixedGap {
  id: number;
  question: string;
  note: string | null;
}
export const loadThread = (id: number) => api<{ thread: ThreadSummary; msgs: SavedMsg[]; fixed?: FixedGap[] }>(`/api/chat/threads/${id}`);
export const updateThread = (id: number, patch: { title?: string; pinned?: boolean }) => api<{ ok: true }>(`/api/chat/threads/${id}`, "PATCH", patch);
export const deleteThread = (id: number) => api<{ ok: true }>(`/api/chat/threads/${id}`, "DELETE");
export const saveAnswer = (thread: number, a: { text: string; thinking: string; thinkMs: number | null; found: string; steps: string; sources: string }) =>
  api<{ id: number }>(`/api/chat/threads/${thread}/msgs`, "POST", a);
/** 길드원의 '👎 별로' (앱개발자에게 간다) */
export const reportAnswer = (msg: number) => api<{ ok: true }>("/api/chat/gaps", "POST", { msg });

export interface ChatGap {
  id: number;
  user_id: string;
  thread_id: number;
  question: string;
  answer: string | null;
  reason: string;
  kind: "bot" | "user";
  status: "open" | "fixed";
  note: string | null;
  created_at: number;
  fixed_at: number | null;
}
export const listGaps = (status: "open" | "fixed") => api<{ gaps: ChatGap[] }>(`/api/chat/gaps?status=${status}`);
export const fixGap = (id: number, note: string) => api<{ ok: true }>(`/api/chat/gaps/${id}`, "PATCH", { note });

/** 그 말부터 뒤를 지운다 (다시 답하기, 질문 수정) */
export const deleteFrom = (thread: number, from: number) => api<{ ok: true }>(`/api/chat/threads/${thread}/msgs?from=${from}`, "DELETE");
