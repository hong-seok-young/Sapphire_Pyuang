// 기부 내역의 물건 이름 (제작자 2026-11-12 '이런 것들 정식 용어로 바꾸고 아이콘도 넣어서 이쁘게 정리'): 기부자별 내역(길드 톡방)과 기부함에 적힌 글
// ('지3 마나17 마재1 +5 망장', '사멧 60개 · 딸기빙수 600개', '분배금 (공동 기부)')을 물건마다 나눠 정식 이름(위키·아이템 책, 줄임말은 book.abbr)과 그림,
// 강화·개수·옵션(정식 옵션 이름)으로 그린다. 저장된 글은 그대로 두고 보일 때만 바꾼다
import { itemPic, knownItem, useBook } from "../data";
import type { Book } from "../data";
import type { Pic, Wiki } from "../types";
import { PicImg } from "../ui";

/** 옵션 줄임말 -> 정식 이름 (게임 정보창 이름) */
const OPT: Record<string, string> = {
  명: "명중", 명중: "명중", 크: "크리티컬", 크리: "크리티컬", 크리티컬: "크리티컬", 힘: "힘", 민: "민첩", 민첩: "민첩", 지: "지능", 지능: "지능",
  체: "체력", 체력: "체력", 마: "마나", 마나: "마나", 마재: "마나재생", 마나재생: "마나재생", 체젠: "체력재생", 체재: "체력재생", 체력재생: "체력재생",
  이속: "이동속도", 이동속도: "이동속도", 속저: "속성저항", 속성저항: "속성저항", 회: "회피", 회피: "회피",
};
const OPT_RE = new RegExp(`^(${Object.keys(OPT).sort((a, b) => b.length - a.length).join("|")})(\\d+(?:\\.\\d+)?%?)$`);
/** 골드로 낸 것 (동전 그림) */
const GOLD_WORDS = new Set(["골드", "분배금"]);
/** 게임 밖 물건 (현금 가치로 셈한 것): 보일 이름과 그림 글자 */
const CASH: Record<string, [string, string]> = { 큐브라떼: ["메가커피 큐브라떼", "☕"] };
const COIN = "/data/market/coin.png";

export interface GiftPart {
  /** 보일 이름 (정식 이름) */
  name: string;
  /** 적힌 이름과 다르면 적힌 말 ('사멧') */
  was?: string;
  enhance: number;
  /** '×60', '3통' */
  qty: string;
  /** '지능 3 · 마나 17' */
  opts: string;
  /** 괄호 글 ('공동 기부') */
  note: string;
  pic?: Pic;
  /** 그림 대신 글자 그림 */
  glyph?: string;
  coin?: boolean;
}

const squashAbbr = new WeakMap<Book, Map<string, string[]>>();
function abbrOf(book: Book | null | undefined, word: string): string | undefined {
  if (!book) return undefined;
  let m = squashAbbr.get(book);
  if (!m) {
    m = new Map(Object.entries(book.abbr).map(([a, n]) => [a.replace(/\s+/g, ""), n]));
    squashAbbr.set(book, m);
  }
  const hit = m.get(word.replace(/\s+/g, ""));
  return hit?.length ? hit[0] : undefined;
}

/** 물건 이름 하나를 정식 이름으로: 위키·책에 그대로 있으면 그 이름(띄어쓰기도 정식대로), 줄임말이면 푼 이름, 모르면 적힌 그대로 */
export function officialName(wiki: Wiki | null | undefined, book: Book | null | undefined, raw: string): string {
  const t = raw.trim();
  return knownItem(wiki, book, t) ?? abbrOf(book, t) ?? t;
}

/** 기부 글 하나를 물건마다 나눈다 */
export function giftParts(label: string, wiki: Wiki | null | undefined, book: Book | null | undefined): GiftPart[] {
  return label
    .split(/\s+·\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      let note = "";
      let s = piece.replace(/\s*\(([^)]*)\)\s*$/, (_, n: string) => {
        note = n.trim();
        return "";
      });
      let enhance = 0;
      let qty = "";
      const opts: string[] = [];
      const name: string[] = [];
      for (const tok of s.split(/\s+/)) {
        let m: RegExpExecArray | null;
        if ((m = /^\+(\d{1,2})$/.exec(tok))) enhance = Number(m[1]);
        else if ((m = /^\+(\d{1,2})(\D.*)$/.exec(tok)) && !name.length) {
          enhance = Number(m[1]);
          name.push(m[2]);
        } else if ((m = /^(?:x|×)(\d+)$/i.exec(tok)) || (m = /^(\d+)개$/.exec(tok))) qty = `×${Number(m[1]).toLocaleString()}`;
        else if (/^\d+통$/.test(tok)) qty = tok;
        else if ((m = OPT_RE.exec(tok))) opts.push(`${OPT[m[1]]} ${m[2]}`);
        else name.push(tok);
      }
      s = name.join(" ");
      const part: GiftPart = { name: s, enhance, qty, opts: opts.join(" · "), note };
      if (GOLD_WORDS.has(s.replace(/\s+/g, ""))) return { ...part, coin: true };
      const cash = CASH[s.replace(/\s+/g, "")];
      if (cash) return { ...part, name: cash[0], was: s, glyph: cash[1] };
      const full = officialName(wiki, book, s);
      const pic = itemPic(wiki, book, full);
      return { ...part, name: full, was: full.replace(/\s+/g, "") !== s.replace(/\s+/g, "") ? s : undefined, pic };
    });
}

function PartIcon({ p, size }: { p: GiftPart | undefined; size: number }) {
  if (p?.coin) return <img className="gf-coin" src={COIN} alt="" style={{ width: size, height: size }} draggable={false} />;
  if (p?.pic) return <PicImg pic={p.pic} fit={size} />;
  return <span className="gf-glyph" style={{ fontSize: Math.round(size * 0.78) }}>{p?.glyph ?? "🎁"}</span>;
}

/** 줄 왼쪽 그림: 첫 물건, 여럿이면 뒤에 겹친 둘째 그림과 '+2' */
export function GiftIcon({ parts, size = 22 }: { parts: GiftPart[]; size?: number }) {
  return (
    <span className={"gf-ic" + (parts.length > 1 ? " gf-ic-many" : "")} style={{ width: size + 6, height: size + 6 }}>
      {parts.length > 1 && (
        <span className="gf-ic-back">
          <PartIcon p={parts[1]} size={Math.round(size * 0.72)} />
        </span>
      )}
      <span className="gf-ic-front">
        <PartIcon p={parts[0]} size={size} />
      </span>
      {parts.length > 1 && <b className="gf-ic-n">+{parts.length - 1}</b>}
    </span>
  );
}

/** 물건 이름들: 물건마다 '[작은 그림] +5 망자의장갑 ×60' 과 옵션 (물건이 하나면 작은 그림 없이) */
export function GiftTitle({ parts }: { parts: GiftPart[] }) {
  const many = parts.length > 1;
  return (
    <span className="gf-title">
      {parts.map((p, i) => (
        <span key={i} className="gf-part">
          {many && <PartIcon p={p} size={15} />}
          <span className="gf-main">
            {p.enhance > 0 && <b className="gf-plus">+{p.enhance}</b>}
            <span className={"gf-name" + (p.coin ? " gf-gold" : "")}>{p.name}</span>
            {p.qty && <em className="gf-qty">{p.qty}</em>}
            {p.note && <i className="gf-note">{p.note}</i>}
          </span>
          {p.opts && <small className="gf-opts">{p.opts}</small>}
        </span>
      ))}
    </span>
  );
}

/** 이름 글 하나를 받아 책을 기다려 나눠 주는 훅 */
export function useGiftParts(label: string, wiki: Wiki | null | undefined): GiftPart[] {
  const book = useBook();
  return giftParts(label, wiki, book);
}

/** 줄 왼쪽 그림 (글 하나로) */
export function GiftIconOf({ label, wiki, size = 22 }: { label: string; wiki: Wiki | null | undefined; size?: number }) {
  return <GiftIcon parts={useGiftParts(label, wiki)} size={size} />;
}
/** 물건 이름들 (글 하나로) */
export function GiftTitleOf({ label, wiki }: { label: string; wiki: Wiki | null | undefined }) {
  return <GiftTitle parts={useGiftParts(label, wiki)} />;
}
