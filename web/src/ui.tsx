import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUpdate } from "./update";
import { isFavorite, toggleFavorite, useFavorites } from "./favorites";
import type { FavKind } from "./favorites";
import type { ReactNode } from "react";
import { EDITION } from "./platform";
import { useUnread } from "./alerts";
import type { Pic } from "./types";

/**
 * 픽셀 그림. 작은 아이콘은 scale 배로 키워도 흐려지지 않게 그린다.
 * fit 을 주면 원본 크기와 상관없이 긴 쪽을 fit 픽셀에 맞춘다 (같은 아이템이 드랍표에선 12px,
 * 장비표에선 30px 로 저장돼 있어서, 아이템 아이콘은 fit 으로 크기를 맞춘다)
 */
export function PicImg({ pic, scale = 1, max, fit, alt = "", className }: {
  pic: Pic | null | undefined;
  scale?: number;
  max?: number;
  fit?: number;
  alt?: string;
  className?: string;
}) {
  if (!pic) {
    const style = fit ? { width: fit, height: fit } : undefined;
    return <span className={"pic-empty " + (className ?? "")} style={style} aria-hidden />;
  }
  if (fit) {
    const k = fit / Math.max(pic.w, pic.h);
    return (
      <img className={"pic " + (className ?? "")} src={pic.src} width={Math.round(pic.w * k)} height={Math.round(pic.h * k)}
        alt={alt} loading="lazy" decoding="async" />
    );
  }
  let w = pic.w * scale;
  let h = pic.h * scale;
  if (max && Math.max(w, h) > max) {
    const k = max / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return <img className={"pic " + (className ?? "")} src={pic.src} width={w} height={h} alt={alt} loading="lazy" decoding="async" />;
}

/** 화면 위 줄: 뒤로, 제목, 오른쪽에는 따로 준 것이 없으면 '내 정보' 단추 (내 정보 화면에서는 빼고) */
export function TopBar({ title, back = true, right, star }: { title: ReactNode; back?: boolean; right?: ReactNode; star?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <button className="topbar-back" onClick={() => (history.length > 1 ? history.back() : (location.hash = "#/"))} aria-label="뒤로">
          ◀
        </button>
      ) : (
        <img className="topbar-logo" src="guild-mark.png" alt="" />
      )}
      <h1 className="topbar-title">{typeof title === "string" ? <FitLine text={title} shrink={2} /> : title}</h1>
      {right ?? (
        <span className="topbar-right">
          {star}
          {!location.hash.startsWith("#/alerts") && <Bell className="topbar-me" />}
          {!location.hash.startsWith("#/me") && (
            <a className="topbar-me" href="#/me" aria-label="내 정보" title="내 정보">
              👤
            </a>
          )}
        </span>
      )}
    </header>
  );
}

/**
 * 짧은 이름을 한 줄에 맞춘다. 넘치면 ' · ' 양옆을 좁히고 글자를 shrink 픽셀까지 줄여 보고,
 * 그래도 넘치면 낱말 사이(띄어쓰기와 · 뒤)에서만 줄을 바꾼다. 낱말 가운데에서는 자르지 않는다 (제작자 요청).
 * wrap={false} (닉네임처럼 줄을 바꿀 자리가 없는 글)는 들어갈 만큼 글자를 줄인다
 */
export function FitLine({ text, shrink = 1, wrap = true, className }: {
  text: string; shrink?: number; wrap?: boolean; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fits = () => el.scrollWidth <= el.clientWidth;
    const fit = () => {
      el.dataset.fit = "";
      el.style.fontSize = "";
      if (fits()) return;
      const base = parseFloat(getComputedStyle(el).fontSize);
      el.dataset.fit = "tight";
      if (!wrap) {
        el.style.fontSize = Math.max(9, Math.floor(((base * el.clientWidth) / el.scrollWidth) * 2) / 2) + "px";
        return;
      }
      for (let px = base; px >= base - shrink; px--) {
        el.style.fontSize = px + "px";
        if (fits()) return;
      }
      el.style.fontSize = "";
      el.dataset.fit = "wrap";
    };
    fit();
    // 폰을 돌리는 등 너비가 바뀔 때와 글꼴을 다 받았을 때 다시 맞춘다 (높이만 바뀐 건 무시)
    let width = box.clientWidth;
    const watch = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      fit();
    });
    watch.observe(box);
    let alive = true;
    document.fonts.ready.then(() => alive && fit());
    return () => {
      alive = false;
      watch.disconnect();
    };
  }, [text, shrink, wrap]);

  return (
    <span ref={ref} className={"fit-line" + (className ? " " + className : "")}>
      {/* · 뒤와 ( 앞의 폭 없는 공백이 줄을 바꿀 자리다 (<wbr> 은 크롬에서 한 줄로 둘 때도 줄을 바꿔서 쓰지 않는다) */}
      {text.split(" · ").map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="fit-sep">·</span>}
          {i > 0 && "\u200b"}
          {part.replace(/(\S)\(/g, "$1\u200b(")}
        </Fragment>
      ))}
    </span>
  );
}

/** TapTip 이 떠 있는 시간 (styles.css 의 tap-tip 애니메이션과 같다) */
const TIP_MS = 2000;

/**
 * 누르면 옆에 잠깐 떴다가 저절로 사라지는 작은 설명. 마우스는 올려 두는 동안 보이고 치우면 사라진다.
 * 화면을 가리는 창 대신, 무엇인지 모를 수 있는 마크에 쓴다 (제작자 요청)
 */
export function TapTip({ tip, children }: { tip: string; children: ReactNode }) {
  // 0 이면 숨김. 누를 때마다 숫자를 올려서 애니메이션을 처음부터 다시 튼다
  const [shown, setShown] = useState(0);
  const [hold, setHold] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function show(keep: boolean) {
    window.clearTimeout(timer.current);
    setHold(keep);
    setShown((n) => n + 1);
    if (!keep) timer.current = window.setTimeout(() => setShown(0), TIP_MS);
  }
  function hide() {
    window.clearTimeout(timer.current);
    setHold(false);
    setShown(0);
  }

  return (
    <span
      className="tap-tip-host"
      onClick={() => {
        // 떠 있을 때 한 번 더 누르면 끈다 (제작자 요청)
        if (hold) return;
        if (shown > 0) hide();
        else show(false);
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") show(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hide();
      }}
    >
      {children}
      {shown > 0 && (
        <span key={shown} className={"tap-tip" + (hold ? " tap-tip-hold" : "")} role="tooltip">
          {tip}
        </span>
      )}
    </span>
  );
}

/** 알림 단추: 🔔 와 안 읽은 수 (제작자 요청) */
export function Bell({ className }: { className?: string }) {
  const n = useUnread();
  return (
    <a className={"bell " + (className ?? "")} href="#/alerts" aria-label={n ? `알림 ${n}개` : "알림"}>
      🔔
      {n > 0 && <i className="bell-dot">{n > 99 ? "99+" : n}</i>}
    </a>
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

/** 맨 위 제목. 안드로이드 앱 안에서는 'Sapphire app', 브라우저와 홈 화면 웹앱에서는 'Sapphire web' */
export function HeroTitle() {
  return (
    <h1 className="hero-title">
      Sapphire <span className="hero-edition">{EDITION}</span>
    </h1>
  );
}

/** 즐겨찾기 별 (제작자 요청): 누르면 달고 다시 누르면 뺀다. 검색 화면 위 '즐겨찾기'에 모인다 */
export function FavStar({ kind, fkey, name, className }: { kind: FavKind; fkey: string; name: string; className?: string }) {
  const list = useFavorites();
  const on = isFavorite(list, kind, fkey);
  return (
    <button
      type="button"
      className={"fav-star" + (on ? " fav-on" : "") + (className ? " " + className : "")}
      aria-pressed={on}
      aria-label={on ? "즐겨찾기 빼기" : "즐겨찾기"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(kind, fkey, name).catch((x) => alertText(x));
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/** 즐겨찾기를 못 바꿨을 때 (화면은 이미 되돌렸다). 브라우저 대화상자를 쓰지 않으므로 콘솔에만 */
function alertText(x: unknown) {
  console.warn("즐겨찾기를 바꾸지 못했어요", x);
}

/** 새 버전을 받는 동안 아래쪽 막대: 무엇을 하는지와 %, 100%가 되면 새로고침 (update.ts, 제작자 요청) */
export function UpdateBar() {
  const { pct, label, waiting } = useUpdate();
  if (pct === null) return null;
  return (
    <div className="update-bar" role="status">
      <div className="update-bar-text">
        <span>⬇ {label}</span>
        {waiting ? (
          <button className="pill pill-on" onClick={() => location.reload()}>
            새로고침
          </button>
        ) : (
          <b>{pct}%</b>
        )}
      </div>
      <div className="update-bar-track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

