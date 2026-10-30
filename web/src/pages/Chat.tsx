import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Wiki } from "../types";
import { askChat, shrinkImage, wikiContext } from "../chat";
import type { ChatImage, ChatTurn } from "../chat";
import { loadPosts, useAsync } from "../data";
import { inFloat } from "../platform";
import { TopBar } from "../ui";

/** 화면에 보이는 말 하나. previews 는 이번에 고른 사진 미리보기 (저장하지 않는다) */
interface Shown extends ChatTurn {
  previews?: string[];
  error?: boolean;
  /** 지난 대화에서 보낸 사진 수 (다시 열면 사진은 없고 개수만 보인다) */
  photos?: number;
}

const STORE = "sapphire-chat";
const EXAMPLES = ["30레벨 전사는 어디서 사냥해?", "현인의장갑은 어디서 나와?", "버섯늪지 퀘스트 알려 줘"];

/** 지난 대화 (이 탭에서만, 글만). 저장소를 못 쓰면 빈 대화 */
function loadHistory(): Shown[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Shown[];
  } catch {
    return [];
  }
}
function saveHistory(turns: Shown[]) {
  try {
    const light = turns.map(({ role, text, error, images, photos }) => ({ role, text, error, photos: images?.length || photos }));
    sessionStorage.setItem(STORE, JSON.stringify(light));
  } catch {
    // 저장 못 해도 대화는 된다
  }
}

/** 답 글: 줄바꿈은 그대로, **굵게** 만 살린다 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/**
 * AI 챗봇. 위키 자료(질문에 맞춰 고른 것)와 길드원이 갤러리에서 직접 고른 스샷으로 조언을 받는다.
 * 앱은 화면을 캡처하지 않고, 답은 읽는 글로만 보여 준다 (CLAUDE.md 게임 안전 규칙).
 * 게임 위 위키 창에서는 갤러리를 열 수 없어서 사진 버튼을 숨긴다.
 */
export function ChatPage({ wiki }: { wiki: Wiki }) {
  const { data: posts } = useAsync(useCallback(() => loadPosts(), []));
  const [turns, setTurns] = useState<Shown[]>(loadHistory);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ image: ChatImage; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(turns);
  }, [turns]);
  useEffect(() => {
    // 값을 돌려주지 않는다: 새 크롬은 scrollIntoView 가 Promise 를 돌려주는데, 그걸 돌려주면 React 가 정리 함수로 부르다 멈춘다
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  async function pick(files: FileList | null) {
    const room = 2 - pending.length;
    const chosen = Array.from(files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, room);
    const shrunk = await Promise.all(chosen.map((f) => shrinkImage(f).catch(() => null)));
    setPending((p) => [...p, ...shrunk.filter((x): x is NonNullable<typeof x> => x !== null)].slice(0, 2));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const question = input.trim();
    if (busy || (!question && !pending.length)) return;
    const user: Shown = {
      role: "user",
      text: question,
      images: pending.map((p) => p.image),
      previews: pending.map((p) => p.preview),
    };
    // 서버에는 오류 말을 빼고, 사진은 이번 질문 것만 보낸다
    const history: ChatTurn[] = [...turns.filter((t) => !t.error), user].map((t, i, all) => ({
      role: t.role,
      text: t.text,
      ...(i === all.length - 1 && t.images?.length ? { images: t.images } : {}),
    }));
    const context = wikiContext(wiki, posts, question);
    setTurns((t) => [...t, user, { role: "assistant", text: "" }]);
    setInput("");
    setPending([]);
    setBusy(true);
    const update = (fn: (last: Shown) => Shown) => setTurns((t) => [...t.slice(0, -1), fn(t[t.length - 1])]);
    try {
      const r = await askChat(history, context, (piece) => update((last) => ({ ...last, text: last.text + piece })));
      if (r.refused) update((last) => ({ ...last, text: "이 질문에는 답할 수 없어요. 다르게 물어봐 주세요." }));
      else if (r.cut) update((last) => ({ ...last, text: last.text + "\n\n(답이 길어서 여기까지만 보여요)" }));
      if (r.left !== null) setLeft(r.left);
    } catch (err) {
      update(() => ({ role: "assistant", text: err instanceof Error ? err.message : String(err), error: true }));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTurns([]);
    setPending([]);
  }

  return (
    <>
      <TopBar
        title="AI 챗봇"
        right={
          turns.length > 0 && !busy ? (
            <button className="topbar-action" onClick={reset}>
              새 대화
            </button>
          ) : undefined
        }
      />
      {turns.length === 0 && (
        <section className="panel chat-intro">
          <p>
            길드 위키 자료를 보고 답해요. 육성법, 장비, 드랍, 사냥터를 물어보세요.
            {!inFloat && " 📷 로 갤러리의 게임 스샷을 골라 보내면 보고 조언해 줘요."}
          </p>
          <div className="chat-examples">
            {EXAMPLES.map((x) => (
              <button key={x} className="pill" onClick={() => setInput(x)}>
                {x}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="chat-list">
        {turns.map((t, i) => (
          <div key={i} className={"bubble bubble-" + t.role + (t.error ? " bubble-error" : "")}>
            {t.previews?.map((src, j) => <img key={j} className="bubble-pic" src={src} alt="고른 스샷" />)}
            {!t.previews?.length && t.photos ? <div className="bubble-photos">📷 사진 {t.photos}장</div> : null}
            {t.text ? <Rich text={t.text} /> : t.role === "assistant" && busy && i === turns.length - 1 ? <span className="chat-wait">생각하는 중…</span> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat-compose" onSubmit={send}>
        {pending.length > 0 && (
          <div className="chat-pending">
            {pending.map((p, i) => (
              <span key={i} className="chat-thumb">
                <img src={p.preview} alt="" />
                <button type="button" onClick={() => setPending((all) => all.filter((_, j) => j !== i))} aria-label="사진 빼기">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-row">
          {!inFloat && (
            <>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />
              <button type="button" className="pill chat-photo" disabled={busy || pending.length >= 2} onClick={() => fileRef.current?.click()} aria-label="스샷 고르기">
                📷
              </button>
            </>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="궁금한 걸 물어보세요"
            rows={2}
            maxLength={2000}
          />
          <button className="btn chat-send" disabled={busy || (!input.trim() && !pending.length)}>
            {busy ? "…" : "보내기"}
          </button>
        </div>
        <p className="chat-note">
          위키 자료로 답해서 틀릴 수도 있어요{left !== null ? ` · 오늘 남은 질문 ${left}번` : ""}
        </p>
      </form>
    </>
  );
}
