// 건의 결재선 (제작자 2026-11-10 '건의 접수가 되면 결재선을 만들어서 제대로 처리, 개발 요청처럼'): 건의 글 아래 결재란 · 내 결재 · 결재 이력.
// 접수 · 오피서 합의 · 길마 결재 · 접수 완료 · 반영 완료. 길마는 직권 결재(합의 없이)와 반려 뒤 강제 결재, 반영 완료는 운영진 누구나. 서버 server/suggest.ts
// 모양은 개발 요청의 결재란(.dr-*)을 그대로 쓴다. 보는 동안 새로 찍힌 도장만 쾅
import { Fragment, useEffect, useRef, useState } from "react";
import { RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { actSuggest } from "../board";
import type { SgKind, SgStatus, SgStep } from "../board";
import { Nick } from "../kakao";
import { ago } from "../market";
import { FitLine } from "../ui";

/** 길드마스터 (결재 칸 아래 미리 적어 두는 이름, DevRequests.tsx 와 같다) */
const GUILD_MASTER = "마을모금함";

const seen = new Set<string>();
/** 도장: 처음 그릴 때는 가만히, 보는 동안 새로 찍힌 것만 쾅 */
function Stamp({ id, text, red, grey }: { id: string; text: string; red?: boolean; grey?: boolean }) {
  const first = useRef(!seen.size);
  const pop = useRef(!first.current && !seen.has(id)).current;
  useEffect(() => {
    seen.add(id);
  }, [id]);
  return <span className={"dr-stamp" + (red ? " dr-stamp-red" : "") + (grey ? " dr-stamp-grey" : "") + (pop ? " dr-stamp-pop" : "")}>{text}</span>;
}

const KIND_LINE: Record<SgKind, string> = {
  agree: "합의",
  approve: "길마 결재",
  skip: "길마 직권 결재 (합의 생략)",
  force: "길마 강제 결재",
  reject: "반려",
  done: "반영 완료",
  resubmit: "고쳐서 다시 올림",
};
/** 이번 차례의 이력 (반려 뒤 다시 올리면 그 뒤부터, 서버 server/suggest.ts currentRound) */
const currentRound = (steps: SgStep[]) => steps.slice(steps.map((s) => s.kind).lastIndexOf("resubmit") + 1);

/** 결재란: 접수 · 오피서 합의 · 길마 결재 · 접수 완료 · 반영 완료 */
function Line({ postId, author, status, steps }: { postId: number; author: string; status: SgStatus; steps: SgStep[] }) {
  const by = (k: SgKind) => steps.filter((s) => s.kind === k);
  const agrees = by("agree");
  const reject = [...steps].reverse().find((s) => s.kind === "reject");
  const go = by("approve")[0] ?? by("skip")[0] ?? by("force")[0];
  const skip = by("skip")[0];
  const force = by("force")[0];
  const done = by("done")[0];
  const accepted = status === "accepted" || status === "done";
  type Cell = { key: string; label: string; step?: { user_id: string; kind: string }; stamp: string; wait: boolean; red?: boolean; grey?: boolean; pre?: string };
  const cells: Cell[] = [
    { key: "sub", label: "접수", step: { user_id: author, kind: "sub" }, stamp: "접수", wait: false },
    skip && !agrees.length
      ? { key: "agree", label: "오피서 합의", step: skip, stamp: "생략", grey: true, wait: false }
      : { key: "agree", label: "오피서 합의", step: agrees[agrees.length - 1], stamp: agrees.length > 1 ? `합의${agrees.length}` : "합의", wait: status === "agree" && !agrees.length },
    { key: "appr", label: "길마 결재", step: go, stamp: force ? "강제" : skip ? "직권" : "결재", wait: status === "agree" && agrees.length > 0, pre: GUILD_MASTER },
    { key: "acc", label: "접수 완료", step: accepted && go ? { user_id: go.user_id, kind: "acc" } : undefined, stamp: "접수", wait: false },
    { key: "done", label: "반영 완료", step: done, stamp: "반영", wait: status === "accepted" },
  ];
  // 반려는 아직 도장이 없는 첫 칸에 빨간 도장 (강제 결재로 받아들였으면 반려 도장은 오피서 합의 칸 이력에만)
  if (status === "rejected" && reject) {
    const c = cells.find((x) => !x.step);
    if (c) Object.assign(c, { step: reject, stamp: "반려", red: true });
  }
  return (
    <div className={"dr-line" + (status === "rejected" ? " dr-line-rej" : "")}>
      {cells.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 && <span className={"dr-link" + (c.step || c.wait ? " dr-link-on" : "")} aria-hidden />}
          <div className={"dr-cell" + (c.wait && status !== "rejected" ? " dr-cell-wait" : "") + (c.step ? " dr-cell-done" : "")}>
            <span className="dr-cell-label">
              <FitLine text={c.label} wrap={false} />
            </span>
            <span className="dr-cell-box">
              {c.step ? (
                <Stamp id={`${postId}:${steps.length ? steps[0].created_at : 0}:${c.key}:${c.stamp}:${c.step.user_id}`} text={c.stamp} red={c.red} grey={c.grey} />
              ) : c.wait && status !== "rejected" ? (
                <span className="dr-wait">대기</span>
              ) : null}
            </span>
            <span className={"dr-cell-who" + (!c.step && c.pre ? " dr-cell-pre" : "")}>
              {c.step ? <FitLine text={c.step.user_id} wrap={false} /> : c.pre ? <FitLine text={c.pre} wrap={false} /> : null}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** 내 결재: 오피서는 합의·반려, 길마는 결재(합의 없으면 직권 결재)·반려, 반려된 건의는 길마 강제 결재, 접수 완료는 운영진 누구나 반영 완료 */
function Act({ me, postId, mine, status, steps: all, onDone }: { me: Me; postId: number; mine: boolean; status: SgStatus; steps: SgStep[]; onDone: () => void }) {
  const steps = currentRound(all);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  const agrees = steps.filter((s) => s.kind === "agree");
  const myChars = me.characters?.length ? me.characters.map((c) => c.id) : [me.id];
  let acts: [SgKind, string][] = [];
  let ph = "의견 (선택)";
  if (status === "agree") {
    if (me.role === "officer" && !mine && !agrees.some((s) => myChars.includes(s.user_id))) {
      acts = [
        ["agree", "합의"],
        ["reject", "반려"],
      ];
      ph = "합의·반려 의견 (반려하면 꼭)";
    } else if (me.role === "master") {
      acts = [agrees.length ? ["approve", "결재"] : ["skip", "직권 결재"], ["reject", "반려"]];
      ph = "결재·반려 의견 (반려하면 꼭)";
    }
  } else if (status === "rejected" && mine) {
    // 올린 사람: 반려 의견을 보고 '수정'으로 고친 뒤 다시 올린다 (제작자 2026-11-10 '다시 올리기 ㄱ')
    acts = [["resubmit", "다시 올리기"]];
    ph = "다시 올리며 한마디 (선택)";
  } else if (status === "rejected" && me.role === "master") {
    acts = [["force", "강제 결재"]];
    ph = "결재 의견 (선택)";
  } else if (status === "accepted" && RANK[me.role] >= 1) {
    acts = [["done", "반영 완료"]];
    ph = "어떻게 반영했는지 (선택)";
  }
  if (!acts.length) return null;
  const go = async (a: SgKind) => {
    if (a === "reject" && !note.trim()) return setErr("반려 의견을 적어 주세요");
    if (a === "force" && !armed) return setArmed(true);
    setBusy(true);
    setErr("");
    try {
      await actSuggest(postId, a, note.trim());
      setNote("");
      setArmed(false);
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-act">
      <b className="dr-sub-title dr-act-title">내 결재</b>
      <textarea className="dr-text dr-note" rows={2} maxLength={300} value={note} placeholder={ph} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="dr-err">{err}</p>}
      <div className="dr-act-btns">
        {acts.map(([a, name]) => (
          <button
            key={a}
            type="button"
            className={"btn dr-btn " + (a === "reject" ? "dr-btn-no" : a === "force" ? "dr-btn-force" + (armed ? " dr-btn-danger" : "") : "dr-btn-go")}
            disabled={busy}
            onClick={() => void go(a)}
          >
            {a !== "reject" && <span className="dr-btn-shine" aria-hidden />}
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SuggestFlow({
  me,
  postId,
  author,
  mine,
  flow,
  onChanged,
}: {
  me: Me;
  postId: number;
  author: string;
  mine: boolean;
  flow: { status: SgStatus; steps: SgStep[] };
  onChanged: () => void;
}) {
  const round = flow.steps.filter((s) => s.kind === "resubmit").length + 1;
  return (
    <section className="panel sg-flow">
      {round > 1 && <span className="sg-round">{round}차</span>}
      <Line postId={postId} author={author} status={flow.status} steps={currentRound(flow.steps)} />
      <Act me={me} postId={postId} mine={mine} status={flow.status} steps={flow.steps} onDone={onChanged} />
      {flow.steps.length > 0 && (
        <div className="dr-history">
          <b className="dr-sub-title">결재 이력</b>
          {flow.steps.map((s, i) => (
            <div key={i} className={`dr-step dr-step-${s.kind === "skip" || s.kind === "force" ? "approve" : s.kind === "resubmit" ? "resubmit" : s.kind}`}>
              <span className="dr-step-kind">{KIND_LINE[s.kind]}</span>
              <span className="dr-step-who">
                <Nick name={s.user_id} />
              </span>
              <span className="dr-step-at">{ago(s.created_at)}</span>
              {s.note && <p className="dr-step-note">{s.note}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
