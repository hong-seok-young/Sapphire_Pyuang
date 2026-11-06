import { useEffect, useMemo, useState } from "react";
import type { Wiki } from "../types";
import { TYPE_NAME, fetchItemEvents } from "../official";
import type { ItemEvent } from "../official";
import { ImageText } from "./ImageText";
import { FavStar, PicImg, TopBar, NotFound, Panel } from "../ui";
import { MonsterCard } from "../wiki-ui";
import { monstersByName } from "../data";

export function MonsterPage({ wiki, name }: { wiki: Wiki; name: string }) {
  const list = useMemo(() => monstersByName(wiki).get(name) ?? [], [wiki, name]);
  if (!list.length) return <NotFound what="몬스터" />;
  return (
    <>
      <TopBar title={name} star={<FavStar kind="monster" fkey={name} name={name} className="topbar-me" />} />
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

/**
 * 이 아이템이 나오는 공식 이벤트·소식 (제작자 2026-11-06 '시너지 다 하자'): 공식 글 그림 속 표(교환표, 확률표, 보상)와 본문에서 찾은 줄.
 * 누르면 그 글(#/official/번호). 진행 중인 이벤트가 위, 같은 이벤트의 예전 회차는 수만. 없으면 칸을 그리지 않는다
 */
function ItemEvents({ name, job }: { name: string; job: string | null }) {
  const [items, setItems] = useState<ItemEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    fetchItemEvents(name).then(
      (r) => alive && setItems(r),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, [name]);
  if (!items?.length) return null;
  return (
    <Panel title={`공식 이벤트·소식 (${items.length})`}>
      <div className="ie-list">
        {items.map((e) => (
          <div key={e.id} className={"ie" + (e.ongoing ? " ie-on" : "")}>
            <a className="ie-head" href={`#/official/${e.id}`}>
              <span className={"off-type off-type-" + e.type}>{TYPE_NAME[e.type] ?? e.type}</span>
              <b className="ie-title">{e.title}</b>
              <span className="ie-go">›</span>
            </a>
            <small className="ie-sub">
              {e.ongoing && <span className="ie-live">진행 중</span>}
              {(e.start ?? "") + (e.end ? ` ~ ${e.end}` : "")}
              {e.older > 0 && ` · 예전 회차 ${e.older}번`}
              {e.image && " · 그림 속 표"}
            </small>
            <ImageText text={e.text} job={job} mark={name} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ItemPage({ wiki, name, job = null }: { wiki: Wiki; name: string; job?: string | null }) {
  const it = wiki.items[name];
  const droppers = useMemo(
    () => (it ? it.from.map((k) => wiki.monsters[k]).filter(Boolean).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)) : []),
    [wiki, it],
  );
  if (!it) return <NotFound what="아이템" />;
  return (
    <>
      <TopBar title={name} star={<FavStar kind="item" fkey={name} name={name} className="topbar-me" />} />
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
      <ItemEvents name={name} job={job} />
    </>
  );
}
