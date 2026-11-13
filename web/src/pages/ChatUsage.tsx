// 챗봇 입력창 위 한 줄 사용량 막대 (제작자 2026-11-13 '다른 설명 다 필요 없이 행 하나로 막대와 내가 쓴 금액, 300 중 내가 얼마 썼냐 길드 전체 얼마 썼냐',
// 초안 셋 중 'b': 글자를 막대 안에). 금색 = 내 몫(묶은 캐릭터 모두), 파랑 = 길드 전체, 빈 칸 = 이번 달 남은 한도. 실시간으로 채워지게:
// 화면이 보이는 동안 1분마다, 답이 끝나면('sapphire:chat-used') 곧바로 다시 받는다 (서버가 사용량을 답을 넣은 뒤에 적어서 2초·8초 뒤에 한 번씩 더).
import { useEffect, useRef, useState } from "react";
import { api } from "../auth";

interface Usage {
  month: string;
  limit: number;
  guild: number;
  me: number;
}

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`);

/** 답이 끝났을 때 Chat.tsx 가 부른다 */
export const chatUsed = () => dispatchEvent(new Event("sapphire:chat-used"));

export function ChatUsageBar() {
  const [u, setU] = useState<Usage | null>(null);
  const [bump, setBump] = useState(0);
  const last = useRef<Usage | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => {
      if (document.hidden) return;
      api<Usage>("/api/chat/usage")
        .then((n) => {
          if (dead) return;
          const p = last.current;
          if (p && (n.me > p.me + 0.004 || n.guild > p.guild + 0.004)) setBump((b) => b + 1);
          last.current = n;
          setU(n);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 60_000);
    const later: number[] = [];
    const onUsed = () => {
      later.push(window.setTimeout(load, 2000), window.setTimeout(load, 8000));
    };
    const onShow = () => {
      if (!document.hidden) load();
    };
    addEventListener("sapphire:chat-used", onUsed);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      clearInterval(timer);
      later.forEach(clearTimeout);
      removeEventListener("sapphire:chat-used", onUsed);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  if (!u) return null;
  const all = Math.min(1, u.guild / u.limit);
  const mine = Math.min(all, u.me / u.limit);
  return (
    <div className="chat-use" title={`이번 달 AI 사용 · 나 ${usd(u.me)} · 길드 ${usd(u.guild)} / $${u.limit}`}>
      <div className={"chat-use-bar" + (all >= 0.9 ? " chat-use-hot" : "")}>
        <i className="chat-use-all" style={{ transform: `scaleX(${all})` }} />
        <i className="chat-use-me" style={{ transform: `scaleX(${mine})` }} />
        <i className="chat-use-shine" />
        {bump > 0 && <i key={bump} className="chat-use-pop" style={{ left: `${all * 100}%` }} />}
        <span className="chat-use-lbl">
          <b>나 {usd(u.me)}</b>
          <span>
            길드 {usd(u.guild)} / ${u.limit}
          </span>
        </span>
      </div>
    </div>
  );
}
