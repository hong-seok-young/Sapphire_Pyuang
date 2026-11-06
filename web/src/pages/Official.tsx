import { Fragment, createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { Comments } from "./Comments";
import {
  OFFICIAL_TABS, TYPE_NAME, addOfficialComment, deleteOfficialComment, fetchOfficial, fetchOfficialPost, fetchOfficialSummary, officialLink, officialUrl, setOfficialLike,
} from "../official";
import type { OfficialItem, OfficialPost, OfficialSummary, OfficialTab } from "../official";
import { go } from "../router";
import { Loading, NewsDot, ThingDot, TopBar } from "../ui";
import { markThingSeen, newsSum, thingSince, useNews } from "../news";
import type { NewsKey } from "../news";

/** 한국 날짜 'YYYY-MM-DD' (며칠 전) */
const kstDay = (daysAgo = 0) => new Date(Date.now() + 9 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

const dates = (it: Pick<OfficialItem, "start" | "end">, today: string) =>
  (it.start ?? "") + (it.end ? ` ~ ${it.end}${it.end < today ? " · 종료" : " · 진행 중"}` : "");

/**
 * 게시판 '아이모 소식' (제작자 요청 2026-11-01): 아이모 공식 홈페이지의 공지사항, 점검, 이벤트를 칸으로 나눠 보인다.
 * 누르면 앱 안에서 읽는다 (#/official/번호). 고른 칸은 주소 ?t= 에 남는다
 */
/** 아이모 소식 칸마다 새 글 수 (news.ts) */
const TAB_NEWS: Record<OfficialTab, NewsKey[]> = { all: ["imo.notice", "imo.maint", "imo.event"], notice: ["imo.notice"], maint: ["imo.maint"], event: ["imo.event"] };

export function OfficialList({ tab }: { tab: OfficialTab }) {
  const news = useNews();
  // 칸을 연다고 지우지 않고 그 글을 열어야 지운다 (news.ts, 제작자 2026-11-06 '끝까지 배지가 추적해서')
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
      {/* 아이모 소식 안의 칸: 위 탭 아래 기존 단추 모양, 폭은 모두 같게 (제작자 요청 2026-11-02) */}
      <nav className="pill-row">
        {OFFICIAL_TABS.map((t) => (
          <button
            key={t.key}
            className={"pill" + (tab === t.key ? " pill-on" : "")}
            aria-pressed={tab === t.key}
            onClick={() => go(`#/board?cat=imo&t=${t.key}`, true)}
          >
            {t.label}
            <NewsDot n={newsSum(news, TAB_NEWS[t.key])} />
          </button>
        ))}
      </nav>
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
                    <b className="off-title">
                      {it.title}
                      <ThingDot k={`imo:${it.id}`} />
                    </b>
                    <small>
                      {dates(it, today)}
                      {/* 게시판 줄처럼 본 사람·좋아요·댓글 수 */}
                      {` · 👁 ${it.views ?? 0}`}
                      {(it.likes ?? 0) > 0 && ` · ♥ ${it.likes}`}
                      {(it.comments ?? 0) > 0 && ` · 💬 ${it.comments}`}
                    </small>
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

/**
 * 핵심 요약 (제작자 요청 2026-11-02: 공식 글이 너무 길다): 서버가 처음 연 사람 때 만들어 둔다 (server/officialSummary.ts).
 * 만드는 중이면 4초 뒤에 다시 묻고(5번까지), 못 만들었으면 칸을 그리지 않는다
 */
function useSummary(id: number): OfficialSummary | null {
  const [summary, setSummary] = useState<OfficialSummary | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    setSummary(null);
    const ask = (tries: number) => {
      fetchOfficialSummary(id).then(
        (s) => {
          if (!alive) return;
          if (s.pending && tries < 5) {
            setSummary(s);
            timer = window.setTimeout(() => ask(tries + 1), 4000);
          } else setSummary(s.pending ? { none: true } : s);
        },
        () => alive && setSummary({ none: true }),
      );
    };
    ask(0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id]);
  return summary;
}

/** 글 제목 아래 '핵심 요약' 칸과, 패치노트면 내 직업 변경점 */
function SummaryBox({ summary, job }: { summary: OfficialSummary | null; job: string | null }) {
  if (summary?.none || (summary && !summary.pending && !summary.lines?.length)) return null;
  const mine = job ? (summary?.jobs?.[job] ?? []) : [];
  return (
    <div className="off-sum">
      <b className="off-sum-head">핵심 요약</b>
      {!summary || summary.pending ? (
        <p className="off-sum-wait">요약하는 중…</p>
      ) : (
        <ul>
          {summary.lines!.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {mine.length > 0 && (
        <>
          <b className="off-sum-head">{job} 변경점</b>
          <ul>
            {mine.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 공식 글 하나를 앱 안에서 읽는다 (그림 포함, 맨 위에 원문 링크) */
export function OfficialPostPage({ me, id, job }: { me: Me; id: number; job: string | null }) {
  const [post, setPost] = useState<OfficialPost | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 이 글을 마지막으로 본 때 (그 뒤에 남이 단 댓글에 'N', news.ts)
  const [since] = useState(() => thingSince(`imo:${id}`));
  const summary = useSummary(id);
  useEffect(() => {
    let alive = true;
    setPost(null);
    setError("");
    fetchOfficialPost(id).then(
      (p) => {
        if (!alive) return;
        setPost(p);
        // 새 공식 글을 열면 그 글의 배지를 지운다 (위 단추들의 수도 같이 준다)
        markThingSeen(`imo:${id}`);
      },
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
        <SummaryBox summary={summary} job={job} />
        <div className="off-body">{body ?? <p className="off-text">{post.body}</p>}</div>
        {/* 게시판 글처럼 좋아요와 본 사람 수 (제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등, 일반 게시판이랑 똑같이') */}
        <div className="bd-actions off-actions">
          <button
            className={"pill bd-like" + (post.liked ? " pill-on" : "")}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await setOfficialLike(id, !post.liked);
                setPost({ ...post, likes: r.likes, liked: r.liked });
              } catch (x) {
                setError(errorText(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            {post.liked ? "♥" : "♡"} {post.likes ?? 0}
          </button>
          <small className="off-views">👁 {post.views ?? 0}</small>
        </div>
        {error && <p className="form-error">{error}</p>}
      </article>
      <Comments
        me={me}
        id={id}
        comments={post.comments}
        roles={post.roles}
        since={since}
        onChange={(comments) => setPost({ ...post, comments })}
        add={addOfficialComment}
        remove={deleteOfficialComment}
      />
    </>
  );
}
