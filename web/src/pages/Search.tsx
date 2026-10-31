import { useEffect, useMemo, useState } from "react";
import type { Wiki } from "../types";
import { search } from "../search";
import { go } from "../router";
import { FavStar, PicImg, TopBar } from "../ui";
import { monstersByName } from "../data";
import { forgetSearch, recentSearches, rememberSearch, useFavorites } from "../favorites";
import type { FavKind } from "../favorites";

const KIND = { item: "아이템", monster: "몬스터", place: "사냥터" } as const;

/** 검색 결과와 즐겨찾기에 같이 쓰는 한 줄 */
function HitRow({ wiki, byName, kind, name, fkey, to, onOpen }: {
  wiki: Wiki;
  byName: ReturnType<typeof monstersByName>;
  kind: FavKind;
  name: string;
  fkey: string;
  to: string;
  onOpen?: () => void;
}) {
  const pic = kind === "item" ? wiki.items[name]?.icon : kind === "monster" ? byName.get(name)?.[0]?.img : null;
  const sub =
    kind === "monster" ? (byName.get(name) ?? []).map((m) => wiki.places[m.place]?.name).filter(Boolean).join(", ")
    : kind === "item" ? (wiki.items[name] ? itemSub(wiki, name) : "")
    : wiki.places[fkey]?.region;
  return (
    <li className="hit">
      <a className="row" href={to} onClick={onOpen}>
        <span className="row-pic">
          {kind === "place" ? "🗺️" : kind === "item" ? <PicImg pic={pic} fit={32} /> : <PicImg pic={pic} max={36} />}
        </span>
        <span className="row-main">
          <span className="row-title">{name}</span>
          <span className="row-sub">{sub}</span>
        </span>
        <span className={"kind kind-" + kind}>{KIND[kind]}</span>
      </a>
      <FavStar kind={kind} fkey={fkey} name={name} />
    </li>
  );
}

const linkOf = (kind: FavKind, key: string) =>
  kind === "place" ? "#/place/" + key : `#/${kind}/` + encodeURIComponent(key);

export function Search({ wiki, q }: { wiki: Wiki; q: string }) {
  const hits = useMemo(() => search(wiki, q), [wiki, q]);
  const byName = useMemo(() => monstersByName(wiki), [wiki]);
  // 입력칸 글자는 주소(q)를 따라간다. 뒤로 가기나 다른 링크로 주소가 바뀌어도 칸이 옛 글자로 남지 않게
  const [text, setText] = useState(q);
  useEffect(() => setText((t) => (t === q ? t : q)), [q]);
  const favorites = useFavorites();
  // 최근 검색어 (이 기기에만): 결과를 누르거나 엔터를 치면 남긴다 (제작자 요청)
  const [recent, setRecent] = useState(recentSearches);
  const remember = () => rememberSearch(q);

  return (
    <>
      <TopBar title="검색" />
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          remember();
          setRecent(recentSearches());
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <input
          autoFocus
          type="search"
          placeholder="예: 현인의장갑, 다크주노, ㅎㅇㅇㅈㄱ"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            go("#/search?q=" + encodeURIComponent(e.target.value), true);
          }}
        />
      </form>
      {!q && recent.length > 0 && (
        <section className="search-recent">
          <h2 className="panel-title">
            최근 검색
            <button
              className="pill"
              onClick={() => {
                forgetSearch(null);
                setRecent([]);
              }}
            >
              전체 삭제
            </button>
          </h2>
          <div className="filter">
            {recent.map((r) => (
              <span key={r} className="recent-chip">
                <button className="pill" onClick={() => go("#/search?q=" + encodeURIComponent(r), true)}>
                  {r}
                </button>
                <button
                  className="recent-x"
                  aria-label={`${r} 지우기`}
                  onClick={() => {
                    forgetSearch(r);
                    setRecent(recentSearches());
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      {!q && favorites.length > 0 && (
        <section>
          <h2 className="panel-title">즐겨찾기 {favorites.length}</h2>
          <ul className="list">
            {favorites.map((f) => (
              <HitRow key={f.kind + f.key} wiki={wiki} byName={byName} kind={f.kind} name={f.name} fkey={f.key} to={linkOf(f.kind, f.key)} />
            ))}
          </ul>
        </section>
      )}
      {q && !hits.length && <div className="empty">"{q}" 검색 결과가 없어요.</div>}
      <ul className="list">
        {hits.map((h) => {
          const key = h.kind === "place" ? h.to.split("/").pop()! : h.name;
          return <HitRow key={h.kind + h.name} wiki={wiki} byName={byName} kind={h.kind} name={h.name} fkey={key} to={h.to} onOpen={remember} />;
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
