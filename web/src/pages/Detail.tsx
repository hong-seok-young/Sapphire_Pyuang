import { useMemo } from "react";
import type { Wiki } from "../types";
import { PicImg, TopBar, NotFound, Panel } from "../ui";
import { MonsterCard } from "../wiki-ui";
import { monstersByName } from "../data";

export function MonsterPage({ wiki, name }: { wiki: Wiki; name: string }) {
  const list = useMemo(() => monstersByName(wiki).get(name) ?? [], [wiki, name]);
  if (!list.length) return <NotFound what="몬스터" />;
  return (
    <>
      <TopBar title={name} />
      <div className="detail-hero">
        <PicImg pic={list[0].img} scale={2} max={180} alt={name} />
      </div>
      {list.length > 1 && <div className="muted center">{list.length}곳에 나와요</div>}
      {list.map((m) => (
        <MonsterCard key={m.key} wiki={wiki} m={m} showPlace link={false} />
      ))}
    </>
  );
}

export function ItemPage({ wiki, name }: { wiki: Wiki; name: string }) {
  const it = wiki.items[name];
  const droppers = useMemo(
    () => (it ? it.from.map((k) => wiki.monsters[k]).filter(Boolean).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)) : []),
    [wiki, it],
  );
  if (!it) return <NotFound what="아이템" />;
  return (
    <>
      <TopBar title={name} />
      <div className="detail-hero">
        <PicImg pic={it.icon} fit={80} alt={name} />
        <div className="detail-name">{name}</div>
      </div>

      {it.equip.map((e, i) => (
        <Panel key={i} title={"장비 · " + e.slot}>
          <dl className="kv">
            {Object.entries(e.info)
              .filter(([k, v]) => k !== "이미지" && k !== "아이템명" && v && v !== "-")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          <a className="more" href={"#/equip/" + encodeURIComponent(e.slot)}>
            {e.slot} 전체 보기 ▶
          </a>
        </Panel>
      ))}

      <Panel title={droppers.length ? `떨구는 몬스터 (${droppers.length})` : "떨구는 몬스터"}>
        {!droppers.length && <div className="muted">드랍표에 나오는 몬스터가 없어요. 퀘스트, 제작, 상점으로 얻는 아이템일 수 있어요.</div>}
        <ul className="list">
          {droppers.map((m) => (
            <li key={m.key}>
              <a className="row" href={"#/monster/" + encodeURIComponent(m.name)}>
                <span className="row-pic">
                  <PicImg pic={m.img} max={40} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    {m.name} <span className="lv">Lv.{m.level ?? "?"}</span>
                  </span>
                  <span className="row-sub">📍 {wiki.places[m.place]?.name}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
