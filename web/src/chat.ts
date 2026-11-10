// 챗봇: 질문에 맞는 위키 자료 고르기, 고른 스샷 줄이기, /api/chat 부르기 (서버는 functions/api/chat/index.ts), 대화 기록.
// 위키 자료는 이미 화면에 받아 둔 것에서 고른다. 서버는 길이만 자르고 질문 앞에 붙인다.
import type { Block, ControlMob, Monster, Place, Post, Run, Wiki } from "./types";
import { api } from "./auth";
import { search } from "./search";
import { levelText } from "./ui";
import { matchedSections, oddsName } from "./odds";
import type { Odds } from "./odds";
import { PATCHES } from "./patchnotes";

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

// 위키 자료는 글자 수로 자르지 않는다 (제작자 2026-11-03 '무조건 다 봐', '없애': 전체 1만 5천 자, 글마다 2500자, 사냥터 원글 600자,
// 공식 확률 표 1500자 한도를 모두 뺐다). 무엇을 붙일지(글 2~3개, 표 2개)만 고른다.
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
  return list.map(blockText).filter(Boolean).join("\n");
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

/**
 * 게임 은어 -> 자료에 쓰는 말 (제작자 2026-11-06: '유물 이벤트인데 유물깡이라고 해'). 질문에 붙여 공식 확률 표와 위키를 찾는다.
 * 서버(server/officialImages.ts SLANG)에도 같은 표가 있다 (공식 글 찾기). 둘을 같이 고친다
 */
const SLANG: [RegExp, string][] = [
  [/유물\s*깡|유물\s*까기|유물\s*상자|과거의\s*유물|용사의\s*유물|유물\s*이벤트|글러트|전리품/, "과거의 기억 마법의유물 영웅의유물 전설의유물 용사의 보물"],
  [/상자\s*깡/, "상자"],
  // 스킬북 은어 ('덥마북' = 더블샷 마지막 단계 스킬북. 시세 동향 build_trend.py SKILL_BOOK 과 같은 줄임말)
  [/덥마/, "더블샷4 더블샷"],
  [/와마/, "와일드스윙4 와일드스윙"],
  [/프마/, "프레임쇼크4 프레임쇼크"],
  [/수기/, "수호의기원3 수호의기원"],
  [/아프(?!다|고|서|면|네|지|니|잖)/, "아이스프리즌3 아이스프리즌"],
  [/화폭/, "화염폭풍2 화염폭풍"],
  [/치격/, "치명적일격2 치명적일격"],
  [/포아/, "포레스트아이"],
  [/마북/, "스킬북"],
];
const slangOf = (q: string) => SLANG.filter(([re]) => re.test(q)).map(([, w]) => w).join(" ");

/** 질문 낱말 (두 글자 이상) */
function words(q: string): string[] {
  return q.split(/[\s,.?!~·()[\]"'“”‘’]+/).map((w) => w.replace(/(은|는|이|가|을|를|에|에서|으로|로|랑|하고|의|도|만)$/, "")).filter((w) => w.length >= 2);
}

/** 흔한 말 (제목·본문 찾기에 쓰지 않는다) */
const STOP_WORD = /^(좋아|좋은|좋을|올라|오르|오른|얼마|궁금|알려|해도|되나|될까|같아|같은|뭐가|그리고|아니면|그래서|때문|지금|이제|그냥|다시|한번|정도|쯤|부터|까지|사이|하면|하는|하고|해서|근데|진짜|혹시|요즘|요새|제일|가장|제대로|어느|무슨|어떤|어떻게|이거|저거|그거|그건|이건|나|내|제|저|우리)/;
/** 묻는 말 (본문 찾기에 쓰지 않는다): '어디서', '사냥해', '추천해줘', '뭐가' ... */
const ASK_WORD = /^(어디|어디서|어디가|어떻게|어떤|무엇|뭐|뭐가|뭘|언제|누가|왜|좋은|좋아|추천|가면|사냥|사냥해|사냥하|사냥터|해야|해줘|알려|알려줘|있어|있나|있나요|되나|되나요|할까|하나요|가요|해요|돼|좀|지금|이제|그럼|이거|저거|이건|나|내|제)$|(해|해요|해줘|할까|하나|하나요|나요|까요|줘|요)$/;

/** 자기 캐릭터를 묻는 말 ('내가 지금 할 것', '나 뭐 해', '내 렙에 맞는 사냥터', '추천') */
const ABOUT_ME = /(^|[\s,.])(나|내|난|내가|제가|저|전|제)(는|가|한테|에게|게)?(\s|$)|내 ?(렙|레벨|직업|캐릭|장비|스펙)|할 ?것|할 ?거|해야|뭐 ?(하|해|할)|뭘 ?(하|해|할)|추천|다음 ?(목표|단계)|어디서 ?사냥|사냥 ?어디/;
/** 골드·돈 벌이를 묻는 말 (챗봇 개선 2026-11-10: '골드는 어디서 벌어야될까'에 레벨에 맞는 사냥터·드랍이 안 붙었다). 물은 사람의 레벨로 사냥터를 고른다 */
const MONEY_WORD = /(골드|돈|용돈|자금|재화).{0,8}(벌|모으|모아|부족|모자|필요)|벌이|벌어|벌까|벌려|벌기|벌만|돈 ?되|뭐 ?팔|팔 ?만한|팔아서|팔면 ?(돈|골드)/;
/** 사냥터·육성·템 세팅을 묻는 말 (레벨을 안 적었으면 물은 사람의 레벨로 사냥터·공략을 고른다). '어디서 얻어' 같은 아이템 질문은 아니다 */
const HUNT_ASK = /사냥터|사냥|렙업|레벨업|육성|키우|템 ?세팅|세팅|장비 ?(추천|세팅|뭐|뭘|맞)|뭘 ?(맞|입|끼|들)|어디서 ?(렙|키|잡)|추천|공략/;

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
    // '41레인저', '35법사', '40무도' 처럼 숫자 뒤에 직업이 바로 붙은 것 (챗봇 개선 2026-11-10: '41레인저 사냥터'의 41 을 몰라 사냥터 자료가 빠졌다)
    question.match(/(?:^|[\s,.(])(\d{1,2})\s*(?:레인저|렌저|궁수|전사|워리어|마법사|법사|무도가|무도)/) ??
    (HUNT_WORD.test(question) ? question.match(/(?:^|\s)(\d{1,2})(?=\s|$|에서|에|이면|인데|쯤|짜리)/) : null);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 200 ? n : null;
}

/**
 * 질문의 레벨 구간 ('32렙부터 36렙사이', 'Lv.34~40'). 레벨이 둘 이상 나오고 20 안이면 [낮은, 높은]
 * (챗봇 개선 2026-11-10: '32렙부터 36렙사이 템 세팅'에 초급 공략(~33)만 붙고 중급(34~)이 빠졌다)
 */
function levelRangeOf(question: string): [number, number] | null {
  const found = new Set<number>();
  for (const m of question.matchAll(/(\d{1,3})\s*(?:레벨|렙|lv)/gi)) found.add(Number(m[1]));
  for (const m of question.matchAll(/(?:lv|레벨)\.?\s*(\d{1,3})/gi)) found.add(Number(m[1]));
  for (const m of question.matchAll(/(\d{1,3})\s*[~～-]\s*(\d{1,3})\s*(?:레벨|렙|lv|까지|사이)/gi)) {
    found.add(Number(m[1]));
    found.add(Number(m[2]));
  }
  const levels = [...found].filter((n) => n >= 1 && n <= 200).sort((a, b) => a - b);
  if (levels.length < 2) return null;
  const lo = levels[0];
  const hi = levels[levels.length - 1];
  return hi - lo <= 20 ? [lo, hi] : null;
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
 * 사냥터를 부르는 다른 말 (카페 글 해시태그 '#오숲 #죽늪 #미궁 #정원 #뿌리 #금서고 #성채', 톡방·길드원 말) -> 사냥터 이름 (data/places.json 의 name).
 * 띄어쓰기를 뺀 질문(q)에 맞춘다. 이름 그대로 나온 것은 위에서 먼저 잡는다 (챗봇 개선 2026-11-10: '요새·미로·중사·타신' 같은 말을 사냥터로 못 알아봤다)
 */
const PLACE_ALIAS: [RegExp, string[]][] = [
  [/숲의?미궁|숲미궁|(?<![가-힣])미궁/, ["숲의미궁"]],
  [/돌무더기|요새/, ["하늘성채 돌무더기요새"]],
  [/알수없는|(?<![가-힣])미로(?!찾)/, ["하늘성채 알수없는미로"]],
  [/하늘성채동부|(?<![가-힣])동부/, ["하늘성채 동부"]],
  [/하늘성채서부|(?<![가-힣])서부/, ["하늘성채 서부"]],
  [/(?<![가-힣])성채(?!동부|서부|돌무더기|알수없는)|하늘성채(?!동부|서부|돌무더기|알수없는)/, ["하늘성채 서부", "하늘성채 동부"]],
  [/타락한?신전|타신|타락/, ["타락한신전"]],
  [/이슬롯의?신전|이슬롯(?!의?실험실)/, ["이슬롯신전"]],
  [/이슬롯의?실험실/, ["실험실"]],
  [/비탄의?제단|비탄/, ["비탄"]],
  [/빛의?신전|빛이들지않는신전|빛신|빛들신/, ["빛신"]],
  [/고대의?누각|(?<![가-힣])누각/, ["고대의누각"]],
  [/제국사막|제사막|모래무덤|(?<![가-힣])제사(?![가-힣])/, ["제국사막"]],
  [/왕국사막|왕사막|건조한초원|(?<![가-힣])왕사(?![가-힣])/, ["왕국사막"]],
  [/중앙사막|뜨거운모래사막|뜨사|(?<![가-힣])중사/, ["중사"]],
  [/죽음의?늪|죽늪/, ["죽늪"]],
  [/오염된?숲|오숲/, ["오숲"]],
  [/폐허/, ["폐허숲"]],
  [/라노스평원|라평/, ["라노스평원"]],
  [/노을/, ["노을숲"]],
  [/카타르/, ["카타르"]],
  [/등대섬|등섬/, ["해변"]],
  [/등대(?!\s*[1-5]|던전\s*[1-5]|[1-5]층)/, ["등대1층", "등대2층", "등대3층", "등대4층", "등대5층"]],
  [/버섯늪|(?<![가-힣])버섯(?!돌이|늪지)/, ["버섯늪지"]],
  [/스포어/, ["머쉬룸스포어"]],
  [/우디숲|우디위디|우디워디(?!마을)/, ["우디숲"]],
  [/해적/, ["해적선"]],
  [/모르포시즈뿌리|(?<![가-힣])뿌리(?!갑|뿌리)/, ["뿌리"]],
  [/모르포시즈정원/, ["정원"]],
  [/금서고/, ["금서고"]],
  [/길던|길드던전|리에티|전지의관/, ["길드던전"]],
  [/헌팅그라운드|헌그|퉁카|테멘/, ["헌팅그라운드 퉁카", "시나르 평야", "비툼 습지"]],
  [/시나르/, ["시나르 평야"]],
  [/비툼/, ["비툼 습지"]],
  [/(?<![가-힣])전장|이노티아워|언더크라운/, ["이노티아워"]],
];
/** '인던30', '인던 30', '30인던', '등대2층', '등대 2' -> 사냥터 이름 */
function numberedPlace(q: string): string[] {
  const out: string[] = [];
  for (const m of q.matchAll(/인던(\d{2})|(\d{2})인던/g)) out.push(`인던${m[1] ?? m[2]}`);
  for (const m of q.matchAll(/등대(?:던전)?([1-5])층?/g)) out.push(`등대${m[1]}층`);
  return out;
}

/** 몬스터 한 줄 (레벨, HP, 선공·속도·거리, 재부활, 드랍, 스킬, 참고). 사냥터·인던을 물으면 몬스터마다 이것을 붙인다 */
function monsterLine(m: Monster): string {
  return [
    `- ${m.name}` + (m.level ? ` Lv.${m.level}` : "") + (m.hp ? ` HP ${m.hp.toLocaleString("ko-KR")}` : m.hps?.length ? ` HP ${m.hps.join("/")}` : ""),
    m.traits,
    m.respawn && `재부활 ${m.respawn}`,
    m.drops.length && `드랍: ${m.drops.join(", ")}`,
    m.skill && `스킬: ${m.skill}`,
    m.note && `참고: ${m.note}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 질문에 맞는 위키 자료를 짧은 글로 만든다.
 * 질문에 이름이 나온 아이템, 몬스터, 사냥터 → 레벨을 물으면 그 레벨 근처 사냥터와 직업 장비 → 없으면 낱말로 검색 →
 * 제목이 맞는 글(육성 공략 등) → 사냥터 목록 순서로 채운다.
 * 질문에 레벨이나 직업이 없으면 물은 사람의 것을 쓴다 (챗봇 개선 2026-10-31: 사진만 보낸 질문에서 레벨, 직업을 몰라
 * 맞는 공략을 못 붙였다). 레벨만 물으면 직업은 물은 사람 것, 사진만 보내면 둘 다 물은 사람 것.
 * 사진에서 먼저 읽은 값(seen)이 있으면 사진 속 캐릭터의 직업, 레벨을 먼저 쓰고, 사진에 보이는 이름도 질문 낱말처럼 찾는다.
 */
/** 통제 리스트를 붙일 질문 (잡아도 되는지, 통제·중립·쟁) */
const CONTROL_ASK = /통제|중립|잡아도|잡으면|잡지 ?말|잡아 ?돼|건드려도|양보제|쟁 ?길드/;

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
  const asked = [question, slangOf(question), ...(seen?.names ?? [])].filter(Boolean).join(" ");
  const q = norm(asked);
  const parts: string[] = [];
  const found: string[] = [];
  const add = (s: string) => {
    if (s) parts.push(s);
  };
  const askedLevel = levelOf(question);
  const askedRange = levelRangeOf(question);
  const askedJob = jobOf(question);
  // '내가 지금 할 것', '나 어디서 사냥해' 처럼 자기를 물으면 레벨·직업을 안 말해도 물은 사람의 값으로 고른다 (제작자 요청 2026-11-02).
  // 사냥터·육성·장비를 묻거나 골드 벌이를 물을 때도 레벨을 안 적었으면 물은 사람의 레벨로 (챗봇 개선 2026-11-10: '골드는 어디서 벌어야될까', '사냥터 알려주라')
  const aboutMe = ABOUT_ME.test(question) || MONEY_WORD.test(question) || HUNT_ASK.test(question);
  const level = askedLevel ?? (photo ? (seen?.level ?? asker?.level ?? null) : aboutMe ? (asker?.level ?? null) : null);
  // 레벨 구간을 물었으면 그 구간 전체 ('32렙부터 36렙'), 아니면 그 레벨 하나
  const lo = askedRange?.[0] ?? level;
  const hi = askedRange?.[1] ?? level;
  const job = askedJob ?? (photo ? (seen?.job ?? asker?.job ?? null) : askedLevel !== null || aboutMe ? (asker?.job ?? null) : null);
  if (asker?.job || asker?.level) add(`[물은 사람] ${[asker.job, asker.level && `Lv.${asker.level}`].filter(Boolean).join(" ")} (길드원이 스스로 적은 값)`);
  if (seen) {
    const who = [seen.job, seen.level && `Lv.${seen.level}`].filter(Boolean).join(" ");
    if (who) found.push(`사진: ${who}`);
    add(`[사진에서 읽음] ${who ? `사진 속 캐릭터 ${who}` : "캐릭터 직업·레벨은 안 보임"}${seen.names.length ? ` · 보이는 이름: ${seen.names.join(", ")}` : ""} (자료는 이 값으로 골랐다)`);
  }

  // 길드 통제 리스트 (제작자 2026-11-10: 중립 길드라 잡지 않는 몹, 공지사항에도 있음, '다 DB 화 해서 챗봇이 읽을 수 있게').
  // 작아서 늘 붙인다 (사냥터를 추천할 때 그곳의 통제 몹을 알리게). 물은 말에 곳·몹 이름이 나오거나 통제·잡아도 되는지를 물으면 찾은 자료에도 적는다
  const control = wiki.meta.control;
  if (control) {
    const mobName = (m: ControlMob) => {
      const wikiName = m.key ? wiki.monsters[m.key]?.name : "";
      return m.name + (wikiName && norm(wikiName) !== norm(m.name) ? ` (위키 이름 ${wikiName})` : "") + (m.note ? ` (${m.note})` : "");
    };
    add(
      `[길드 통제 리스트 · ${control.server} 서버 · ${control.rule} · 표 제작 ${control.by} · 수정 ${control.date} · 게시판 공지사항에 있음]\n` +
        control.groups
          .map((g) => `- ${g.place}${g.placeId && wiki.places[g.placeId] ? ` (위키 사냥터 ${wiki.places[g.placeId].name})` : ""}${g.mark ? ` [${g.mark}]` : ""}: ${g.mobs.map(mobName).join(", ")}`)
          .join("\n"),
    );
    const words = control.groups
      .flatMap((g) => [g.place, g.placeId ? wiki.places[g.placeId]?.name ?? "" : "", ...g.mobs.flatMap((m) => [m.name, m.key ? wiki.monsters[m.key]?.name ?? "" : ""])])
      .map((w) => norm(w))
      .filter((w) => w.length >= 2);
    if (CONTROL_ASK.test(question) || words.some((w) => q.includes(w))) found.push("길드 통제 리스트");
  }

  // 1. 질문에 이름이 그대로 나온 것 (긴 이름부터, 짧은 이름이 긴 이름 안에 든 경우는 뺀다)
  const names: { kind: "item" | "monster" | "place"; name: string; id?: string }[] = [];
  for (const name of Object.keys(wiki.items)) if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "item", name });
  for (const name of new Set(Object.values(wiki.monsters).map((m) => m.name)))
    if (name.length >= 2 && q.includes(norm(name))) names.push({ kind: "monster", name });
  for (const p of Object.values(wiki.places))
    if (p.name.length >= 2 && q.includes(norm(p.name))) names.push({ kind: "place", name: p.name, id: p.id });
    // 자리 안내의 찾는말('신전' …)로도 그 사냥터를 고른다 (자료 길드/사냥터_자리.json)
    else if (p.guide?.words.some((w) => q.includes(norm(w)))) names.push({ kind: "place", name: p.name, id: p.id });
  names.sort((a, b) => b.name.length - a.name.length);
  const picked = names.filter((n, i) => !names.slice(0, i).some((m) => norm(m.name).includes(norm(n.name)))).slice(0, 8);
  // 사냥터를 다른 말로 불렀으면 ('요새', '미로', '중사', '타신', '인던30', '등대 2층') 그 사냥터도 (이름으로 잡힌 것은 빼고)
  const byName = new Map(Object.values(wiki.places).map((p) => [p.name, p]));
  const aliased = [...PLACE_ALIAS.filter(([re]) => re.test(q)).flatMap(([, ns]) => ns), ...numberedPlace(q)];
  for (const name of new Set(aliased)) {
    const p = byName.get(name);
    if (p && !picked.some((n) => n.kind === "place" && n.name === p.name) && picked.length < 12) picked.push({ kind: "place", name: p.name, id: p.id });
  }

  // 2. 없으면 질문 낱말로 검색해서 맞는 것 몇 개 (레벨을 물으면 아래 레벨 자료로 충분하다)
  // 숫자가 든 말('힘1'), 묻는 말, 직업 이름, '아이모'로는 찾지 않고, 오타 짐작(자모 비교)으로 걸린 것은 쓰지 않는다
  // (챗봇 개선 2026-11-10: '힘1 당 뭐가 좋아져'에 힘센 샤쿤·힘의 띠·나른함1 이 붙었다)
  if (!picked.length && askedLevel === null) {
    for (const w of words(asked)) {
      if (/\d/.test(w) || ASK_WORD.test(w) || JOB_WORDS.includes(w) || w === "아이모") continue;
      for (const h of search(wiki, w, 3)) {
        // 이름 처음부터 맞는 것만 ('상자'로 깜짝상자·허름한상자가 다 걸리지 않게). 네 글자 넘는 말은 이름 안에 든 것도 ('용병의장갑' -> 사막용병의장갑)
        if (h.score < ([...w].length >= 4 ? 1 : 3)) continue;
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
      const from = (it.from ?? [])
        .map((k) => wiki.monsters[k])
        .filter(Boolean)
        .map((m) => `${m.name}(${wiki.places[m.place]?.name ?? "?"})`);
      const equip = (it.equip ?? []).map((e) => `${e.slot}: ` + Object.entries(e.info).filter(([k, v]) => v && k !== "이미지").map(([k, v]) => `${k} ${v}`).join(", "));
      add([`[아이템] ${it.name}`, from.length && `떨구는 몬스터: ${[...new Set(from)].join(", ")}`, ...equip].filter(Boolean).join(" · "));
    } else if (n.id && wiki.places[n.id]) {
      const p = wiki.places[n.id];
      const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
      // 몬스터마다 레벨·HP·선공·재부활·드랍·스킬·참고까지 (챗봇 개선 2026-11-10: '비탄', '인던30' 을 물었는데 몬스터 이름만 붙어 HP·선공·보스 공략·드랍이 없다고 했다)
      add(
        `[사냥터] ${p.name} (${p.region}${levelText(p.level) ? ", " + levelText(p.level) : ""})${p.title && norm(p.title) !== norm(p.name) ? ` · 글 제목: ${p.title.replace(/\s*_ReMAKE$/, "")}` : ""}` +
          (mons.length ? `\n몬스터 ${mons.length}:\n` + mons.map(monsterLine).join("\n") : " 몬스터 자료 없음"),
      );
      // 길드가 정한 자리 나누기 (제작자 2026-11-10, 마을모금함이 길드 잡담방에 공유한 것). 그림 주소는 답에 [[그림:주소|설명]] 으로 넣을 수 있다
      if (p.guide)
        add(
          `[${p.name} ${p.guide.title} · 길드 자료 · ${p.guide.by}]\n` +
            p.guide.notes.map((n) => "- " + n).join("\n") +
            p.guide.pics.map((pic) => `\n그림 주소: /${pic.src} (${pic.caption})`).join(""),
        );
      const post = posts?.[p.id];
      if (post) add(`[${p.name} 안내]\n` + postText(post, [...p.above, ...p.below]));
    }
  }

  // 레벨을 물으면: 그 레벨 근처 사냥터(몬스터, 장비 드랍)와 직업 장비 (제작자 요청: 답을 더 알차게). 레벨 구간이면 그 구간 전체
  if (level !== null && lo !== null && hi !== null) {
    // 끝이 없는 레벨('Lv.30 이상', 길드던전)은 시작 레벨에서 10 위까지만 맞는 곳으로 친다
    const top = (p: Place) => p.level![1] ?? p.level![0] + 10;
    const inside = (p: Place) => p.level![0] <= hi && lo <= top(p);
    const around = Object.values(wiki.places)
      .filter((p) => p.level && p.level[0] - 3 <= hi && lo <= top(p) + 3)
      .map((p) => ({ p, gap: inside(p) ? 0 : Math.min(Math.abs(p.level![0] - hi), Math.abs(top(p) - lo)) }));
    // 막 들어갈 만한 곳(시작 레벨이 지금 레벨에 가까운 곳)부터
    const fromStart = (x: { p: Place }) => Math.abs(level - x.p.level![0]);
    const near = [...around].sort((a, b) => a.gap - b.gap || fromStart(a) - fromStart(b)).slice(0, askedRange ? 10 : 8);
    // 레벨이 딱 맞는 곳 4곳은 원글 안내(가는 길, 퀘스트, NPC)까지: 시작 레벨이 가깝고 레벨 폭이 좁은(그 레벨에 맞춘) 곳부터
    // (챗봇 개선 2026-11-01: 시작 레벨이 낮은 2곳만 골라 Lv.35 에 30~36 사막이 들고 34~40 죽늪이 빠졌다)
    const width = (x: { p: Place }) => top(x.p) - x.p.level![0];
    const exact = around
      .filter((x) => x.gap === 0)
      .sort((a, b) => fromStart(a) - fromStart(b) || width(a) - width(b))
      .slice(0, askedRange ? 6 : 4);
    const levelName = askedRange ? `${lo}~${hi}` : String(level);
    if (near.length) {
      found.push(`Lv.${levelName} 근처 사냥터 ${near.length}곳`);
      add(
        `[레벨 ${levelName} 근처 사냥터]\n` +
          near
            .map(({ p }) => {
              const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
              const gear = [...new Set(mons.flatMap((m) => m.drops))].filter((d) => wiki.items[d]?.equip.length);
              return (
                `${p.name} (${p.region}, ${levelText(p.level)}) 몬스터: ` +
                mons.map((m) => m.name + (m.level ? ` Lv.${m.level}` : "")).join(", ") +
                (gear.length ? ` · 장비 드랍: ${gear.join(", ")}` : "")
              );
            })
            .join("\n"),
      );
      // 근처 사냥터마다 몬스터 자세히(레벨·HP·선공·재부활·드랍·스킬), 레벨이 딱 맞는 곳은 원글 안내까지
      // (챗봇 개선 2026-10-31: '정원·금서고 몬스터와 드랍 자료 없음'. 2026-11-10: 딱 맞는 4곳만 자세히 붙여 '중사·숲의미궁 드랍 자료 없음'이라고 했다)
      const exactIds = new Set(exact.map((x) => x.p.id));
      const seenPlace = new Set(picked.filter((n) => n.kind === "place" && n.id).map((n) => n.id));
      // 사냥터를 이름으로 물었으면('비탄에서 사냥해도 돼?') 그 사냥터는 위에서 자세히 붙였고, 근처 사냥터는 견줄 목록만
      for (const { p } of seenPlace.size ? [] : near) {
        if (seenPlace.has(p.id)) continue;
        const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
        const post = exactIds.has(p.id) ? posts?.[p.id] : undefined;
        add(`[${p.name} 자세히]\n` + mons.map(monsterLine).join("\n") + (post ? "\n" + postText(post, [...p.above, ...p.below]) : ""));
      }
    }
    if (job) {
      const gear = Object.values(wiki.items)
        .flatMap((it) => (it.equip ?? []).map((e) => ({ it, e })))
        .filter(({ e }) => (e.info["직업"] === job || e.info["직업"] === "공용") && Number(e.info["레벨제한"]) >= lo - 5 && Number(e.info["레벨제한"]) <= hi + 5)
        .sort((a, b) => Number(b.e.info["레벨제한"]) - Number(a.e.info["레벨제한"]))
        .slice(0, askedRange ? 24 : 16);
      if (gear.length) {
        found.push(`${job} 장비 ${gear.length}개`);
        add(
          `[직업 장비: ${job}, Lv.${lo - 5}~${hi + 5}]\n` +
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
    // '아이모', 묻는 말, 흔한 말('좋아져', '올라', '얼마나', '그리고')로는 제목·본문을 찾지 않는다 (챗봇 개선 2026-11-10: '아이모 에서 힘1 당'에 제목에 아이모가 든 글 셋이 붙었다)
    const ws = words(asked).filter((w) => w !== "아이모" && !ASK_WORD.test(w) && !STOP_WORD.test(w));
    const scored = wiki.menu
      .flatMap((s) => s.posts)
      .filter((p) => !wiki.places[p.id] && posts[p.id])
      .map((p) => {
        let score = ws.filter((w) => norm(p.title).includes(norm(w))).length;
        const jobTitle = !!job && p.title.includes(job);
        if (jobTitle && !askedJob) score++;
        // 직업을 알면 다른 직업의 공략·스킬 글은 붙이지 않는다 (챗봇 개선 2026-11-10: '인던30 공략'에 전사·레인저 초급 공략까지 셋이 붙었다)
        if (job && !jobTitle && JOBS.some((j) => p.title.includes(j))) return { p, score: -1 };
        const r = titleRange(p.title);
        // 레벨(구간)이 맞는 그 직업의 공략은 제목 낱말이 없어도 붙인다 (챗봇 개선 2026-11-10: '41레인저 사냥터 알려주라'에 레인저 중급 공략이 안 붙었다)
        if (r && lo !== null && hi !== null) score = r[0] <= hi && lo <= r[1] ? (score > 0 ? score + 3 : jobTitle ? 3 : 0) : -1;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // 공략과 직업 스킬 글을 같이 (장비, 스킬 우선순위를 묻는 일이 많다). 레벨 구간이면 초급·중급 공략이 둘 다 든다
    for (const { p } of scored) {
      found.push(p.title);
      add(`[${p.title}]\n` + postText(posts[p.id]));
    }

    // 3-1. 컴투스 공식 확률 (제작자 요청 2026-10-31): 확률을 묻거나, 질문의 이름(아이템, 상자, 옵션)이 공식 표에 나오면 그 표.
    // 이름이 든 섹션을 먼저, 표 전체 (자르지 않는다, 제작자 2026-11-03)
    if (odds) {
      const askOdds = /확률|가챠|뽑기|깡|상자|합성|세공|재설정|염색|퍼센트|%/.test(question);
      // 'lv' 같은 짧은 영문과 '상자', '옵션' 같은 흔한 말로는 표를 고르지 않는다 (챗봇 개선 2026-11-10: 'Lv.40' 의 lv 가 레벨제한 칸에 걸려 엉뚱한 표가 붙었다)
      const ODDS_STOP = /^(상자|확률|이벤트|아이템|획득|개별|옵션|무기|갑옷|장비|레벨|등급|단계|성공|실패|종류|이름|lv|[a-z]{1,2})$/i;
      const terms = [...new Set([...picked.map((n) => n.name), ...ws.filter((w) => !/\d/.test(w) && !ASK_WORD.test(w) && !JOB_WORDS.includes(w) && !ODDS_STOP.test(w))])].filter((w) => w.length >= 2);
      // 확률을 묻지 않은 질문에서는 이름이 나온 것(아이템, 상자)이 표 안에 있을 때만 (낱말 하나가 칸에 든 것으로는 안 고른다: '지능'이 옵션 표 수십 줄에 걸렸다)
      const secTerms = askOdds ? terms : picked.map((n) => n.name);
      const scoredOdds = odds.tables
        .map((t) => {
          const name = norm(t.path.join(""));
          const nameHits = terms.filter((w) => name.includes(norm(w))).length;
          const secs = [...new Set(secTerms.flatMap((w) => matchedSections(t, w)))];
          return { t, secs, score: nameHits * 3 + Math.min(secs.length, 3) };
        })
        .filter((x) => x.score >= (askOdds ? 1 : 3))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      // 질문에 분류 이름이 그대로 나오면('랜덤 코스튬 상자', '신비로운 코스튬 상자') 그 분류의 표를 모두 (챗봇 개선 2026-11-10: 랜덤 코스튬 상자 8개 표 중 둘만 붙었다)
      for (const t of odds.tables) {
        if (scoredOdds.length >= 12 || scoredOdds.some((x) => x.t === t)) continue;
        const cat = t.path.length > 1 ? t.path.slice(0, -1).map(norm) : [];
        if (cat.some((c) => c.length >= 4 && q.includes(c))) scoredOdds.push({ t, secs: [], score: 0 });
      }
      for (const { t, secs } of scoredOdds) {
        const order = [...secs, ...t.sections.map((_, i) => i).filter((i) => !secs.includes(i))];
        const body = order
          .map((i) => {
            const s = t.sections[i];
            return [s.t && `## ${s.t}`, s.d, s.c.join(" | "), ...s.r.map((r) => r.join(" | "))].filter(Boolean).join("\n");
          })
          .join("\n");
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
    const otherJob = (title: string) => !!job && !title.includes(job) && JOBS.some((j) => title.includes(j));
    const hits = keys
      .map((k) => ({ k, posts: texts.filter((t) => !taken.has(t.id) && !otherJob(t.title) && t.flat.includes(k)) }))
      .filter((h) => h.posts.length > 0 && h.posts.length <= 25) // 너무 흔한 낱말은 자리를 못 짚는다
      .sort((a, b) => a.posts.length - b.posts.length);
    // 조합·제작·퀘스트·얻는 곳을 물으면 재료와 재료 얻는 곳(제작소 NPC, 퀘스트)이 글의 다른 자리에 있어 둘레를 넓게 (챗봇 개선 2026-11-10: '백색레이피어 어떻게 만들어'에 세르앙의눈물 얻는 법이 빠졌다)
    const craft = /만들|만드|제작|조합|재료|레시피|퀘스트|얻(어|나|는|을|고)|구하|구해|구함|교환|어디서|획득/.test(question);
    const [before, after] = craft ? [1200, 1600] : [300, 900];
    let more = 0;
    for (const h of hits) {
      for (const t of h.posts) {
        if (more >= 6 || taken.has(t.id)) continue;
        // 나온 자리마다(5번까지) 둘레를 잘라 이어 붙인다 (예전에는 처음 나온 자리 하나만)
        const spots: number[] = [];
        for (let i = t.flat.indexOf(h.k); i >= 0 && spots.length < 5; i = t.flat.indexOf(h.k, i + h.k.length)) spots.push(textPos(t.text, i));
        const ranges: [number, number][] = [];
        for (const at of spots) {
          const s = Math.max(0, at - before);
          const e = Math.min(t.text.length, at + after);
          const last = ranges[ranges.length - 1];
          if (last && s <= last[1]) last[1] = Math.max(last[1], e);
          else ranges.push([s, e]);
        }
        const around = ranges.map(([s, e]) => t.text.slice(s, e)).join("\n…\n").slice(0, 6000);
        taken.add(t.id);
        more++;
        found.push(t.title);
        add(`[${t.title} 중에서]\n` + around);
      }
    }
  }

  // 3-2. 길드 앱 패치 내역 (홈 'v1.0' 을 누르면 보이는 화면과 같다. 2026-11-02 제작자 요청: 웹에서 볼 수 있는 모든 정보를 챗봇이)
  if (/패치 ?내역|앱 ?(업데이트|패치|버전)|새 ?기능|새로 ?생긴|바뀐 ?(거|것|점)|v\d+\.\d+/i.test(question)) {
    found.push("패치 내역");
    add("[길드 앱 패치 내역 (새 버전 먼저)]\n" + PATCHES.slice(0, 4).map((p) => `v${p.version} (${p.date})\n` + p.items.map((i) => `- ${i}`).join("\n")).join("\n"));
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
  /** 서버의 답 받기 일꾼이 받는 답이면 true: 화면을 닫아도 일꾼이 끝까지 받아 대화에 넣는다 (화면은 넣지 않는다) */
  durable: boolean;
  /** 일꾼이 대화에 넣은 답의 번호 */
  savedId: number | null;
  /** 끝 신호(message_stop)까지 받았으면 true */
  finished: boolean;
}

export interface AskEvents {
  /** 서버가 답을 보내기 시작할 때: 대화 번호(새 대화면 새 번호)와 넣은 질문 번호 */
  /** durable: 서버의 답 받기 일꾼이 받는 답 (앱을 꺼도 끝까지 받아 넣고 알림) */
  onStart(info: { thread: number | null; msg: number | null; durable: boolean }): void;
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
  /** 일꾼(server/chatRun.ts)이 만든 오류 줄이면 error.message 를 그대로 보인다 */
  sapphire?: boolean;
  /** sapphire_saved: 일꾼이 넣은 답 번호 */
  id?: number;
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
  req: {
    turns: ChatTurn[];
    context: string;
    thread: number | null;
    again?: boolean;
    found?: string;
    /** 위키 자료를 고르는 중이면: 질문을 먼저 보내고 자료는 고르는 대로 뒤따라 보낸다 (제작자 2026-11-09 '질문하자마자 웹을 꺼도 끝까지') */
    later?: Promise<{ context: string; found: string }>;
  },
  on: AskEvents,
  signal: AbortSignal,
): Promise<ChatResult> {
  const result = emptyResult();
  const post = (body: Record<string, unknown>) =>
    fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  const base = { messages: req.turns, thread: req.thread, again: req.again === true };
  let res: Response;
  try {
    if (req.later) {
      res = await post({ ...base, context: "", found: "", later: true });
      // 서버에 답 받기 일꾼이 없으면 자료를 다 고른 뒤 같이 보낸다
      if (res.status === 409) {
        const c = await req.later;
        res = await post({ ...base, context: c.context, found: c.found });
      } else if (res.ok) {
        const thread = Number(res.headers.get("x-chat-thread"));
        // 자료 보내기가 망 오류로 실패하면 조금 뒤 두 번 더 (일꾼은 자료를 2분까지 기다린다. 자료 고르기가 실패하면 빈 자료가 바로 가서 기다리지 않는다)
        const send = (c: { context: string; found: string }, tries: number): Promise<unknown> =>
          fetch("/api/chat/context", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ thread, context: c.context, found: c.found }),
            keepalive: c.context.length < 60_000, // 앱을 닫는 중이어도 가게 (64KB 한도)
          }).catch(() => (tries > 0 ? new Promise((r) => setTimeout(r, 2500)).then(() => send(c, tries - 1)) : undefined));
        void req.later.then((c) => send(c, 2));
      }
    } else res = await post({ ...base, context: req.context, found: req.found ?? "" });
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
  result.durable = res.headers.get("x-chat-run") === "1";
  on.onStart({ thread: header("x-chat-thread"), msg: header("x-chat-msg"), durable: result.durable });
  // 이 계정에서 웹 찾기를 쓸 수 없으면 (콘솔에서 꺼 둔 경우) 숨기지 않고 알린다
  if (res.headers.get("x-chat-web") === "off") on.onStep({ kind: "search", text: "꺼짐 (위키 자료로만 답해요)" });
  return readAnswer(res.body, on, signal, result);
}

const emptyResult = (): ChatResult => ({
  refused: false,
  cut: false,
  broken: false,
  paused: false,
  aborted: false,
  left: null,
  durable: false,
  savedId: null,
  finished: false,
});

/**
 * 서버의 답 받기 일꾼(server/chatRun.ts)에 다시 붙는다 (화면이 끊겼다 돌아왔을 때, 대화를 다시 열었을 때): 처음부터 다시 받는다.
 * 일꾼이 받는 답이 없으면 null (durable 이면 일꾼은 있다: 받을 것이 없다는 뜻)
 */
export async function watchChat(thread: number, on: AskEvents, signal: AbortSignal): Promise<ChatResult | { none: true; durable: boolean }> {
  let res: Response;
  try {
    res = await fetch(`/api/chat/live?thread=${thread}`, { credentials: "same-origin", signal });
  } catch {
    if (signal.aborted) return { ...emptyResult(), aborted: true };
    return { ...emptyResult(), broken: true, durable: true };
  }
  const durable = res.headers.get("x-chat-run") === "1";
  if (res.status !== 200 || !res.body) return { none: true, durable };
  on.onStart({ thread: null, msg: null, durable: true });
  return readAnswer(res.body, on, signal, { ...emptyResult(), durable: true });
}

/** 화면의 '중지': 서버의 일꾼도 받기를 멈춘다 */
export const stopChat = (thread: number) =>
  fetch("/api/chat/stop", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thread }),
  }).catch(() => null);

/** Claude API 의 SSE (서버가 그대로 넘겨 준 것)를 읽어 생각과 답을 받는 대로 넘긴다 */
async function readAnswer(body: ReadableStream<Uint8Array>, on: AskEvents, signal: AbortSignal, result: ChatResult): Promise<ChatResult> {
  const reader = body.getReader();
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
        else if (ev.type === "sapphire_saved" && typeof ev.id === "number") result.savedId = ev.id;
        else if (ev.type === "sapphire_web_off") on.onStep({ kind: "search", text: "꺼짐 (위키 자료로만 답해요)" });
        else if (ev.type === "error") throw new StreamError(ev.sapphire && ev.error?.message ? ev.error.message : streamError(ev.error?.type));
      }
      if (done) break;
    }
  } catch (e) {
    if (signal.aborted) return { ...result, aborted: true };
    if (e instanceof StreamError) throw e;
    return { ...result, broken: true };
  }
  return { ...result, finished, broken: !finished };
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
