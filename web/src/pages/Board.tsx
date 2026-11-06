import { peekMemo, putMemo } from "../memo";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, RANK, errorText } from "../auth";
import type { Me } from "../auth";
import {
  CATS, CAT_ICON, CAT_NAME, URL_RE, createPost, deleteFile, deletePost, fetchPost, fetchPosts,
  fileUrl, linkPreview, polishPost, setLike, shrinkPhoto, sizeText, updatePost, uploadFile, youtubeId,
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
import { Comments } from "./Comments";
import { ImageViewer } from "./ImageViewer";

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
    newsSum(news, key === null ? CATS.map((c) => `board.${c}` as NewsKey) : key === "imo" ? IMO_NEWS : [`board.${key}` as NewsKey]);
  const tabs: { key: Cat | "imo" | null; icon: string; name: string; to: string }[] = [
    { key: null, icon: "📋", name: "전체", to: "#/board" },
    ...CATS.map((c) => ({ key: c, icon: CAT_ICON[c], name: CAT_SHORT[c], to: `#/board?cat=${c}` })),
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

function List({ me, cat }: { me: Me; cat: Cat | null }) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useEntryState("text", "");
  const [q, setQ] = useEntryState("q", "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // 이번에 연 동안 본 목록은 새로 받는 동안 바로 보인다 (src/memo.ts)
    const key = `board:${cat}|${q}`;
    const had = peekMemo<{ posts: PostSummary[]; more: boolean }>(key);
    setPosts(had?.posts ?? null);
    setMore(had?.more ?? false);
    setError("");
    fetchPosts({ cat, q }).then(
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
  }, [cat, q]);

  async function loadMore() {
    if (!posts?.length) return;
    setBusy(true);
    try {
      const r = await fetchPosts({ cat, q, before: posts[posts.length - 1].id });
      setPosts([...posts, ...r.posts.filter((p) => !posts.some((x) => x.id === p.id))]);
      setMore(r.more);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const writeCat = cat && canWrite(me, cat) ? cat : "free";
  return (
    <>
      <TopBar title="게시판" />
      <BoardCats cat={cat} />
      <form
        className="bd-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text.trim());
        }}
      >
        <input className="mk-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="🔍 제목, 내용, 글쓴이" aria-label="글 찾기" />
        <a className="btn bd-write" href={`#/board/write?cat=${writeCat}`}>
          ✏️ 글쓰기
        </a>
      </form>
      {!posts ? (
        <Loading error={error} />
      ) : posts.length === 0 ? (
        <div className="empty">{q ? `"${q}" 글이 없어요.` : "아직 글이 없어요."}</div>
      ) : (
        <ul className="bd-list">
          {posts.map((p) => (
            <li key={p.id}>
              <a className={"bd-row" + (p.pinned ? " bd-pinned" : "")} href={`#/board/${p.id}`}>
                <span className="bd-row-main">
                  <span className="bd-row-title">
                    {p.pinned && <i className="bd-pin">고정</i>}
                    <i className={"bd-cat bd-cat-" + p.cat}>{CAT_NAME[p.cat]}</i>
                    {p.title}
                    <ThingDot k={`post:${p.id}`} />
                  </span>
                  {p.snippet && <span className="bd-row-snippet">{p.snippet.replace(/\s+/g, " ")}</span>}
                  <small>
                    <Nick name={p.author} /> <KakaoButton name={p.author} nested /> · {ago(p.at)} · 👁 {p.views}
                    {p.likes > 0 && ` · ♥ ${p.likes}`}
                    {p.comments > 0 && ` · 💬 ${p.comments}`}
                    {p.files > 0 && ` · 📎 ${p.files}`}
                  </small>
                </span>
                {p.thumb && <img className="bd-thumb" src={fileUrl(p.thumb)} alt="" loading="lazy" decoding="async" width={56} height={56} />}
              </a>
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

function PostView({ me, id }: { me: Me; id: number }) {
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

  if (!d) return (
    <>
      <TopBar title="게시판" />
      <Loading error={error} />
    </>
  );
  const { post, files } = d;
  const mine = post.author === me.id;
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
      <TopBar title={CAT_NAME[post.cat]} />
      <article className="panel bd-post">
        <h1 className="bd-title">
          {post.pinned && <i className="bd-pin">고정</i>}
          {post.title}
        </h1>
        <div className="bd-meta">
          <b>
            <Nick name={post.author} />
          </b>
          <KakaoButton name={post.author} mine={post.author === me.id} />
          {d.roles[post.author] && <RoleBadge role={d.roles[post.author]} />}
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
          {staff(me) && (
            <button className="pill" disabled={busy} onClick={() => run(async () => {
              await updatePost(id, { pinned: !post.pinned });
              reload();
            })}>
              {post.pinned ? "고정 해제" : "고정"}
            </button>
          )}
          {mine && (
            <a className="pill" href={`#/board/${id}/edit`}>
              수정
            </a>
          )}
          {(mine || staff(me)) &&
            (confirm ? (
              <button className="pill pill-danger" disabled={busy} onClick={() => run(async () => {
                await deletePost(id);
                go("#/board", true);
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
      <Comments me={me} id={id} comments={d.comments} roles={d.roles} since={since} onChange={(comments) => setD({ ...d, comments })} />
    </>
  );
}

interface NewFile {
  key: string;
  file: File;
  photo: boolean;
  preview: string | null;
}

function Write({ me, cat: startCat, editId }: { me: Me; cat?: Cat; editId?: number }) {
  const [cat, setCat] = useState<Cat>(startCat && canWrite(me, startCat) ? startCat : "free");
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
        id = (await createPost(cat, title, body)).id;
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
      go(`#/board/${id}`, true);
    } catch (x) {
      setError(errorText(x));
      setBusy("");
    }
  }

  if (!loaded) return (
    <>
      <TopBar title="글 수정" />
      <Loading error={error} />
    </>
  );
  return (
    <>
      <TopBar title={editId ? "글 수정" : "글쓰기"} />
      <section className="panel form bd-write-form">
        {!editId && (
          <div className="pill-row">
            {CATS.filter((c) => canWrite(me, c)).map((c) => (
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
          placeholder="내용 (링크를 넣으면 미리보기가 붙어요. 유튜브는 글 안에서 재생돼요)"
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


