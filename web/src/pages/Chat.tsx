import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Wiki } from "../types";
import { errorText } from "../auth";
import {
  askChat,
  deleteFrom,
  deleteThread,
  listThreads,
  loadThread,
  readAttachment,
  reportAnswer,
  saveAnswer,
  shrinkImage,
  updateThread,
  wikiContext,
} from "../chat";
import type { ChatFile, ChatImage, ChatSource, ChatStep, ChatTurn, SavedMsg, ThreadSummary } from "../chat";
import { loadPosts, useAsync } from "../data";
import { inFloat } from "../platform";
import { go } from "../router";
import { Loading, TopBar } from "../ui";
import { ChatAnswer } from "./ChatAnswer";

/**
 * AI 챗봇 (제작자 요청: 클로드, GPT 처럼). 대화는 계정에 남고(목록 #/chat/list, 대화 #/chat/번호), 이어서 묻고,
 * 이름 변경, 고정, 삭제, 찾기가 된다. 답하는 동안 위키에서 무엇을 찾았는지와 생각(요약)을 보이고, 중지, 다시 답하기, 질문 수정, 복사가 된다.
 * 위키 자료(질문에 맞춰 고른 것), 웹 찾기(출처를 답 아래에), 길드원이 직접 고른 스샷, PDF, 글 파일로 답한다 (제작자 요청: 모든 걸 되게).
 * 새로 고치거나 닫아도 서버가 답을 마저 받아 둔다. 다시 열면 답을 기다렸다가 보이고, 서버도 못 끝냈으면 다시 묻는다.
 * 앱은 화면을 캡처하지 않고, 답은 읽는 글로만 보여 준다 (CLAUDE.md 게임 안전 규칙). 게임 위 위키 창에서는 첨부 버튼을 숨긴다.
 */

/** 화면에 보이는 말 하나 */
interface Shown {
  /** 서버에 저장된 말 번호 */
  id?: number;
  role: "user" | "assistant";
  text: string;
  /** 이번에 고른 사진 (저장하지 않는다) */
  images?: ChatImage[];
  previews?: string[];
  /** 지난 대화에서 보낸 사진 수 */
  photos?: number;
  /** 이번에 고른 파일 (저장하지 않는다) */
  files?: ChatFile[];
  /** 지난 대화에서 보낸 첨부 이름 */
  attach?: string[];
  /** 웹 찾기, 글 읽기 */
  steps?: ChatStep[];
  /** 웹 출처 */
  sources?: ChatSource[];
  /** 새로 고친 뒤 서버가 받던 답을 기다리는 중 */
  resuming?: boolean;
  at?: number;
  error?: boolean;
  /** 생각(요약) */
  thinking?: string;
  thinkMs?: number | null;
  /** 위키에서 찾은 것 */
  found?: string[];
  /** 답 아래 작은 안내 (중지, 끊김, 길이) */
  note?: string;
  /** 챗봇이 개선돼서 다시 물은 질문 (개선 내용) */
  redo?: string;
  streaming?: boolean;
}

const EXAMPLES = ["30레벨 전사는 어디서 사냥해?", "현인의장갑은 어디서 나와?", "버섯늪지 퀘스트 알려 줘"];

function parse<T>(json: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

const fromSaved = (m: SavedMsg): Shown => ({
  id: m.id,
  role: m.role,
  text: m.text,
  photos: m.photos || undefined,
  attach: parse<string[]>(m.attach)?.filter((n) => n !== "사진"),
  thinking: m.thinking ?? undefined,
  thinkMs: m.think_ms,
  found: m.found ? m.found.split(" · ") : undefined,
  steps: parse<ChatStep[]>(m.steps),
  sources: parse<ChatSource[]>(m.sources),
  at: m.created_at,
});

/** 질문이 남아 있고 답이 없는 대화를 이만큼 안에 열면 서버가 받던 답을 기다린다 */
const RESUME_MS = 15 * 60_000;

/** 복사할 글: 그림 단추 표시는 이름만, 추천 질문은 뺀다 */
const plainAnswer = (text: string) =>
  text
    .replace(/\[\[(?:질문|모름):[^\]\n]*\]\]/g, "")
    .replace(/\[\[(?:아이템|몬스터|사냥터|메뉴|화면):([^\]\n]+)\]\]/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** 같은 쪽 말이 이어지면 하나로 (답을 못 받은 질문 뒤에 다시 물은 경우) */
function toHistory(shown: Shown[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  shown
    .filter((t) => !t.error && !t.resuming && (t.text || t.images?.length || t.files?.length || t.photos || t.attach?.length))
    .forEach((t, i, all) => {
      const last = i === all.length - 1;
      const images = last && t.images?.length ? t.images : undefined;
      const files = last && t.files?.length ? t.files : undefined;
      // 지난 첨부는 내용이 없어서 이름만 알린다
      const text = t.text || (t.attach?.length ? `(첨부: ${t.attach.join(", ")})` : "");
      const prev = out[out.length - 1];
      if (prev && prev.role === t.role) {
        prev.text = [prev.text, text].filter(Boolean).join("\n\n");
        if (images) prev.images = images;
        if (files) prev.files = files;
      } else out.push({ role: t.role, text, ...(images ? { images } : {}), ...(files ? { files } : {}) });
    });
  return out;
}

const secs = (ms: number | null | undefined) => Math.max(1, Math.round((ms ?? 0) / 1000));

export function ChatPage({ wiki, arg, query }: { wiki: Wiki; arg: string; query: URLSearchParams }) {
  const { data: posts, error: postsError } = useAsync(useCallback(() => loadPosts(), []));
  const listing = arg === "list";
  const wanted = /^\d+$/.test(arg) ? Number(arg) : null;

  const [threadId, setThreadId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [turns, setTurns] = useState<Shown[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ image: ChatImage; preview: string }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [attachError, setAttachError] = useState("");
  /** 다시 열었을 때 답이 없는 질문이 있으면 서버가 받던 답을 기다린다 */
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thinkStart, setThinkStart] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const threadRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<HTMLFormElement>(null);
  const [composeH, setComposeH] = useState(120);
  const stickRef = useRef(true);
  const [away, setAway] = useState(false);
  /** 개선 알림을 누르고 들어왔을 때 다시 물을 질문 */
  const [redo, setRedo] = useState<{ question: string; note: string } | null>(null);
  const againId = Number(query.get("again"));

  // 주소의 대화를 연다 (방금 보내서 새로 생긴 대화면 그대로 둔다. 개선 알림(?again=)으로 오면 열려 있어도 새로 불러온다)
  useEffect(() => {
    if (listing || (wanted === threadRef.current && !againId)) return;
    runRef.current++; // 이전 대화에서 받던 답은 화면에 넣지 않는다 (서버에는 저장된다)
    threadRef.current = wanted;
    setThreadId(wanted);
    setTurns([]);
    setTitle("");
    setLoadError("");
    setBusy(false);
    setThinkStart(null);
    stickRef.current = true;
    if (wanted === null) return;
    let alive = true;
    setLoading(true);
    loadThread(wanted)
      .then((r) => {
        if (!alive) return;
        setTurns(r.msgs.map(fromSaved));
        setTitle(r.thread.title);
        const gap = r.fixed?.find((g) => g.id === againId);
        if (gap) setRedo({ question: gap.question, note: gap.note ?? "" });
        const lastMsg = r.msgs[r.msgs.length - 1];
        if (!gap && lastMsg?.role === "user" && Date.now() - lastMsg.created_at < RESUME_MS) setResume(true);
      })
      .catch((e) => alive && setLoadError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing, wanted, againId]);

  // 챗봇이 개선됐다는 알림으로 들어오면 그 질문을 다시 물어 새 답을 받는다 (제작자 요청). 위키 글을 받은 뒤에
  useEffect(() => {
    if (!redo || busy || loading || (!posts && !postsError)) return;
    setRedo(null);
    if (threadRef.current !== null) go(`#/chat/${threadRef.current}`, true); // 새로 고쳐도 또 묻지 않게
    const user: Shown = { role: "user", text: redo.question, redo: redo.note || "개선됨" };
    void run([...turns, user], redo.question, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redo, busy, loading, posts, postsError]);

  // 새로 고치거나 닫았다 열면: 서버가 뒤에서 받아 두는 답을 기다리고 (3초마다, 45초까지), 그래도 없으면 다시 묻는다
  useEffect(() => {
    if (!resume || threadId === null) return;
    setResume(false);
    const id = threadId;
    const run0 = ++runRef.current;
    let tries = 0;
    setTurns((t) => [...t, { role: "assistant", text: "", streaming: true, resuming: true }]);
    setBusy(true);
    const poll = async () => {
      tries++;
      const r = await loadThread(id).catch(() => null);
      if (runRef.current !== run0) return;
      const msgs = r?.msgs.map(fromSaved) ?? null;
      if (msgs && msgs[msgs.length - 1]?.role === "assistant") {
        setTurns(msgs);
        setBusy(false);
        return;
      }
      if (tries < 15) {
        window.setTimeout(() => void poll(), 3000);
        return;
      }
      setBusy(false);
      if (msgs?.length) void run(msgs, msgs[msgs.length - 1].text, true);
    };
    // 멈추는 것은 runRef 로 (setResume(false) 로 이 효과가 다시 돌 때 타이머를 지우면 안 된다)
    window.setTimeout(() => void poll(), 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, threadId]);
  // 화면을 떠나면 기다리던 것과 받던 답을 화면에 넣지 않는다 (서버에는 저장된다)
  useEffect(
    () => () => {
      runRef.current++;
    },
    [],
  );

  // 생각하는 동안 초를 센다
  useEffect(() => {
    if (thinkStart === null) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [thinkStart]);

  // 입력칸은 화면 맨 아래에 고정 (제작자 요청). 그 높이만큼 대화 아래를 비운다
  useLayoutEffect(() => {
    const el = composeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setComposeH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [listing]);

  // 맨 아래를 보고 있을 때만 새 글을 따라 내려간다 (위로 올려 읽는 중이면 그대로)
  useEffect(() => {
    const onScroll = () => {
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
      stickRef.current = atEnd;
      setAway(!atEnd);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (stickRef.current && !listing) window.scrollTo(0, document.documentElement.scrollHeight);
  }, [turns, composeH, listing]);

  /** 첨부: 사진은 4장(줄여서), PDF, 글 파일은 3개까지 */
  async function pick(files: FileList | null) {
    setAttachError("");
    const all = Array.from(files ?? []);
    if (fileRef.current) fileRef.current.value = "";
    const pics = all.filter((f) => f.type.startsWith("image/")).slice(0, 4 - pending.length);
    const docs = all.filter((f) => !f.type.startsWith("image/")).slice(0, 3 - pendingFiles.length);
    const shrunk = await Promise.all(pics.map((f) => shrinkImage(f).catch(() => null)));
    setPending((p) => [...p, ...shrunk.filter((x): x is NonNullable<typeof x> => x !== null)].slice(0, 4));
    const read = await Promise.all(docs.map((f) => readAttachment(f).catch((e: Error) => e)));
    const errors = read.filter((x): x is Error => x instanceof Error);
    if (errors.length) setAttachError(errors.map((e) => e.message).join(" · "));
    setPendingFiles((p) => [...p, ...read.filter((x): x is ChatFile => !(x instanceof Error))].slice(0, 3));
  }

  /**
   * 묻기. reuse 면 마지막 질문에 다시 답한다 (다시 답하기): 그 질문이 저장돼 있으면 서버는 질문을 또 넣지 않는다
   */
  async function run(base: Shown[], question: string, reuse: boolean) {
    const run = ++runRef.current;
    const live = () => runRef.current === run;
    const ctx = wikiContext(wiki, posts, question);
    const lastUser = base[base.length - 1];
    const startedAt = Date.now();
    let firstText: number | null = null;
    let text = "";
    let thinking = "";
    const steps: ChatStep[] = [];
    const sources: ChatSource[] = [];
    let thread = threadRef.current;

    setTurns([...base, { role: "assistant", text: "", thinking: "", found: ctx.found, streaming: true }]);
    setBusy(true);
    setThinkStart(startedAt);
    stickRef.current = true;
    const update = (fn: (last: Shown) => Shown) => live() && setTurns((t) => [...t.slice(0, -1), fn(t[t.length - 1])]);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const r = await askChat(
        { turns: toHistory(base), context: ctx.text, thread, again: reuse && lastUser.id !== undefined },
        {
          onStart: (info) => {
            if (info.thread !== null && thread === null) {
              thread = info.thread;
              if (live()) {
                threadRef.current = info.thread;
                setThreadId(info.thread);
                setTitle(question.replace(/\s+/g, " ").slice(0, 40) || "사진 질문");
                go(`#/chat/${info.thread}`, true);
              }
            }
            if (info.msg !== null && live()) setTurns((t) => t.map((x, i) => (i === t.length - 2 ? { ...x, id: info.msg! } : x)));
          },
          onThinking: (piece) => {
            thinking += piece;
            update((last) => ({ ...last, thinking }));
          },
          onText: (piece) => {
            if (firstText === null && piece.trim()) {
              firstText = Date.now();
              if (live()) setThinkStart(null);
            }
            text += piece;
            update((last) => ({ ...last, text, thinkMs: (firstText ?? Date.now()) - startedAt }));
          },
          onStep: (step) => {
            // 웹 찾기 결과 수는 앞 검색 줄에 붙인다
            const prev = steps[steps.length - 1];
            if (step.kind === "search" && step.text.startsWith("결과 ") && prev?.kind === "search") prev.text += ` · ${step.text}`;
            else steps.push(step);
            update((last) => ({ ...last, steps: [...steps] }));
          },
          onSource: (src) => {
            if (sources.some((s) => s.url === src.url)) return;
            sources.push(src);
            update((last) => ({ ...last, sources: [...sources] }));
          },
        },
        ctrl.signal,
      );
      if (r.left !== null) setLeft(r.left);
      const thinkMs = (firstText ?? Date.now()) - startedAt;
      let note: string | undefined;
      if (r.refused) {
        text = text ? text + "\n\n" : "";
        text += "이 질문에는 답할 수 없어요. 다르게 물어봐 주세요.";
      } else if (r.cut) note = "답이 길어서 여기까지만 보여요";
      else if (r.aborted) note = "중지했어요";
      else if (r.paused) note = "웹을 오래 찾아서 여기까지 답했어요";
      else if (r.broken) note = "답이 중간에 끊겼어요";
      update((last) => ({ ...last, text, thinkMs, note, streaming: false }));
      if (thread !== null && text.trim()) {
        const saved = await saveAnswer(thread, {
          text,
          thinking,
          thinkMs,
          found: ctx.found.join(" · "),
          steps: steps.length ? JSON.stringify(steps.slice(0, 20)) : "",
          sources: sources.length ? JSON.stringify(sources.slice(0, 20)) : "",
        }).catch(() => null);
        if (saved) update((last) => ({ ...last, id: saved.id }));
      }
    } catch (err) {
      update(() => ({ role: "assistant", text: err instanceof Error ? err.message : String(err), error: true }));
    } finally {
      if (live()) {
        setBusy(false);
        setThinkStart(null);
      }
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    }
  }

  function send(e?: FormEvent, asked?: string) {
    e?.preventDefault();
    const question = (asked ?? input).trim();
    if (busy || (!question && !pending.length && !pendingFiles.length)) return;
    const user: Shown = {
      role: "user",
      text: question,
      images: pending.map((p) => p.image),
      previews: pending.map((p) => p.preview),
      files: pendingFiles,
    };
    setInput("");
    setPending([]);
    setPendingFiles([]);
    setAttachError("");
    void run([...turns, user], question, false);
  }

  /** 마지막 답을 지우고 같은 질문에 다시 답한다 */
  async function again() {
    if (busy) return;
    const at = turns.map((t) => t.role).lastIndexOf("user");
    if (at < 0) return;
    const drop = turns.slice(at + 1).find((t) => t.id !== undefined);
    if (drop && threadRef.current !== null) await deleteFrom(threadRef.current, drop.id!).catch(() => null);
    void run(turns.slice(0, at + 1), turns[at].text, true);
  }

  /** 마지막 질문을 고친다: 그 질문부터 지우고 입력칸에 넣는다 */
  async function edit() {
    if (busy) return;
    const at = turns.map((t) => t.role).lastIndexOf("user");
    if (at < 0) return;
    const q = turns[at];
    if (q.id !== undefined && threadRef.current !== null) await deleteFrom(threadRef.current, q.id).catch(() => null);
    setTurns(turns.slice(0, at));
    setInput(q.text);
    inputRef.current?.focus();
  }

  function stop() {
    if (ctrlRef.current) {
      ctrlRef.current.abort();
      return;
    }
    // 서버가 받던 답을 기다리는 중이면 그만 기다린다
    runRef.current++;
    setBusy(false);
    setTurns((t) => t.filter((x) => !x.resuming));
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // PC 는 Enter 로 보내고 Shift+Enter 로 줄바꿈. 폰은 Enter 가 줄바꿈 (보내기는 단추)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches) send(e as unknown as FormEvent);
  }

  // 입력칸은 글이 늘면 다섯 줄까지 커진다
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [input, listing]);

  if (listing) {
    return (
      <ThreadList
        current={threadId}
        onDeleted={(id) => {
          // 열려 있던 대화를 지웠으면 다음에 열 때 새로 불러온다
          if (threadRef.current === id) threadRef.current = -1;
        }}
      />
    );
  }

  const lastUser = turns.map((t) => t.role).lastIndexOf("user");
  const lastAnswer = turns.length - 1;
  const compose = (
    <form ref={composeRef} className="chat-compose chat-compose-fixed" onSubmit={send}>
      {(pending.length > 0 || pendingFiles.length > 0) && (
        <div className="chat-pending">
          {pending.map((p, i) => (
            <span key={i} className="chat-thumb">
              <img src={p.preview} alt="" />
              <button type="button" onClick={() => setPending((all) => all.filter((_, j) => j !== i))} aria-label="사진 빼기">
                ✕
              </button>
            </span>
          ))}
          {pendingFiles.map((f, i) => (
            <span key={"f" + i} className="chat-file">
              {f.kind === "pdf" ? "📄" : "📝"} {f.name}
              <button type="button" onClick={() => setPendingFiles((all) => all.filter((_, j) => j !== i))} aria-label="파일 빼기">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {attachError && <p className="form-error chat-attach-error">{attachError}</p>}
      <div className="chat-row">
        {!inFloat && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.pdf,text/*,.txt,.md,.csv,.tsv,.json,.log"
              multiple
              hidden
              onChange={(e) => void pick(e.target.files)}
            />
            <button
              type="button"
              className="pill chat-photo"
              disabled={busy || (pending.length >= 4 && pendingFiles.length >= 3)}
              onClick={() => fileRef.current?.click()}
              aria-label="첨부"
            >
              📎
            </button>
          </>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="사파이어 길잡이에게 물어보세요"
          rows={1}
          maxLength={2000}
        />
        {busy ? (
          <button type="button" className="btn chat-send chat-stop" onClick={stop} aria-label="중지">
            ■
          </button>
        ) : (
          <button className="btn chat-send" disabled={!input.trim() && !pending.length && !pendingFiles.length} aria-label="전송">
            ▲
          </button>
        )}
      </div>
      <p className="chat-note">아이모 자료와 웹을 찾아 답해서 틀릴 수도 있어요{left !== null ? ` · 오늘 남은 질문 ${left}번` : ""}</p>
    </form>
  );

  return (
    <>
      <TopBar
        title={title || "AI 챗봇"}
        right={
          <span className="topbar-right">
            <a className="topbar-action" href="#/chat/list">
              ☰ 목록
            </a>
            {(turns.length > 0 || threadId !== null) && (
              <a className="topbar-action" href="#/chat">
                새 대화
              </a>
            )}
          </span>
        }
      />
      {loading && <Loading />}
      {loadError && <p className="form-error">{loadError}</p>}
      {!loading && !loadError && turns.length === 0 && <Intro onPick={(x) => setInput(x)} />}

      <div className="chat-list">
        {turns.map((t, i) => (
          <div key={i} className={"bubble bubble-" + t.role + (t.error ? " bubble-error" : "")}>
            {t.role === "assistant" && !t.error && (
              <>
                {/* 답은 게임의 NPC 대화창처럼 (제작자 요청) */}
                <div className="npc-name">🧙 사파이어 길잡이</div>
                <Steps t={t} thinkingSecs={t.streaming && !t.text && thinkStart !== null ? secs(Date.now() - thinkStart) : null} />
              </>
            )}
            {t.redo && <div className="chat-redo">🔄 챗봇이 개선돼서 다시 물어봤어요{t.redo !== "개선됨" ? ` · ${t.redo}` : ""}</div>}
            {t.previews?.map((src, j) => <img key={j} className="bubble-pic" src={src} alt="고른 스샷" />)}
            {!t.previews?.length && t.photos ? <div className="bubble-photos">📷 사진 {t.photos}장</div> : null}
            {(t.files?.map((f) => f.name) ?? t.attach)?.map((name, j) => (
              <div key={"a" + j} className="bubble-photos">
                📎 {name}
              </div>
            ))}
            {t.text ? (
              t.role === "assistant" && !t.error ? (
                <ChatAnswer wiki={wiki} text={t.text} done={!t.streaming} onAsk={(q) => send(undefined, q)} />
              ) : (
                <span className="bubble-text">{t.text}</span>
              )
            ) : null}
            {t.streaming && t.text && <span className="chat-caret" />}
            {t.sources && t.sources.length > 0 && (
              <div className="chat-sources">
                <div className="chat-sources-h">🔗 출처</div>
                <ol>
                  {t.sources.map((src) => (
                    <li key={src.url}>
                      <a href={src.url} target="_blank" rel="noopener noreferrer">
                        {src.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {t.note && <div className="chat-msg-note">{t.note}</div>}
            {!busy && t.role === "assistant" && (
              <MsgActions text={t.error ? "" : t.text} msg={t.error ? undefined : t.id} onAgain={i === lastAnswer ? () => void again() : undefined} />
            )}
            {!busy && t.role === "user" && i === lastUser && i >= turns.length - 2 && (
              <div className="chat-actions chat-actions-user">
                <button className="chat-act" onClick={() => void edit()}>
                  ✏️ 수정
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {away && turns.length > 0 && (
        <button
          className="chat-down"
          style={{ bottom: `calc(${composeH}px + var(--tab-h) + env(safe-area-inset-bottom) + 14px)` }}
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
          aria-label="맨 아래로"
        >
          ↓
        </button>
      )}
      <div style={{ height: composeH + 8 }} />
      {createPortal(compose, document.body)}
    </>
  );
}

/** 답하기 전 한 일: 위키에서 찾은 것, 생각 (클로드처럼 생각하는 동안 펼쳐 보이고, 다 하면 접는다) */
function Steps({ t, thinkingSecs }: { t: Shown; thinkingSecs: number | null }) {
  const [open, setOpen] = useState(false);
  const thinkingNow = thinkingSecs !== null;
  const showThought = thinkingNow || open;
  return (
    <div className="chat-steps">
      {t.resuming && <div className="chat-step chat-think-live">⏳ 답을 마저 받는 중…</div>}
      {t.found !== undefined && (
        <div className="chat-step">📚 {t.found.length ? `아이모 자료 둘러봄: ${t.found.slice(0, 6).join(" · ")}` : "아이모 자료 둘러봄"}</div>
      )}
      {t.steps?.map((st, i) => (
        <div key={i} className="chat-step">
          {st.kind === "search" ? "🔎 웹 찾기" : st.kind === "fetch" ? "📄 읽음" : "🧮"} {st.text}
        </div>
      ))}
      {(thinkingNow || t.thinking || t.thinkMs) && (
        <button type="button" className={"chat-step chat-think" + (thinkingNow ? " chat-think-live" : "")} onClick={() => setOpen(!open)} disabled={thinkingNow}>
          💭 {thinkingNow ? `생각하는 중… ${thinkingSecs}초` : `${secs(t.thinkMs)}초 동안 생각함`}
          {!thinkingNow && t.thinking ? <span className="chat-think-arrow">{open ? "▴" : "▾"}</span> : null}
        </button>
      )}
      {/* 생각하는 동안은 새 글이 보이게 아래에 붙여 둔다 */}
      {showThought && t.thinking && (
        <div className={"chat-thought" + (thinkingNow ? " chat-thought-live" : "")}>
          <div>{t.thinking}</div>
        </div>
      )}
    </div>
  );
}

function MsgActions({ text, msg, onAgain }: { text: string; msg?: number; onAgain?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);
  if (!text && !onAgain) return null;
  return (
    <div className="chat-actions">
      {text && (
        <button
          className="chat-act"
          onClick={() => {
            void navigator.clipboard?.writeText(plainAnswer(text)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "✓ 복사됨" : "📋 복사"}
        </button>
      )}
      {onAgain && (
        <button className="chat-act" onClick={onAgain}>
          🔄 다시 답하기
        </button>
      )}
      {/* 답이 틀리거나 모자라면 앱개발자에게 (제작자 요청: 보고 고칠 수 있게) */}
      {msg !== undefined && (
        <button className="chat-act" disabled={reported} onClick={() => void reportAnswer(msg).then(() => setReported(true), () => undefined)}>
          {reported ? "✓ 알렸어요" : "👎 별로"}
        </button>
      )}
    </div>
  );
}

/** 새 대화 첫 화면: 예시 질문과 최근 대화 */
function Intro({ onPick }: { onPick: (q: string) => void }) {
  const { data } = useAsync(useCallback(() => listThreads(), []));
  const recent = (data?.threads ?? []).slice(0, 4);
  return (
    <section className="panel chat-intro">
      <p>
        아이모 관련 사이트 자료를 먼저 둘러보고, 없으면 웹을 찾아 답해요. 육성법, 장비, 드랍, 사냥터, 무엇이든 물어보세요.
        {!inFloat && " 📎 로 게임 스샷이나 파일을 보내면 보고 답해요."}
      </p>
      <div className="chat-examples">
        {EXAMPLES.map((x) => (
          <button key={x} className="pill" onClick={() => onPick(x)}>
            {x}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="chat-recent">
          <div className="chat-recent-h">최근 대화</div>
          {recent.map((r) => (
            <a key={r.id} href={`#/chat/${r.id}`} className="chat-recent-row">
              <span>{r.pinned ? "📌 " : "💬 "}{r.title}</span>
              <small>{when(r.updated_at)}</small>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function groupOf(t: ThreadSummary): string {
  if (t.pinned) return "📌 고정";
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const s = start.getTime();
  if (t.updated_at >= s) return "오늘";
  if (t.updated_at >= s - day) return "어제";
  if (t.updated_at >= s - 6 * day) return "지난 7일";
  if (t.updated_at >= s - 29 * day) return "지난 30일";
  return "이전";
}

/** 대화 목록: 찾기, 고정, 이름 변경, 삭제 */
function ThreadList({ current, onDeleted }: { current: number | null; onDeleted: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () =>
        listThreads(q.trim())
          .then((r) => alive && setThreads(r.threads))
          .catch((e) => alive && setError(errorText(e))),
      q ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const change = (id: number, fn: (t: ThreadSummary) => ThreadSummary | null) =>
    setThreads((all) => (all ?? []).map((t) => (t.id === id ? fn(t) : t)).filter((t): t is ThreadSummary => t !== null));

  const groups: { name: string; items: ThreadSummary[] }[] = [];
  for (const t of threads ?? []) {
    const name = groupOf(t);
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(t);
    else groups.push({ name, items: [t] });
  }

  return (
    <>
      <TopBar
        title="대화 목록"
        right={
          <span className="topbar-right">
            <a className="topbar-action" href="#/chat">
              새 대화
            </a>
          </span>
        }
      />
      <input className="chat-input chat-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="대화 찾기" />
      {error && <p className="form-error">{error}</p>}
      {threads === null && !error && <Loading />}
      {threads?.length === 0 && <p className="muted chat-empty">{q ? "맞는 대화가 없어요" : "아직 대화가 없어요"}</p>}
      {groups.map((g) => (
        <section key={g.name} className="chat-group">
          <h3 className="chat-group-h">{g.name}</h3>
          {g.items.map((t) => (
            <ThreadRow
              key={t.id}
              t={t}
              current={t.id === current}
              open={open === t.id}
              onToggle={() => setOpen(open === t.id ? null : t.id)}
              onChange={(fn) => change(t.id, fn)}
              onDeleted={() => onDeleted(t.id)}
              onError={setError}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function ThreadRow({
  t,
  current,
  open,
  onToggle,
  onChange,
  onDeleted,
  onError,
}: {
  t: ThreadSummary;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (fn: (t: ThreadSummary) => ThreadSummary | null) => void;
  onDeleted: () => void;
  onError: (e: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(t.title);
  useEffect(() => {
    if (!open) setMode("menu");
  }, [open]);

  const act = async (fn: () => Promise<unknown>, after: () => void) => {
    try {
      await fn();
      after();
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className={"chat-thread" + (current ? " chat-thread-on" : "")}>
      <div className="chat-thread-row">
        <a className="chat-thread-main" href={`#/chat/${t.id}`}>
          <span className="chat-thread-title">{t.title}</span>
          {t.hit && <small className="chat-thread-hit">{t.hit}</small>}
          <small className="chat-thread-when">{when(t.updated_at)}</small>
        </a>
        <button className="chat-thread-more" onClick={onToggle} aria-label="대화 메뉴">
          ⋯
        </button>
      </div>
      {open && mode === "menu" && (
        <div className="chat-thread-menu">
          <button className="pill" onClick={() => setMode("rename")}>
            이름 변경
          </button>
          <button className="pill" onClick={() => void act(() => updateThread(t.id, { pinned: !t.pinned }), () => onChange((x) => ({ ...x, pinned: !x.pinned })))}>
            {t.pinned ? "고정 해제" : "📌 고정"}
          </button>
          <button className="pill pill-danger" onClick={() => setMode("delete")}>
            삭제
          </button>
        </div>
      )}
      {open && mode === "rename" && (
        <form
          className="chat-thread-menu"
          onSubmit={(e) => {
            e.preventDefault();
            const title = name.replace(/\s+/g, " ").trim().slice(0, 40);
            if (title) void act(() => updateThread(t.id, { title }), () => onChange((x) => ({ ...x, title })));
            onToggle();
          }}
        >
          <input className="chat-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          <button className="pill pill-on">저장</button>
          <button type="button" className="pill" onClick={() => setMode("menu")}>
            취소
          </button>
        </form>
      )}
      {open && mode === "delete" && (
        <div className="chat-thread-menu">
          <span className="chat-thread-ask">이 대화를 지울까요?</span>
          <button
            className="pill pill-danger"
            onClick={() =>
              void act(
                () => deleteThread(t.id),
                () => {
                  onChange(() => null);
                  onDeleted();
                },
              )
            }
          >
            삭제
          </button>
          <button className="pill" onClick={() => setMode("menu")}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}
