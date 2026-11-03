// 메뉴 튜토리얼 (제작자 요청 2026-11-02, 글은 src/guides.ts).
// - 위 줄 제목(배너)이나 홈의 길드마크를 누르면 openGuide(제목) -> GuideHost(App 이 한 번 그린다)가 바로 튜토리얼을 시작한다.
//   처음엔 설명 칸(단추별 기능·흐름 글)을 먼저 올리고 '튜토리얼 시작'을 누르게 했는데, 제작자가 '설명서 필요 없고 바로 튜토리얼 시작' 이라고 해서 뺐다 (2026-11-02).
// - Tutorial: 화면을 어둡게 하고 그 단계의 자리만 밝게 비추며(spotlight) 글 상자로 안내. 'n/N', 그만 · 이전 · 다음.
//   튜토리얼이 도는 동안은 화면의 다른 단추가 눌리지 않고(어두운 막과 비추는 네모가 누름을 다 받는다), 글 상자 밖 아무 데나 누르면 다음 단계로 간다
//   (제작자 요청 2026-11-02 '튜토리얼 중에는 다른 버튼 안 눌리게', '화면 아무데나 클릭하면 다음으로'). 손가락으로 끌어 스크롤은 된다.
//   '눌러 보기' 단계(tap)는 칸 열기·탭 바꾸기처럼 바꾸지 않는 자리: 어디를 누르든(다음 단추도) 튜토리얼이 그 자리를 대신 눌러 주고 넘어간다
//   (제작자 2026-11-02: 안 누르고 다음을 누르니 열려야 보이는 다음 단계가 건너뛰어져 3번에서 6번으로 갔다). 이미 열려 있거나 그 탭이면(이전으로 왔다가 다시 다음) 누르지 않아
//   도로 닫히지 않는다. 마지막 단계는 대신 누르지 않는다. go 가 있으면 먼저 그 주소로 간다.
//   날씨 샘플 단계(fx)는 어두운 막 없이 그 날씨 효과(WeatherFx)를 그리고 글 상자는 위에 (제작자 요청: 비·눈·함박눈·빈 곳 누르기 샘플). tap 이면 빈 곳을 누르면 다음으로.
//   자리를 못 찾으면(그 권한에 없거나 자료가 없어서) 그 단계는 건너뛴다. 어두운 막은 누르는 데 걸리지 않아 화면을 그대로 쓸 수 있다.
//   비추는 네모는 화면 안으로 맞춘다 (가장자리의 배치 편집을 비출 때 잘렸다, 제작자 2026-11-02). 설명이 있는 다른 메뉴로 가면 끝난다.
//   글 상자는 head(무엇인지) 한 줄 굵게, 그 아래 text 문장 (제작자 요청 2026-11-02: '내 정보 버튼' 밑에 줄 바꿔 '캐릭터가 여러 개면 캐릭터 목록이 떠요' 식으로).
//   다음·이전을 누르면 새 단계의 자리를 찾을 때까지 어두운 막만 둔다 (전에는 새 단계 글이 옛 자리에 잠깐 떴다가 꺼졌다 다시 켜졌다, 제작자 2026-11-02).
//   이전으로 돌아오면 그 단계를 보였을 때의 주소로 되돌린다 (제작자 2026-11-02: 패치 내역에 들어간 뒤 이전을 눌러도 화면이 안 돌아왔다).
//   튜토리얼이 스스로 옮길 때(go, 되돌리기)는 기록 칸을 늘리지 않는다 (router.go(…, true): replaceState + hashchange).
//   폰의 뒤로 가기나 '그만'으로 꺼진다 (제작자 요청 2026-11-02): 열 때 방문 기록을 하나 넣어 두고(사진 크게 보기와 같은 방법) 뒤로 가기가 그 기록을 빼면 닫는다.
//   그만·끝으로 닫을 때는 넣어 둔 기록을 뺀다 (안 빼면 다음 뒤로 가기가 한 번 헛돈다). 튜토리얼이 다른 주소로 옮긴 채 끝나면 그 기록을 그 주소로 남긴다
//   (뒤로 가기가 시작한 화면으로 가게). 눌러 보기로 사용자가 새 화면에 들어가 기록이 그 뒤에 쌓이면, 나중에 뒤로 가다 그 기록에 닿을 때 한 번 더 뒤로 가 건너뛴다 (skipStale).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Me } from "./auth";
import { GUIDES, canSee, guideByTitle } from "./guides";
import { go as goRoute } from "./router";
import type { Guide, GuideStep } from "./guides";
import { WeatherFx } from "./pages/Weather";

// ---------- 열기 (작은 바깥 저장소: TopBar 는 me 를 모른다) ----------
let openKey: string | null = null;
let openSeq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** 제목으로 튜토리얼 시작 (설명이 없는 제목이면 아무 일도 없다. 도는 중에 다시 누르면 처음부터) */
export function openGuide(title: string) {
  const g = guideByTitle(title);
  if (!g) return;
  openKey = g.key;
  openSeq++;
  emit();
}
export const hasGuide = (title: string) => !!guideByTitle(title);
function useOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (openKey === null ? "" : `${openSeq}:${openKey}`),
  );
}
const close = () => {
  openKey = null;
  emit();
};
/** 넣어 둔 튜토리얼 기록이 시작한 화면과 같은 주소 그대로인지 (튜토리얼이 go 로 옮긴 채 끝났으면 다른 주소라 진짜 화면 하나로 남긴다) */
const dupEntry = () =>
  !!history.state?.tut &&
  norm(location.hash) === norm(history.state.tutFrom ?? "");
const norm = (h: string) => h.replace(/^#\/?/, "");
// 튜토리얼이 닫힌 뒤 남은 '튜토리얼 기록'(state.tut, 같은 주소)에 뒤로 가기로 닿으면 한 번 더 뒤로 가서 건너뛴다 (화면이 안 바뀌는 헛도는 뒤로 가기를 없앤다)
window.addEventListener("popstate", () => {
  if (openKey === null && dupEntry()) history.back();
});

/** App 이 한 번 그린다: 진행 중인 튜토리얼 */
export function GuideHost({ me }: { me: Me }) {
  const open = useOpen();
  if (!open) return null;
  const key = open.slice(open.indexOf(":") + 1);
  const guide = GUIDES.find((g) => g.key === key);
  return guide ? (
    <Tutorial key={open} guide={guide} me={me} onEnd={close} />
  ) : null;
}

// ---------- 튜토리얼 ----------
/** 선택자 찾기: 쉼표로 나눈 것 중 처음 보이는 것. ':has-text('글')' 은 그 글자가 든 것 */
function find(sel: string): HTMLElement | null {
  for (const part of sel.split(/,(?![^(]*\))/).map((s) => s.trim())) {
    const m = part.match(/^(.*?):has-text\('([^']*)'\)$/);
    const base = m ? m[1].trim() || "*" : part;
    let list: HTMLElement[] = [];
    try {
      list = [...document.querySelectorAll<HTMLElement>(base)];
    } catch {
      continue;
    }
    if (m) list = list.filter((el) => (el.textContent ?? "").includes(m[2]));
    const el = list.find((e) => {
      const r = e.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        getComputedStyle(e).visibility !== "hidden"
      );
    });
    if (el) return el;
  }
  return null;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * 눌러 보기 자리를 대신 누르지 않아도 되는지 (이전으로 왔다가 다시 다음을 누를 때 도로 닫히지 않게):
 * opens 가 벌써 보이거나, closes 가 벌써 안 보이거나, 그것도 없으면 aria-expanded / aria-selected / aria-pressed 가 true
 */
function alreadyDone(el: HTMLElement | null, step: GuideStep): boolean {
  if (step.opens) return !!find(step.opens);
  if (step.closes) return !find(step.closes);
  const state = el
    ? (el.getAttribute("aria-expanded") ??
      el.getAttribute("aria-selected") ??
      el.getAttribute("aria-pressed"))
    : null;
  return state === "true";
}
/**
 * 이전으로 눌러 보기 단계에 돌아올 때 열어 둔 것을 닫는다 (제작자 요청 2026-11-02 '이전으로 화면까지 다 돌아오는지'): 닫는 단추가 있으면(data-tut-dismiss:
 * 장비대여 정보창의 바깥, 배치 편집의 완료) 그것을, 없으면 그 자리를 한 번 더 눌러 접는다 (토글). 탭(undo: false)은 그대로 둔다. 닫았으면 true
 */
function undoTap(el: HTMLElement | null, step: GuideStep): boolean {
  if (!step.tap || step.fx || step.undo === false || !alreadyDone(el, step))
    return false;
  const dismiss = find("[data-tut-dismiss]");
  if (dismiss) dismiss.click();
  else if (el) el.click();
  else return false;
  return true;
}
/** 주소의 첫 칸 ('#/rent?v=apps' -> 'rent', '#/' -> '') */
const hashKey = () => location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];

function Tutorial({
  guide,
  me,
  onEnd,
}: {
  guide: Guide;
  me: Me;
  onEnd: () => void;
}) {
  const steps = guide.tutorial.filter((s) => canSee(s.who, me));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  /** 자리를 찾아 글 상자를 보이는 단계 번호 (i 와 다르면 아직 찾는 중: 어두운 막만) */
  const [shownAt, setShownAt] = useState(-1);
  const shown = useRef(false);
  const [nothing, setNothing] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const step: GuideStep | undefined = steps[i];
  const dir = useRef(1);
  const going = useRef(false);
  /** 이 단계에서 눌러 이미 넘어가는 중 (두 번 눌러 두 단계 건너뛰지 않게) */
  const fired = useRef(false);
  /** 눌러 준 뒤 잠깐 기다렸다 넘어가는 타이머: 단계가 바뀌면 지운다 (제작자 2026-11-03: 이전을 눌렀는데 전으로 갔다가 다시 돌아왔다 = 남아 있던 타이머) */
  const timer = useRef(0);
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  /** 단계마다 보였을 때의 주소 (이전으로 돌아올 때 그 주소로) */
  const shownAddr = useRef<Record<number, string>>({});
  const sameAddr = (a: string, b: string) => norm(a) === norm(b);
  const pushed = useRef(false);
  /** 그만·끝·다른 메뉴로 닫기: 넣어 둔 기록이 시작한 화면과 같은 주소 그대로면 빼고, 다른 주소로 옮겨 있으면 그 화면으로 남긴다 */
  const finish = () => {
    if (pushed.current) {
      pushed.current = false;
      if (dupEntry()) history.back();
      else if (history.state?.tut)
        history.replaceState({ ...history.state, tut: false }, "");
    }
    onEnd();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // 단계가 바뀌면: 이동(go) -> 자리 찾기(1.5초까지) -> 보이게 스크롤. 못 찾으면 건너뛴다
  useEffect(() => {
    if (!step) {
      finishRef.current();
      return;
    }
    let alive = true;
    fired.current = false;
    window.clearTimeout(timer.current);
    (async () => {
      // 이 단계의 주소로: go 가 있으면 그 주소, 이전으로 돌아오는 것이면 그 단계를 보였을 때의 주소 (기록 칸은 늘리지 않는다)
      const addr =
        step.go ?? (dir.current < 0 ? shownAddr.current[i] : undefined);
      const move = !!addr && !sameAddr(location.hash, addr);
      if (move) {
        going.current = true;
        goRoute(addr, true);
        await wait(350);
        going.current = false;
      }
      let el: HTMLElement | null = null;
      if (step.sel) {
        // 이전으로 돌아올 때, 연 것이 무엇인지(opens·closes) 아는 눌러 보기 단계는 자리를 찾기 전에 먼저 닫는다
        // (배치 편집 단추는 편집 중에는 없어서, 완료를 눌러 편집을 끝내야 비출 수 있다)
        if (
          dir.current < 0 &&
          (step.opens || step.closes) &&
          undoTap(null, step)
        )
          await wait(300);
        for (let t = 0; t < (move ? 15 : 8) && alive; t++) {
          el = find(step.sel);
          if (el) break;
          await wait(100);
        }
        if (!alive) return;
        // 이전으로 돌아왔는데 자리가 없으면(완료 단추는 편집 중에만 있다) 앞 단계가 열었던 것을 다시 열어 본다
        if (!el && dir.current < 0) {
          for (let k = i - 1; k >= 0 && !el; k--) {
            const s = steps[k];
            if (!s.tap || !s.opens || s.undo === false || find(s.opens))
              continue;
            const e = s.sel ? find(s.sel) : null;
            if (!e) continue;
            e.click();
            await wait(400);
            if (!alive) return;
            el = find(step.sel);
          }
        }
        if (!el) {
          // 그 권한에 없거나 자료가 없는 자리: 건너뛴다 (양쪽 끝이면 끝낸다)
          const next = i + dir.current;
          if (next < 0 || next >= steps.length) {
            if (shown.current) finishRef.current();
            else setNothing(true);
          } else setI(next);
          return;
        }
        // 이전으로 눌러 보기 단계에 돌아온 것이면 열어 둔 것을 닫아 그때 화면으로 (opens·closes 가 없는 것: aria-expanded 로 안다)
        if (
          dir.current < 0 &&
          !step.opens &&
          !step.closes &&
          undoTap(el, step)
        ) {
          await wait(250);
          if (!alive) return;
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        await wait(300);
      }
      if (!alive) return;
      elRef.current = el;
      setMissing(!el);
      setRect(el ? el.getBoundingClientRect() : null);
      setShownAt(i);
      shownAddr.current[i] = location.hash;
      shown.current = true;
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // 폰의 뒤로 가기로 닫기: 열 때 방문 기록을 하나 넣어 두고, 뒤로 가기가 오면(popstate) 닫는다. 그만·끝은 finish 가 그 기록을 뺀다
  useEffect(() => {
    history.pushState(
      { ...(history.state ?? {}), tut: true, tutFrom: location.hash },
      "",
    );
    pushed.current = true;
    const onPop = () => {
      pushed.current = false;
      onEnd();
      // 눌러 보기로 들어간 화면에서 뒤로 와 넣어 둔 기록(같은 주소)에 닿은 것이면 한 번 더 뒤로 (시작한 화면으로)
      if (dupEntry()) history.back();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자리가 움직이면(스크롤, 펼침) 따라간다
  useEffect(() => {
    const tick = () => {
      const el = elRef.current;
      if (el && el.isConnected) setRect(el.getBoundingClientRect());
    };
    const id = window.setInterval(tick, 150);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
    };
  }, []);

  // 설명이 있는 다른 메뉴로 가면(아래 탭 등) 끝낸다. go 로 스스로 옮기는 것과 글·사냥터·패치 내역처럼 설명이 없는 안쪽 화면은 그대로
  useEffect(() => {
    const onHash = () => {
      if (going.current) return;
      const k = hashKey();
      if (k !== guide.key && GUIDES.some((g) => g.key === k))
        finishRef.current();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [guide.key]);

  /**
   * 다음으로 (눌러 보기 단계면 그 자리를 대신 눌러 준 뒤). 마지막이면 끝.
   * 마지막 단계가 눌러 보기(패치 내역, 공식 글)면 화면을 눌렀을 때(fromScreen)만 그 자리를 대신 누르고 끝낸다 (다른 단추는 막혀 있어서 직접 누를 수 없다). '끝' 단추는 그냥 닫는다
   */
  const next = (fromScreen = false) => {
    if (!step || fired.current) return;
    dir.current = 1;
    const el = elRef.current;
    if (i + 1 >= steps.length) {
      if (fromScreen && step.tap && !step.fx && el && !alreadyDone(el, step)) {
        fired.current = true;
        el.click();
        later(finish, 300);
      } else finish();
      return;
    }
    if (step.tap && !step.fx && el && !alreadyDone(el, step)) {
      fired.current = true;
      el.click();
      later(() => setI(i + 1), 450);
    } else setI(i + 1);
  };
  /**
   * 어두운 막·네모 위 아무 데나 누르면 다음으로 (글 상자 안과 찾는 중은 빼고).
   * 날씨 샘플의 '빈 곳을 눌러 보세요'(fx + tap)는 누를 때마다 터지기만 하고 넘어가지 않는다: 다음 단추로 넘어간다
   * (제작자 2026-11-03: 여기서는 아무 데나 눌러서 넘어가게 하지 말고 다음 버튼을 눌러야. 전에는 1.8초 뒤 저절로 넘어가 '14번 누르니 넘어갔다')
   */
  const onOverlay = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(".tut-box")) return;
    if (shownAt !== i) return;
    if (step?.fx && step.tap) return;
    next(true);
  };

  if (nothing)
    return createPortal(
      <div
        className="tut"
        onClick={(e) => !(e.target as Element).closest(".tut-box") && finish()}
      >
        <div className="tut-box" style={{ bottom: 80 }}>
          <small>{guide.title} 튜토리얼</small>
          <p>
            지금 이 화면에는 보여 줄 게 없어요. 글이나 신청, 파티가 생기면 다시
            눌러 보세요.
          </p>
          <div className="tut-acts">
            <button className="pill pill-on" onClick={finish}>
              닫기
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  if (!step) return null;
  // 다음 자리를 찾는 동안(0.1~2초)은 앞 단계의 네모(또는 날씨 샘플)를 그대로 두고 글 상자만 숨긴다: 어두운 막을 껐다 켜면 화면이 한 번 깜박였다
  // (제작자 2026-11-03 '이전 다음 누를 때마다 화면이 깜빡'). 네모는 새 자리로 미끄러져 간다 (.tut-spot transition). 처음(아직 아무것도 못 비춤)은 어두운 막
  const cur = shownAt === i;
  const vstep: GuideStep | undefined = cur
    ? step
    : shownAt >= 0
      ? steps[shownAt]
      : undefined;
  if (!vstep)
    return createPortal(
      <div className="tut">
        <div className="tut-dim" />
      </div>,
      document.body,
    );
  const pad = 6;
  const r = rect;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // 비추는 네모는 화면 안으로 (가장자리 단추는 잘렸다)
  const sx = r ? Math.max(2, r.left - pad) : 0;
  const sy = r ? Math.max(2, r.top - pad) : 0;
  const ex = r ? Math.min(W - 2, r.right + pad) : 0;
  const ey = r ? Math.min(H - 2, r.bottom + pad) : 0;
  // 글 상자: 비춘 자리 아래, 자리가 아래쪽이면 위, 자리가 크면 아래쪽에. 날씨 샘플은 위에 (아래에 쌓이는 것을 보게)
  const tall = !!r && r.height > H * 0.45;
  const below = !!r && !tall && r.bottom + 160 < H;
  const boxStyle: CSSProperties = vstep.fx
    ? { top: 12 }
    : !r || tall
      ? { bottom: 80 }
      : below
        ? { top: Math.max(8, Math.min(H - 170, ey + 10)) }
        : { bottom: Math.max(8, Math.min(H - 170, H - sy + 10)) };
  return createPortal(
    <>
      {vstep.fx && <WeatherFx key={vstep.fx} sky={vstep.fx} />}
      <div className="tut" aria-live="polite" onClick={onOverlay}>
        {vstep.fx ? null : r && !missing ? (
          <div
            className={"tut-spot" + (vstep.tap && cur ? " tut-spot-tap" : "")}
            style={{
              left: sx,
              top: sy,
              width: Math.max(0, ex - sx),
              height: Math.max(0, ey - sy),
            }}
          />
        ) : (
          <div className="tut-dim" />
        )}
        {cur && (
          <div className="tut-box" style={boxStyle}>
            <small>
              {guide.title} 튜토리얼 {i + 1}/{steps.length}
            </small>
            {step.head && (
              <b className="tut-head">
                {step.tap && <span className="tut-tap">눌러 보기</span>}
                {step.head}
              </b>
            )}
            <p>
              {!step.head && step.tap && (
                <span className="tut-tap">눌러 보기</span>
              )}
              {step.text}
            </p>
            <div className="tut-acts">
              <button className="bd-mini" onClick={finish}>
                그만
              </button>
              {i > 0 && (
                <button
                  className="pill"
                  onClick={() => {
                    dir.current = -1;
                    setI(i - 1);
                  }}
                >
                  이전
                </button>
              )}
              <button
                className={"pill" + (step.tap ? "" : " pill-on")}
                onClick={() => next()}
              >
                {i + 1 >= steps.length ? "끝" : "다음"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
