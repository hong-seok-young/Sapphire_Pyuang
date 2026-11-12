import type { Me } from "../auth";
import {
  Bell,
  CharacterSwitch,
  FitLine,
  FlowLine,
  HeroTitle,
  MeButton,
  NewsDot,
  PixelIcon,
  TopBar,
} from "../ui";
import { VERSION } from "../patchnotes";
import { useEffect, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { enablePush, markPushAsked, shouldAskPush } from "../push";
import {
  COLS,
  INFO_TILES,
  MAX_SLOTS,
  canPreview,
  canSee,
  clickItem,
  gridSlots,
  isLocked,
  isUpdated,
  itemOf,
  pressItem,
  resetLayout,
  searchUp,
  setEditing,
  useLauncher,
} from "../launcher";
import type { LaunchItem, Layout } from "../launcher";
import { newsFor, useMaint, useNews } from "../news";
import type { Maint } from "../news";
import { ClickHint, openGuide } from "../tutorial";
import { showNew } from "../updates";
import { useBackClose } from "../backClose";
import { emojiPic } from "../emojiIcons";

/**
 * 칸 그림: 이모지 (상점 칸만 게임 상점 그림). 제작자 요청 2026-10-31: 게임 아이템 그림을 키운 아이콘은 뭉개져서
 * 보기 싫다, 게임 그림을 굳이 쓸 필요 없다
 */
export function TileIcon({ t }: { t: LaunchItem }) {
  // 이모지도 그림으로 (제작자 2026-11-12 '아이콘 폰인데 pc랑 다르자너': 이모지는 기기 글꼴이라 폰과 PC 가 달랐다, emojiIcons.ts)
  const pic = t.iconPic ?? emojiPic(t.icon);
  return pic ? <img className="tile-pic" src={pic} alt="" draggable={false} /> : <>{t.icon}</>;
}

/**
 * 칸 하나 (홈과 정보가 같이 쓴다). editable: 홈 칸 (꾹 눌러 편집, 끌어서 옮기기, launcher.ts), index: 홈 격자의 자리 번호
 */
function TileCell({
  me,
  t,
  editable = false,
  dragKey,
  index,
}: {
  me: Me;
  t: LaunchItem;
  editable?: boolean;
  dragKey?: string;
  index?: number;
}) {
  const news = useNews();
  // 고친 메뉴: 다른 색 테두리와 'UPDATE' (그 메뉴에 처음 들어가면 사라진다, updates.ts). '정보'는 안의 메뉴가 고쳐졌을 때도
  const updated = isUpdated(me.id, t);
  // 새로 연 메뉴: 하루 동안 'NEW' (updates.ts MENU_NEW, 제작자 요청 2026-11-05)
  const fresh = !t.soon && !t.locked && showNew(t.to);
  // 개발 중인 칸: 길드원은 못 들어가고 앱개발자는 들어간다 (표시는 같이 보인다)
  const locked = isLocked(t, me);
  const className =
    "tile" +
    (t.soon ? " tile-soon" : "") +
    (locked ? " tile-locked" : "") +
    (t.ring ? ` tile-ring tile-ring-${t.ring}` : "") +
    (fresh ? " tile-new tile-fresh" : updated ? " tile-new" : "") +
    (dragKey === t.key ? " launch-drag-src" : "");
  const inside = (
    <>
      {t.ribbon && <span className="tile-ribbon">{t.ribbon}</span>}
      {/* 오른쪽 위 글자만 (장비대여 담당자 '담당자' / '멍멍', 제작자 요청 2026-11-03). UPDATE 표와 자리가 같아 표가 붙어 있는 동안은 숨기고,
          표가 사라지면(한 번 들어가면) 보인다 (제작자: '업데이트는 어차피 한 번 누르면 사라지니까 우측 위로 해도 돼') */}
      {t.corner && !updated && !fresh && (
        <span className={"tile-corner" + (newsFor(news, t.key) > 0 ? " tile-corner-low" : "")}>
          {t.corner.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      )}
      {fresh ? <span className="tile-update tile-fresh-tag">NEW</span> : updated && <span className="tile-update">UPDATE</span>}
      {/* 사람들이 새로 올린 글·물건 수 (news.ts, 'UPDATE' 와 따로) */}
      {newsFor(news, t.key) > 0 && (
        <span className="news-badge tile-news">
          {newsFor(news, t.key) > 99 ? "99+" : newsFor(news, t.key)}
        </span>
      )}
      <span className="tile-icon">
        <TileIcon t={t} />
      </span>
      {/* 칸 크기는 모두 같게 (제작자 요청: 작은 칸 기준): 이름은 줄을 바꾸지 않고 들어갈 만큼 글자를 줄인다 */}
      <FitLine className="tile-title" text={t.title} wrap={false} />
      {t.soon && <span className="tile-badge">{t.badge ?? "준비 중"}</span>}
    </>
  );
  const handlers = editable
    ? {
        "data-slot": t.key,
        "data-zone": "grid",
        "data-index": index,
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) =>
          pressItem(e, t.key, true),
        onClick: clickItem,
        onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
      }
    : {};
  return locked ? (
    <span className={className} aria-disabled="true" {...handlers}>
      {inside}
    </span>
  ) : (
    <a className={className} href={t.to} draggable={false} {...handlers}>
      {inside}
    </a>
  );
}

/** 칸 목록을 위부터 채워 그린다 (정보 화면, 홈의 '개발 중' 묶음) */
function Tiles({ me, tiles }: { me: Me; tiles: LaunchItem[] }) {
  return (
    <nav className="tiles">
      {tiles.map((t) => (
        <TileCell key={t.key} me={me} t={t} />
      ))}
    </nav>
  );
}

/**
 * 홈 칸 격자: 배치의 자리 그대로 (제작자 요청 2026-11-03: 위로 몰지 말고 중간에 빈 자리가 있어도 그대로, 편집 때는 정해진 자리에만 놓는다).
 * 빈 자리와 이 사람에게 안 보이는 칸(운영진 칸, 개발 중 칸)의 자리는 빈 칸으로 둔다 (평소에는 안 보이고 편집 중에만 점선 칸).
 * 편집 중에는 아래에 빈 줄을 하나 더 두어 더 아래로도 놓을 수 있다
 */
function HomeGrid({
  me,
  layout,
  editing,
  dragKey,
}: {
  me: Me;
  layout: Layout;
  editing: boolean;
  dragKey?: string;
}) {
  const slots = gridSlots(layout).map((k) => (k ? itemOf(k) : undefined));
  const shown = (t: LaunchItem | undefined): t is LaunchItem =>
    !!t && canSee(t, me) && !t.soon;
  let last = -1;
  slots.forEach((t, i) => {
    if (shown(t)) last = i;
  });
  const rows = Math.ceil((last + 1) / COLS) + (editing ? 1 : 0);
  const n = Math.min(rows * COLS, MAX_SLOTS);
  return (
    <nav className="tiles home-tiles" data-zone="grid">
      {Array.from({ length: n }, (_, i) => {
        const t = slots[i];
        return shown(t) ? (
          <TileCell
            key={t.key}
            me={me}
            t={t}
            editable
            dragKey={dragKey}
            index={i}
          />
        ) : (
          <span
            key={"empty-" + i}
            className="tile tile-empty"
            data-index={i}
            data-zone="grid"
            aria-hidden="true"
          />
        );
      })}
    </nav>
  );
}

/** 정보 (#/info): 위키 자료 메뉴 모음 (사냥터, 장비도 여기) */
export function InfoPage({ me }: { me: Me }) {
  return (
    <>
      <TopBar title="정보" />
      <Tiles me={me} tiles={INFO_TILES} />
    </>
  );
}

export function Home({ me }: { me: Me }) {
  const L = useLauncher();
  // 배치 편집 중에는 폰 뒤로 가기가 편집만 끝낸다 (backClose.ts)
  useBackClose(L.editing, () => setEditing(false));
  const layout = L.preview ?? L.layout;
  // 검색은 아래 탭에 있으면 홈에 검색 칸을 두지 않고, 홈으로 올리면 맨 위에 검색 칸이 생긴다 (제작자 요청 2026-11-01)
  const hasSearch = searchUp(layout);
  // 열린 칸만 홈 격자에 보이고, 개발 중·검토 후 오픈 칸은 그 아래 접힌 '개발 중' 묶음에 (제작자 요청 2026-11-02: 평소에는 접혀서 안 보이게)
  const soon = gridSlots(layout)
    .map(itemOf)
    .filter((t): t is LaunchItem => !!t && canSee(t, me) && !!t.soon);
  const [showSoon, setShowSoon] = useState(false);
  const foldNews = useNews();
  const dragKey = L.drag?.moved ? L.drag.key : undefined;

  return (
    <div className={"home" + (L.editing ? " launch-editing" : "")}>
      <header className="hero">
        {/* 앱 안에서는 게임 속 1군 길드마크 (12칸 그대로), 폰 홈 화면 아이콘은 고화질 원본 (제작자 요청) */}
        {/* 길드마크를 누르면 홈 튜토리얼 (제작자 요청 2026-11-02 '홈 화면 설명은 길드마크 누르면', src/tutorial.tsx) */}
        <button
          className="hero-mark-btn"
          onClick={() => openGuide("홈")}
          aria-label="홈 튜토리얼"
        >
          <img
            className="hero-mark"
            src="guild-mark.png"
            alt=""
            width={72}
            height={72}
          />
          <ClickHint title="홈" />
        </button>
        <div>
          <HeroTitle />
          <p className="hero-sub">
            사파이어 길드 포탈
            {/* 로그인한 사람: 초록 점과 닉네임. 닉네임은 10글자까지라 자르지 않고, 자리가 모자라면 다음 줄로 */}
            <span className="hero-user">
              {/* 알림: 닉네임 앞 작은 🔔 (위의 단추 줄은 좁은 폰에서 'web' 과 겹쳐서) */}
              <Bell className="hero-bell" size={16} />
              {/* 초록 점과 닉네임: 캐릭터를 묶었으면 눌러서 캐릭터 바꾸기 (부캐 묶기) */}
              <CharacterSwitch />
            </span>
          </p>
        </div>
        {/* 내 정보 (직업, 레벨, 캐릭터 사진, 비밀번호, 로그아웃): 'web' 오른쪽의 사람 단추 (제작자 요청) */}
        <MeButton className="pill hero-me" size={32} />
      </header>

      {/* 아이모 점검 전광판: 공식 점검 글이 뜨면 점검이 끝날 때까지 (제작자 요청 2026-11-01) */}
      <MaintBanner />

      {/* 배치 편집 중 (홈 칸을 꾹 누르면): 끌어서 홈 칸끼리, 홈 칸과 아래 탭 사이를 옮긴다 (launcher.ts) */}
      {L.editing && (
        <div className="panel launch-bar">
          <b>배치 편집</b>
          <button className="pill" onClick={resetLayout}>
            기본 배치
          </button>
          <button
            className="pill pill-on"
            onClick={() => setEditing(false)}
            data-tut-dismiss
          >
            완료
          </button>
        </div>
      )}

      <PushAsk />

      {hasSearch && (
        <a
          className={
            "search-entry" + (dragKey === "search" ? " launch-drag-src" : "")
          }
          href="#/search"
          draggable={false}
          data-slot="search"
          data-zone="grid"
          onPointerDown={(e) => pressItem(e, "search", true)}
          onClick={clickItem}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PixelIcon name="search" size={16} /> 아이템, 몬스터, 사냥터 검색
        </a>
      )}

      <HomeGrid me={me} layout={layout} editing={L.editing} dragKey={dragKey} />

      {soon.length > 0 && !L.editing && (
        <>
          <button
            className="soon-fold"
            onClick={() => setShowSoon((v) => !v)}
            aria-expanded={showSoon}
          >
            개발 중 {soon.length} {showSoon ? "▴" : "▾"}
            {/* 접힌 칸 안의 새 것 수 (장비대여 새 신청 등, 미리 보는 사람만) */}
            {canPreview(me) && !showSoon && (
              <NewsDot
                n={soon.reduce((n, t) => n + newsFor(foldNews, t.key), 0)}
              />
            )}
          </button>
          {/* 안의 칸은 운영진(길드마스터, 오피서)과 앱개발자만 (제작자 요청 2026-11-02). 길드원은 단추만 */}
          {showSoon &&
            (canPreview(me) ? (
              <Tiles me={me} tiles={soon} />
            ) : (
              <p className="soon-closed">운영진에게만 보여요</p>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * 홈의 아래 탭 바로 위 작은 글씨 둘. 화면이 떠오르는 효과(.page 의 transform) 밖에 두어야 처음부터 아래에 있다
 * (제작자 요청 2026-11-02: 위에 있다가 확 내려왔다). App.tsx 가 홈일 때 <main> 옆에 그린다
 */
export function HomeCorner() {
  const L = useLauncher();
  return (
    <>
      {/* 배치 편집: 아래 탭 왼쪽 끝 바로 위에 작게 (제작자 요청 2026-11-01: 꾹 누르기와 함께, 버전 글씨의 반대편) */}
      {!L.editing && (
        <button className="home-edit" onClick={() => setEditing(true)}>
          ⚙️ 배치 편집
        </button>
      )}

      {/* 아래 탭 챗봇 아이콘 바로 위에 아주 작게: 누르면 처음부터 지금까지의 패치 내역 (제작자 요청). 2026-11-01 정식 오픈 v1.0 */}
      <a className="home-version" href="#/patch">
        v{VERSION}
      </a>
    </>
  );
}

/** 폰 알림 켜기 카드 (한 번만): 브라우저는 사용자가 눌러야 알림을 허락받을 수 있어서 처음 한 번 묻는다 (제작자 요청: 기본은 허용) */
function PushAsk() {
  const [show, setShow] = useState(shouldAskPush);
  const [busy, setBusy] = useState(false);
  if (!show) return null;
  const close = () => {
    markPushAsked();
    setShow(false);
  };
  return (
    <div className="panel push-ask">
      <span>📱 폰 알림</span>
      <button
        className="pill pill-on"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await enablePush().catch(() => null);
          close();
        }}
      >
        켜기
      </button>
      <button className="pill" onClick={close}>
        나중에
      </button>
    </div>
  );
}

const DOW = "일월화수목금토";
/** 한국 시간 '11/5(목)', '10:30' */
function kstParts(ms: number) {
  const d = new Date(ms + 9 * 3_600_000);
  return {
    day: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`,
    hm: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  };
}

/** 띠의 윗줄: '11/5(목) 10:30 ~ 15:00 정기 점검 (연장) · 시리온 서버' */
function maintTop(m: Maint): string {
  const s = kstParts(m.start);
  const e = m.end !== null ? kstParts(m.end) : null;
  const range = `${s.day} ${s.hm} ~ ${e ? (e.day === s.day ? "" : e.day + " ") + e.hm : "종료 시까지"}`;
  return `${range} ${m.label}${m.extended ? " (연장)" : ""}${m.servers ? " · " + m.servers : ""}`;
}

/**
 * 아이모 점검 띠 (제작자 요청 2026-11-01, 2026-11-02 고침: '위아래 폭은 엄청 얇게, 반투명, 테두리 없는 띠, 글씨는 작게,
 * 점검이 이때부터 이때 있구나 하는 인상만'): 좌우를 꽉 채운 얇은 공사 띠 한 줄에 '정기 점검 11/5(목) 10:30 ~ 15:00 · 점검 내용'이 흐른다.
 * 공식 점검 글이 올라온 때부터 점검이 끝날 때까지만 (눌러 봐도 없어지지 않는다). 서버가 점검 글을 2분마다 새로 받는다 (연장 공지도, server/maint.ts).
 * 누르면 그 공식 글
 */
function MaintBanner() {
  const list = useMaint();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  const shown = list.filter((m) =>
    m.end !== null ? m.end > now : now < m.start + 12 * 3_600_000,
  );
  if (!shown.length) return null;
  return (
    <div className="maint-wrap">
      {shown.map((m) => {
        const on = now >= m.start;
        return (
          <a
            key={m.id}
            className={"maint" + (on ? " maint-on" : "")}
            href={`#/official/${m.id}`}
            aria-label={maintTop(m)}
          >
            <span className="maint-dot" aria-hidden />
            <FlowLine
              text={
                (on ? "점검 중 · " : "") +
                maintTop(m) +
                (m.content ? "  ·  " + m.content : "")
              }
            />
          </a>
        );
      })}
    </div>
  );
}
