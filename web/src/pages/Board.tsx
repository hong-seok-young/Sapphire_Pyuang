import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { ApiError, RANK, errorText } from "../auth";
import type { Me } from "../auth";
import {
  CATS, CAT_ICON, CAT_NAME, URL_RE, addComment, createPost, deleteComment, deleteFile, deletePost, fetchPost, fetchPosts,
  fileUrl, linkPreview, polishPost, setLike, shrinkPhoto, sizeText, updatePost, uploadFile, youtubeId,
} from "../board";
import type { BoardComment, BoardFile, Cat, LinkPreview, PostDetail, PostSummary } from "../board";
import { RoleBadge } from "../emblems";
import { ago } from "../market";
import { go, useEntryState } from "../router";
import { FitLine, Loading, NewsDot, TopBar } from "../ui";
import { markNewsSeen, newsSum, useNews, useNewsSeen } from "../news";
import type { NewsKey } from "../news";
import { OfficialList } from "./Official";
import { isOfficialTab } from "../official";

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
  // 칸마다 새 글 수 (제작자 요청 2026-11-02: 홈의 게시판 숫자가 어느 칸에서 왔는지). 그 칸을 열거나 새 글을 열면 본 것으로.
  // '전체'는 지우지 않는다 (열자마자 다 지워져 어느 칸에 새 글이 있는지 못 봤다), 아이모 소식은 Official.tsx
  const news = useNews();
  useNewsSeen(cat && cat !== "imo" ? [`board.${cat}` as NewsKey] : []);
  const countOf = (key: Cat | "imo" | null) => (key === null ? 0 : newsSum(news, key === "imo" ? IMO_NEWS : [`board.${key}` as NewsKey]));
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
    setPosts(null);
    setError("");
    fetchPosts({ cat, q }).then(
      (r) => {
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
                  </span>
                  {p.snippet && <span className="bd-row-snippet">{p.snippet.replace(/\s+/g, " ")}</span>}
                  <small>
                    {p.author} · {ago(p.at)} · 👁 {p.views}
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

  const reload = useCallback(() => {
    fetchPost(id).then(
      (r) => {
        setD(r);
        markNewsSeen(`board.${r.post.cat}` as NewsKey); // 새 글을 열면 그 칸의 숫자를 지운다
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
          <b>{post.author}</b>
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
        {viewing !== null && <PhotoViewer photos={photos} start={viewing} onClose={() => setViewing(null)} />}
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
      <Comments me={me} id={id} comments={d.comments} roles={d.roles} onChange={(comments) => setD({ ...d, comments })} />
    </>
  );
}

function Comments({ me, id, comments, roles, onChange }: {
  me: Me;
  id: number;
  comments: BoardComment[];
  roles: PostDetail["roles"];
  onChange: (c: BoardComment[]) => void;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<BoardComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const top = comments.filter((c) => c.parent === null);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError("");
    try {
      const c = await addComment(id, t, reply?.id ?? null);
      onChange([...comments, c]);
      setText("");
      setReply(null);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: BoardComment) {
    try {
      await deleteComment(c.id);
      onChange(comments.filter((x) => x.id !== c.id && x.parent !== c.id));
    } catch (x) {
      setError(errorText(x));
    }
  }

  const line = (c: BoardComment, child: boolean) => (
    <li key={c.id} className={"bd-comment" + (child ? " bd-reply" : "")}>
      <div className="bd-comment-head">
        <b>{c.user}</b>
        {roles[c.user] && <RoleBadge role={roles[c.user]} />}
        <small>{ago(c.at)}</small>
        {!child && (
          <button className="bd-mini" onClick={() => setReply(c)}>
            답글
          </button>
        )}
        {(c.user === me.id || staff(me)) && (
          <button className="bd-mini" onClick={() => remove(c)}>
            삭제
          </button>
        )}
      </div>
      <p>{c.text}</p>
    </li>
  );

  return (
    <section className="panel bd-comments">
      <h2 className="panel-title">댓글 {comments.length}</h2>
      <ul>
        {top.map((c) => (
          <Fragment key={c.id}>
            {line(c, false)}
            {comments.filter((r) => r.parent === c.id).map((r) => line(r, true))}
          </Fragment>
        ))}
      </ul>
      {reply && (
        <p className="bd-replying">
          ↳ {reply.user} 님에게 답글 <button className="bd-mini" onClick={() => setReply(null)}>취소</button>
        </p>
      )}
      <form
        className="bd-comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="mk-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={reply ? "답글" : "댓글"} />
        <button className="pill" disabled={busy || !text.trim()}>
          등록
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </section>
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

/**
 * 사진 크게 보기 (제작자 요청: 새 창으로 열면 위아래가 잘리고 뒤로 가기에 웹이 꺼졌다).
 * 앱 안에서 화면에 맞춰 보이고(잘리지 않게), ✕ 나 폰의 뒤로 가기로 닫는다 (열 때 방문 기록을 하나 넣어 둔다).
 * 옆으로 밀면 다음·이전 사진, 두 번 누르면 두 배로 키워서 끌어 본다
 */
function PhotoViewer({ photos, start, onClose }: { photos: BoardFile[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  // 열 때 한 번만 방문 기록을 넣는다 (onClose 가 새로 만들어져도 다시 넣지 않게)
  const close = useRef(onClose);
  close.current = onClose;
  const count = photos.length;

  useEffect(() => {
    history.pushState({ photo: true }, "");
    const onPop = () => close.current();
    window.addEventListener("popstate", onPop);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") history.back();
      if (e.key === "ArrowRight") setI((n) => Math.min(count - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [count]);
  useEffect(() => setZoom(false), [i]);

  const f = photos[i];
  // 화면 전환 애니메이션(transform)이 걸린 칸 안에서는 fixed 가 화면 기준이 아니라서 body 에 바로 그린다
  return createPortal(
    <div className="pv" role="dialog" aria-label="사진">
      <div className="pv-top">
        <span>
          {i + 1} / {photos.length}
        </span>
        <a className="pv-btn" href={fileUrl(f.id)} download={f.name}>
          저장
        </a>
        <button className="pv-btn" onClick={() => history.back()} aria-label="닫기">
          ✕
        </button>
      </div>
      <div
        className={"pv-stage" + (zoom ? " pv-zoom" : "")}
        onTouchStart={(e) => {
          if (e.touches.length === 1) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t || zoom) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) setI((n) => Math.min(photos.length - 1, Math.max(0, n + (dx < 0 ? 1 : -1))));
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) history.back(); // 아래로 쓸어내리면 닫기
        }}
        onClick={() => {
          const now = Date.now();
          if (now - lastTap.current < 300) setZoom((z) => !z);
          lastTap.current = now;
        }}
      >
        <img src={fileUrl(f.id)} alt={f.name} draggable={false} />
      </div>
      {photos.length > 1 && (
        <div className="pv-nav">
          <button className="pv-btn" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="이전 사진">
            ◀
          </button>
          <button className="pv-btn" disabled={i === photos.length - 1} onClick={() => setI(i + 1)} aria-label="다음 사진">
            ▶
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

