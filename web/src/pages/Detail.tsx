import { useCallback, useEffect, useMemo, useState } from "react";
import type { Wiki } from "../types";
import { TYPE_NAME, fetchItemEvents } from "../official";
import type { ItemEvent } from "../official";
import { ImageText } from "./ImageText";
import { FavStar, PicImg, TopBar, NotFound, Panel } from "../ui";
import { MonsterCard } from "../wiki-ui";
import { ControlMonsterBox } from "./Control";
import { bookOf, loadBook, monstersByName, useAsync } from "../data";
import type { Book, BookVariant } from "../data";

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
      <ControlMonsterBox wiki={wiki} keys={list.map((m) => m.key)} />
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

const md = (d: string) => d.slice(5).replace("-", "/");
const GRADE: Record<string, string> = { 일반: "common", 고급: "fine", 희귀: "rare", 영웅: "hero", 전설: "legend" };
/** 변형 칸 제목: '게임 정보 · 코스튬 모자' */
const variantTitle = (v: BookVariant) =>
  (v.t === "상점" || v.t === "상자" || v.t === "가챠" ? "게임 상점" : "게임 정보") +
  " · " +
  (v.t === "일반" ? (v.s ?? "아이템") : v.t === "상점" ? (v.s ?? "상품") : v.t + (v.s ? " " + v.s : ""));

/**
 * 아이템 책의 한 변형 (제작자 2026-11-12 'DB 에는 정보가 있는데 웹이 활용 못 하는 부분 싹 다'): 게임 도감 정보 사전의 등급·요구 레벨·직업·능력치·세트·설명,
 * 게임 상점의 플래티넘 값·구매 제한·구성품, 톡방 시세, 들어가는 도감 항목. '??' 는 게임이 가린 값 그대로.
 * 게임 거래소 녹화 최저가는 보이지 않는다 (제작자 2026-11-12: 항상 새로 찍어 줄 수 없는 값이라 러프한 도감 계산기에만)
 */
function BookPanel({ v, has, book }: { v: BookVariant; has: (n: string) => boolean; book: Book }) {
  const chips = [
    v.lv ? `요구 레벨 ${v.lv}` : "",
    v.jobs && v.jobs.length < 4 ? v.jobs.join("·") : "",
    v.sex && v.sex.length === 1 ? v.sex[0] : "",
    v.cd ? `쿨타임 ${v.cd}초` : "",
    v.cash ? `캐쉬샵 ${v.cash}` : "",
  ].filter(Boolean);
  return (
    <Panel title={variantTitle(v)} className="bk">
      {(v.g || chips.length > 0 || v.nt) && (
        <div className="bk-chips">
          {v.g && <span className={"bk-grade bk-" + (GRADE[v.g] ?? "common")}>{v.g}</span>}
          {chips.map((c) => (
            <span key={c}>{c}</span>
          ))}
          {v.nt && <span className="bk-nt">거래불가</span>}
        </div>
      )}
      {v.plat != null && (
        <div className="bk-plat">
          <b>{v.plat.toLocaleString("ko-KR")}</b> 플래티넘{v.cnt ? ` · ${v.cnt}개` : ""}
          {v.limit && <small> · {v.limit.replace(/\s*:\s*/, " ")}</small>}
        </div>
      )}
      {!!v.st?.length && (
        <dl className="kv">
          {v.st.map(([k, x], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{x}</dd>
            </div>
          ))}
        </dl>
      )}
      {v.set?.map((s) => (
        <div key={s} className="bk-set">
          {s}
        </div>
      ))}
      {v.desc && <p className="bk-desc">{v.desc}</p>}
      {!!v.lines?.length && (
        <div className="bk-lines">
          {v.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      {!!v.parts?.length && (
        <div className="bk-parts">
          {v.parts.map(([n, c]) =>
            has(n) ? (
              <a key={n} href={"#/item/" + encodeURIComponent(n)}>
                {n}
                {c > 1 ? ` x${c}` : ""}
              </a>
            ) : (
              <span key={n}>
                {n}
                {c > 1 ? ` x${c}` : ""}
              </span>
            ),
          )}
        </div>
      )}
      {!!v.more?.length && (
        <div className="bk-more">
          {v.more.map((p) => (
            <PicImg key={p.src} pic={p} fit={32} />
          ))}
        </div>
      )}
      {v.tk && (
        <div className="bk-tk">
          거래 톡방 팝니다 중간값{" "}
          <b>{v.tk.med >= 1 ? `${+v.tk.med.toFixed(1)}만 원` : `${Math.round(v.tk.med * 10000).toLocaleString("ko-KR")}원`}</b>
          <small>
            {" "}
            글 {v.tk.n}
            {v.tk.to ? ` · ~${md(v.tk.to)}` : ""}
          </small>
        </div>
      )}
      {!!v.dex?.length && (
        <div className="bk-dex">
          <div className="bk-dex-head">들어가는 도감 {v.dex.length}</div>
          {v.dex.map(([e, p, n], i) => (
            <span key={i}>
              {e}
              <small>
                {p ? ` +${p}` : ""}
                {n > 1 ? ` ${n}개` : ""}
              </small>
            </span>
          ))}
        </div>
      )}
      {v.src && <div className="bk-src">{v.src === "도감 정보" ? book.src.book : v.src}</div>}
    </Panel>
  );
}

export function ItemPage({ wiki, name, job = null }: { wiki: Wiki; name: string; job?: string | null }) {
  // 띄어쓰기만 다른 옛 이름(합치기 전 링크·즐겨찾기, 예 '스카우트띠')도 같은 아이템으로 (build_data.py 의 aka)
  const it = wiki.items[name] ?? Object.values(wiki.items).find((x) => x.name.replace(/\s+/g, "") === name.replace(/\s+/g, "") || x.aka?.includes(name));
  const droppers = useMemo(
    () => (it ? it.from.map((k) => wiki.monsters[k]).filter(Boolean).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)) : []),
    [wiki, it],
  );
  // 아이템 책: 위키 드랍표에 없는 게임 아이템(코스튬·펫·소모품·상점 상품)도 이 화면으로 연다. 위키 아이템에는 게임 정보·거래소 값·도감 칸을 더한다
  const { data: book, error: bookError } = useAsync(useCallback(() => loadBook(), []), "book");
  const variants = bookOf(book, it?.name ?? name);
  if (!it && !variants.length) {
    if (!book && !bookError) return <TopBar title={name} />; // 책을 받는 중
    return <NotFound what="아이템" />;
  }
  const has = (n: string) => !!wiki.items[n] || !!book?.items[n];
  return (
    <>
      <TopBar title={name} star={<FavStar kind="item" fkey={name} name={name} className="topbar-me" />} />
      <div className="detail-hero">
        <PicImg pic={it?.icon ?? variants.find((v) => v.pic)?.pic} fit={80} alt={name} />
        <div className="detail-name">{name}</div>
      </div>

      {(it?.equip ?? []).map((e, i) => (
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

      {book && variants.map((v, i) => <BookPanel key={i} v={v} has={has} book={book} />)}

      {it && (
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
      )}
      <ItemEvents name={name} job={job} />
    </>
  );
}
