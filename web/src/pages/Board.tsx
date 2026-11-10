import { peekMemo, putMemo } from "../memo";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, RANK, errorText } from "../auth";
import type { Me } from "../auth";
import {
  BOARD_CATS, CAT_ICON, CAT_NAME, URL_RE, createPost, deleteFile, deletePost, fetchPost, fetchPosts,
  fileUrl, linkPreview, polishPost, setLike, sgName, shrinkPhoto, sizeText, updatePost, uploadFile, youtubeId,
} from "../board";
import type { BoardFile, Cat, LinkPreview, PostDetail, PostSummary } from "../board";
import { RoleBadge } from "../emblems";
import { ago } from "../market";
import { go, useEntryState } from "../router";
import { FitLine, Loading, NewsDot, ThingDot, TopBar } from "../ui";
import { markThingSeen, newsSum, thingSince, useNews } from "../news";
import type { NewsKey } from "../news";
import { OfficialList } from "./Official";
import { KakaoButton, Nick } from "../kakao";
import { isOfficialTab } from "../official";
import { AnonName, Comments } from "./Comments";
import { ImageViewer } from "./ImageViewer";
import { SuggestFlow } from "./SuggestFlow";

/** 공지사항과 이벤트는 오피서 이상만 쓴다 (서버 server/board.ts canWrite 와 같다) */
const canWrite = (me: Me, cat: Cat) => cat === "free" || cat === "suggest" || RANK[me.role] >= 1;
const staff = (me: Me) => RANK[me.role] >= 1;

/**
 * 게시판 (제작자 요청, 홈의 '장비' 칸 자리): #/board 목록, #/board/:id 글, #/board/write?cat=, #/board/:id/edit
 * 사진과 첨부 파일, 링크(유튜브는 글 안에서 바로 재생, 다른 링크는 제목과 그림 미리보기), 댓글과 답글, 좋아요, 본 사람 수, 고정
 */
export function BoardPage({ me, arg, sub, query }: { me: Me; arg: string; sub: string; query: URLSearchParams }) {
  // 아이모 소식: 공식 홈페이지의 공지사항, 점검, 이벤트 (제작자 요청 2026-11-01)
  if (query.get("cat") === "imo") {
    const t = query.get("t");
    return (
      <>
        <TopBar title="게시판" />
        <BoardCats cat="imo" />
        <OfficialList tab={isOfficialTab(t) ? t : "all"} />
      </>
    );
  }
  if (arg === "write") return <Write me={me} cat={(query.get("cat") as Cat) || "free"} />;
  const id = Number(arg);
  if (id && sub === "edit") return <Write me={me} editId={id} />;
  if (id) return <PostView me={me} id={id} />;
  return <List me={me} cat={(query.get("cat") as Cat | null) ?? null} />;
}

/**
 * 건의함 (제작자 요청 2026-11-09):
 * #/suggest 글 칸, #/suggest/:id 글, #/suggest/write, #/suggest/:id/edit. 게시판의 건의 사항(cat suggest)을 그대로 쓰고, 글과 댓글을 익명으로 올릴 수 있다.
 * 익명 이름은 서버가 가려서 보낸다 (server/board.ts canSeeAnon). 열 때는 src/board.ts SUGGEST_OPEN.
 * 칸 (제작자 2026-11-10 '길드원 화면은 건의하기 버튼만 크게, 보낸 뒤엔 내 건의함에서, 운영진은 건의하기·내 건의함·접수함'):
 * 건의하기(#/suggest, 큰 단추 하나) · 내 건의함(?v=mine, 내가 보낸 건의와 답글) · 접수함(?v=inbox, 운영진만: 받은 건의 모두와 찾기)
 */
type SuggestTab = "write" | "mine" | "inbox";
export function SuggestPage({ me, arg, sub, query }: { me: Me; arg: string; sub: string; query: URLSearchParams }) {
  if (arg === "write") return <Write me={me} cat="suggest" box />;
  const id = Number(arg);
  if (id && sub === "edit") return <Write me={me} editId={id} box />;
  if (id) return <PostView me={me} id={id} box />;
  const v = query.get("v");
  const tab: SuggestTab = v === "mine" ? "mine" : v === "inbox" && staff(me) ? "inbox" : "write";
  return (
    <>
      <TopBar title="건의함" />
      <SuggestTabs me={me} tab={tab} />
      {tab === "write" ? (
        <section className="sg-home">
          <a className="sg-big" href="#/suggest/write">
            <b>건의하기</b>
            <span className="sg-big-shine" aria-hidden />
          </a>
        </section>
      ) : (
        <List key={tab} me={me} cat="suggest" box={tab} />
      )}
    </>
  );
}

/** 건의함 칸 줄: 건의하기 · 내 건의함 · 접수함(운영진). 새 답글·새 건의 수는 내 건의함(길드원)·접수함(운영진) 모서리에 */
function SuggestTabs({ me, tab }: { me: Me; tab: SuggestTab }) {
  const news = useNews();
  const n = newsSum(news, ["board.suggest"]);
  const tabs: { key: SuggestTab; name: string; to: string }[] = [
    { key: "write", name: "건의하기", to: "#/suggest" },
    { key: "mine", name: "내 건의함", to: "#/suggest?v=mine" },
    ...(staff(me) ? [{ key: "inbox" as const, name: "접수함", to: "#/suggest?v=inbox" }] : []),
  ];
  return (
    <nav className="pill-row sg-tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`pill sg-tab-${t.key}` + (tab === t.key ? " pill-on" : "")} aria-pressed={tab === t.key} onClick={() => go(t.to, true)}>
          {t.name}
          {t.key === (staff(me) ? "inbox" : "mine") && <NewsDot n={n} />}
        </button>
      ))}
    </nav>
  );
}

/** 글 주소의 앞 (건의함은 #/suggest) */
const baseOf = (box?: boolean) => (box ? "#/suggest" : "#/board");

/** 게시판 칸 이름 (위 칸 줄에서 짧게) */
const CAT_SHORT: Record<Cat, string> = { notice: "공지", event: "길드 이벤트", free: "자유", suggest: "건의" };

/**
 * 게시판 칸 줄: 전체, 공지, 길드 이벤트, 자유, 건의, 아이모 소식을 한 줄 탭으로 (제작자 요청 2026-11-02: 맨 위 단추를 한 줄로,
 * 아이모 소식 안의 전체·공지사항·점검·이벤트와 위아래가 구분되게). 이모지는 이름 위에, 이름 글자 크기는 모두 같게(줄이지 않고 칸 좌우 여백을 줄인다).
 * 아래 칸 줄은 Official.tsx 의 .pill-row
 */
const IMO_NEWS: NewsKey[] = ["imo.notice", "imo.maint", "imo.event"];

function BoardCats({ cat }: { cat: Cat | "imo" | null }) {
  // 칸마다 새 글·새 댓글 수 (제작자 요청 2026-11-02: 홈의 게시판 숫자가 어느 칸에서 왔는지). 칸을 연다고 지우지 않고 그 글을 열어야 지운다
  // (제작자 2026-11-06 '끝까지 배지가 추적해서'). '전체'는 게시판 네 칸의 합, 아이모 소식은 Official.tsx
  const news = useNews();
  const countOf = (key: Cat | "imo" | null) =>
    newsSum(news, key === null ? BOARD_CATS.map((c) => `board.${c}` as NewsKey) : key === "imo" ? IMO_NEWS : [`board.${key}` as NewsKey]);
  const tabs: { key: Cat | "imo" | null; icon: string; name: string; to: string }[] = [
    { key: null, icon: "📋", name: "전체", to: "#/board" },
    ...BOARD_CATS.map((c) => ({ key: c, icon: CAT_ICON[c], name: CAT_SHORT[c], to: `#/board?cat=${c}` })),
    { key: "imo", icon: "🎮", name: "아이모 소식", to: "#/board?cat=imo" },
  ];
  return (
    <nav className="main-tabs">
      {tabs.map((t) => (
        <button
          key={t.key ?? "all"}
          className={"main-tab" + (cat === t.key ? " main-tab-on" : "")}
          aria-pressed={cat === t.key}
          onClick={() => go(t.to, true)}
        >
          <span className="main-tab-icon" aria-hidden>
            {t.icon}
          </span>
          <span className="main-tab-name">{t.name}</span>
          <NewsDot n={countOf(t.key)} />
        </button>
      ))}
    </nav>
  );
}

/** 글 목록. box 는 건의함의 칸: 'mine' 내 건의만, 'inbox' 받은 건의 모두 (위 줄과 칸 줄은 SuggestPage 가 그린다) */
function List({ me, cat, box }: { me: Me; cat: Cat | null; box?: "mine" | "inbox" }) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useEntryState("text", "");
  const [q, setQ] = useEntryState("q", "");
  const [busy, setBusy] = useState(false);
  // 건의함(내 건의함·접수함)은 보는 동안 30초마다·다시 볼 때 새로 받아 결재 상황이 바로 바뀐다
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (!box) return;
    const bump = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    const t = window.setInterval(bump, 30_000);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [box]);

  useEffect(() => {
    let alive = true;
    // 이번에 연 동안 본 목록은 새로 받는 동안 바로 보인다 (src/memo.ts)
    const key = `board:${cat}|${q}|${box ?? ""}`;
    const had = peekMemo<{ posts: PostSummary[]; more: boolean }>(key);
    setPosts(had?.posts ?? null);
    setMore(had?.more ?? false);
    setError("");
    fetchPosts({ cat, q, mine: box === "mine" }).then(
      (r) => {
        putMemo(key, { posts: r.posts, more: r.more });
        if (!alive) return;
        setPosts(r.posts);
        setMore(r.more);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [cat, q, box, tick]);

  async function loadMore() {
    if (!posts?.length) return;
    setBusy(true);
    try {
      const r = await fetchPosts({ cat, q, before: posts[posts.length - 1].id, mine: box === "mine" });
      setPosts([...posts, ...r.posts.filter((p) => !posts.some((x) => x.id === p.id))]);
      setMore(r.more);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const writeCat = cat && canWrite(me, cat) ? cat : "free";
  const base = baseOf(!!box);
  return (
    <>
      {!box && <TopBar title="게시판" />}
      {!box && <BoardCats cat={cat} />}
      {box !== "mine" && (
      <form
        className="bd-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text.trim());
        }}
      >
        <input className="mk-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="🔍 제목, 내용, 글쓴이" aria-label="글 찾기" />
        {!box && (
          <a className="btn bd-write" href={`#/board/write?cat=${writeCat}`}>
            ✏️ 글쓰기
          </a>
        )}
      </form>
      )}
      {!posts ? (
        <Loading error={error} />
      ) : posts.length === 0 ? (
        <div className="empty">
          {q
            ? `"${q}" 글이 없어요.`
            : box === "mine"
              ? "아직 보낸 건의가 없어요."
              : box === "inbox"
                ? "아직 받은 건의가 없어요."
                : cat === "suggest" && RANK[me.role] < 1
                  ? "건의는 운영진과 쓴 사람만 봐요."
                  : "아직 글이 없어요."}
        </div>
      ) : (
        <ul className="bd-list">
          {posts.map((p) => (
            <li key={p.id} className={box && open === p.id ? "sg-open" : undefined}>
              <a
                className={"bd-row" + (p.pinned ? " bd-pinned" : "")}
                href={`${base}/${p.id}`}
                aria-expanded={box ? open === p.id : undefined}
                onClick={(e) => {
                  if (!box) return;
                  e.preventDefault();
                  setOpen(open === p.id ? null : p.id);
                }}
              >
                <span className="bd-row-main">
                  <span className="bd-row-title">
                    {p.pinned && <i className="bd-pin">고정</i>}
                    {!box && <i className={"bd-cat bd-cat-" + p.cat}>{CAT_NAME[p.cat]}</i>}
                    {p.sg && <i className={"sg-chip sg-chip-" + p.sg}>{sgName(p.sg, p.sgAgrees ?? 0)}</i>}
                    {p.title}
                    <ThingDot k={`post:${p.id}`} />
                  </span>
                  {p.snippet && !(box && open === p.id) && <span className="bd-row-snippet">{p.snippet.replace(/\s+/g, " ")}</span>}
                  <small>
                    <AnonName name={p.author} anon={p.anon} mine={p.mine}>
                      <Nick name={p.author} /> <KakaoButton name={p.author} nested />
                    </AnonName>{" "}
                    · {ago(p.at)} · 👁 {p.views}
                    {p.likes > 0 && ` · ♥ ${p.likes}`}
                    {p.comments > 0 && ` · 💬 ${p.comments}`}
                    {p.files > 0 && ` · 📎 ${p.files}`}
                  </small>
                </span>
                {p.thumb && <img className="bd-thumb" src={fileUrl(p.thumb)} alt="" loading="lazy" decoding="async" width={56} height={56} />}
              </a>
              {box && open === p.id && (
                <div className="sg-inline">
                  <PostView
                    me={me}
                    id={p.id}
                    box
                    inline
                    onGone={() => {
                      setOpen(null);
                      setTick((t) => t + 1);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && posts && <p className="form-error">{error}</p>}
      {more && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            {busy ? "불러오는 중…" : "더 보기"}
          </button>
        </div>
      )}
    </>
  );
}

/** 유튜브: 처음엔 그림과 ▶, 누르면 그 자리에서 재생 */
function YouTube({ id }: { id: string }) {
  const [play, setPlay] = useState(false);
  return (
    <span className="bd-yt">
      {play ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`}
          title="YouTube"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button onClick={() => setPlay(true)} aria-label="영상 재생">
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <b>▶</b>
        </button>
      )}
    </span>
  );
}

/** 다른 링크: 제목, 설명, 그림 (서버가 그 페이지에서 읽는다) */
function LinkCard({ url }: { url: string }) {
  const [p, setP] = useState<LinkPreview | null>(null);
  useEffect(() => {
    let alive = true;
    linkPreview(url).then((r) => alive && setP(r), () => {});
    return () => {
      alive = false;
    };
  }, [url]);
  if (!p || (!p.title && !p.image)) return null;
  return (
    <a className="bd-link" href={url} target="_blank" rel="noopener noreferrer">
      {p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span>
        <b>{p.title ?? url}</b>
        {p.description && <small>{p.description}</small>}
        <small className="bd-link-site">{p.site}</small>
      </span>
    </a>
  );
}

/** 글 내용: 줄바꿈은 그대로, 주소는 링크로, 유튜브와 다른 링크는 아래에 미리보기 */
function Body({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const links: string[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    if (!links.includes(url)) links.push(url);
    last = (m.index ?? 0) + url.length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {text && <div className="bd-body">{parts}</div>}
      {links.slice(0, 5).map((url) => {
        const yt = youtubeId(url);
        return yt ? <YouTube key={url} id={yt} /> : <LinkCard key={url} url={url} />;
      })}
    </>
  );
}

/** 글 하나. inline 이면 건의함 목록 줄 아래에 그 자리에서 펼친다 (위 줄·제목 없이, 제작자 2026-11-10 '개발 요청처럼 여기서 누르면 이 화면에서 결재 진행 상황, 대화') */
function PostView({ me, id, box, inline, onGone }: { me: Me; id: number; box?: boolean; inline?: boolean; onGone?: () => void }) {
  const [d, setD] = useState<PostDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  // 이 글을 마지막으로 본 때 (그 뒤에 남이 단 댓글에 'N'), 열면 이 글의 새 것을 지운다 (news.ts, 제작자 2026-11-06 '끝까지 배지가 추적해서')
  const [since] = useState(() => thingSince(`post:${id}`));
  const reload = useCallback(() => {
    fetchPost(id).then(
      (r) => {
        setD(r);
        markThingSeen(`post:${id}`);
      },
      (x) => setError(errorText(x)),
    );
  }, [id]);
  useEffect(reload, [reload]);
  // 건의 결재선은 보는 동안 20초마다·다시 볼 때 새로 받는다 (제작자 2026-11-10 '실시간으로 결재 상황을 볼 수 있게')
  const watching = !!d?.flow && d.flow.status !== "done";
  useEffect(() => {
    if (!watching) return;
    const tick = () => document.visibilityState === "visible" && reload();
    const t = window.setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [watching, reload]);

  if (!d) return inline ? (
    <Loading error={error} />
  ) : (
    <>
      <TopBar title={box ? "건의함" : "게시판"} />
      <Loading error={error} />
    </>
  );
  const { post, files } = d;
  const mine = post.mine ?? post.author === me.id;
  const base = baseOf(box);
  const photos = files.filter((f) => f.image);
  const attachments = files.filter((f) => !f.image);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!inline && <TopBar title={box ? "건의함" : CAT_NAME[post.cat]} />}
      <article className={"panel bd-post" + (inline ? " bd-post-inline" : "")}>
        {!inline && (
          <h1 className="bd-title">
            {post.pinned && <i className="bd-pin">고정</i>}
            {post.title}
          </h1>
        )}
        <div className="bd-meta">
          <AnonName name={post.author} anon={post.anon} mine={mine}>
            <b>
              <Nick name={post.author} />
            </b>
            <KakaoButton name={post.author} mine={post.author === me.id} />
            {d.roles[post.author] && <RoleBadge role={d.roles[post.author]} />}
          </AnonName>
          <span>
            {ago(post.created_at)}
            {post.edited_at && " · 고침"} · 👁 {d.views}
          </span>
        </div>
        <Body text={post.body} />
        {photos.map((f, i) => (
          <button key={f.id} className="bd-photo" onClick={() => setViewing(i)} aria-label="사진 크게 보기">
            <img src={fileUrl(f.id)} alt={f.name} loading="lazy" />
          </button>
        ))}
        {viewing !== null && (
          <ImageViewer images={photos.map((f) => ({ src: fileUrl(f.id), name: f.name, download: f.name }))} start={viewing} onClose={() => setViewing(null)} />
        )}
        {attachments.length > 0 && (
          <ul className="bd-files">
            {attachments.map((f) => (
              <li key={f.id}>
                <a href={fileUrl(f.id)} download={f.name}>
                  📎 {f.name} <small>{sizeText(f.size)}</small>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="bd-actions">
          <button
            className={"pill bd-like" + (d.liked ? " pill-on" : "")}
            disabled={busy}
            onClick={() => run(async () => {
              const r = await setLike(id, !d.liked);
              setD({ ...d, likes: r.likes, liked: r.liked });
            })}
          >
            {d.liked ? "♥" : "♡"} {d.likes}
          </button>
          {staff(me) && !box && (
            <button className="pill" disabled={busy} onClick={() => run(async () => {
              await updatePost(id, { pinned: !post.pinned });
              reload();
            })}>
              {post.pinned ? "고정 해제" : "고정"}
            </button>
          )}
          {mine && (
            <a className="pill" href={`${base}/${id}/edit`}>
              수정
            </a>
          )}
          {(mine || staff(me)) &&
            (confirm ? (
              <button className="pill pill-danger" disabled={busy} onClick={() => run(async () => {
                await deletePost(id);
                // 목록 안에서 펼친 것이면 목록을 다시, 건의함은 내 건의함이나 접수함으로
                if (onGone) return onGone();
                go(box ? (mine || !staff(me) ? "#/suggest?v=mine" : "#/suggest?v=inbox") : base, true);
              })}>
                삭제 확인
              </button>
            ) : (
              <button className="pill" onClick={() => setConfirm(true)}>
                삭제
              </button>
            ))}
        </div>
        {error && <p className="form-error">{error}</p>}
      </article>
      {d.flow && <SuggestFlow me={me} postId={id} author={post.author} mine={mine} flow={d.flow} onChanged={reload} />}
      <Comments
        me={me}
        id={id}
        comments={d.comments}
        roles={d.roles}
        since={since}
        onChange={(comments) => setD({ ...d, comments })}
        anonOk={!!box && post.cat === "suggest"}
        noun={box ? "대화" : "댓글"}
      />
    </>
  );
}

interface NewFile {
  key: string;
  file: File;
  photo: boolean;
  preview: string | null;
}

function Write({ me, cat: startCat, editId, box }: { me: Me; cat?: Cat; editId?: number; box?: boolean }) {
  const [cat, setCat] = useState<Cat>(startCat && canWrite(me, startCat) && (box || BOARD_CATS.includes(startCat)) ? startCat : "free");
  // 건의함 익명 글 (처음 올릴 때만 고른다)
  const [anon, setAnon] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [old, setOld] = useState<BoardFile[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [added, setAdded] = useState<NewFile[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // AI 로 다듬기 (운영진, 공지사항·길드 이벤트만, 제작자 요청 2026-11-02). 쓴 글을 바로 바꾸지 않고 아래에 미리 보여 주고 '적용'·'닫기'
  // (제작자 요청: 원치 않게 되면 다 지워야 해서 번거롭다). 적용한 뒤에도 손대기 전까지 '되돌리기'
  const [suggestion, setSuggestion] = useState<{ title: string; body: string } | null>(null);
  const [before, setBefore] = useState<{ title: string; body: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const canPolish = staff(me) && (cat === "notice" || cat === "event");
  async function polish() {
    setPolishing(true);
    setError("");
    try {
      setSuggestion(await polishPost(cat, title, body));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPolishing(false);
    }
  }
  const [loaded, setLoaded] = useState(!editId);
  // 이미 만든 글 번호: 사진 올리기가 중간에 실패해도 다시 누르면 글을 또 만들지 않고 이어서 올린다
  const created = useRef<number | null>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    if (!editId) return;
    fetchPost(editId).then(
      (d) => {
        setCat(d.post.cat);
        setTitle(d.post.title);
        setBody(d.post.body);
        setOld(d.files);
        setLoaded(true);
      },
      (x) => setError(errorText(x)),
    );
  }, [editId]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  function dropAdded(key: string) {
    setAdded((list) => {
      const f = list.find((x) => x.key === key);
      if (f?.preview) {
        URL.revokeObjectURL(f.preview);
        previews.current.delete(f.preview);
      }
      return list.filter((x) => x.key !== key);
    });
  }

  const count = old.length - removed.length + added.length;
  function pick(list: FileList | null, photo: boolean) {
    if (!list) return;
    const room = 10 - count;
    const next = [...list].slice(0, Math.max(0, room)).map((file) => {
      const preview = photo && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (preview) previews.current.add(preview);
      return { key: `${file.name}-${file.size}-${Math.random()}`, file, photo: photo && file.type.startsWith("image/"), preview };
    });
    if (list.length > room) setError("사진과 파일은 글 하나에 10개까지예요");
    setAdded([...added, ...next]);
  }

  async function save() {
    if (!title.trim()) return setError("제목을 적어 주세요");
    // 글을 올리기 전에 먼저 확인한다: 큰 파일, 줄이지 못하는 사진 (글만 올라가고 멈추지 않게)
    const big = added.find((f) => !f.photo && f.file.size > 1_900_000);
    if (big) return setError(`${big.file.name}: 파일은 1.9MB 까지예요`);
    setError("");
    try {
      const ready: { key: string; blob: Blob; name: string; photo: boolean }[] = [];
      for (let i = 0; i < added.length; i++) {
        const f = added[i];
        if (f.photo) {
          setBusy(`사진 준비 중… ${i + 1}/${added.length}`);
          const { blob, name } = await shrinkPhoto(f.file);
          ready.push({ key: f.key, blob, name, photo: true });
        } else ready.push({ key: f.key, blob: f.file, name: f.file.name, photo: false });
      }
      setBusy("글을 올리는 중…");
      let id = editId ?? created.current;
      if (id) await updatePost(id, { title, body });
      else {
        id = (await createPost(cat, title, body, !!box && cat === "suggest" && anon)).id;
        created.current = id;
      }
      // 한 단계씩 끝날 때마다 화면에서도 빼서, 실패한 뒤 다시 누르면 남은 것만 한다
      for (const fid of removed) {
        await deleteFile(fid).catch((x) => {
          if (!(x instanceof ApiError && x.status === 404)) throw x; // 이미 지운 파일
        });
        setRemoved((r) => r.filter((v) => v !== fid));
        setOld((o) => o.filter((f) => f.id !== fid));
      }
      for (let i = 0; i < ready.length; i++) {
        const r = ready[i];
        setBusy(`${r.photo ? "사진" : "파일"} 올리는 중… ${i + 1}/${ready.length}`);
        await uploadFile(id, r.blob, r.name);
        dropAdded(r.key);
      }
      // 건의함에서 새로 보낸 건의는 내 건의함으로 (제작자 2026-11-10 '보내고 그 뒤론 내 건의함에서'), 고친 글은 그 글로
      go(box && !editId ? "#/suggest?v=mine" : `${baseOf(box)}/${id}`, true);
    } catch (x) {
      setError(errorText(x));
      setBusy("");
    }
  }

  if (!loaded) return (
    <>
      <TopBar title={box ? "건의함" : "글 수정"} />
      <Loading error={error} />
    </>
  );
  return (
    <>
      <TopBar title={box ? "건의함" : editId ? "글 수정" : "글쓰기"} />
      <section className="panel form bd-write-form">
        {box && !editId && (
          <div className="sg-anon">
            <div className="pill-row">
              <button type="button" className={"pill" + (!anon ? " pill-on" : "")} aria-pressed={!anon} onClick={() => setAnon(false)}>
                실명
              </button>
              <button type="button" className={"pill" + (anon ? " pill-on" : "")} aria-pressed={anon} onClick={() => setAnon(true)}>
                익명
              </button>
            </div>
            {anon && <small>익명 보장 · 이름이 공개되지 않아요</small>}
          </div>
        )}
        {!editId && !box && (
          <div className="pill-row">
            {BOARD_CATS.filter((c) => canWrite(me, c)).map((c) => (
              <button key={c} type="button" className={"pill" + (cat === c ? " pill-on" : "")} aria-pressed={cat === c} onClick={() => setCat(c)}>
                {/* 좁은 폰(320px)에서 '길드 이벤트'가 단추를 넘었다: 글자를 줄여 한 줄에 (화면 폭 대원칙) */}
                <FitLine text={CAT_NAME[c]} wrap={false} />
              </button>
            ))}
          </div>
        )}
        <input className="mk-input" value={title} maxLength={80} onChange={(e) => (setTitle(e.target.value), setBefore(null))} placeholder="제목" aria-label="제목" />
        <textarea
          className="mk-input bd-textarea"
          value={body}
          maxLength={10000}
          onChange={(e) => (setBody(e.target.value), setBefore(null))}
          placeholder={box ? "건의 내용" : "내용 (링크를 넣으면 미리보기가 붙어요. 유튜브는 글 안에서 재생돼요)"}
          aria-label="내용"
        />
        <div className="bd-pickers">
          <label className="pill">
            📷 사진
            <input type="file" accept="image/*" multiple hidden onChange={(e) => (pick(e.target.files, true), (e.target.value = ""))} />
          </label>
          <label className="pill">
            📎 파일
            <input type="file" multiple hidden onChange={(e) => (pick(e.target.files, false), (e.target.value = ""))} />
          </label>
          <small>{count}/10</small>
          {canPolish &&
            (before ? (
              <button type="button" className="pill bd-polish" onClick={() => (setTitle(before.title), setBody(before.body), setBefore(null))}>
                되돌리기
              </button>
            ) : (
              <button type="button" className="pill bd-polish" disabled={polishing || !!suggestion || body.trim().length < 10} onClick={() => void polish()}>
                {polishing ? "다듬는 중…" : "AI로 다듬기"}
              </button>
            ))}
        </div>
        {suggestion && (
          <div className="bd-suggest">
            <b className="bd-suggest-head">AI가 다듬은 글</b>
            <p className="bd-suggest-title">{suggestion.title}</p>
            <p className="bd-suggest-body">{suggestion.body}</p>
            <div className="pill-row">
              <button
                type="button"
                className="pill pill-on"
                onClick={() => (setBefore({ title, body }), setTitle(suggestion.title), setBody(suggestion.body), setSuggestion(null))}
              >
                적용
              </button>
              <button type="button" className="pill" onClick={() => setSuggestion(null)}>
                닫기
              </button>
            </div>
          </div>
        )}
        {(old.length > 0 || added.length > 0) && (
          <ul className="bd-attach">
            {old.filter((f) => !removed.includes(f.id)).map((f) => (
              <li key={f.id}>
                {f.image ? <img src={fileUrl(f.id)} alt="" /> : <span>📎 {f.name}</span>}
                <button type="button" aria-label="빼기" onClick={() => setRemoved([...removed, f.id])}>
                  ✕
                </button>
              </li>
            ))}
            {added.map((f) => (
              <li key={f.key}>
                {f.preview ? <img src={f.preview} alt="" /> : <span>📎 {f.file.name} <small>{sizeText(f.file.size)}</small></span>}
                <button type="button" aria-label="빼기" onClick={() => dropAdded(f.key)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="avatar-actions">
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => history.back()}>
            취소
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={save}>
            {busy || (editId ? "저장" : "등록")}
          </button>
        </div>
      </section>
    </>
  );
}


