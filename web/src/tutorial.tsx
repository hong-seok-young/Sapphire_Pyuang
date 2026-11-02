// 메뉴 설명 칸과 튜토리얼 (제작자 요청 2026-11-02, 글은 src/guides.ts).
// - 위 줄 제목(배너)이나 홈의 'Sapphire' 글씨를 누르면 openGuide(제목) -> GuideHost(App 이 한 번 그린다)가 아래에서 설명 칸(GuideSheet)을 올린다:
//   한 줄 소개, 단추, 흐름 (그 사람 권한에 보이는 것만), '튜토리얼 시작'.
// - 튜토리얼(Tutorial): 화면을 어둡게 하고 그 단계의 자리만 밝게 비추며(spotlight) 글 상자로 안내. 'n/N · 이전 · 다음 · 그만'.
//   👆 단계(tap)는 그 자리를 직접 누르면 다음으로 (칸 열기, 탭 바꾸기처럼 바꾸지 않는 것만). go 가 있으면 먼저 그 주소로 간다.
//   자리를 못 찾으면(그 권한에 없거나 자료가 없어서) 그 단계는 건너뛴다. 어두운 막은 누르는 데 걸리지 않아 화면을 그대로 쓸 수 있다.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Me } from "./auth";
import { GUIDES, canSee, guideByTitle } from "./guides";
import type { Guide, GuideStep } from "./guides";

// ---------- 열기 (작은 바깥 저장소: TopBar 는 me 를 모른다) ----------
let openKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** 제목으로 설명 칸 열기 (설명이 없는 제목이면 아무 일도 없다) */
export function openGuide(title: string) {
  const g = guideByTitle(title);
  if (!g) return;
  openKey = g.key;
  emit();
}
export const hasGuide = (title: string) => !!guideByTitle(title);
function useOpenKey() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => openKey,
  );
}
const close = () => {
  openKey = null;
  emit();
};

/** App 이 한 번 그린다: 열린 설명 칸과 진행 중인 튜토리얼 */
export function GuideHost({ me }: { me: Me }) {
  const key = useOpenKey();
  const [running, setRunning] = useState<Guide | null>(null);
  const guide = key === null ? null : GUIDES.find((g) => g.key === key) ?? null;
  // 다른 화면으로 가면 설명 칸은 닫는다 (튜토리얼은 go 로 스스로 옮기므로 그대로)
  useEffect(() => {
    const onHash = () => {
      if (openKey !== null) close();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <>
      {guide && !running && (
        <GuideSheet
          guide={guide}
          me={me}
          onClose={close}
          onStart={() => {
            close();
            setRunning(guide);
          }}
        />
      )}
      {running && <Tutorial guide={running} me={me} onEnd={() => setRunning(null)} />}
    </>
  );
}

// ---------- 설명 칸 ----------
function GuideSheet({ guide, me, onClose, onStart }: { guide: Guide; me: Me; onClose: () => void; onStart: () => void }) {
  const buttons = guide.buttons.filter((b) => canSee(b.who, me));
  const flows = guide.flows.filter((f) => canSee(f.who, me));
  const steps = guide.tutorial.filter((s) => canSee(s.who, me));
  // 폰 뒤로 가기로 닫히게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="guide-back" onClick={onClose}>
      <section className="guide-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${guide.title} 설명`}>
        <header className="guide-head">
          <b>{guide.title}</b>
          <button className="bd-mini" onClick={onClose}>
            닫기
          </button>
        </header>
        <p className="guide-intro">{guide.intro}</p>
        <div className="guide-body">
          <h3>단추</h3>
          <ul className="guide-buttons">
            {buttons.map((b) => (
              <li key={b.name}>
                <b>{b.name}</b>
                {b.what && <span>{b.what}</span>}
              </li>
            ))}
          </ul>
          <h3>흐름</h3>
          {flows.map((f) => (
            <div key={f.title} className="guide-flow">
              <b>{f.title}</b>
              <ol>
                {f.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {steps.length > 0 && (
          <button className="pill pill-on guide-start" onClick={onStart}>
            튜토리얼 시작 ({steps.length}단계)
          </button>
        )}
      </section>
    </div>,
    document.body,
  );
}

// ---------- 튜토리얼 ----------
/** 선택자 찾기: 쉼표로 나눈 것 중 처음 보이는 것. ':has-text('글')' 은 그 글자가 든 것 */
function find(sel: string): HTMLElement | null {
  for (const part of sel.split(/,(?![^(]*\))/).map((s) => s.trim())) {
    const m = part.match(/^(.*?):has-text\('([^']*)'\)$/);
    const base = m ? m[1] || "*" : part;
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
        location.hash = step.go;
        await wait(350);
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

  // 👆 단계: 그 자리를 누르면 다음으로
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
          <p>지금 이 화면에는 보여 줄 게 없어요. 자료가 생기면(글, 신청, 파티 등) 다시 눌러 보세요.</p>
          <div className="tut-acts">
            <button className="pill pill-on" onClick={onEnd}>
              닫기
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  if (!step || !ready) return null;
  const pad = 6;
  const r = rect;
  // 글 상자: 비춘 자리 아래, 자리가 아래쪽이면 위
  const H = window.innerHeight;
  const tall = !!r && r.height > H * 0.45;
  const below = !!r && !tall && r.bottom + 160 < H;
  const boxStyle: CSSProperties = !r || tall
    ? { bottom: 80 }
    : below
      ? { top: Math.max(8, Math.min(H - 170, r.bottom + pad + 10)) }
      : { bottom: Math.max(8, Math.min(H - 170, H - r.top + pad + 10)) };
  return createPortal(
    <div className="tut" aria-live="polite">
      {r && !missing ? (
        <div
          className={"tut-spot" + (step.tap ? " tut-spot-tap" : "")}
          style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }}
        />
      ) : (
        <div className="tut-dim" />
      )}
      <div className="tut-box" style={boxStyle}>
        <small>
          {guide.title} 튜토리얼 · {i + 1}/{steps.length}
        </small>
        <p>
          {step.tap && <span className="tut-tap">👆 </span>}
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
            {i + 1 >= steps.length ? "끝" : step.tap ? "건너뛰기" : "다음"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
