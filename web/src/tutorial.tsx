// 메뉴 튜토리얼 (제작자 요청 2026-11-02, 글은 src/guides.ts).
// - 위 줄 제목(배너)이나 홈의 길드마크를 누르면 openGuide(제목) -> GuideHost(App 이 한 번 그린다)가 바로 튜토리얼을 시작한다.
//   처음엔 설명 칸(단추별 기능·흐름 글)을 먼저 올리고 '튜토리얼 시작'을 누르게 했는데, 제작자가 '설명서 필요 없고 바로 튜토리얼 시작' 이라고 해서 뺐다 (2026-11-02).
// - Tutorial: 화면을 어둡게 하고 그 단계의 자리만 밝게 비추며(spotlight) 글 상자로 안내. 'n/N', 그만 · 이전 · 다음.
//   '눌러 보기' 단계(tap)는 그 자리를 직접 누르면 다음으로 (칸 열기, 탭 바꾸기처럼 바꾸지 않는 것만). 다음을 누르면 그 자리를 대신 눌러 주고 넘어간다
//   (제작자 2026-11-02: 안 누르고 다음을 누르니 열려야 보이는 다음 단계가 건너뛰어져 3번에서 6번으로 갔다). 마지막 단계는 대신 누르지 않는다. go 가 있으면 먼저 그 주소로 간다.
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
const dupEntry = () => !!history.state?.tut && norm(location.hash) === norm(history.state.tutFrom ?? "");
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
  return guide ? <Tutorial key={open} guide={guide} me={me} onEnd={close} /> : null;
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
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    });
    if (el) return el;
  }
  return null;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 주소의 첫 칸 ('#/rent?v=apps' -> 'rent', '#/' -> '') */
const hashKey = () => location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];

function Tutorial({ guide, me, onEnd }: { guide: Guide; me: Me; onEnd: () => void }) {
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
  /** 단계마다 보였을 때의 주소 (이전으로 돌아올 때 그 주소로) */
  const shownAddr = useRef<Record<number, string>>({});
  const sameAddr = (a: string, b: string) => norm(a) === norm(b);
  const pushed = useRef(false);
  /** 그만·끝·다른 메뉴로 닫기: 넣어 둔 기록이 시작한 화면과 같은 주소 그대로면 빼고, 다른 주소로 옮겨 있으면 그 화면으로 남긴다 */
  const finish = () => {
    if (pushed.current) {
      pushed.current = false;
      if (dupEntry()) history.back();
      else if (history.state?.tut) history.replaceState({ ...history.state, tut: false }, "");
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
    (async () => {
      // 이 단계의 주소로: go 가 있으면 그 주소, 이전으로 돌아오는 것이면 그 단계를 보였을 때의 주소 (기록 칸은 늘리지 않는다)
      const addr = step.go ?? (dir.current < 0 ? shownAddr.current[i] : undefined);
      const move = !!addr && !sameAddr(location.hash, addr);
      if (move) {
        going.current = true;
        goRoute(addr, true);
        await wait(350);
        going.current = false;
      }
      let el: HTMLElement | null = null;
      if (step.sel) {
        for (let t = 0; t < (move ? 15 : 8) && alive; t++) {
          el = find(step.sel);
          if (el) break;
          await wait(100);
        }
        if (!alive) return;
        if (!el) {
          // 그 권한에 없거나 자료가 없는 자리: 건너뛴다 (양쪽 끝이면 끝낸다)
          const next = i + dir.current;
          if (next < 0 || next >= steps.length) {
            if (shown.current) finishRef.current();
            else setNothing(true);
          } else setI(next);
          return;
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
    history.pushState({ ...(history.state ?? {}), tut: true, tutFrom: location.hash }, "");
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
      if (k !== guide.key && GUIDES.some((g) => g.key === k)) finishRef.current();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [guide.key]);

  // 눌러 보기 단계: 그 자리를 누르면 다음으로. 날씨 샘플이면 글 상자 밖 아무 곳이나 (터지는 것을 보고 넘어간다)
  useEffect(() => {
    if (!step?.tap) return;
    const advance = (after: number) => {
      if (fired.current) return;
      fired.current = true;
      dir.current = 1;
      window.setTimeout(() => setI((n) => n + 1), after);
    };
    if (step.fx) {
      const onDown = (e: Event) => {
        const t = e.target as Element | null;
        if (t && t.closest(".tut-box")) return;
        advance(1800);
      };
      document.addEventListener("pointerdown", onDown, true);
      return () => document.removeEventListener("pointerdown", onDown, true);
    }
    const onTap = (e: Event) => {
      const el = elRef.current;
      const t = e.target as Node | null;
      if (!el || !t || !el.contains(t)) return;
      advance(450);
    };
    document.addEventListener("click", onTap, true);
    return () => document.removeEventListener("click", onTap, true);
  }, [step]);

  if (nothing)
    return createPortal(
      <div className="tut">
        <div className="tut-box" style={{ bottom: 80 }}>
          <small>{guide.title} 튜토리얼</small>
          <p>지금 이 화면에는 보여 줄 게 없어요. 글이나 신청, 파티가 생기면 다시 눌러 보세요.</p>
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
  // 다음 자리를 찾는 동안(건너뛰는 단계가 있으면 1~2초)은 어두운 막만 두어 화면이 깜박이지 않게 (옛 단계 자리에 새 글이 잠깐 뜨지 않게 단계 번호로 가린다)
  if (shownAt !== i)
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
  const boxStyle: CSSProperties = step.fx
    ? { top: 12 }
    : !r || tall
      ? { bottom: 80 }
      : below
        ? { top: Math.max(8, Math.min(H - 170, ey + 10)) }
        : { bottom: Math.max(8, Math.min(H - 170, H - sy + 10)) };
  return createPortal(
    <>
      {step.fx && <WeatherFx key={step.fx} sky={step.fx} />}
      <div className="tut" aria-live="polite">
        {step.fx ? null : r && !missing ? (
          <div className={"tut-spot" + (step.tap ? " tut-spot-tap" : "")} style={{ left: sx, top: sy, width: Math.max(0, ex - sx), height: Math.max(0, ey - sy) }} />
        ) : (
          <div className="tut-dim" />
        )}
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
            {!step.head && step.tap && <span className="tut-tap">눌러 보기</span>}
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
              onClick={() => {
                dir.current = 1;
                const el = elRef.current;
                if (step.tap && !step.fx && el && i + 1 < steps.length && !fired.current) {
                  // 눌러 보기 자리를 대신 눌러 주고(칸 열기, 탭 바꾸기) 열린 뒤에 다음으로
                  fired.current = true;
                  el.click();
                  window.setTimeout(() => setI(i + 1), 450);
                } else setI(i + 1);
              }}
            >
              {i + 1 >= steps.length ? "끝" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
