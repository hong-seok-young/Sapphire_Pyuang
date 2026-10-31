import type { Me } from "../auth";
import { Bell, FitLine, HeroTitle, PixelIcon, TopBar } from "../ui";
import { VERSION } from "../patchnotes";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { enablePush, markPushAsked, shouldAskPush } from "../push";
import { INFO_TILES, canSee, clickItem, isUpdated, itemOf, pressItem, resetLayout, setEditing, useLauncher } from "../launcher";
import type { LaunchItem } from "../launcher";
import { newsFor, useNews } from "../news";

/**
 * 칸 그림: 이모지 (상점 칸만 게임 상점 그림). 제작자 요청 2026-10-31: 게임 아이템 그림을 키운 아이콘은 뭉개져서
 * 보기 싫다, 게임 그림을 굳이 쓸 필요 없다
 */
export function TileIcon({ t }: { t: LaunchItem }) {
  return t.iconPic ? <img className="tile-pic" src={t.iconPic} alt="" draggable={false} /> : <>{t.icon}</>;
}

/**
 * 칸 그리기 (홈과 정보가 같이 쓴다). editable: 홈 칸 (꾹 눌러 편집, 끌어서 옮기기, launcher.ts)
 */
function Tiles({ me, tiles, editable = false, dragKey }: { me: Me; tiles: LaunchItem[]; editable?: boolean; dragKey?: string }) {
  const news = useNews();
  return (
    <nav className="tiles" {...(editable ? { "data-zone": "grid" } : {})}>
      {tiles.map((t) => {
        // 고친 메뉴: 다른 색 테두리와 'UPDATE' (처음 들어간 뒤 하루 동안, updates.ts). '정보'는 안의 메뉴가 고쳐졌을 때도
        const updated = isUpdated(me.id, t);
        const className =
          "tile" +
          (t.soon ? " tile-soon" : "") +
          (t.locked ? " tile-locked" : "") +
          (t.ring ? ` tile-ring tile-ring-${t.ring}` : "") +
          (updated ? " tile-new" : "") +
          (dragKey === t.key ? " launch-drag-src" : "");
        const inside = (
          <>
            {t.ribbon && <span className="tile-ribbon">{t.ribbon}</span>}
            {updated && <span className="tile-update">UPDATE</span>}
            {/* 사람들이 새로 올린 글·물건 수 (news.ts, 'UPDATE' 와 따로) */}
            {newsFor(news, t.key) > 0 && <span className="news-badge tile-news">{newsFor(news, t.key) > 99 ? "99+" : newsFor(news, t.key)}</span>}
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
              onPointerDown: (e: ReactPointerEvent<HTMLElement>) => pressItem(e, t.key, true),
              onClick: clickItem,
              onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
            }
          : {};
        return t.locked ? (
          <span key={t.key} className={className} aria-disabled="true" {...handlers}>
            {inside}
          </span>
        ) : (
          <a key={t.key} className={className} href={t.to} draggable={false} {...handlers}>
            {inside}
          </a>
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
  const layout = L.preview ?? L.layout;
  const grid = layout.grid.map(itemOf).filter((t): t is LaunchItem => !!t && canSee(t, me));
  // 검색은 아래 탭에 있으면 홈에 검색 칸을 두지 않고, 홈으로 올리면 맨 위에 검색 칸이 생긴다 (제작자 요청 2026-11-01)
  const searchUp = grid.some((t) => t.key === "search");
  const tiles = grid.filter((t) => t.key !== "search");
  const dragKey = L.drag?.moved ? L.drag.key : undefined;

  return (
    <div className={"home" + (L.editing ? " launch-editing" : "")}>
      <header className="hero">
        {/* 앱 안에서는 게임 속 1군 길드마크 (12칸 그대로), 폰 홈 화면 아이콘은 고화질 원본 (제작자 요청) */}
        <img className="hero-mark" src="guild-mark.png" alt="" width={72} height={72} />
        <div>
          <HeroTitle />
          <p className="hero-sub">
            사파이어 길드 포탈
            {/* 로그인한 사람: 초록 점과 닉네임. 닉네임은 10글자까지라 자르지 않고, 자리가 모자라면 다음 줄로 */}
            <span className="hero-user">
              {/* 알림: 닉네임 앞 작은 🔔 (위의 단추 줄은 좁은 폰에서 'web' 과 겹쳐서) */}
              <Bell className="hero-bell" size={16} />
              <i className="online-dot" aria-label="로그인 중" />
              {me.id}
            </span>
          </p>
        </div>
        {/* 내 정보 (직업, 레벨, 캐릭터 사진, 비밀번호, 로그아웃): 'web' 오른쪽의 사람 단추 (제작자 요청) */}
        <a className="pill hero-me" href="#/me" aria-label="내 정보" title="내 정보">
          <PixelIcon name="me" size={32} />
        </a>
      </header>

      {/* 배치 편집 중 (홈 칸을 꾹 누르면): 끌어서 홈 칸끼리, 홈 칸과 아래 탭 사이를 옮긴다 (launcher.ts) */}
      {L.editing && (
        <div className="panel launch-bar">
          <b>배치 편집</b>
          <button className="pill" onClick={resetLayout}>
            기본 배치
          </button>
          <button className="pill pill-on" onClick={() => setEditing(false)}>
            완료
          </button>
        </div>
      )}

      <PushAsk />

      {searchUp && (
        <a
          className={"search-entry" + (dragKey === "search" ? " launch-drag-src" : "")}
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

      <Tiles me={me} tiles={tiles} editable dragKey={dragKey} />

      {/* 배치 편집: 아래 탭 왼쪽 끝 바로 위에 작게 (제작자 요청 2026-11-01: 꾹 누르기와 함께, 버전 글씨의 반대편) */}
      {!L.editing && (
        <button className="home-edit" onClick={() => setEditing(true)}>
          ✏️ 배치 편집
        </button>
      )}

      {/* 아래 탭 챗봇 아이콘 바로 위에 아주 작게: 누르면 처음부터 지금까지의 패치 내역 (제작자 요청). 2026-11-01 정식 오픈 v1.0 */}
      <a className="home-version" href="#/patch">
        v{VERSION}
      </a>
    </div>
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

