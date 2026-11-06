import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Wiki } from "../types";
import { JOB_NAME, errorText } from "../auth";
import type { Me } from "../auth";
import {
  askChat,
  stopChat,
  watchChat,
  deleteFrom,
  deleteThread,
  listThreads,
  loadThread,
  peekPhotos,
  readAttachment,
  reportAnswer,
  saveAnswer,
  shrinkImage,
  updateThread,
  wikiContext,
} from "../chat";
import type { AskEvents, ChatFile, ChatImage, ChatResult, ChatSource, ChatStep, ChatTurn, SavedMsg, Seen, ThreadSummary } from "../chat";
import { loadPosts, useAsync } from "../data";
import { loadOdds } from "../odds";
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
  /** 답하는 동안 한 줄로 깜박이는 지금 하는 일 ('생각하는 중', '웹에서 찾는 중' …). 기록으로 쌓지 않는다 */
  phase?: string;
  /** 서버의 답 받기 일꾼이 받는 답 (앱을 꺼도 끝까지, 다 되면 알림) */
  durable?: boolean;
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

/** 질문이 남아 있고 답이 없는 대화를 이만큼 안에 열면 서버가 받던 답을 기다린다 (더 지났으면 기다리지 않고 바로 다시 묻는다) */
const RESUME_MS = 15 * 60_000;
/** 일꾼 없이 받는 답은 화면이 끊긴 뒤 서버가 이만큼만 더 받아 둔다 (Pages Functions, chat/index.ts finishInBackground) */
const SERVER_TAIL_MS = 40_000;
/** 화면이 마지막으로 가려진 때 (다른 앱으로 간 때): 끊긴 답을 서버가 아직 받고 있을 수 있는지 셈한다 */
let hiddenAt = 0;
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
  });

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

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** 화면이 보일 때까지 (다른 앱에 가 있으면 돌아올 때) */
const whenVisible = () =>
  new Promise<void>((done) => {
    if (document.visibilityState === "visible") return done();
    const on = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      done();
    };
    document.addEventListener("visibilitychange", on);
  });


export function ChatPage({ wiki, arg, query, me }: { wiki: Wiki; arg: string; query: URLSearchParams; me?: Me }) {
  const { data: posts, error: postsError } = useAsync(useCallback(() => loadPosts(), []));
  // 공식 확률 표는 첫 질문 전에 미리 받아 둔다 (첫 질문이 늦게 시작하지 않게)
  useEffect(() => {
    void loadOdds().catch(() => undefined);
  }, []);
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
  /** 다시 열었을 때 답이 없는 질문이 있으면 서버가 받던 답을 기다리거나 다시 묻는다 (old: RESUME_MS 보다 오래된 질문이라 바로 다시 묻는다) */
  const [resume, setResume] = useState<null | "fresh" | "old">(null);
  const [busy, setBusy] = useState(false);
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
        // 답 없이 남은 질문: 언제 물었든 답을 받아 온다 (제작자 2026-11-06 '화면 나가면 자꾸 답이 멈춰': 15분이 지나면 질문만 남고 아무것도 안 보였다)
        if (!gap && lastMsg?.role === "user") setResume(Date.now() - lastMsg.created_at < RESUME_MS ? "fresh" : "old");
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

  // 새로 고치거나 닫았다 열면: 서버의 답 받기 일꾼이 받는 중이거나 방금 받은 답에 붙는다 (처음부터 다시 받는다).
  // 일꾼에 받을 것이 없으면 예전처럼 서버가 뒤에서 받아 두는 답을 기다리고 (3초마다, 45초까지), 그래도 없으면 다시 묻는다
  useEffect(() => {
    if (!resume || threadId === null) return;
    const old = resume === "old";
    setResume(null);
    const id = threadId;
    const run0 = ++runRef.current;
    const base = turns;
    void (async () => {
      let durable = false;
      const got = await follow(run0, base, [], async (events, signal) => {
        const w = await watchChat(id, events, signal);
        if ("none" in w) durable = w.durable;
        return w;
      });
      if (got === "done" || runRef.current !== run0) return;
      let tries = 0;
      setTurns([...base, { role: "assistant", text: "", streaming: true, resuming: true, phase: "답을 이어 받는 중" }]);
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
        // 일꾼이 있는데 받을 것이 없으면 답이 없는 것이라 바로 다시 묻는다
        if (!durable && !old && tries < 15) {
          window.setTimeout(() => void poll(), 3000);
          return;
        }
        setBusy(false);
        if (msgs?.length) void run(msgs, msgs[msgs.length - 1].text, true);
      };
      // 멈추는 것은 runRef 로 (setResume(false) 로 이 효과가 다시 돌 때 타이머를 지우면 안 된다)
      window.setTimeout(() => void poll(), durable || old ? 0 : 1500);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, threadId]);
  // 화면을 떠나면 기다리던 것과 받던 답을 화면에 넣지 않는다 (서버에는 저장된다)
  useEffect(
    () => () => {
      runRef.current++;
    },
    [],
  );


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
    // 물은 사람의 직업, 레벨 (질문에 없으면 이것으로 공략과 사냥터를 고른다. 사진만 보낸 질문 등)
    const asker = me ? { job: me.job ? JOB_NAME[me.job] : null, level: me.level } : undefined;
    const lastUser = base[base.length - 1];
    // 사진 질문은 사진 속 직업, 레벨, 보이는 이름을 먼저 읽고 그 값으로 자료를 고른다 (챗봇 개선 2026-11-01, chat.ts Seen)
    let seen: Seen | null = null;
    // 자료를 고르는 동안에도 바로 답 자리와 '답하는 중'을 보인다 (그사이 두 번 눌러 같은 질문을 두 번 묻지 않게, 2026-11-01 검토)
    setTurns([...base, { role: "assistant", text: "", thinking: "", phase: lastUser?.images?.length ? "사진 읽는 중" : "자료 찾는 중", streaming: true }]);
    setBusy(true);
    if (lastUser?.images?.length) {
      seen = await peekPhotos(lastUser.images);
      if (!live()) return;
    }
    // 공식 확률 표 (못 받으면 없이 묻는다)
    const odds = await loadOdds().catch(() => undefined);
    if (!live()) return;
    // 글 본문은 아직 받는 중일 수 있어서 기다린다 (못 받으면 없이)
    const allPosts = posts ?? (await loadPosts().catch(() => undefined));
    if (!live()) return;
    const ctx = wikiContext(wiki, allPosts, question, asker, !!(lastUser?.images?.length || lastUser?.photos), odds, seen ?? undefined);
    await follow(run, base, ctx.found, (events, signal) =>
      askChat({ turns: toHistory(base), context: ctx.text, thread: threadRef.current, again: reuse && lastUser.id !== undefined, found: ctx.found.join(" · ") }, events, signal),
    );
  }

  /**
   * 답을 받아 그린다 (새로 묻기, 다시 열었을 때 서버의 일꾼에 다시 붙기).
   * 서버의 답 받기 일꾼(server/chatRun.ts)이 받는 답이면 화면이 끊겨도(앱을 닫았다 열기, 다른 앱에 갔다 오기) 일꾼은 끝까지 받아 대화에 넣는다:
   * 화면은 보이게 되면 일꾼에 다시 붙어 처음부터 다시 받는다 (제작자 2026-11-05 '답을 하다 끊냐?', '내가 웹 꺼도 되게 하랬지').
   * 끊긴 반쪽 답은 대화에 넣지 않는다 (넣으면 다 된 답처럼 보였다). 일꾼에 받을 것이 없으면 'none' 을 돌려준다
   */
  async function follow(
    runId: number,
    base: Shown[],
    found: string[],
    first: (events: AskEvents, signal: AbortSignal) => Promise<ChatResult | { none: true; durable: boolean }>,
  ): Promise<"done" | "none"> {
    const live = () => runRef.current === runId;
    const startedAt = Date.now();
    let firstText: number | null = null;
    let text = "";
    let thinking = "";
    const steps: ChatStep[] = [];
    const sources: ChatSource[] = [];
    let thread = threadRef.current;

    setTurns([...base, { role: "assistant", text: "", thinking: "", found: found.length ? found : undefined, streaming: true, phase: "생각하는 중" }]);
    setBusy(true);
    stickRef.current = true;
    const update = (fn: (last: Shown) => Shown) => live() && setTurns((t) => [...t.slice(0, -1), fn(t[t.length - 1])]);
    const events: AskEvents = {
      onStart: (info) => {
        if (info.durable) update((last) => ({ ...last, durable: true }));
        if (info.thread !== null && thread === null) {
          thread = info.thread;
          if (live()) {
            threadRef.current = info.thread;
            setThreadId(info.thread);
            const q = base[base.length - 1]?.text ?? "";
            setTitle(q.replace(/\s+/g, " ").slice(0, 40) || "사진 질문");
            go(`#/chat/${info.thread}`, true);
          }
        }
        if (info.msg !== null && live()) setTurns((t) => t.map((x, i) => (i === t.length - 2 ? { ...x, id: info.msg! } : x)));
      },
      onThinking: (piece) => {
        thinking += piece;
        update((last) => ({ ...last, thinking, phase: "생각하는 중" }));
      },
      onText: (piece) => {
        if (firstText === null && piece.trim()) {
          firstText = Date.now();
        }
        text += piece;
        update((last) => ({ ...last, text, phase: "답 쓰는 중", thinkMs: (firstText ?? Date.now()) - startedAt }));
      },
      onStep: (step) => {
        // 웹 찾기 결과 수는 앞 검색 줄에 붙인다
        const prev = steps[steps.length - 1];
        if (step.kind === "search" && step.text.startsWith("결과 ") && prev?.kind === "search") prev.text += ` · ${step.text}`;
        else steps.push(step);
        const phase = phaseOf(step);
        update((last) => ({ ...last, steps: [...steps], ...(phase ? { phase } : {}) }));
      },
      onSource: (src) => {
        if (sources.some((s) => s.url === src.url)) return;
        sources.push(src);
        update((last) => ({ ...last, sources: [...sources] }));
      },
    };
    /** 일꾼에 다시 붙으면 처음부터 다시 오므로 받은 것을 비운다 */
    const reset = () => {
      text = "";
      thinking = "";
      steps.length = 0;
      sources.length = 0;
      update((last) => ({ ...last, text: "", thinking: "", steps: [], sources: [], streaming: true, phase: "답을 이어 받는 중" }));
    };
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const got = await first(events, ctrl.signal);
      if ("none" in got) return "none";
      let r = got;
      // 일꾼이 받는 답이 끊겼으면: 화면이 보일 때 다시 붙는다 (처음엔 바로, 그 뒤로 조금씩 늦게, 몇 분까지)
      for (let tries = 0; r.durable && r.broken && !r.aborted && thread !== null && live() && tries < 40; tries++) {
        await whenVisible();
        if (tries) await sleep(Math.min(8000, 1000 * tries));
        if (!live() || ctrl.signal.aborted) break;
        reset();
        const w = await watchChat(thread, events, ctrl.signal);
        if ("none" in w) {
          // 일꾼에 받을 것이 없다: 일꾼이 이미 넣은 답이 있으면 그것을 보인다
          const saved = await loadThread(thread).catch(() => null);
          const msgs = saved?.msgs.map(fromSaved);
          if (live() && msgs?.length && msgs[msgs.length - 1].role === "assistant") {
            setTurns(msgs);
            return "done";
          }
          r = { ...r, broken: true, durable: false };
          break;
        }
        r = { ...w, left: r.left };
      }
      // 일꾼 없이 받던 답이 끊겼으면 (앱을 나갔다 옴, 제작자 2026-11-06 '화면 나가면 자꾸 답이 멈춰'): 서버가 끊긴 뒤 조금 더 받아 넣은 답이 있으면 그것을,
      // 없으면 같은 질문을 저절로 다시 묻는다 (끊긴 반쪽 답과 '다시 답하기' 단추만 남기지 않는다)
      if (r.broken && !r.durable && !r.aborted && !r.refused && thread !== null && live()) {
        const since = hiddenAt > startedAt ? hiddenAt : Date.now();
        update((last) => ({ ...last, streaming: true, phase: "답을 이어 받는 중" }));
        await whenVisible();
        for (let i = 0; live() && !ctrl.signal.aborted; i++) {
          const saved = await loadThread(thread).catch(() => null);
          if (!live() || ctrl.signal.aborted) break;
          const msgs = saved?.msgs.map(fromSaved);
          if (msgs?.length && msgs[msgs.length - 1].role === "assistant") {
            setTurns(msgs);
            return "done";
          }
          if (Date.now() - since > SERVER_TAIL_MS || i >= 15) {
            if (msgs?.length && msgs[msgs.length - 1].role === "user") {
              const q = msgs[msgs.length - 1].text;
              window.setTimeout(() => void run(msgs, q, true), 0);
              return "done";
            }
            break;
          }
          await sleep(3000);
        }
      }
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
      if (r.savedId !== null) {
        const id = r.savedId;
        update((last) => ({ ...last, id }));
      } else if (thread !== null && text.trim() && !r.broken) {
        // 일꾼 없이 받은 답, 중지한 답(일꾼은 넣지 않는다), 일꾼이 못 넣은 답은 화면이 넣는다. 끊긴 반쪽 답은 넣지 않는다
        const saved = await saveAnswer(thread, {
          text,
          thinking,
          thinkMs,
          found: found.join(" · "),
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
          }
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    }
    return "done";
  }

  // 답 속 추천 질문 단추가 부르는 묻기: 늘 같은 함수라 끝난 답은 다시 그리지 않는다 (ChatAnswer 는 memo)
  const sendRef = useRef<(e?: FormEvent, asked?: string) => void>(() => undefined);
  const askFromAnswer = useCallback((q: string) => sendRef.current(undefined, q), []);
  sendRef.current = send;
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
      // 서버의 답 받기 일꾼도 멈춘다 (멈추지 않으면 끝까지 받아 대화에 넣는다)
      if (threadRef.current !== null) void stopChat(threadRef.current);
      ctrlRef.current.abort();
      return;
    }
    // 서버가 받던 답을 기다리는 중이거나 사진을 먼저 읽는 중이면 그만 기다린다
    runRef.current++;
    setBusy(false);
    setTurns((t) => t.filter((x) => !x.resuming && !(x.role === "assistant" && x.streaming && !x.text)));
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
        guide="AI 챗봇"
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
                <ChatAnswer wiki={wiki} text={t.text} done={!t.streaming} onAsk={askFromAnswer} />
              ) : (
                <span className="bubble-text">{t.text}</span>
              )
            ) : null}
            {t.streaming && t.text && <span className="chat-caret" />}
            {t.streaming && <LiveStatus t={t} />}
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

/**
 * 답하는 동안 지금 하는 일 한 줄 (제작자 2026-11-05 '책 모양 쓰고 뭐 하는 중 뭐 하는 중 기록으로 쌓지 말고, 클로드처럼 모래시계와 깜박이며 텍스트만 바뀌게'):
 * 자료 찾는 중 -> 생각하는 중 -> 웹에서 찾는 중 -> 답 쓰는 중. 답 글이 나오는 동안은 글 끝의 깜박이는 막대로 충분해서 숨긴다.
 * 다 끝나면 사라지고 기록에는 답과 출처만 남는다. 서버의 답 받기 일꾼이 받는 답이면 앱을 꺼도 된다고 알린다
 */
function LiveStatus({ t }: { t: Shown }) {
  const phase = t.phase ?? "생각하는 중";
  const show = !(t.text && phase === "답 쓰는 중");
  return (
    <>
      {show && (
        <div className="chat-live" role="status">
          <span className="chat-live-glass" aria-hidden>
            ⏳
          </span>
          <span key={phase} className="chat-live-text">
            {phase}
          </span>
        </div>
      )}
      {t.durable && <div className="chat-live-note">웹을 꺼도 돌아오면 답변을 볼 수 있어요 · 답변이 완료되면 알림을 드릴게요</div>}
    </>
  );
}

/** 웹 찾기·글 읽기를 지금 하는 일 글로 */
function phaseOf(step: ChatStep): string | null {
  if (step.kind === "search") return step.text.startsWith("결과 ") || step.text.startsWith("꺼짐") ? null : "웹에서 찾는 중";
  if (step.kind === "fetch") return "글 읽는 중";
  return "찾은 것 정리하는 중";
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
  const { data } = useAsync(useCallback(() => listThreads(), []), "threads");
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
