import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { RANK, errorText } from "../auth";
import type { Me } from "../auth";
import {
  CATS, CAT_ICON, CAT_NAME, URL_RE, addComment, createPost, deleteComment, deleteFile, deletePost, fetchPost, fetchPosts,
  fileUrl, linkPreview, setLike, shrinkPhoto, sizeText, updatePost, uploadFile, youtubeId,
} from "../board";
import type { BoardComment, BoardFile, Cat, LinkPreview, PostDetail, PostSummary } from "../board";
import { RoleBadge } from "../emblems";
import { ago } from "../market";
import { go } from "../router";
import { Loading, TopBar } from "../ui";

/** 공지사항과 이벤트는 오피서 이상만 쓴다 (서버 server/board.ts canWrite 와 같다) */
const canWrite = (me: Me, cat: Cat) => cat === "free" || RANK[me.role] >= 1;
const staff = (me: Me) => RANK[me.role] >= 1;

/**
 * 게시판 (제작자 요청, 홈의 '장비' 칸 자리): #/board 목록, #/board/:id 글, #/board/write?cat=, #/board/:id/edit
 * 사진과 첨부 파일, 링크(유튜브는 글 안에서 바로 재생, 다른 링크는 제목과 그림 미리보기), 댓글과 답글, 좋아요, 본 사람 수, 고정
 */
export function BoardPage({ me, arg, sub, query }: { me: Me; arg: string; sub: string; query: URLSearchParams }) {
  if (arg === "write") return <Write me={me} cat={(query.get("cat") as Cat) || "free"} />;
  const id = Number(arg);
  if (id && sub === "edit") return <Write me={me} editId={id} />;
  if (id) return <PostView me={me} id={id} />;
  return <List me={me} cat={(query.get("cat") as Cat | null) ?? null} />;
}

function List({ me, cat }: { me: Me; cat: Cat | null }) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
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
      setPosts([...posts, ...r.posts]);
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
      <div className="filter">
        <button className={"pill" + (!cat ? " pill-on" : "")} onClick={() => go("#/board", true)}>
          전체
        </button>
        {CATS.map((c) => (
          <button key={c} className={"pill" + (cat === c ? " pill-on" : "")} onClick={() => go(`#/board?cat=${c}`, true)}>
            {CAT_ICON[c]} {CAT_NAME[c]}
          </button>
        ))}
      </div>
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
                {p.thumb && <img className="bd-thumb" src={fileUrl(p.thumb)} alt="" loading="lazy" />}
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
    fetchPost(id).then(setD, (x) => setError(errorText(x)));
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
  const [loaded, setLoaded] = useState(!editId);

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
  useEffect(() => () => added.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [added]);

  const count = old.length - removed.length + added.length;
  function pick(list: FileList | null, photo: boolean) {
    if (!list) return;
    const room = 10 - count;
    const next = [...list].slice(0, Math.max(0, room)).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      photo: photo && file.type.startsWith("image/"),
      preview: photo && file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    if (list.length > room) setError("사진과 파일은 글 하나에 10개까지예요");
    setAdded([...added, ...next]);
  }

  async function save() {
    if (!title.trim()) return setError("제목을 적어 주세요");
    setError("");
    try {
      setBusy("글을 올리는 중…");
      let id = editId;
      if (id) await updatePost(id, { title, body });
      else id = (await createPost(cat, title, body)).id;
      for (const fid of removed) await deleteFile(fid);
      for (let i = 0; i < added.length; i++) {
        const f = added[i];
        setBusy(`${f.photo ? "사진" : "파일"} 올리는 중… ${i + 1}/${added.length}`);
        if (f.photo) {
          const { blob, name } = await shrinkPhoto(f.file);
          await uploadFile(id, blob, name);
        } else {
          if (f.file.size > 1_900_000) throw new Error(`${f.file.name}: 파일은 1.9MB 까지예요`);
          await uploadFile(id, f.file, f.file.name);
        }
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
          <div className="filter">
            {CATS.filter((c) => canWrite(me, c)).map((c) => (
              <button key={c} type="button" className={"pill" + (cat === c ? " pill-on" : "")} onClick={() => setCat(c)}>
                {CAT_ICON[c]} {CAT_NAME[c]}
              </button>
            ))}
          </div>
        )}
        <input className="mk-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="제목" aria-label="제목" />
        <textarea
          className="mk-input bd-textarea"
          value={body}
          maxLength={10000}
          onChange={(e) => setBody(e.target.value)}
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
        </div>
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
                <button type="button" aria-label="빼기" onClick={() => setAdded(added.filter((x) => x.key !== f.key))}>
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

