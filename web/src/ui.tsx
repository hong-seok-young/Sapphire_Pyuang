import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUpdate } from "./update";
import { isFavorite, toggleFavorite, useFavorites } from "./favorites";
import type { FavKind } from "./favorites";
import type { ReactNode } from "react";
import { EDITION } from "./platform";
import { useUnread } from "./alerts";
import { JOB_NAME, errorText } from "./auth";
import { goCharacter, refreshMe, useMyCharacters } from "./characters";
import { goBack } from "./router";
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
/**
 * 메뉴 화면 제목의 영문 (제작자 요청 2026-11-02, 4안: 화면 아래 따로 두던 배너를 없애고 위 줄 가운데 제목을 작은 배너 모양으로).
 * 여기 있는 제목만 배너로 그리고, 아이템·글·사냥터 이름 같은 제목은 글자 그대로. 새 메뉴 화면을 만들면 여기에 더한다
 */
export const TITLE_EN: Record<string, string> = {
  "사파이어 중개인": "SAPPHIRE BROKER",
  게시판: "NOTICE BOARD",
  장비대여: "EQUIPMENT RENTAL",
  "길드 랭킹": "RANKING",
  "플래티넘 할인 상점": "PLATINUM SHOP",
  "길드원 의뢰소": "REQUESTS",
  "To do": "CHECKLIST",
  정보: "GUILD WIKI",
  사냥터: "HUNTING GROUNDS",
  장비: "EQUIPMENT",
  검색: "SEARCH",
  "공식 확률": "OFFICIAL ODDS",
  "아이모 소식": "IMO NEWS",
  알림: "NOTIFICATIONS",
  "내 정보": "MY PAGE",
  "길드원 관리": "MEMBERS",
  "사용 기록": "ACTIVITY LOG",
  "챗봇 개선": "CHATBOT FIXES",
  "패치 내역": "PATCH NOTES",
  "안드로이드 앱": "ANDROID APP",
  "앱 기능": "APP SETTINGS",
  "AI 챗봇": "SAPPHIRE GUIDE",
  "육성 공략": "GROWTH GUIDE",
  "직업별 스킬": "CLASS SKILLS",
  조합책: "RECIPES",
  "강화 · 보석 · 성장": "ENHANCE · GEMS",
  "인던 · 길드던전": "DUNGEONS",
  "전장 · 헌팅그라운드": "BATTLEFIELD",
  "퀘스트 · 지도": "QUESTS · MAPS",
  "길드 던전": "GUILD DUNGEON",
};

export function TopBar({ title, back = true, right, star }: { title: ReactNode; back?: boolean; right?: ReactNode; star?: ReactNode }) {
  const en = typeof title === "string" ? TITLE_EN[title] : undefined;
  return (
    // 위 줄 (제작자 요청 2026-11-02): 왼쪽 ◀, 가운데 제목(메뉴 화면은 작은 배너, 화면 가운데), 오른쪽 🔔 과 👤. 단추는 상자 없이 작게
    <header className={"topbar" + (right ? "" : " topbar-std")}>
      {back ? (
        <button className="topbar-back" onClick={goBack} aria-label="뒤로">
          ◀
        </button>
      ) : (
        <img className="topbar-logo" src="guild-mark.png" alt="" />
      )}
      {en ? (
        <h1 className="topbar-title topbar-title-banner">
          {/* 제작자가 고른 E: 판 없이 금빛 글자, 양옆 보석 장식과 밑줄, 잔잔한 움직임 (2026-11-02, styles.css .tb-banner) */}
          <span className="tb-banner">
            <span className="tb-b">
              <span className="tb-i">
                <span className="tb-en">{en}</span>
                <FitLine className="tb-ko" text={title as string} wrap={false} />
              </span>
            </span>
          </span>
        </h1>
      ) : (
        <h1 className="topbar-title">{typeof title === "string" ? <FitLine text={title} shrink={2} /> : title}</h1>
      )}
      {right ?? (
        <span className="topbar-right">
          {star}
          {!location.hash.startsWith("#/alerts") && <Bell className="topbar-me" size={18} />}
          {!location.hash.startsWith("#/me") && <MeButton className="topbar-me" size={18} />}
        </span>
      )}
    </header>
  );
}

/**
 * 캐릭터 목록 (부캐 묶기): 고르면 그 캐릭터로 바꿔 지금 화면을 다시 연다. me 를 주면 맨 아래에 '내 정보' 줄
 * (제작자 요청 2026-11-02: 위 줄 프로필 단추를 누르면 아이디 목록과 내 정보)
 */
function CharacterMenu({ top, me, onClose }: { top: number; me?: boolean; onClose: () => void }) {
  const { current, list } = useMyCharacters();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function pick(id: string) {
    if (id === current) {
      onClose();
      return;
    }
    setBusy(id);
    setError("");
    try {
      await goCharacter(id, location.hash || "#/");
    } catch (x) {
      setError(errorText(x));
      setBusy("");
      refreshMe(); // 목록이 예전 것이었으면 (뗀 부캐 등) 맞춘다
    }
  }
  return (
    <>
      <div className="char-menu-back" onClick={onClose} />
      <div className="char-menu" role="menu" style={{ top }}>
        {list.map((c) => (
          <button key={c.id} className={"char-item" + (c.id === current ? " char-on" : "")} disabled={!!busy} onClick={() => pick(c.id)} role="menuitem">
            <span className="char-name">
              <b>{c.id}</b>
              <small>
                {c.main ? "본캐" : "부캐"}
                {c.level ? ` · Lv.${c.level}` : ""}
                {c.job ? ` ${JOB_NAME[c.job]}` : ""}
              </small>
            </span>
            <span className="char-mark">{busy === c.id ? "…" : c.id === current ? "✓" : ""}</span>
          </button>
        ))}
        {me && (
          <a className="char-item char-me" href="#/me" onClick={onClose} role="menuitem">
            <span className="char-name">
              <b>내 정보</b>
            </span>
            <span className="char-mark">›</span>
          </a>
        )}
        {error && <small className="form-error">{error}</small>}
      </div>
    </>
  );
}

/**
 * 프로필 단추 (👤): 캐릭터가 하나면 누르면 바로 내 정보, 묶은 캐릭터가 있으면 아이디 목록과 '내 정보'가 뜨고 고르면 그 캐릭터로 바꾼다
 * (제작자 요청 2026-11-02: '알림 + 프로필 모양으로 두고 한 번 누르면 아이디 목록 + 내 정보, 부캐 없으면 바로 내 정보')
 */
export function MeButton({ className, size }: { className: string; size: number }) {
  const { list } = useMyCharacters();
  const [at, setAt] = useState<number | null>(null);
  if (list.length < 2)
    return (
      <a className={className} href="#/me" aria-label="내 정보" title="내 정보">
        <PixelIcon name="me" size={size} />
      </a>
    );
  return (
    <>
      <button
        className={className}
        onClick={(e) => setAt(at === null ? e.currentTarget.getBoundingClientRect().bottom + 6 : null)}
        aria-label="캐릭터 · 내 정보"
        aria-expanded={at !== null}
      >
        <PixelIcon name="me" size={size} />
      </button>
      {at !== null && <CharacterMenu top={at} me onClose={() => setAt(null)} />}
    </>
  );
}

/**
 * 홈의 초록 점과 닉네임. 캐릭터를 묶은 사람(부캐 묶기)은 누르면 캐릭터 목록이 뜨고, 고르면 그 캐릭터로 바꿔 지금 화면을 다시 연다
 * (제작자 요청 2026-11-01: 캐릭터 바꾸기만). 캐릭터가 하나면 그냥 글자
 */
export function CharacterSwitch() {
  const { current, list } = useMyCharacters();
  const [at, setAt] = useState<number | null>(null);
  const label = (
    <>
      <i className="online-dot" aria-label="로그인 중" />
      {current}
    </>
  );
  if (list.length < 2) return label;
  return (
    <>
      <button
        className="char-switch"
        onClick={(e) => setAt(at === null ? e.currentTarget.getBoundingClientRect().bottom + 6 : null)}
        aria-label="캐릭터 바꾸기"
        aria-expanded={at !== null}
      >
        {label}
        <span className="char-switch-arrow" aria-hidden="true">▾</span>
      </button>
      {at !== null && <CharacterMenu top={at} onClose={() => setAt(null)} />}
    </>
  );
}

/**
 * 짧은 이름을 한 줄에 맞춘다. 넘치면 ' · ' 양옆을 좁히고 글자를 shrink 픽셀까지 줄여 보고,
 * 그래도 넘치면 낱말 사이(띄어쓰기와 · 뒤)에서만 줄을 바꾼다. 낱말 가운데에서는 자르지 않는다 (제작자 요청).
 * wrap={false} (닉네임처럼 줄을 바꿀 자리가 없는 글)는 들어갈 만큼 글자를 줄인다
 */
export function FitLine({ text, shrink = 1, wrap = true, className, hs = false }: {
  text: string; shrink?: number; wrap?: boolean; className?: string;
  /** 고스펙 닉네임: 글자 위로 금빛 반짝임 (styles.css .hs, src/kakao.tsx Nick 과 같다) */
  hs?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fits = () => el.scrollWidth <= el.clientWidth;
    const fit = () => {
      // 바꾼 적이 있을 때만 되돌린다 (글자 하나하나마다 레이아웃을 다시 재지 않게: 랭킹은 줄마다 두 개씩 있다)
      if (el.dataset.fit || el.style.fontSize) {
        el.dataset.fit = "";
        el.style.fontSize = "";
      }
      if (fits()) return;
      const base = parseFloat(getComputedStyle(el).fontSize);
      el.dataset.fit = "tight";
      if (!wrap) {
        // 글자 폭이 크기에 꼭 비례하지 않아서(픽셀 글꼴) 맞을 때까지 0.5px 씩 더 줄인다 (2026-11-02: 320px 폭에서 3~5px 잘렸다)
        let px = Math.max(9, Math.floor(((base * el.clientWidth) / el.scrollWidth) * 2) / 2);
        el.style.fontSize = px + "px";
        while (!fits() && px > 8) {
          px -= 0.5;
          el.style.fontSize = px + "px";
        }
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
    // 폰을 돌리는 등 너비가 바뀔 때와 글꼴을 다 받았을 때 다시 맞춘다 (높이만 바뀐 건 무시).
    // 옆에 나중에 붙는 것(카톡 단추 등)에 자리를 내줘 이 글자 칸만 좁아진 때도 (2026-11-02: 길드 던전 파티원 카드의 긴 닉네임이 잘렸다)
    let width = box.clientWidth;
    let own = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (box.clientWidth === width && el.clientWidth === own) return;
      width = box.clientWidth;
      fit();
      own = el.clientWidth;
    });
    watch.observe(box);
    watch.observe(el);
    let alive = true;
    // 글꼴을 아직 받는 중일 때만 다 받은 뒤에 한 번 더 맞춘다
    if (document.fonts.status !== "loaded") document.fonts.ready.then(() => alive && fit());
    return () => {
      alive = false;
      watch.disconnect();
    };
  }, [text, shrink, wrap]);

  return (
    <span ref={ref} className={"fit-line" + (className ? " " + className : "") + (hs ? " hs" : "")} data-hs={hs ? text : undefined}>
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
/**
 * 앱 단추의 픽셀 아이콘 (public/icons, scripts/make_pixel_icons.py). 아이모 아이템 그림과 어울리게 16칸 그림을 정수배로 키운다
 * (제작자 요청: 아이콘을 아이모 그래픽 느낌으로). 게임에 그림이 있는 것(책, 메달, 동전 ...)은 게임 그림을 쓴다 (Home.tsx)
 */
export function PixelIcon({ name, size = 16, className }: { name: "bell" | "home" | "map" | "search" | "gear" | "info" | "chat" | "me" | "phone"; size?: number; className?: string }) {
  return <img className={"px-icon " + (className ?? "")} src={`/icons/${name}.png`} width={size} height={size} alt="" aria-hidden />;
}

export function Bell({ className, size = 24 }: { className?: string; size?: number }) {
  const n = useUnread();
  return (
    <a className={"bell " + (className ?? "")} href="#/alerts" aria-label={n ? `알림 ${n}개` : "알림"}>
      <PixelIcon name="bell" size={size} />
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

export function Loading({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="loading">
      {error ? "자료를 불러오지 못했어요: " + error : "불러오는 중…"}
      {error && onRetry && (
        <div className="links">
          <button className="btn btn-ghost" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}

/** 개발 중인 칸을 길드원이 열었을 때 (앱개발자만 들어가는 동안, 제작자 요청 2026-11-01) */
export function DevSoon({ title, text = "🚧 개발 중이에요" }: { title: string; text?: string }) {
  return (
    <>
      <TopBar title={title} />
      <div className="empty">{text}</div>
    </>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <>
      <TopBar title="없음" />
      <div className="empty">{what}을(를) 찾지 못했어요.</div>
    </>
  );
}

export function levelText(level: [number, number | null] | null | undefined): string {
  if (!level) return "";
  return level[1] === null ? `Lv.${level[0]} 이상` : `Lv.${level[0]}~${level[1]}`;
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

/**
 * 레벨·경험치가 바뀌었을 때 까닭을 묻는다 (제작자 요청): 실제로 오르내린 것인지, 잘못 쓴 것을 고친 것인지.
 * 오타 수정은 성장 랭킹과 레벨업 표시에 들어가지 않는다. 화면을 가리지 않고 그 자리에 뜬다
 */
export function ChangeAsk({ onPick, onCancel, busy, compact }: {
  onPick: (change: "grow" | "fix") => void;
  onCancel: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  return (
    <span className={"change-ask" + (compact ? " change-ask-compact" : "")}>
      {!compact && <span className="change-ask-q">레벨이나 경험치가 바뀌었어요. 어떤 변경이에요?</span>}
      <button type="button" className="pill" disabled={busy} onClick={() => onPick("grow")}>
        실제 성장
      </button>
      <button type="button" className="pill" disabled={busy} onClick={() => onPick("fix")}>
        오타 수정
      </button>
      <button type="button" className="pill" disabled={busy} onClick={onCancel}>
        취소
      </button>
    </span>
  );
}


/**
 * 단추 안의 새 것 수 (제작자 요청 2026-11-02: 홈 칸의 빨간 숫자처럼 그 안의 어느 단추에서 새로 올라왔는지도). src/news.ts 의 단추 key 하나나 여럿의 합
 */
export function NewsDot({ n }: { n: number }) {
  return n > 0 ? <span className="news-badge in-news">{n > 99 ? "99+" : n}</span> : null;
}
