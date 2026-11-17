// 사용 기록의 챗봇 질문과 답 (제작자 2026-11-17 '챗봇을 썼으면 그 챗봇에서 질문과 답변도 보이게').
// 답은 처음엔 보통 글로 몇 줄만, '답 전체'를 누르면 챗봇 화면과 같은 모양(ChatAnswer)으로 펼친다
import { useState } from "react";
import { plainAnswer } from "../activity";
import type { ChatQA } from "../activity";
import { Nick } from "../kakao";
import type { Wiki } from "../types";
import { ChatAnswer } from "./ChatAnswer";

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const secText = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}초` : `${Math.round(ms / 60_000)}분`);

/** 질문과 답 한 쌍. who 를 주면 맨 위에 누가·언제 */
export function ChatCard({ qa, wiki, who, when }: { qa: ChatQA; wiki: Wiki; who?: boolean; when?: string }) {
  const [full, setFull] = useState(false);
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
      ) : full ? (
        <div className="lg-a-full">
          <ChatAnswer wiki={wiki} text={qa.a} done onAsk={() => {}} />
          <button type="button" className="lg-a-more" onClick={() => setFull(false)}>
            접기
          </button>
        </div>
      ) : (
        <button type="button" className="lg-a" onClick={() => setFull(true)} data-notap>
          <i aria-hidden>A</i>
          <span className="lg-a-text">{preview || "(그림·표만)"}</span>
          <small className="lg-a-more">
            답 전체{qa.aAt ? ` · ${secText(qa.aAt - qa.at)} 걸림` : ""}
          </small>
        </button>
      )}
    </div>
  );
}
