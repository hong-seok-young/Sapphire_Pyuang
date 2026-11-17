// 사용 기록의 챗봇 질문과 답 (제작자 2026-11-17 '챗봇을 썼으면 그 챗봇에서 질문과 답변도 보이게').
// 목록에는 질문과 답 4줄만, 답을 누르면 화면을 바꿔 챗봇 화면과 같은 모양(ChatAnswer)으로 전체를 보인다 (#/log/qa/<질문 글 번호>).
// 폰 뒤로 가기는 보던 목록 자리로 돌아온다 (제작자 2026-11-17 '한 번 누르면 스크롤이 너무 많아지니 화면 전환으로, 뒤로 가기 누르면 원래 보던 스크롤 위치로':
// 펼친 카드는 useEntryState, 목록은 이번에 연 동안 받은 것, 스크롤은 router 가 되돌린다)
import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { fetchQA, plainAnswer } from "../activity";
import type { ChatQA } from "../activity";
import { Nick } from "../kakao";
import { go } from "../router";
import type { Wiki } from "../types";
import { Loading, TopBar } from "../ui";
import { ChatAnswer } from "./ChatAnswer";

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const secText = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}초` : `${Math.round(ms / 60_000)}분`);
const whenText = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(t)}`;
};

/** 목록에서 본 질문과 답 (답 화면이 서버에 다시 묻지 않고 바로 그린다) */
const seen = new Map<number, ChatQA>();

/** 질문과 답 한 쌍. who 를 주면 맨 위에 누가 */
export function ChatCard({ qa, who, when }: { qa: ChatQA; wiki?: Wiki; who?: boolean; when?: string }) {
  const preview = qa.a ? plainAnswer(qa.a) : "";
  return (
    <div className="lg-qa">
      {(who || when) && (
        <div className="lg-qa-head">
          {who && (
            <b>
              <Nick name={qa.user} />
            </b>
          )}
          <small>{when ?? hm(qa.at)}</small>
        </div>
      )}
      <p className="lg-q">
        <i aria-hidden>Q</i>
        <span>
          {qa.q || "(첨부만)"}
          {qa.attach.length > 0 && <em> · {qa.attach.join(", ")}</em>}
        </span>
      </p>
      {qa.a === null ? (
        <p className="lg-a lg-a-none">
          <i aria-hidden>A</i>
          <span>답 없음 (끊겼거나 답하는 중)</span>
        </p>
      ) : (
        <button
          type="button"
          className="lg-a"
          onClick={() => {
            seen.set(qa.id, qa);
            go(`#/log/qa/${qa.id}`);
          }}
        >
          <i aria-hidden>A</i>
          <span className="lg-a-text">{preview || "(그림·표만)"}</span>
          <small className="lg-a-more">
            답 전체 ›{qa.aAt ? ` · ${secText(qa.aAt - qa.at)} 걸림` : ""}
          </small>
        </button>
      )}
    </div>
  );
}

/** 답 전체 화면 (#/log/qa/<질문 글 번호>): 누가 언제 물었는지, 질문, 챗봇 화면과 같은 모양의 답 */
export function LogAnswerPage({ id, wiki }: { id: number; wiki: Wiki }) {
  const [qa, setQa] = useState<ChatQA | null>(seen.get(id) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (seen.has(id)) return;
    let alive = true;
    fetchQA(id).then(
      (r) => {
        if (!alive) return;
        seen.set(id, r);
        setQa(r);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <>
      <TopBar title="챗봇 질문과 답" />
      {!qa ? (
        <Loading error={error} />
      ) : (
        <section className="panel lg-qa-page">
          <div className="lg-qa-head">
            <b>
              <Nick name={qa.user} />
            </b>
            <small>
              {whenText(qa.at)}
              {qa.aAt ? ` · ${secText(qa.aAt - qa.at)} 걸림` : ""}
            </small>
          </div>
          <p className="lg-q">
            <i aria-hidden>Q</i>
            <span>
              {qa.q || "(첨부만)"}
              {qa.attach.length > 0 && <em> · {qa.attach.join(", ")}</em>}
            </span>
          </p>
          {qa.a === null ? (
            <p className="lg-a lg-a-none">
              <i aria-hidden>A</i>
              <span>답 없음 (끊겼거나 답하는 중)</span>
            </p>
          ) : (
            <div className="lg-a-full">
              <ChatAnswer wiki={wiki} text={qa.a} done onAsk={() => {}} />
            </div>
          )}
        </section>
      )}
    </>
  );
}
