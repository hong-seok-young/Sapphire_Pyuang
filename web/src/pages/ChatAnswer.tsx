import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import type { Wiki } from "../types";
import { monstersByName } from "../data";
import { PicImg, levelText } from "../ui";

/**
 * 챗봇 답 그리기 (제작자 요청: 줄글만 말고 그림을 쓰고, 눌러서 그 화면으로 가게, 아이모 게임답게).
 * 서버의 시스템 프롬프트(functions/api/chat.ts)가 쓰게 한 표시를 바꿔 그린다.
 *   ## 소제목 / - 목록 / 1. 순서 / **굵게**
 *   [[아이템:이름]] [[몬스터:이름]] [[사냥터:이름]] [[메뉴:이름]] [[화면:이름]] -> 그림이 붙은 단추 (누르면 그 화면)
 *   [[질문:...]] -> 답 아래 추천 질문 단추 (누르면 바로 묻는다)
 * 위키에 없는 이름은 글자만 보인다. 답이 다 오기 전의 끊긴 표시는 글자로 둔다
 */

type Kind = "아이템" | "몬스터" | "사냥터" | "메뉴" | "화면";

const SCREENS: Record<string, string> = {
  "길드 랭킹": "#/ranking", 랭킹: "#/ranking", "사파이어 중개인": "#/market", 중개인: "#/market", "길드원 의뢰소": "#/requests",
  의뢰소: "#/requests", 게시판: "#/board", "플래티넘 할인 상점": "#/shop", 상점: "#/shop", 검색: "#/search", "내 정보": "#/me",
  알림: "#/alerts", 장비: "#/equip", 사냥터: "#/places", 챗봇: "#/chat",
};

interface Target {
  kind: Kind;
  name: string;
  to: string;
  icon: ReactNode;
  /** 아래 카드에 쓰는 한 줄 */
  sub?: string;
  /** 카드 그림 */
  big?: ReactNode;
}

const TOKEN = /\[\[(아이템|몬스터|사냥터|메뉴|화면|질문|모름):([^\]\n]{1,200})\]\]/g;
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function useResolver(wiki: Wiki) {
  return useMemo(() => {
    const byName = monstersByName(wiki);
    const placeByName = new Map(Object.values(wiki.places).map((p) => [squash(p.name), p]));
    const itemByName = new Map(Object.keys(wiki.items).map((n) => [squash(n), n]));
    const monsterNames = new Map([...byName.keys()].map((n) => [squash(n), n]));
    return (kind: Kind, raw: string): Target | null => {
      const key = squash(raw);
      if (kind === "아이템") {
        const name = itemByName.get(key);
        if (!name) return null;
        const it = wiki.items[name];
        const from = new Set(it.from.map((k) => wiki.monsters[k]?.name).filter(Boolean)).size;
        return {
          kind, name, to: "#/item/" + encodeURIComponent(name),
          icon: <PicImg pic={it.icon} fit={18} />, big: <PicImg pic={it.icon} fit={40} />,
          sub: [it.equip[0]?.slot, from ? `${from}마리가 떨굼` : ""].filter(Boolean).join(" · "),
        };
      }
      if (kind === "몬스터") {
        const name = monsterNames.get(key);
        if (!name) return null;
        const ms = byName.get(name) ?? [];
        const m = ms[0];
        const place = m && wiki.places[m.place];
        return {
          kind, name, to: "#/monster/" + encodeURIComponent(name),
          icon: <PicImg pic={m?.img} max={20} />, big: <PicImg pic={m?.img} max={44} />,
          sub: [m?.level ? `Lv.${m.level}` : "", place?.name ?? ""].filter(Boolean).join(" · "),
        };
      }
      if (kind === "사냥터") {
        // 지도 그림을 되풀이하지 않고 (제작자 요청) 그 사냥터에서 잡는 몬스터 그림을 붙인다: 단추는 가장 센 몬스터, 카드는 셋
        const p = placeByName.get(key);
        if (!p) return null;
        const mons = p.monsters
          .map((k) => wiki.monsters[k])
          .filter((m) => m?.img)
          .sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
        return {
          kind, name: p.name, to: "#/place/" + p.id,
          icon: mons[0] ? <PicImg pic={mons[0].img} max={20} /> : null,
          big: mons.length ? (
            <span className="ans-card-mons">
              {mons.slice(0, 3).map((m) => <PicImg key={m.key} pic={m.img} max={30} />)}
            </span>
          ) : undefined,
          sub: [levelText(p.level), p.region].filter(Boolean).join(" · "),
        };
      }
      if (kind === "메뉴") {
        const s = wiki.menu.find((m) => squash(m.title) === key);
        return s ? { kind, name: s.title, to: "#/menu/" + encodeURIComponent(s.title), icon: "📖" } : null;
      }
      const to = SCREENS[raw.trim()] ?? Object.entries(SCREENS).find(([n]) => squash(n) === key)?.[1];
      return to ? { kind, name: raw.trim(), to, icon: "🧭" } : null;
    };
  }, [wiki]);
}

/** 한 줄 안의 **굵게**, [[...]] */
function inline(text: string, resolve: ReturnType<typeof useResolver>, seen: Target[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const pushText = (t: string) => {
    t.split(/(\*\*[^*\n]+\*\*)/).forEach((part, i) => {
      if (!part) return;
      out.push(
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={`${keyBase}b${n}-${i}`}>{part.slice(2, -2)}</b> : <Fragment key={`${keyBase}t${n}-${i}`}>{part}</Fragment>,
      );
    });
  };
  for (const m of text.matchAll(TOKEN)) {
    pushText(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    n++;
    if (m[1] === "질문" || m[1] === "모름") continue; // 추천 질문은 아래로, 모르는 부분은 개발자에게 (아래 한 줄로만 알린다)
    const t = resolve(m[1] as Kind, m[2]);
    if (!t) {
      out.push(<b key={`${keyBase}x${n}`}>{m[2]}</b>);
      continue;
    }
    if (!seen.some((s) => s.to === t.to)) seen.push(t);
    out.push(
      <a key={`${keyBase}c${n}`} className={"ans-chip ans-chip-" + t.kind} href={t.to}>
        {t.icon && <span className="ans-chip-icon">{t.icon}</span>}
        {t.name}
      </a>,
    );
  }
  pushText(text.slice(last));
  return out;
}

export function ChatAnswer({ wiki, text, done, onAsk }: { wiki: Wiki; text: string; done: boolean; onAsk: (q: string) => void }) {
  const resolve = useResolver(wiki);
  const seen: Target[] = [];
  const asks = [...text.matchAll(TOKEN)].filter((m) => m[1] === "질문").map((m) => m[2].trim());
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = (i: number) => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={`l${i}`} className="ans-list">{list.items}</Tag>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const onlyAsks = line.replace(TOKEN, (all, kind) => (kind === "질문" || kind === "모름" ? "" : all)).trim() === "" && /\[\[(질문|모름):/.test(line);
    if (onlyAsks) return;
    const head = line.match(/^#{2,3}\s+(.*)$/);
    const bullet = line.match(/^\s*[-•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (head) {
      flush(i);
      blocks.push(<h3 key={`h${i}`} className="ans-h">{inline(head[1], resolve, seen, `h${i}`)}</h3>);
    } else if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush(i);
        list = { ordered, items: [] };
      }
      list.items.push(<li key={`i${i}`}>{inline((bullet ?? num)![1], resolve, seen, `i${i}`)}</li>);
    } else if (line.trim() === "") {
      flush(i);
    } else {
      flush(i);
      blocks.push(<p key={`p${i}`} className={"ans-p" + (line.startsWith("📍") ? " ans-route" : "")}>{inline(line, resolve, seen, `p${i}`)}</p>);
    }
  });
  flush(lines.length);
  const cards = seen.filter((t) => t.big).slice(0, 6);
  return (
    <div className="ans">
      {blocks}
      {done && cards.length > 0 && (
        <div className="ans-cards">
          {cards.map((c) => (
            <a key={c.to} className="ans-card" href={c.to}>
              <span className="ans-card-pic">{c.big}</span>
              <b>{c.name}</b>
              {c.sub && <small>{c.sub}</small>}
            </a>
          ))}
        </div>
      )}
      {done && /\[\[모름:/.test(text) && <div className="ans-gap">📝 자료가 모자란 부분은 개발자에게 알렸어요. 고치면 알려 드릴게요</div>}
      {done && asks.length > 0 && (
        <div className="ans-asks">
          {asks.slice(0, 3).map((q) => (
            <button key={q} className="pill" onClick={() => onAsk(q)}>
              💬 {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
