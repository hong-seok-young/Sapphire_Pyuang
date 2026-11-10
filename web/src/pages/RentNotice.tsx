// 장비대여 안내 (제작자 2026-11-10. 대여 담당 성민(멍멍) 님이 제작자에게 카톡으로 부탁: '장비대여 들어가면 공지 하나만 띄워 주실 수 있나요? 장비대여가 결국엔
// 대화 내용이 남는 거라, 신청하고 저한테 프로필 카톡 주세요 느낌으로' -> 제작자 '장비대여에 들어오면 앱에서 신청하고 오픈카톡으로 채팅을 하라고 안내',
// '맨 위 전광판에 신청 후 오픈 채팅 하라고', '들어오면 안내 팝업, 다시 안 보기 체크', '대여 신청하고 나서는 신청했다 -> 오픈채팅을 하겠냐 팝업, 이 링크로 연결'.
// 초안 셋(공사 띠 + 안내 카드, LED 전광판 + 카톡 대화창, 퀘스트 줄 + NPC 대화창) 중 제작자가 '이게 좋다'로 퀘스트 줄 + NPC 대화창을 골랐다):
// - 맨 위 퀘스트 줄 (RentBoard): 들썩이는 '!' 표와 '대여 신청은 앱에서 · 신청한 뒤 대화는 담당자 멍멍 오픈채팅으로' (길면 흐른다). 누르면 오픈채팅이 열린다.
// - 들어올 때 NPC 대화창 (RentNotice): '멍멍 · 대여 담당', 말 한 줄, 단계 셋(앱에서 대여 신청 → 오픈채팅으로 대화 → 게임 안에서 받기), '오픈채팅 열기',
//   '다시 안 보기' (이 기기에 계정마다, localStorage sapphire.rent.notice.<아이디>. 글을 고쳐 다시 보이게 하려면 NOTICE_REV 를 올린다). 튜토리얼이 도는 동안은 안 뜬다.
// - 신청한 뒤 창 (AppliedPopup): 1단계 ✓, 2단계 금색 '오픈채팅으로 대화', '오픈채팅 열기' / '나중에'.
// 오픈채팅 링크는 담당자 계정의 카톡 링크(users.kakao, /api/kakao)다. 사람의 연락처라 공개 저장소에 적지 않고, 비공개 자료
// 길드/장비대여/담당자_오픈채팅.txt 를 배포(scripts/ci-d1.mjs)가 한 번 넣는다. 담당자가 '내 정보'에서 바꾸면 그대로 따라간다.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { KakaoBubble, useKakao } from "../kakao";
import { useBackClose } from "../backClose";
import { tutorialOpen, useTutorial } from "../tutorialState";
import { FlowLine } from "../ui";
import { RENT_MANAGER } from "../rental";

/** 안내 글의 판: 글을 고치면 올려서 '다시 안 보기'를 누른 사람에게도 한 번 다시 보인다 */
export const NOTICE_REV = "1";
const noticeKey = (me: string) => `sapphire.rent.notice.${me}`;

/** 담당자 이름과 오픈채팅 링크 (담당자 계정의 카톡 링크). ready: 링크를 한 번 받아 봤는지 */
export function useRentChat() {
  const { links, staff, ready } = useKakao();
  const name = RENT_MANAGER;
  const link = links[name] ?? (staff.length ? links[staff[0]] : undefined);
  return { name, link, ready };
}

/** 맨 위 퀘스트 줄: 누르면 담당자 오픈채팅 */
export function RentBoard() {
  const { name, link } = useRentChat();
  const text = `대여 신청은 앱에서 · 신청한 뒤 대화는 담당자 ${name} 오픈채팅으로`;
  const inner = (
    <>
      <span className="rn-quest-mark" aria-hidden>
        !
      </span>
      <FlowLine text={text} />
      <KakaoBubble />
    </>
  );
  return (
    <div className="rn-wrap">
      {link ? (
        <a className="rn-quest" href={link} target="_blank" rel="noopener noreferrer" aria-label={`${text} · 오픈채팅 열기`}>
          {inner}
        </a>
      ) : (
        <div className="rn-quest" role="note">
          {inner}
        </div>
      )}
    </div>
  );
}

/** 오픈채팅 여는 단추 (카톡 노랑). 링크를 아직 못 받았으면 흐리게, 받아 봤는데 없으면 안 그린다 */
function ChatLink({ onOpen }: { onOpen?: () => void }) {
  const { name, link, ready } = useRentChat();
  if (!link && ready) return null;
  return (
    <a
      className={"rn-kakao" + (link ? "" : " rn-kakao-off")}
      href={link ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} 오픈채팅 열기`}
      aria-disabled={!link}
      onClick={(e) => {
        if (!link) e.preventDefault();
        else onOpen?.();
      }}
    >
      <KakaoBubble />
      오픈채팅 열기
    </a>
  );
}

/** 창 틀: 어두운 막과 NPC 대화창 (바깥을 누르면 닫힘. 폰 뒤로 가기는 쓰는 쪽의 useBackClose) */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="rn-back" onClick={onClose}>
      <div className="rn-card" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** 단계 셋: 앱에서 대여 신청 → 오픈채팅으로 대화 → 게임 안에서 받기 (now: 지금 단계, 그 앞은 끝낸 것 ✓, 뒤는 흐리게) */
function Steps({ now }: { now: 1 | 2 }) {
  const names = ["앱에서 대여 신청", "오픈채팅으로 대화", "게임 안에서 받기"];
  return (
    <ol className="rn-steps">
      {names.map((n, i) => {
        const k = i + 1;
        // 안내 창(now 1)은 2·3단계를 보통으로, 신청 뒤 창(now 2)은 남은 3단계를 흐리게
        const cls = k < now ? "rn-done" : k === now ? "rn-now" : now === 1 ? "" : "rn-dim";
        return (
          <li key={n} className={cls}>
            <i>{k < now ? "✓" : k}</i>
            {n}
          </li>
        );
      })}
    </ol>
  );
}

/** 들어올 때 안내 창: '다시 안 보기'를 누르고 닫으면 이 기기·이 계정에서 다시 안 뜬다 (글을 고쳐 NOTICE_REV 를 올리면 한 번 더) */
export function RentNotice({ me }: { me: string }) {
  const { name } = useRentChat();
  const [open, setOpen] = useState(() => {
    if (tutorialOpen()) return false;
    try {
      return localStorage.getItem(noticeKey(me)) !== NOTICE_REV;
    } catch {
      return true;
    }
  });
  const [never, setNever] = useState(false);
  const tut = useTutorial();
  // 튜토리얼이 시작되면 안내 창은 닫는다 (비출 자리를 가리지 않게)
  useEffect(() => {
    if (tut) setOpen(false);
  }, [tut]);
  const close = () => {
    if (never) {
      try {
        localStorage.setItem(noticeKey(me), NOTICE_REV);
      } catch {
        // 저장 못 해도 이번에는 닫는다
      }
    }
    setOpen(false);
  };
  useBackClose(open, close);
  if (!open) return null;
  return (
    <Sheet label="장비대여 안내" onClose={close}>
      <div className="rn-npc">
        <span className="rn-quest-mark" aria-hidden>
          !
        </span>
        <b>{name}</b>
        <small>대여 담당</small>
      </div>
      <p className="rn-say">“신청은 앱에서, 대화는 오픈채팅으로 해 줘요!”</p>
      <Steps now={1} />
      <ChatLink onOpen={close} />
      <button type="button" className={"rn-never" + (never ? " rn-never-on" : "")} role="checkbox" aria-checked={never} onClick={() => setNever((v) => !v)}>
        <span className="rn-box" aria-hidden>
          {never ? "✓" : ""}
        </span>
        다시 안 보기
      </button>
      <button type="button" className="pill" onClick={close}>
        닫기
      </button>
    </Sheet>
  );
}

/** 대여 신청을 보낸 뒤: 1단계 ✓, 2단계 오픈채팅으로 대화 */
export function AppliedPopup({ onClose }: { onClose: () => void }) {
  const { name } = useRentChat();
  useBackClose(true, onClose);
  return (
    <Sheet label="신청했어요" onClose={onClose}>
      <div className="rn-npc">
        <span className="rn-quest-mark" aria-hidden>
          !
        </span>
        <b>신청했어요</b>
        <small>{name} · 대여 담당</small>
      </div>
      <Steps now={2} />
      <p className="rn-say">“오픈채팅으로 이야기할까요?”</p>
      <ChatLink onOpen={onClose} />
      <button type="button" className="pill" onClick={onClose}>
        나중에
      </button>
    </Sheet>
  );
}
