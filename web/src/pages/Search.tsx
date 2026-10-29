import { useMemo } from "react";
import type { Wiki } from "../types";
import { search } from "../search";
import { go } from "../router";
import { PicImg, TopBar } from "../ui";
import { monstersByName } from "../data";

const KIND = { item: "아이템", monster: "몬스터", place: "사냥터" } as const;

export function Search({ wiki, q }: { wiki: Wiki; q: string }) {
  const hits = useMemo(() => search(wiki, q), [wiki, q]);
  const byName = useMemo(() => monstersByName(wiki), [wiki]);

  return (
    <>
      <TopBar title="검색" />
      <div className="search-box">
        <input
          autoFocus
          type="search"
          placeholder="예: 현인의장갑, 다크주노, ㅎㅇㅇㅈㄱ"
          defaultValue={q}
          onChange={(e) => go("#/search?q=" + encodeURIComponent(e.target.value), true)}
        />
      </div>
      {q && !hits.length && <div className="empty">"{q}" 검색 결과가 없어요.</div>}
      <ul className="list">
        {hits.map((h) => {
          const pic =
            h.kind === "item" ? wiki.items[h.name]?.icon
            : h.kind === "monster" ? byName.get(h.name)?.[0]?.img
            : null;
          const sub =
            h.kind === "monster" ? byName.get(h.name)!.map((m) => wiki.places[m.place]?.name).filter(Boolean).join(", ")
            : h.kind === "item" ? itemSub(wiki, h.name)
            : wiki.places[h.to.split("/").pop()!]?.region;
          return (
            <li key={h.kind + h.name}>
              <a className="row" href={h.to}>
                <span className="row-pic">
                  {h.kind === "place" ? "🗺️" : <PicImg pic={pic} scale={h.kind === "item" ? 2 : 1} max={36} />}
                </span>
                <span className="row-main">
                  <span className="row-title">{h.name}</span>
                  <span className="row-sub">{sub}</span>
                </span>
                <span className={"kind kind-" + h.kind}>{KIND[h.kind]}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function itemSub(wiki: Wiki, name: string): string {
  const it = wiki.items[name];
  const parts: string[] = [];
  if (it.equip.length) parts.push(it.equip[0].slot);
  if (it.from.length) parts.push(`${new Set(it.from.map((k) => wiki.monsters[k]?.name)).size}마리가 떨굼`);
  return parts.join(" · ");
}
