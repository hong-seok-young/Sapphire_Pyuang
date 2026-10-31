import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { fixGap, listGaps } from "../chat";
import type { ChatGap } from "../chat";
import { ago } from "../market";
import { Loading, TopBar } from "../ui";

/**
 * 챗봇 개선 (앱개발자만, 제작자 요청): 길잡이가 짐작하거나 자료가 없다고 한 답, 길드원이 '👎 별로'를 누른 답.
 * '목록 복사'로 Claude 에게 넘겨 위키 자료나 프롬프트를 고치고 배포한 뒤 '개선 완료'를 누르면,
 * 물은 사람에게 '챗봇이 개선됐어요' 알림이 가고 누르면 그 대화에서 새 답을 받는다
 */
export function ChatGapsPage() {
  const [tab, setTab] = useState<"open" | "fixed">("open");
  const [gaps, setGaps] = useState<ChatGap[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setGaps(null);
    listGaps(tab).then(
      (r) => alive && setGaps(r.gaps),
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [tab]);

  /** Claude 에게 넘길 글 */
  function copyAll() {
    const list = gaps ?? [];
    const text =
      `[사파이어 챗봇 개선 요청 ${list.length}건] 길잡이가 모르거나 길드원이 별로라고 한 질문이에요. 위키 자료나 챗봇을 고쳐 주세요.\n\n` +
      list
        .map((g) =>
          [
            `#${g.id} ${new Date(g.created_at).toLocaleString("ko-KR")} ${g.user_id} (${g.kind === "user" ? "길드원이 별로라고 함" : "길잡이가 모름"})`,
            `질문: ${g.question}`,
            `모자란 것: ${g.reason}`,
            g.answer ? `답: ${g.answer.replace(/\s+/g, " ").slice(0, 400)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <TopBar title="챗봇 개선" />
      <div className="gap-top">
        <button className={"pill" + (tab === "open" ? " pill-on" : "")} onClick={() => setTab("open")}>
          대기
        </button>
        <button className={"pill" + (tab === "fixed" ? " pill-on" : "")} onClick={() => setTab("fixed")}>
          개선함
        </button>
        {tab === "open" && gaps && gaps.length > 0 && (
          <button className="pill" onClick={copyAll}>
            {copied ? "✓ 복사됨" : "📋 목록 복사"}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!gaps && !error && <Loading />}
      {gaps?.length === 0 && <p className="muted chat-empty">{tab === "open" ? "모르는 질문이 없어요" : "아직 개선한 질문이 없어요"}</p>}
      {gaps?.map((g) => (
        <GapCard key={g.id} g={g} onFixed={() => setGaps((all) => (all ?? []).filter((x) => x.id !== g.id))} onError={setError} />
      ))}
    </>
  );
}

function GapCard({ g, onFixed, onError }: { g: ChatGap; onFixed: () => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel gap-card">
      <div className="gap-head">
        <span>
          {g.kind === "user" ? "👎" : "🤔"} {g.user_id}
        </span>
        <span>{ago(g.status === "fixed" && g.fixed_at ? g.fixed_at : g.created_at)}</span>
      </div>
      <div className="gap-q">{g.question}</div>
      <div className="gap-reason">{g.reason}</div>
      {g.note && <div className="chat-step">고친 것: {g.note}</div>}
      {g.answer && (
        <button className="chat-act" onClick={() => setOpen(!open)}>
          {open ? "답 접기" : "답 보기"}
        </button>
      )}
      {open && g.answer && <div className="gap-answer">{g.answer}</div>}
      {g.status === "open" && !fixing && (
        <div className="gap-actions">
          <button className="pill pill-on" onClick={() => setFixing(true)}>
            개선 완료
          </button>
        </div>
      )}
      {fixing && (
        <form
          className="gap-actions"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            fixGap(g.id, note).then(onFixed, (x) => {
              onError(errorText(x));
              setBusy(false);
            });
          }}
        >
          <input className="chat-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="고친 것 (물은 사람에게 보여요)" maxLength={200} />
          <button className="pill pill-on" disabled={busy}>
            알림 보내기
          </button>
          <button type="button" className="pill" onClick={() => setFixing(false)}>
            취소
          </button>
        </form>
      )}
    </section>
  );
}
