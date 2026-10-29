import type { Monster, Wiki } from "./types";
import { PicImg, num } from "./ui";

/** 드랍 아이템: 아이콘 + 이름, 누르면 아이템 화면 */
export function DropChips({ wiki, names }: { wiki: Wiki; names: string[] }) {
  return (
    <ul className="chips">
      {names.map((n) => (
        <li key={n}>
          <a className="chip" href={"#/item/" + encodeURIComponent(n)}>
            <PicImg pic={wiki.items[n]?.icon} fit={22} />
            <span>{n}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function MonsterCard({ wiki, m, showPlace = false, link = true }: {
  wiki: Wiki;
  m: Monster;
  showPlace?: boolean;
  link?: boolean;
}) {
  const place = wiki.places[m.place];
  const head = (
    <>
      <div className="mon-pic">
        <PicImg pic={m.img} scale={m.img && m.img.h < 50 ? 2 : 1} max={96} alt={m.name} />
      </div>
      <div className="mon-head">
        <div className="mon-name">
          {m.name} <span className="lv">Lv.{m.level ?? "?"}</span>
        </div>
        <div className="mon-stats">
          HP {num(m.hp)} · {m.traits}
        </div>
        {showPlace && place && <div className="mon-place">📍 {place.name}</div>}
        {m.respawn && <div className="mon-sub">⏱ 재부활 {m.respawn}</div>}
      </div>
    </>
  );
  return (
    <article className="mon card">
      {link ? (
        <a className="mon-top" href={"#/monster/" + encodeURIComponent(m.name)}>
          {head}
        </a>
      ) : (
        <div className="mon-top">{head}</div>
      )}
      {m.skill && (
        <div className="mon-skill">
          <b>스킬</b> {m.skill}
          {m.note && <div className="mon-note">{m.note}</div>}
        </div>
      )}
      {!m.skill && m.note && <div className="mon-note">{m.note}</div>}
      {m.drops.length > 0 && <DropChips wiki={wiki} names={m.drops} />}
    </article>
  );
}

/** '《 이동 》 / 1. 석상 ... / 《 퀘스트 》 / ...' -> 제목별 목록 */
export function PlaceInfo({ text }: { text: string }) {
  const sections: { title: string; lines: string[] }[] = [];
  for (const part of text.split(" / ")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^《\s*(.+?)\s*》$/);
    if (m) sections.push({ title: m[1], lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(t);
  }
  if (!sections.length) return null;
  return (
    <div className="place-info">
      {sections.map((s) => (
        <div key={s.title} className="place-info-sec">
          <h3>{s.title}</h3>
          <ul>
            {s.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
