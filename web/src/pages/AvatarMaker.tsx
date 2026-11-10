import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { errorText, uploadAvatar } from "../auth";
import { HeroHalo } from "../heroHalo";
import { applyReview, cleanThin, keepBiggest, markBox, markIndex, onMagenta, reviewScale } from "../avatarCut";
import type { Marks } from "../avatarCut";

/**
 * 캐릭터 사진 만들기 ('내 정보'). 길드원이 갤러리에서 직접 고른 자기 캐릭터 스샷에서
 *  1. 끌고 벌려서(확대) 캐릭터를 네모 안에 넣고 자른다
 *  2. 'AI 보정' 하나로 끝 (제작자 요청 2026-11-02: '색 범위 이딴 거 필요없음, AI 보정 하나 누르면 싹 배경 따고 캐릭 센터로 딱 맞춰주고 끝'):
 *     서버의 Cloudflare 배경 지우기(BiRefNet)로 배경을 따고, 떨어진 조각(이름표, 펫)을 지우고,
 *     Claude 가 원래 스샷과 결과를 보고 캐릭터에 붙어 남은 것(바닥의 둥근 물체, 뒤의 동상, 꽃, 이름표)에 점을 찍으면
 *     그 점에서 색 경계를 따라 퍼져 그 덩어리만 지운다 (separate. 제작자 2026-11-10: '발밑 회색 동그라미가 누끼가 안 따진다, 제대로 되게').
 *     가는 찌꺼기 줄을 걷어 내고 캐릭터에 꼭 맞게 잘라 가운데에 둔다. 이미 배경을 딴 PNG 를 고르면 그 투명한 곳을 그대로 쓴다.
 *     AI 를 못 쓰면(로컬 시험, 하루 한도) 가장자리에 이어진 배경을 저절로 지우고 그 까닭과 '다시 AI 보정'을 보인다. 손으로 지우는 도구는 없다
 *  3. 성장 랭킹 1등 카드에 넣어 보고 올린다
 * 자르기는 폰 안에서 하고, 자른 그림만 서버에 간다 (AI 지우기, 올리기). 앱은 화면을 찍지 않고 게임에 아무것도 보내지 않는다
 * (CLAUDE.md 게임 안전 규칙: 사용자가 고른 스샷만 쓰는 챗봇과 같은 조건).
 */

/** 자르는 네모 한 변 (CSS px) */
const VIEW = 300;
/** 배경을 지울 때 쓰는 그림 한 변 최대 (배경 지우기 AI 가 1024 로 본다. 더 작으면 도트가 뭉개진 채로 보냈다) */
const WORK_MAX = 1024;
/** 올리는 그림 높이. 작으면 정수배로 키우고(도트가 안 번지게), 크면 줄인다 */
const OUT_H = 240;
/** 서버 한도(300KB)보다 조금 작게 */
const OUT_MAX_BYTES = 280_000;

type Step = "pick" | "crop" | "check";

export function AvatarMaker({ onSaved, onCancel }: { onSaved: (avatar: number) => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [work, setWork] = useState<ImageData | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  /** AI 를 못 써서 가장자리 배경만 지웠으면 그 까닭 */
  const [fallback, setFallback] = useState("");
  /** 보정하는 동안 지금 하는 일 */
  const [stage, setStage] = useState("");
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

  /** AI 보정: 배경 따기 -> 떨어진 조각 지우기 -> 캐릭터에 꼭 맞게 가운데로 -> 미리 보기 */
  async function correct(pixels: ImageData) {
    setWork(pixels);
    setBusy(true);
    setError("");
    try {
      const r = await autoCut(pixels, setStage);
      setPng({ blob: r.blob, url: URL.createObjectURL(r.blob) });
      setFallback(r.fallback);
      setStep("check");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setStage("");
    }
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
          <p className="form-note">게임에서 내 캐릭터가 잘 보이게 찍어 둔 스샷을 골라요. 자른 캐릭터만 올라가요.</p>
          <label className="btn avatar-file">
            스샷 고르기
            <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </>
      )}
      {/* 미리 보기에서 '다시 자르기'로 돌아오면 맞춰 둔 자리 그대로 (화면에서 숨겨 둔다) */}
      {img && step !== "pick" && (
        <div className="avatar-maker" hidden={step !== "crop"}>
          <CropStep img={img} busy={busy} stage={stage} onBack={() => setStep("pick")} onCrop={(pixels) => void correct(pixels)} />
        </div>
      )}
      {step === "check" && png && (
        <>
          <div className="growth-hero avatar-preview">
            <span className="growth-crown">이번 주의 성장왕</span>
            <span className="growth-hero-face">
              <HeroHalo />
              <span className="gh-who">
                <img className="growth-face" src={png.url} alt="내 캐릭터" style={{ maxWidth: 96, maxHeight: 96 }} />
              </span>
            </span>
          </div>
          {fallback && (
            <p className="form-note avatar-fallback">
              AI 보정을 못 해서 가장자리 배경만 지웠어요 ({fallback}).
              <button type="button" className="pill" disabled={busy || !work} onClick={() => work && void correct(work)}>
                {busy ? stage || "보정하는 중…" : "다시 AI 보정"}
              </button>
            </p>
          )}
          <div className="avatar-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("crop")} disabled={busy}>
              ◀ 다시 자르기
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
function CropStep({ img, busy, stage, onBack, onCrop }: { img: HTMLImageElement; busy: boolean; stage: string; onBack: () => void; onCrop: (pixels: ImageData) => void }) {
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
    if (busy) return;
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
  /** 스샷의 픽셀 칸에 맞춰 1:1 로 자른다 (반 칸 어긋난 채 늘이면 도트 줄이 한 줄씩 겹치거나 빠졌다). 너무 크면 줄인다 */
  function crop() {
    const size = Math.max(16, Math.min(iw, ih, Math.round(VIEW / view.s)));
    const sx = Math.min(iw - size, Math.max(0, Math.round(-view.x / view.s)));
    const sy = Math.min(ih - size, Math.max(0, Math.round(-view.y / view.s)));
    const out = Math.min(WORK_MAX, size);
    const c = document.createElement("canvas");
    c.width = out;
    c.height = out;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.imageSmoothingEnabled = size > out;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, size, size, 0, 0, out, out);
    onCrop(g.getImageData(0, 0, out, out));
  }

  return (
    <>
      <p className="form-note">{busy ? stage || "AI 가 배경을 따는 중…" : "끌어서 옮기고, 두 손가락으로 벌려서 키워요. 내 캐릭터가 네모에 꽉 차게 맞춰 주세요."}</p>
      <canvas
        ref={canvas}
        className={"avatar-crop" + (busy ? " avatar-ai" : "")}
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
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
          ◀ 다른 스샷
        </button>
        <button type="button" className="btn" onClick={crop} disabled={busy}>
          {busy ? "보정하는 중…" : "AI 보정"}
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

/**
 * AI 지우기: 자른 그림을 서버로 보내 배경을 지운 그림을 받고, 그 투명한 곳을 지운다.
 * 도트 그림이라 반투명은 두지 않고 반을 넘으면 남긴다
 */
async function aiAlpha(src: ImageData): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.putImageData(src, 0, 0);
  const jpeg = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.95));
  if (!jpeg) throw new Error("그림을 만들지 못했어요");
  let res: Response;
  try {
    res = await fetch("/api/avatar/cutout", { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: jpeg });
  } catch {
    throw new Error("인터넷 연결을 확인해 주세요");
  }
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `AI 지우기를 하지 못했어요 (${res.status})`);
  }
  const picture = await createImageBitmap(await res.blob());
  const o = document.createElement("canvas");
  o.width = src.width;
  o.height = src.height;
  const g = o.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(picture, 0, 0, src.width, src.height);
  const d = g.getImageData(0, 0, src.width, src.height).data;
  const a = new Uint8Array(src.width * src.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] >= 128 ? 255 : 0;
  if (!a.some((v) => v)) throw new Error("AI 가 캐릭터를 찾지 못했어요. 캐릭터가 꽉 차게 잘라 주세요");
  // 배경을 하나도 못 땄으면(변환이 원래 그림을 그대로 돌려줌) 실패로 보고 가장자리 배경 지우기로 넘어간다
  if (a.reduce((n, v) => n + (v ? 1 : 0), 0) > a.length * 0.97) throw new Error("AI 가 배경을 찾지 못했어요");
  return keepBiggest(a, src.width, src.height);
}

/** 이미 배경을 딴 그림(투명한 곳이 있는 PNG)이면 그 불투명도. 아니면 null */
function ownAlpha(src: ImageData): Uint8Array | null {
  const a = new Uint8Array(src.width * src.height);
  let clear = 0;
  for (let i = 0; i < a.length; i++) {
    if (src.data[i * 4 + 3] >= 128) a[i] = 255;
    else clear++;
  }
  return clear >= a.length * 0.02 && clear < a.length ? a : null;
}

function base64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(new Error("그림을 읽지 못했어요"));
    r.readAsDataURL(blob);
  });
}

/**
 * AI 검수 (/api/avatar/review): 원래 그림과 지금 결과(지운 곳은 자홍색)를 Claude 에게 보여 주고 캐릭터가 아닌 것(remove)과
 * 캐릭터의 각 부분(keep)에 찍은 점을 받는다. again 이면 첫 검수대로 지운 뒤의 결과라, 아직 남은 것과 잘못 지워진 캐릭터 부분을 찾는다.
 * 그림은 Claude 가 줄이지 않는 크기로 키우거나 줄여 보낸다
 */
async function aiReview(src: ImageData, alpha: Uint8Array, again: boolean): Promise<Marks> {
  const { width: w, height: h } = src;
  const k = reviewScale(w, h);
  const rw = Math.max(16, Math.round(w * k));
  const rh = Math.max(16, Math.round(h * k));
  const flat = document.createElement("canvas");
  flat.width = w;
  flat.height = h;
  const fg = flat.getContext("2d")!;
  const own = new Uint8Array(w * h);
  for (let i = 0; i < own.length; i++) own[i] = src.data[i * 4 + 3] >= 128 ? 255 : 0;
  const encode = async (rgba: Uint8ClampedArray, type: string): Promise<string> => {
    const pixels = fg.createImageData(w, h);
    pixels.data.set(rgba);
    fg.putImageData(pixels, 0, 0);
    const o = document.createElement("canvas");
    o.width = rw;
    o.height = rh;
    const og = o.getContext("2d")!;
    og.imageSmoothingEnabled = k < 1;
    og.drawImage(flat, 0, 0, rw, rh);
    const blob = await new Promise<Blob | null>((ok) => o.toBlob(ok, type, 0.92));
    if (!blob) throw new Error("그림을 만들지 못했어요");
    return base64(blob);
  };
  const original = await encode(onMagenta(src, own), "image/jpeg");
  const cutout = await encode(onMagenta(src, alpha), "image/png");
  const res = await fetch("/api/avatar/review", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ original, cutout, w: rw, h: rh, again }),
  });
  if (!res.ok) throw new Error(`AI 검수를 하지 못했어요 (${res.status})`);
  type Box = { x: number; y: number; x0: number; y0: number; x1: number; y1: number };
  const d = (await res.json()) as { keep?: { x: number; y: number }[]; remove?: Box[] };
  return {
    keep: (d.keep ?? []).map((p) => markIndex(p, k, w, h)),
    remove: (d.remove ?? []).map((p) => markIndex(p, k, w, h)),
    boxes: (d.remove ?? []).map((p) => markBox(p, k, w, h)),
  };
}

/**
 * AI 보정: 배경 따기(aiAlpha, 이미 딴 PNG 면 그 투명한 곳) -> 떨어진 조각 지우기(keepBiggest) -> AI 검수로 캐릭터에 붙어 남은 것 지우기
 * (aiReview + separate) -> 가는 찌꺼기 줄 걷기(openMask) -> 캐릭터에 꼭 맞게 가운데로 (exportPng).
 * 배경 지우기 AI 를 못 쓰면 가장자리에 이어진 배경을 지운 것으로 대신하고 그 까닭을 돌려준다. AI 검수를 못 하면 그 단계만 건너뛴다
 */
async function autoCut(src: ImageData, stage: (text: string) => void): Promise<{ blob: Blob; fallback: string }> {
  const { width: w, height: h } = src;
  let alpha = ownAlpha(src);
  let fallback = "";
  if (!alpha) {
    stage("AI 가 배경을 따는 중…");
    try {
      alpha = await aiAlpha(src);
    } catch (e) {
      alpha = keepBiggest(clearEdges(src, 40, new Uint8Array(w * h).fill(255)), w, h);
      if (!alpha.some((v) => v)) throw e;
      fallback = errorText(e);
    }
  }
  // 배경 지우기 결과에서 떨어진 조각을 지운 것이 기준(base). 첫 검수로 지우고, 둘째 검수는 그 결과 위에서 남은 것을 더 지우고
  // 잘못 지워진 캐릭터 부분(첫 검수가 지운 것, 배경 지우기가 뚫은 눈동자 같은 구멍)을 되살린다 (src/avatarCut.ts applyReview)
  const base = keepBiggest(alpha, w, h);
  alpha = cleanThin(base, w, h);
  const keepAll: number[] = [];
  for (const again of [false, true]) {
    stage(again ? "AI 가 한 번 더 확인하는 중…" : "AI 가 캐릭터만 남기는 중…");
    try {
      const m = await aiReview(src, alpha, again);
      keepAll.push(...m.keep);
      alpha = applyReview(src, base, alpha, m, keepAll, again);
    } catch (e) {
      console.warn("avatar review", e);
      break;
    }
  }
  return { blob: await exportPng(src, alpha), fallback };
}

/** 남은 캐릭터만 꼭 맞게 잘라(위아래 양옆 빈 곳 없이 가운데로) 높이를 맞춘 PNG */
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
  if (x1 < 0) throw new Error("캐릭터를 찾지 못했어요. 캐릭터가 네모에 꽉 차게 다시 잘라 주세요");
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
