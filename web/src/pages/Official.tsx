import { Fragment, createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../auth";
import { OFFICIAL_TABS, TYPE_NAME, fetchOfficial, fetchOfficialPost, officialLink, officialUrl } from "../official";
import type { OfficialItem, OfficialPost, OfficialTab } from "../official";
import { go } from "../router";
import { Loading, TopBar } from "../ui";

/** 한국 날짜 'YYYY-MM-DD' (며칠 전) */
const kstDay = (daysAgo = 0) => new Date(Date.now() + 9 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

const dates = (it: Pick<OfficialItem, "start" | "end">, today: string) =>
  (it.start ?? "") + (it.end ? ` ~ ${it.end}${it.end < today ? " · 종료" : " · 진행 중"}` : "");

/**
 * 게시판 '아이모 소식' (제작자 요청 2026-11-01): 아이모 공식 홈페이지의 공지사항, 점검, 이벤트를 칸으로 나눠 보인다.
 * 누르면 앱 안에서 읽는다 (#/official/번호). 고른 칸은 주소 ?t= 에 남는다
 */
export function OfficialList({ tab }: { tab: OfficialTab }) {
  const [items, setItems] = useState<OfficialItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    let alive = true;
    setItems(null);
    setMore(false);
    setError("");
    fetchOfficial(tab).then(
      (r) => {
        if (!alive) return;
        setItems(r.items);
        setMore(r.more);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [tab]);

  async function loadMore() {
    if (!items?.length) return;
    setBusy(true);
    try {
      const r = await fetchOfficial(tab, items[items.length - 1].id);
      if (tabRef.current !== tab) return; // 그사이 다른 칸으로 옮겼다
      setItems((prev) => (prev ? [...prev, ...r.items.filter((it) => !prev.some((x) => x.id === it.id))] : prev));
      setMore(r.more);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const today = kstDay();
  const fresh = kstDay(2);
  return (
    <>
      <div className="filter off-tabs">
        {OFFICIAL_TABS.map((t) => (
          <button key={t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => go(`#/board?cat=imo&t=${t.key}`, true)}>
            {t.label}
          </button>
        ))}
      </div>
      {!items ? (
        <Loading error={error} />
      ) : items.length === 0 ? (
        <div className="empty">아직 받아 온 소식이 없어요.</div>
      ) : (
        <ul className="off-list">
          {items.map((it) => {
            const ended = !!it.end && it.end < today;
            return (
              <li key={it.id}>
                <a className={"off-row" + (ended ? " off-ended" : "")} href={`#/official/${it.id}`}>
                  {it.image && <img className="off-thumb" src={it.image} alt="" loading="lazy" decoding="async" width={84} height={47} />}
                  <span className="off-main">
                    <span className="off-head">
                      <span className={"off-type off-type-" + it.type}>{TYPE_NAME[it.type] ?? it.type}</span>
                      {!ended && it.start && it.start >= fresh && <span className="off-new">NEW</span>}
                    </span>
                    <b className="off-title">{it.title}</b>
                    <small>{dates(it, today)}</small>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {error && items && <p className="form-error">{error}</p>}
      {more && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            더 보기
          </button>
        </div>
      )}
    </>
  );
}

/** 남겨서 그리는 태그 (공식 글의 HTML 은 서버가 이미 걸렀지만, 여기서도 이것만 만든다: 속성은 그림 주소와 링크만). S 는 연장 전 점검 시간처럼 줄 그은 글자 */
const TAGS: Record<string, string> = {
  P: "p", BR: "br", B: "b", I: "i", U: "u", S: "s", H4: "h4", UL: "ul", OL: "ol", LI: "li", TABLE: "table", THEAD: "thead", TBODY: "tbody",
  TR: "tr", TD: "td", TH: "th", HR: "hr", BLOCKQUOTE: "blockquote", IMG: "img", A: "a",
};

function renderNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = TAGS[el.tagName];
  const kids = [...el.childNodes].map(renderNode);
  if (!tag) return <Fragment key={key}>{kids}</Fragment>;
  if (tag === "img") {
    const src = el.getAttribute("src") ?? "";
    return /^https?:\/\//.test(src) ? <img key={key} src={src} alt="" loading="lazy" decoding="async" /> : null;
  }
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) return <Fragment key={key}>{kids}</Fragment>;
    // 다른 공식 글로 가는 링크는 앱 안에서
    const inApp = officialLink(href);
    return inApp ? (
      <a key={key} href={inApp}>
        {kids}
      </a>
    ) : (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {kids}
      </a>
    );
  }
  if (tag === "br" || tag === "hr") return createElement(tag, { key });
  if (tag === "table") return createElement("div", { key, className: "off-table" }, createElement("table", null, kids));
  return createElement(tag, { key }, kids);
}

/** 공식 글 하나를 앱 안에서 읽는다 (그림 포함, 맨 위에 원문 링크) */
export function OfficialPostPage({ id }: { id: number }) {
  const [post, setPost] = useState<OfficialPost | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setPost(null);
    setError("");
    fetchOfficialPost(id).then(
      (p) => alive && setPost(p),
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  const body = useMemo(() => {
    if (!post?.html) return null;
    const doc = new DOMParser().parseFromString(`<body>${post.html}</body>`, "text/html");
    return [...doc.body.childNodes].map(renderNode);
  }, [post?.html]);

  if (!post) {
    return (
      <>
        <TopBar title="아이모 소식" />
        <Loading error={error} />
        {error && (
          <div className="links">
            <a className="btn btn-ghost" href={`https://withhive.com/notice/32/${id}`} target="_blank" rel="noopener noreferrer">
              공식 페이지 ↗
            </a>
          </div>
        )}
      </>
    );
  }
  const today = kstDay();
  return (
    <>
      <TopBar title="아이모 소식" />
      <a className="orig-link" href={officialUrl(post)} target="_blank" rel="noopener noreferrer">
        <span>📄 컴투스 공식 {TYPE_NAME[post.type] ?? ""}</span>
        <b>원문 보기 ↗</b>
      </a>
      <article className="panel off-post">
        <div className="off-head">
          <span className={"off-type off-type-" + post.type}>{TYPE_NAME[post.type] ?? post.type}</span>
          <small>{dates(post, today)}</small>
        </div>
        <h2 className="off-post-title">{post.title}</h2>
        <div className="off-body">{body ?? <p className="off-text">{post.body}</p>}</div>
      </article>
    </>
  );
}
