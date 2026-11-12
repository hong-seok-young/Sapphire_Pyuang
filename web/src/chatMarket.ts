// 챗봇에 붙이는 앱 자료 중 위키 밖의 것: 무기 강화 수치표(강화 비교 자료)와 거래 톡방 시세·줄임말(시세 동향 자료).
// 챗봇 개선 2026-11-09 (제작자 '바로 ㄱㄱ'): '무기 강화 수치표', '레이피어 공격력', '돈벌이', '충격샷4 가격', '월거', '붉자껍', '광부 신발'을
// 앱에 자료가 있는데도 못 답했다. 자료는 build_enhance.py -> data/enhance.json, build_trend.py -> data/chatmarket.json (판 사람 닉네임은 넣지 않는다).
// 질문에 맞을 때만 받아서(한 번 받으면 이번에 연 동안 그대로) 위키 자료 뒤에 붙인다.

interface Stat {
  med: number;
  min: number;
  max: number;
  n: number;
  sellers?: number;
  first?: string;
  last?: string;
  recent?: number | null;
  before?: number | null;
}
interface MarketItem extends Stat {
  name: string;
  abbr: string[];
  cat: string | null;
  other: { med: number; n: number } | null;
  groups: (Stat & { label: string })[];
  samples: string[];
  each?: boolean;
}
interface ChatMarket {
  source: { from: string; to: string; rooms: string[]; rate: number };
  gold: { sell7: number | null; buy7: number | null; days: [string, number | null, number | null][] };
  items: MarketItem[];
  itemsBuy: MarketItem[];
  chars: { band: string; n: number; med: number; min: number; max: number }[];
  slang: Record<string, string>;
}
interface EnhanceWeapon {
  name: string;
  job: string;
  lv: number;
  min: number;
  max: number;
  bonus: string;
}
interface Enhance {
  source: string;
  common: number[];
  mage: Record<string, number[]>;
  weapons: EnhanceWeapon[];
}

const cache = new Map<string, Promise<unknown>>();
function load<T>(url: string): Promise<T | null> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(url) as Promise<T | null>;
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const won = (v: number | null | undefined) => (v == null ? "-" : v >= 1 ? `${+v.toFixed(2)}만 원` : `${Math.round(v * 10000).toLocaleString()}원`);

const ASK_PRICE = /시세|가격|얼마|팔아|팔까|팔면|팔래|사려|살까|살래|매물|돈\s*벌|돈벌이|골드\s*벌|벌이|벌어|벌까|벌려|벌기|돈\s*되|돈\s*버는|비싸|싸게|중개|거래|톡방|현질|원에|만\s*원|장에|콩/;
const ASK_CHAR = /캐릭\s*(값|시세|가격|얼마)|계정\s*(값|시세|가격|얼마)|캘|템통/;
const ASK_ENHANCE = /강화|공격력|데미지|뎀지|딜|수치표|\+\s*\d{1,2}|\d{1,2}\s*강/;
const JOBS: [RegExp, string][] = [
  [/전사|워리어/, "전사"],
  [/레인저|렌저|궁수|렌/, "레인저"],
  [/마법사|법사/, "마법사"],
  [/무도가|무도/, "무도가"],
];

/** 무기 강화 수치표 (강화 비교 화면과 같은 계산: 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100)) */
function enhanceText(e: Enhance, question: string): { text: string; found: string[] } | null {
  const q = norm(question);
  const named = e.weapons.filter((w) => q.includes(norm(w.name)));
  if (!named.length && !ASK_ENHANCE.test(question)) return null;
  const job = JOBS.find(([re]) => re.test(question))?.[1];
  const bonusOf = (w: EnhanceWeapon) => (w.bonus === "common" ? e.common : (e.mage[w.name] ?? e.common));
  const at = (w: EnhanceWeapon, plus: number) => {
    const b = bonusOf(w)[plus] ?? 0;
    return [w.min * (1 + b / 100), w.max * (1 + b / 100)];
  };
  const range = (w: EnhanceWeapon, plus: number) => {
    const [lo, hi] = at(w, plus);
    return `+${plus} ${+lo.toFixed(1)}~${+hi.toFixed(1)} (중앙 ${+((lo + hi) / 2).toFixed(1)})`;
  };
  const lines = [
    `[무기 강화 수치표 · ${e.source}]`,
    "강화 데미지 = 기본 데미지 x (1 + 가산값 / 100). 가산값 %는 강화도 +0 ~ +15 차례.",
    `전사·레인저·무도가 무기 공통 가산값: ${e.common.map((v, i) => `+${i} ${v}%`).join(", ")}`,
    "마법사 무기는 무기마다 가산값이 다르다 (마법사는 데미지 계산이 달라 실제와 잘 안 맞는다, 앱의 강화 비교도 재미로만 보라고 한다).",
  ];
  const detail = named.length ? named : e.weapons.filter((w) => !job || w.job === job);
  for (const w of detail) {
    const head = `${w.name} (${w.job} Lv.${w.lv}, +0 공격 ${w.min}~${w.max}${w.bonus === "common" ? "" : ", 마법사 가산값 " + bonusOf(w).map((v, i) => `+${i} ${v}%`).join(" ")})`;
    const plus = named.length ? Array.from({ length: 16 }, (_, i) => i) : [0, 6, 7, 8, 9, 10];
    lines.push(`- ${head}: ${plus.map((p) => range(w, p)).join(" / ")}`);
  }
  if (!named.length && job) lines.push(`(${job} 무기 ${detail.length}개. 다른 직업 무기는 묻는 사람에게 [[화면:강화 비교]] 를 권하거나 다시 물으면 된다)`);
  lines.push("강화 비교 화면([[화면:강화 비교]])에서 두 무기와 강화도를 골라 몇 % 세지는지 본다.");
  return { text: lines.join("\n"), found: ["무기 강화 수치표", ...named.map((w) => w.name)] };
}

function statLine(s: Stat) {
  const move = s.recent != null && s.before != null && s.before > 0 && Math.abs(s.recent / s.before - 1) > 0.1 ? ` · 최근 7일 ${won(s.recent)} (그 전 ${won(s.before)})` : "";
  return `중간값 ${won(s.med)} (범위 ${won(s.min)} ~ ${won(s.max)}, 글 ${s.n}개${s.sellers ? ` · ${s.sellers}명` : ""}, ${s.first ?? ""} ~ ${s.last ?? ""})${move}`;
}

function itemText(it: MarketItem, side: "팝니다" | "삽니다") {
  const lines = [`- ${it.name}${it.abbr.length ? ` (줄임말 ${it.abbr.slice(0, 4).join(", ")})` : ""} [${side}, ${it.cat ?? "기타"}${it.each ? ", 값은 한 개 값 ('500개 2장' 같은 묶음 글도 개수로 나눔)" : ""}]: ${statLine(it)}`];
  if (it.other) lines.push(`  · 반대쪽(${side === "팝니다" ? "삽니다" : "팝니다"}) 중간값 ${won(it.other.med)} (글 ${it.other.n}개)`);
  for (const g of it.groups) lines.push(`  · ${g.label}: ${statLine(g)}`);
  if (it.samples.length) lines.push(`  · 원글 예: ${it.samples.join(" | ")}`);
  return lines.join("\n");
}

/** 거래 톡방 시세와 줄임말 */
function marketText(m: ChatMarket, question: string): { text: string; found: string[] } | null {
  const q = norm(question);
  const parts: string[] = [];
  const found: string[] = [];
  // 줄임말: 질문에 든 것 (두 글자 이상, 긴 것부터. '장', '콩' 같은 한 글자는 시세를 물을 때만)
  const keys = Object.keys(m.slang)
    .filter((k) => k.length >= 2 && q.includes(norm(k)))
    .sort((a, b) => b.length - a.length)
    .filter((k, i, all) => !all.slice(0, i).some((longer) => norm(longer).includes(norm(k))))
    .slice(0, 12);
  const terms = new Set<string>(keys.map((k) => m.slang[k]));
  if (keys.length) {
    parts.push("[게임·거래 톡방 줄임말 (길드원·제작자가 알려 준 것)]\n" + keys.map((k) => `- ${k} = ${m.slang[k]}`).join("\n"));
    found.push("줄임말");
  }
  const askPrice = ASK_PRICE.test(question);
  const hit = (it: MarketItem) => {
    const n = norm(it.name.replace(/\s*\(.*\)$/, ""));
    return (n.length >= 2 && q.includes(n)) || it.abbr.some((a) => a.length >= 2 && q.includes(norm(a))) || [...terms].some((t) => norm(t).includes(n) && n.length >= 2);
  };
  const sells = m.items.filter(hit);
  const buys = m.itemsBuy.filter(hit);
  const askCostume = /코스튬|코튬|의상|꾸미기|치장/.test(question);
  if (!askPrice && !sells.length && !buys.length && !ASK_CHAR.test(question) && !askCostume) return parts.length ? { text: parts.join("\n\n"), found } : null;
  const head = `[사파이어 앱 시세 동향 · 시리온 거래 톡방 ${m.source.from} ~ ${m.source.to} 글에서 센 값. 단위는 현금(만 원), 파는 사람이 부른 값(팝니다)과 사는 사람이 부른 값(삽니다)을 따로 셌다. 골드 시세: 최근 7일 팝니다 중간값 ${m.gold.sell7 ?? "-"}:1, 삽니다 ${m.gold.buy7 ?? "-"}:1 (1만 원에 N만 골드). 실제 거래가가 아니라 부른 값이다]`;
  const body: string[] = [];
  for (const it of sells.slice(0, 6)) body.push(itemText(it, "팝니다"));
  for (const it of buys.slice(0, 4)) body.push(itemText(it, "삽니다"));
  if ((sells.length || buys.length) && body.length) found.push("톡방 시세: " + [...new Set([...sells, ...buys].map((x) => x.name))].slice(0, 6).join(", "));
  if (!sells.length && !buys.length && askPrice) {
    // 이름을 못 찾은 시세·돈벌이 질문: 많이 거래되는 물건 목록 (돈 되는 물건이 무엇인지)
    body.push(
      "많이 올라온 물건 (팝니다, 글 수 순, 중간값):\n" +
        [...m.items]
          .sort((a, b) => b.n - a.n)
          .slice(0, 40)
          .map((it) => `${it.name} ${won(it.med)} (${it.n})`)
          .join(", "),
    );
    body.push(`골드 시세 날짜별 (날짜, 팝니다, 삽니다 N:1): ${m.gold.days.map(([d, s, b]) => `${d.slice(5)} ${s ?? "-"}/${b ?? "-"}`).join(", ")}`);
    found.push("톡방 시세");
  }
  // 코스튬을 물으면(어떤 코스튬인지 안 적어도) 톡방에 올라온 코스튬 시세를 글 수 순으로 (챗봇 개선 2026-11-10: '코스튬 코인 남는 건 랜덤 코스튬 상자를 만들어 팔까'에 코스튬 시세가 없다고 했다)
  if (/코스튬|코튬|의상|꾸미기|치장/.test(question)) {
    const costumes = m.items.filter((it) => it.cat === "코스튬" && !sells.includes(it)).sort((a, b) => b.n - a.n).slice(0, 30);
    if (costumes.length) {
      body.push("코스튬 시세 (팝니다, 글 수 순, 중간값 · 범위 · 글 수):\n" + costumes.map((it) => `${it.name} ${won(it.med)} (${won(it.min)} ~ ${won(it.max)}, ${it.n})`).join(", "));
      found.push("톡방 코스튬 시세");
    }
  }
  if (ASK_CHAR.test(question) && m.chars.length) {
    body.push("캐릭터 시세 (팝니다, 레벨대별 중간값, 만 원): " + m.chars.map((c) => `${c.band} ${won(c.med)} (범위 ${won(c.min)} ~ ${won(c.max)}, ${c.n}개)`).join(", "));
    found.push("캐릭터 시세");
  }
  if (!body.length) return parts.length ? { text: parts.join("\n\n"), found } : null;
  parts.push(head + "\n" + body.join("\n"));
  return { text: parts.join("\n\n"), found };
}

/** 질문에 맞는 강화 수치표·시세·줄임말 (없으면 빈 글) */
export async function appDataContext(question: string): Promise<{ text: string; found: string[] }> {
  const [e, m] = await Promise.all([load<Enhance>("/data/enhance.json"), load<ChatMarket>("/data/chatmarket.json")]);
  const outs = [e && enhanceText(e, question), m && marketText(m, question)].filter(Boolean) as { text: string; found: string[] }[];
  return { text: outs.map((o) => o.text).join("\n\n"), found: outs.flatMap((o) => o.found) };
}
