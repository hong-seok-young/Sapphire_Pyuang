import { useEffect, useMemo, useState } from "react";
import type { Wiki } from "../types";
import { search } from "../search";
import { go } from "../router";
import { FavStar, PicImg, TopBar } from "../ui";
import { monstersByName } from "../data";
import { forgetSearch, recentSearches, rememberSearch, useFavorites } from "../favorites";
import type { FavKind } from "../favorites";
import { TYPE_NAME, fetchOfficial } from "../official";
import type { OfficialItem } from "../official";
import { ScamRows, fetchScam, matches, scamSource } from "./Scam";
import type { ScamList } from "./Scam";

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

/**
 * 아이모 소식에서도 찾는다 (제작자 2026-11-06 '시너지 다 하자'): 제목·본문·그림 속 글자 (server/officialSearch.ts, 띄어쓰기 상관없이).
 * 글자를 칠 때마다 묻지 않게 0.6초 기다린 뒤, 두 글자 이상일 때만. 받기 전은 null
 */
function useOfficialHits(q: string): OfficialItem[] | null {
  const [items, setItems] = useState<OfficialItem[] | null>(null);
  useEffect(() => {
    setItems(null);
    if (q.replace(/\s+/g, "").length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchOfficial("all", undefined, q.trim()).then(
        (r) => alive && setItems(r.items),
        () => alive && setItems([]),
      );
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);
  return items;
}

/**
 * 아이모 사기꾼 명단에서도 찾는다 (제작자 2026-11-11 'db 에 넣어 = 챗봇이나 검색 등 우리 웹이 얼마든지 활용할 수 있게'): 이름·닉네임·폰 뒷자리·계좌 숫자.
 * 명단은 이번에 연 동안 한 번만 받는다 (pages/Scam.tsx, GET /api/scam)
 */
let scamOnce: Promise<ScamList | null> | null = null;
function useScamHits(q: string): { list: ScamList; rows: ScamList["rows"] } | null {
  const [list, setList] = useState<ScamList | null>(null);
  const on = q.replace(/\s+/g, "").length >= 2;
  useEffect(() => {
    if (!on || list) return;
    let alive = true;
    scamOnce ??= fetchScam().then((r) => r.list, () => ((scamOnce = null), null));
    scamOnce.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [on, list]);
  if (!on || !list) return null;
  const rows = list.rows.filter((r) => matches(r, q));
  return rows.length ? { list, rows } : null;
}

const HIT_NAME: Record<string, string> = { body: "본문", image: "그림 속 글자" };
const OFFICIAL_MAX = 8;

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
  const official = useOfficialHits(q);
  const scam = useScamHits(q);

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
      {scam && (
        <section className="search-scam">
          <h2 className="panel-title">사기꾼 명단 {scam.rows.length}</h2>
          <ScamRows rows={scam.rows} />
          <div className="scam-foot">{scamSource(scam.list)}</div>
        </section>
      )}
      {q && !hits.length && !scam && official && !official.length && <div className="empty">"{q}" 검색 결과가 없어요.</div>}
      <ul className="list">
        {hits.map((h) => {
          const key = h.kind === "place" ? h.to.split("/").pop()! : h.name;
          return <HitRow key={h.kind + h.name} wiki={wiki} byName={byName} kind={h.kind} name={h.name} fkey={key} to={h.to} onOpen={remember} />;
        })}
      </ul>
      {q && !!official?.length && (
        <section className="search-off">
          <h2 className="panel-title">아이모 소식 {official.length > OFFICIAL_MAX ? `${OFFICIAL_MAX}+` : official.length}</h2>
          <ul className="list">
            {official.slice(0, OFFICIAL_MAX).map((it) => (
              <li key={it.id} className="hit">
                <a className="row" href={`#/official/${it.id}`} onClick={remember}>
                  <span className="row-main">
                    <span className="row-title">{it.title}</span>
                    <span className="row-sub">
                      {it.start ?? ""}
                      {it.hit && HIT_NAME[it.hit] ? ` · ${HIT_NAME[it.hit]}` : ""}
                    </span>
                  </span>
                  <span className={"off-type off-type-" + it.type}>{TYPE_NAME[it.type] ?? it.type}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
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
