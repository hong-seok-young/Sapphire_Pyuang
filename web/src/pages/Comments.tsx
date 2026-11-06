// 글 아래 댓글 칸 (게시판 글과 아이모 소식 글이 같이 쓴다. 제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등, 일반 게시판이랑 똑같이').
// 댓글과 답글(한 단계), 쓴 사람·운영진의 삭제, 마지막으로 본 뒤에 남이 단 댓글의 'N'
import { Fragment, useState } from "react";
import { RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { addComment, deleteComment } from "../board";
import type { BoardComment, PostDetail } from "../board";
import { RoleBadge } from "../emblems";
import { ago } from "../market";
import { NewTag } from "../ui";
import { KakaoButton, Nick } from "../kakao";

const staff = (me: Me) => RANK[me.role] >= 1;

export function Comments({ me, id, comments, roles, since, onChange, add = addComment, remove: removeApi = deleteComment }: {
  me: Me;
  id: number;
  comments: BoardComment[];
  roles: PostDetail["roles"];
  /** 이 글을 마지막으로 본 때: 그 뒤에 남이 단 댓글에 'N' */
  since: number;
  onChange: (c: BoardComment[]) => void;
  /** 댓글 올리기·지우기 (게시판 글이 아니면 그 글의 API, 아이모 소식 글은 src/official.ts) */
  add?: (id: number, text: string, parent: number | null) => Promise<BoardComment>;
  remove?: (commentId: number) => Promise<unknown>;
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
      const c = await add(id, t, reply?.id ?? null);
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
      await removeApi(c.id);
      onChange(comments.filter((x) => x.id !== c.id && x.parent !== c.id));
    } catch (x) {
      setError(errorText(x));
    }
  }

  const line = (c: BoardComment, child: boolean) => (
    <li key={c.id} className={"bd-comment" + (child ? " bd-reply" : "")}>
      <div className="bd-comment-head">
        <NewTag on={c.at > since && c.user !== me.id} />
        <b>
          <Nick name={c.user} />
        </b>
        <KakaoButton name={c.user} />
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
