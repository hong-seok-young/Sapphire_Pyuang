import { useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "../backClose";

/**
 * 그림 크게 보기 (게시판 사진, 챗봇 답의 공식 글 그림. 제작자 요청 2026-11-06: '이벤트 이미지를 누르면 전체 화면으로, 뒤로 가기 누르면 다시 챗봇으로, 확대도 되게').
 * 화면에 맞춰 보이고(잘리지 않게) ✕ 나 폰의 뒤로 가기로 닫는다 (useBackClose: 열 때 방문 기록을 하나 넣는다).
 * 손가락 두 개로 벌리면 확대(5배까지), 확대한 채로 끌면 옮겨 보기, 두 번 누르면 그 자리를 2.5배로/원래대로, 마우스 휠도 확대.
 * 확대하지 않았을 때 옆으로 밀면 다음·이전 그림, 아래로 쓸어내리면 닫기. 페이지 확대는 막혀 있어서(styles.css html touch-action) 여기서 직접 한다
 */
export interface ViewImage {
  src: string;
  name?: string;
  /** 저장 단추 (없으면 안 보인다) */
  download?: string;
}

const MAX = 5;

export function ImageViewer({ images, start, onClose }: { images: ViewImage[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ d: number; mx: number; my: number; s: number; x: number; y: number } | null>(null);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const close = useRef(onClose);
  close.current = onClose;
  const count = images.length;

  useBackClose(true, () => close.current());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "ArrowRight") setI((n) => Math.min(count - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [count]);
  useEffect(() => setView({ s: 1, x: 0, y: 0 }), [i]);

  /** 화면 가운데 기준 좌표 */
  const local = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };
  /** 그림이 화면 밖으로 다 나가지 않게 옮긴 거리를 줄인다 */
  const clamp = (v: { s: number; x: number; y: number }) => {
    const st = stage.current?.getBoundingClientRect();
    const im = img.current;
    if (!st || !im) return v;
    const w = im.offsetWidth * v.s;
    const h = im.offsetHeight * v.s;
    const mx = Math.max(0, (w - st.width) / 2);
    const my = Math.max(0, (h - st.height) / 2);
    return { s: v.s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  };
  /** 점 m(가운데 기준)을 붙든 채 배율을 s 로 */
  const zoomAt = (from: { s: number; x: number; y: number }, s: number, m: { x: number; y: number }) => {
    const k = s / from.s;
    return clamp({ s, x: m.x - (m.x - from.x) * k, y: m.y - (m.y - from.y) * k });
  };

  function down(e: RPointerEvent) {
    stage.current?.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: m.x, my: m.y, ...view };
      swipe.current = null;
    } else if (pts.current.size === 1) {
      gesture.current = { d: 0, mx: e.clientX, my: e.clientY, ...view };
      swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    }
  }
  function move(e: RPointerEvent) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (pts.current.size >= 2 && g.d) {
      const [a, b] = [...pts.current.values()];
      const s = Math.min(MAX, Math.max(1, (g.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.d));
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      // 손가락 가운데를 붙든 채 키우고, 가운데가 움직인 만큼 옮긴다
      const z = zoomAt({ s: g.s, x: g.x, y: g.y }, s, { x: g.mx, y: g.my });
      setView(clamp({ s, x: z.x + (m.x - g.mx), y: z.y + (m.y - g.my) }));
    } else if (pts.current.size === 1 && g.s > 1) {
      setView(clamp({ s: g.s, x: g.x + (e.clientX - g.mx), y: g.y + (e.clientY - g.my) }));
    }
  }
  function up(e: RPointerEvent) {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 1) {
      // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 옮긴다
      const [a] = [...pts.current.values()];
      gesture.current = { d: 0, mx: a.x, my: a.y, ...view };
      return;
    }
    if (pts.current.size) return;
    gesture.current = null;
    const sw = swipe.current;
    swipe.current = null;
    if (!sw) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // 두 번 누르기: 그 자리를 키우거나 원래대로
      const now = Date.now();
      const near = Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 40;
      if (now - lastTap.current.t < 320 && near) {
        setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(v, 2.5, local(e.clientX, e.clientY))));
        lastTap.current = { t: 0, x: 0, y: 0 };
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    if (view.s > 1) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) setI((n) => Math.min(count - 1, Math.max(0, n + (dx < 0 ? 1 : -1))));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) history.back(); // 아래로 쓸어내리면 닫기
  }

  const f = images[i];
  // 화면 전환 애니메이션(transform)이 걸린 칸 안에서는 fixed 가 화면 기준이 아니라서 body 에 바로 그린다
  return createPortal(
    <div className="pv" role="dialog" aria-label="그림 크게 보기">
      <div className="pv-top">
        <span>{count > 1 ? `${i + 1} / ${count}` : f.name ?? ""}</span>
        {view.s > 1 && (
          <button className="pv-btn" onClick={() => setView({ s: 1, x: 0, y: 0 })}>
            원래 크기
          </button>
        )}
        {f.download && (
          <a className="pv-btn" href={f.src} download={f.download}>
            저장
          </a>
        )}
        <button className="pv-btn" onClick={() => history.back()} aria-label="닫기">
          ✕
        </button>
      </div>
      <div
        ref={stage}
        className="pv-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => {
          const s = Math.min(MAX, Math.max(1, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
          setView(s === 1 ? { s: 1, x: 0, y: 0 } : zoomAt(view, s, local(e.clientX, e.clientY)));
        }}
      >
        <img
          ref={img}
          src={f.src}
          alt={f.name ?? ""}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
      </div>
      {count > 1 && (
        <div className="pv-nav">
          <button className="pv-btn" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="이전 그림">
            ◀
          </button>
          {view.s === 1 && <small className="pv-tip">두 손가락으로 벌리거나 두 번 눌러 확대</small>}
          <button className="pv-btn" disabled={i === count - 1} onClick={() => setI(i + 1)} aria-label="다음 그림">
            ▶
          </button>
        </div>
      )}
      {count <= 1 && view.s === 1 && <small className="pv-tip pv-tip-solo">두 손가락으로 벌리거나 두 번 눌러 확대</small>}
    </div>,
    document.body,
  );
}
