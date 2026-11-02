// 메뉴 튜토리얼 (제작자 요청 2026-11-02, 글은 src/guides.ts).
// - 위 줄 제목(배너)이나 홈의 'Sapphire' 글씨를 누르면 openGuide(제목) -> GuideHost(App 이 한 번 그린다)가 바로 튜토리얼을 시작한다.
//   처음엔 설명 칸(단추별 기능·흐름 글)을 먼저 올리고 '튜토리얼 시작'을 누르게 했는데, 제작자가 '설명서 필요 없고 바로 튜토리얼 시작' 이라고 해서 뺐다 (2026-11-02).
// - Tutorial: 화면을 어둡게 하고 그 단계의 자리만 밝게 비추며(spotlight) 글 상자로 안내. 'n/N', 그만 · 이전 · 다음.
//   '눌러 보기' 단계(tap)는 그 자리를 직접 누르면 다음으로 (칸 열기, 탭 바꾸기처럼 바꾸지 않는 것만). 다음을 눌러 넘어가도 된다. go 가 있으면 먼저 그 주소로 간다.
//   자리를 못 찾으면(그 권한에 없거나 자료가 없어서) 그 단계는 건너뛴다. 어두운 막은 누르는 데 걸리지 않아 화면을 그대로 쓸 수 있다.
//   비추는 네모는 화면 안으로 맞춘다 (가장자리의 배치 편집을 비출 때 잘렸다, 제작자 2026-11-02). 설명이 있는 다른 메뉴로 가면 끝난다.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Me } from "./auth";
import { GUIDES, canSee, guideByTitle } from "./guides";
import type { Guide, GuideStep } from "./guides";

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
  const [ready, setReady] = useState(false);
  const shown = useRef(false);
  const [nothing, setNothing] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const step: GuideStep | undefined = steps[i];
  const dir = useRef(1);
  const going = useRef(false);

  // 단계가 바뀌면: 이동(go) -> 자리 찾기(1.5초까지) -> 보이게 스크롤. 못 찾으면 건너뛴다
  useEffect(() => {
    if (!step) {
      onEnd();
      return;
    }
    let alive = true;
    setReady(false);
    (async () => {
      if (step.go && location.hash !== step.go) {
        going.current = true;
        location.hash = step.go;
        await wait(350);
        going.current = false;
      }
      let el: HTMLElement | null = null;
      if (step.sel) {
        for (let t = 0; t < (step.go ? 15 : 8) && alive; t++) {
          el = find(step.sel);
          if (el) break;
          await wait(100);
        }
        if (!alive) return;
        if (!el) {
          // 그 권한에 없거나 자료가 없는 자리: 건너뛴다 (양쪽 끝이면 끝낸다)
          const next = i + dir.current;
          if (next < 0 || next >= steps.length) {
            if (shown.current) onEnd();
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
      setReady(true);
      shown.current = true;
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

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

  // 설명이 있는 다른 메뉴로 가면(아래 탭 등) 끝낸다. go 로 스스로 옮기는 것과 글·사냥터처럼 설명이 없는 안쪽 화면은 그대로
  useEffect(() => {
    const onHash = () => {
      if (going.current) return;
      const k = hashKey();
      if (k !== guide.key && GUIDES.some((g) => g.key === k)) onEnd();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [guide.key, onEnd]);

  // 눌러 보기 단계: 그 자리를 누르면 다음으로
  useEffect(() => {
    if (!step?.tap) return;
    const onTap = (e: Event) => {
      const el = elRef.current;
      const t = e.target as Node | null;
      if (!el || !t || !el.contains(t)) return;
      dir.current = 1;
      window.setTimeout(() => setI((n) => n + 1), 450);
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
            <button className="pill pill-on" onClick={onEnd}>
              닫기
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  if (!step) return null;
  // 다음 자리를 찾는 동안(건너뛰는 단계가 있으면 1~2초)은 어두운 막만 두어 화면이 깜박이지 않게
  if (!ready)
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
  // 글 상자: 비춘 자리 아래, 자리가 아래쪽이면 위, 자리가 크면 아래쪽에
  const tall = !!r && r.height > H * 0.45;
  const below = !!r && !tall && r.bottom + 160 < H;
  const boxStyle: CSSProperties = !r || tall
    ? { bottom: 80 }
    : below
      ? { top: Math.max(8, Math.min(H - 170, ey + 10)) }
      : { bottom: Math.max(8, Math.min(H - 170, H - sy + 10)) };
  return createPortal(
    <div className="tut" aria-live="polite">
      {r && !missing ? (
        <div className={"tut-spot" + (step.tap ? " tut-spot-tap" : "")} style={{ left: sx, top: sy, width: Math.max(0, ex - sx), height: Math.max(0, ey - sy) }} />
      ) : (
        <div className="tut-dim" />
      )}
      <div className="tut-box" style={boxStyle}>
        <small>
          {guide.title} 튜토리얼 {i + 1}/{steps.length}
        </small>
        <p>
          {step.tap && <span className="tut-tap">눌러 보기</span>}
          {step.text}
        </p>
        <div className="tut-acts">
          <button className="bd-mini" onClick={onEnd}>
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
              setI(i + 1);
            }}
          >
            {i + 1 >= steps.length ? "끝" : "다음"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
