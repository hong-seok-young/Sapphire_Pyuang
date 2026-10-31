import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { errorText, uploadAvatar } from "../auth";

/**
 * 캐릭터 사진 만들기 ('내 정보'). 길드원이 갤러리에서 직접 고른 자기 캐릭터 스샷에서
 *  1. 끌고 벌려서(확대) 캐릭터를 네모 안에 넣고 자른다
 *  2. 가장자리에 이어진 배경을 저절로 지우고, 남은 배경은 눌러서 지운다 (잘못 지운 곳은 '되살리기')
 *  3. 성장 랭킹 1등 카드에 넣어 보고 올린다
 * 모두 폰 안에서 하고, 자른 캐릭터 그림만 서버에 올라간다. 앱은 화면을 찍지 않고 게임에 아무것도 보내지 않는다
 * (CLAUDE.md 게임 안전 규칙: 사용자가 고른 스샷만 쓰는 챗봇과 같은 조건).
 */

/** 자르는 네모 한 변 (CSS px) */
const VIEW = 300;
/** 배경을 지울 때 쓰는 그림 한 변 최대 */
const WORK_MAX = 480;
/** 올리는 그림 높이. 작으면 정수배로 키우고(도트가 안 번지게), 크면 줄인다 */
const OUT_H = 240;
/** 서버 한도(300KB)보다 조금 작게 */
const OUT_MAX_BYTES = 280_000;

type Step = "pick" | "crop" | "erase" | "check";

export function AvatarMaker({ onSaved, onCancel }: { onSaved: (avatar: number) => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [work, setWork] = useState<ImageData | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (png) URL.revokeObjectURL(png.url);
  }, [png]);

  function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      setImg(im);
      setStep("crop");
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      setError("그림을 열지 못했어요");
    };
    im.src = url;
  }

  async function upload() {
    if (!png) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await uploadAvatar(png.blob));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-maker">
      {step === "pick" && (
        <>
          <p className="form-note">
            게임에서 내 캐릭터가 잘 보이게 찍어 둔 스샷을 골라요. 뒤가 한 가지 색인 화면(장비창 등)이면 더 깔끔하게 따져요.
            자른 캐릭터만 올라가요.
          </p>
          <label className="btn avatar-file">
            📷 스샷 고르기
            <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </>
      )}
      {step === "crop" && img && (
        <CropStep
          img={img}
          onBack={() => setStep("pick")}
          onCrop={(pixels) => {
            setWork(pixels);
            setStep("erase");
          }}
        />
      )}
      {step === "erase" && work && (
        <EraseStep
          source={work}
          onBack={() => setStep("crop")}
          onDone={(blob) => {
            setPng({ blob, url: URL.createObjectURL(blob) });
            setStep("check");
          }}
        />
      )}
      {step === "check" && png && (
        <>
          <div className="growth-hero avatar-preview">
            <span className="growth-crown">👑 이번 주의 성장왕</span>
            <span className="growth-hero-face">
              <img className="growth-face" src={png.url} alt="내 캐릭터" style={{ maxWidth: 96, maxHeight: 96 }} />
            </span>
          </div>
          <div className="avatar-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("erase")} disabled={busy}>
              ◀ 다시 편집
            </button>
            <button type="button" className="btn" onClick={upload} disabled={busy}>
              {busy ? "올리는 중…" : "등록"}
            </button>
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <button type="button" className="btn btn-ghost avatar-cancel" onClick={onCancel} disabled={busy}>
        취소
      </button>
    </div>
  );
}

interface View {
  s: number;
  x: number;
  y: number;
}
type Point = { x: number; y: number };

/** 1단계: 끌어서 옮기고, 두 손가락으로 벌리거나 막대로 확대해서 캐릭터를 네모 안에 넣는다 */
function CropStep({ img, onBack, onCrop }: { img: HTMLImageElement; onBack: () => void; onCrop: (pixels: ImageData) => void }) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const minS = VIEW / Math.min(iw, ih);
  const maxS = minS * 12;
  const fit = (v: View): View => {
    const s = Math.min(maxS, Math.max(minS, v.s));
    return { s, x: Math.min(0, Math.max(VIEW - iw * s, v.x)), y: Math.min(0, Math.max(VIEW - ih * s, v.y)) };
  };
  const [view, setView] = useState<View>(() => fit({ s: minS, x: (VIEW - iw * minS) / 2, y: (VIEW - ih * minS) / 2 }));
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Point>());

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== VIEW * dpr) {
      c.width = VIEW * dpr;
      c.height = VIEW * dpr;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = view.s < 1; // 크게 볼 때는 도트가 보이게
    g.clearRect(0, 0, VIEW, VIEW);
    g.drawImage(img, view.x, view.y, iw * view.s, ih * view.s);
  }, [img, iw, ih, view]);

  /** 화면 좌표 -> 네모 안 좌표 (VIEW 기준) */
  function at(e: { clientX: number; clientY: number }): Point {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * VIEW) / r.width, y: ((e.clientY - r.top) * VIEW) / r.height };
  }

  /** p 자리를 그대로 두고 s 배로 */
  const zoomAt = (v: View, s: number, p: Point): View => {
    const k = Math.min(maxS, Math.max(minS, s)) / v.s;
    return fit({ s: v.s * k, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k });
  };

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // 손가락이 네모 밖으로 나가도 계속 끌리게
    } catch {
      // 이미 떨어진 손가락이면 못 잡는다. 끌기는 그대로 된다
    }
    pointers.current.set(e.pointerId, at(e));
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    const all = pointers.current;
    const prev = all.get(e.pointerId);
    if (!prev) return;
    const now = at(e);
    all.set(e.pointerId, now);
    if (all.size === 1) {
      setView((v) => fit({ ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y }));
    } else if (all.size === 2) {
      const other = [...all.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(now.x - other.x, now.y - other.y);
      if (d0 < 1) return;
      const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const m1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      setView((v) => {
        const z = zoomAt(v, (v.s * d1) / d0, m0);
        return fit({ ...z, x: z.x + m1.x - m0.x, y: z.y + m1.y - m0.y });
      });
    }
  }
  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
  }
  function wheel(e: ReactWheelEvent<HTMLCanvasElement>) {
    const p = at(e);
    setView((v) => zoomAt(v, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p));
  }

  const zoom = Math.round((100 * Math.log(view.s / minS)) / Math.log(maxS / minS));
  function crop() {
    const size = VIEW / view.s;
    const out = Math.max(16, Math.min(WORK_MAX, Math.round(size)));
    const c = document.createElement("canvas");
    c.width = out;
    c.height = out;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.imageSmoothingEnabled = size > out;
    g.drawImage(img, -view.x / view.s, -view.y / view.s, size, size, 0, 0, out, out);
    onCrop(g.getImageData(0, 0, out, out));
  }

  return (
    <>
      <p className="form-note">끌어서 옮기고, 두 손가락으로 벌려서 키워요. 내 캐릭터가 네모에 꽉 차게 맞춰 주세요.</p>
      <canvas
        ref={canvas}
        className="avatar-crop"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
      />
      <label className="avatar-slider">
        <span>확대</span>
        <input
          type="range"
          min={0}
          max={100}
          value={zoom}
          onChange={(e) => {
            const s = minS * Math.pow(maxS / minS, Number(e.target.value) / 100);
            setView((v) => zoomAt(v, s, { x: VIEW / 2, y: VIEW / 2 }));
          }}
        />
      </label>
      <div className="avatar-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ◀ 다른 스샷
        </button>
        <button type="button" className="btn" onClick={crop}>
          자르기
        </button>
      </div>
    </>
  );
}

/** 두 색의 거리 (RGB) */
function far(d: Uint8ClampedArray, i: number, r: number, g: number, b: number): number {
  return Math.hypot(d[i * 4] - r, d[i * 4 + 1] - g, d[i * 4 + 2] - b);
}

/** (x, y) 에서 시작해 비슷한 색으로 이어진 칸들 (4방향). seen 에 이미 있는 칸은 건너뛴다 */
function region(src: ImageData, x0: number, y0: number, tol: number, seen?: Uint8Array): number[] {
  const { width: w, height: h, data } = src;
  const start = y0 * w + x0;
  const mark = seen ?? new Uint8Array(w * h);
  if (mark[start]) return [];
  const [r, g, b] = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
  const out: number[] = [];
  const stack = [start];
  mark[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % w;
    const y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !mark[j] && far(data, j, r, g, b) <= tol) {
        mark[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/** 가장자리에 이어진 배경을 지운 불투명도 */
function clearEdges(src: ImageData, tol: number, alpha: Uint8Array): Uint8Array {
  const { width: w, height: h } = src;
  const next = alpha.slice();
  const seen = new Uint8Array(w * h);
  const edge: [number, number][] = [];
  for (let x = 0; x < w; x++) edge.push([x, 0], [x, h - 1]);
  for (let y = 1; y < h - 1; y++) edge.push([0, y], [w - 1, y]);
  for (const [x, y] of edge) for (const i of region(src, x, y, tol, seen)) next[i] = 0;
  return next;
}

/** 2단계: 배경 지우기. 처음에 가장자리 배경을 지우고, 남은 곳은 눌러서 지우거나 되살린다 */
function EraseStep({ source, onBack, onDone }: { source: ImageData; onBack: () => void; onDone: (png: Blob) => void }) {
  const [tol, setTol] = useState(40);
  const [alpha, setAlpha] = useState(() => clearEdges(source, 40, new Uint8Array(source.width * source.height).fill(255)));
  const [undo, setUndo] = useState<Uint8Array[]>([]);
  const [mode, setMode] = useState<"erase" | "keep">("erase");
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    c.width = source.width;
    c.height = source.height;
    const shown = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    for (let i = 0; i < alpha.length; i++) shown.data[i * 4 + 3] = alpha[i];
    g.putImageData(shown, 0, 0);
  }, [source, alpha]);

  function change(next: Uint8Array) {
    setUndo((u) => [...u.slice(-19), alpha]);
    setAlpha(next);
  }

  function tap(e: ReactPointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) * source.width) / r.width);
    const y = Math.floor(((e.clientY - r.top) * source.height) / r.height);
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
    const next = alpha.slice();
    for (const i of region(source, x, y, tol)) next[i] = mode === "erase" ? 0 : 255;
    change(next);
  }

  async function done() {
    setError("");
    try {
      onDone(await exportPng(source, alpha));
    } catch (x) {
      setError(errorText(x));
    }
  }

  return (
    <>
      <p className="form-note">
        {mode === "erase" ? "남은 배경을 눌러서 지워요." : "잘못 지운 곳을 눌러서 되살려요."} 비슷한 색까지 한 번에 바뀌어요.
      </p>
      <canvas ref={canvas} className="avatar-erase" onPointerDown={tap} />
      <div className="avatar-modes">
        <button type="button" className={"pill" + (mode === "erase" ? " pill-on" : "")} onClick={() => setMode("erase")}>
          🧽 지우개
        </button>
        <button type="button" className={"pill" + (mode === "keep" ? " pill-on" : "")} onClick={() => setMode("keep")}>
          ✏️ 복원
        </button>
        <button
          type="button"
          className="pill"
          disabled={!undo.length}
          onClick={() => {
            setAlpha(undo[undo.length - 1]);
            setUndo((u) => u.slice(0, -1));
          }}
        >
          ↩ 하나 전
        </button>
      </div>
      <label className="avatar-slider">
        <span>색 범위</span>
        <input type="range" min={5} max={120} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
      </label>
      <div className="avatar-modes">
        <button type="button" className="pill" onClick={() => change(clearEdges(source, tol, alpha))}>
          가장자리 정리
        </button>
        <button type="button" className="pill" onClick={() => change(new Uint8Array(alpha.length).fill(255))}>
          처음 그림으로
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="avatar-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ◀ 이전
        </button>
        <button type="button" className="btn" onClick={done}>
          완료
        </button>
      </div>
    </>
  );
}

/** 남은 캐릭터만 꼭 맞게 잘라 높이를 맞춘 PNG */
async function exportPng(src: ImageData, alpha: Uint8Array): Promise<Blob> {
  const { width: w, height: h } = src;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < 16) continue;
    const x = i % w;
    const y = (i - x) / w;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) throw new Error("다 지워졌어요. '처음 그림으로'를 눌러 다시 해 주세요");
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cut = document.createElement("canvas");
  cut.width = cw;
  cut.height = ch;
  const cg = cut.getContext("2d");
  if (!cg) throw new Error("그림을 만들지 못했어요");
  const part = cg.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y + y0) * w + (x + x0);
      const d = (y * cw + x) * 4;
      part.data[d] = src.data[s * 4];
      part.data[d + 1] = src.data[s * 4 + 1];
      part.data[d + 2] = src.data[s * 4 + 2];
      part.data[d + 3] = alpha[s];
    }
  }
  cg.putImageData(part, 0, 0);

  let scale = ch < OUT_H ? Math.max(1, Math.floor(OUT_H / ch)) : OUT_H / ch;
  for (let tries = 0; tries < 5; tries++) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.min(600, Math.round(cw * scale)));
    out.height = Math.max(1, Math.min(600, Math.round(ch * scale)));
    const og = out.getContext("2d");
    if (!og) break;
    og.imageSmoothingEnabled = scale < 1;
    og.drawImage(cut, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, "image/png"));
    if (blob && blob.size <= OUT_MAX_BYTES) return blob;
    scale *= 0.75;
  }
  throw new Error("그림이 너무 커요. 조금 더 작게 잘라 주세요");
}
