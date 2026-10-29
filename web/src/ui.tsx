import type { ReactNode } from "react";
import type { Pic } from "./types";

/** 픽셀 그림. 작은 아이콘은 scale 배로 키워도 흐려지지 않게 그린다 */
export function PicImg({ pic, scale = 1, max, alt = "", className }: {
  pic: Pic | null | undefined;
  scale?: number;
  max?: number;
  alt?: string;
  className?: string;
}) {
  if (!pic) return <span className={"pic-empty " + (className ?? "")} aria-hidden />;
  let w = pic.w * scale;
  let h = pic.h * scale;
  if (max && Math.max(w, h) > max) {
    const k = max / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return <img className={"pic " + (className ?? "")} src={pic.src} width={w} height={h} alt={alt} loading="lazy" decoding="async" />;
}

export function TopBar({ title, back = true, right }: { title: ReactNode; back?: boolean; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <button className="topbar-back" onClick={() => (history.length > 1 ? history.back() : (location.hash = "#/"))} aria-label="뒤로">
          ◀
        </button>
      ) : (
        <img className="topbar-logo" src="icon-192.png" alt="" />
      )}
      <h1 className="topbar-title">{title}</h1>
      {right}
    </header>
  );
}

export function Panel({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={"panel " + (className ?? "")}>
      {title && <h2 className="panel-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Loading({ error }: { error?: string }) {
  return <div className="loading">{error ? "자료를 불러오지 못했어요: " + error : "불러오는 중…"}</div>;
}

export function NotFound({ what }: { what: string }) {
  return (
    <>
      <TopBar title="없음" />
      <div className="empty">{what}을(를) 찾지 못했어요.</div>
    </>
  );
}

export function levelText(level: [number, number] | null | undefined): string {
  return level ? `Lv.${level[0]}~${level[1]}` : "";
}

export function num(n: number | null | undefined): string {
  return n == null ? "-" : n.toLocaleString("ko-KR");
}
