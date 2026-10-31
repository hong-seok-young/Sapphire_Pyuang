import { APP_OPEN, inApp, isAndroid } from "../platform";
import { RANK } from "../auth";
import type { Me } from "../auth";
import { Bell, FitLine, HeroTitle, PixelIcon, TopBar } from "../ui";
import { showUpdate } from "../updates";
import { VERSION } from "../patchnotes";
import { useState } from "react";
import { enablePush, markPushAsked, shouldAskPush } from "../push";

interface Tile {
  title: string;
  to: string;
  icon: string;
  /** 이모지 대신 그림 (상점 칸만: 게임 첫 화면의 상점 그림) */
  iconPic?: string;
  /** 칸 왼쪽 위 작은 띠 (예: 1군 전용) */
  ribbon?: string;
  /** 특정 사람만 들어가는 칸: 테두리에 빛이 돈다 (gold 1군 전용, blue 운영진, purple 개발자) */
  ring?: "gold" | "blue" | "purple";
  soon?: boolean;
  /** soon 일 때 오른쪽 위 표 (없으면 '준비 중') */
  badge?: string;
  /** 아직 못 들어가는 칸 (개발 중): 눌러도 열리지 않는다 */
  locked?: boolean;
  /** 안드로이드 폰 브라우저에서만 보인다 (앱 안, 아이폰에서는 숨김) */
  androidOnly?: boolean;
  /** 오피서 이상에게만 보인다 */
  managers?: boolean;
  /** 앱개발자에게만 보인다 */
  developer?: boolean;
}

const TILES: Tile[] = [
  // 사냥터는 아래 탭에 있어서, 이 자리는 1군 전용 플래티넘 할인 상점 (제작자 요청). 아이콘은 게임 첫 화면의 상점 그림
  // 제목이 길지 않게 '1군 전용'은 왼쪽 위 띠로 (제작자 요청)
  { title: "플래티넘 할인 상점", to: "#/shop", icon: "🏪", iconPic: "/data/shop/shop_icon.png", ribbon: "1군 전용", ring: "gold" },
  // 장비는 아래 탭에 있어서 이 자리는 게시판 (제작자 요청): 공지사항, 길드 이벤트, 자유 게시판
  { title: "게시판", to: "#/board", icon: "📢" },
  // 위키 자료 메뉴는 '정보' 한 칸으로 묶는다 (제작자 요청). 안은 InfoPage
  { title: "정보", to: "#/info", icon: "📚" },
  { title: "길드 랭킹", to: "#/ranking", icon: "🏆" },
  { title: "사파이어 중개인", to: "#/market", icon: "💰" },
  { title: "길드원 의뢰소", to: "#/requests", icon: "📋" },
  // 길드원끼리 장비 빌려주기, 인던 같이 갈 사람 찾기 (제작자 요청 2026-10-31: 칸만 먼저 두고 개발 중으로 막는다)
  { title: "장비대여", to: "", icon: "🤝", soon: true, badge: "개발 중", locked: true },
  { title: "길던&인던 매칭", to: "", icon: "⚔️", soon: true, badge: "개발 중", locked: true }, // 길드던전과 인던 매칭 둘 다 (제작자 요청 2026-11-01)
  // 시계와 보스 타이머는 안드로이드 앱에만 있다. 웹앱은 위키와 챗봇만 맡는다
  // 앱은 검토 후 오픈 (제작자 요청 2026-10-31: 지금은 웹만)
  { title: "안드로이드 앱 받기", to: "#/app", icon: "📲", androidOnly: true, soon: !APP_OPEN, badge: "검토 후 오픈" },
  { title: "길드원 관리", to: "#/admin", icon: "👥", managers: true, ribbon: "운영진", ring: "blue" },
  { title: "사용 기록", to: "#/log", icon: "📊", developer: true, ribbon: "개발자", ring: "purple" },
  // 챗봇이 모르는 질문 (제작자 요청: 보고 고친 뒤 물은 사람에게 알린다)
  { title: "챗봇 개선", to: "#/gaps", icon: "🧙", developer: true, ribbon: "개발자", ring: "purple" },
];

/** '정보' 안의 위키 자료 메뉴 */
const INFO_TILES: Tile[] = [
  { title: "육성 공략", to: "#/menu/육성 공략", icon: "📈" },
  { title: "직업별 스킬", to: "#/menu/직업별 스킬", icon: "✨" },
  { title: "조합책", to: "#/menu/조합책", icon: "⚒️" },
  { title: "강화 · 보석 · 성장", to: "#/menu/강화 · 보석 · 성장", icon: "💎" },
  { title: "인던 · 길드던전", to: "#/menu/인던 · 길드던전", icon: "🏰" },
  { title: "전장 · 헌팅그라운드", to: "#/menu/전장 · 헌팅그라운드", icon: "🚩" },
  { title: "퀘스트 · 지도", to: "#/menu/퀘스트 · 지도", icon: "📜" },
  // 컴투스 공식 확률 정보 (제작자 요청 2026-10-31, pages/Odds.tsx)
  { title: "공식 확률", to: "#/odds", icon: "🎲" },
];

/**
 * 칸 그림: 이모지 (상점 칸만 게임 상점 그림). 제작자 요청 2026-10-31: 게임 아이템 그림을 키운 아이콘은 뭉개져서
 * 보기 싫다, 게임 그림을 굳이 쓸 필요 없다
 */
function TileIcon({ t }: { t: Tile }) {
  return t.iconPic ? <img className="tile-pic" src={t.iconPic} alt="" /> : <>{t.icon}</>;
}

/** 칸 그리기 (홈과 정보가 같이 쓴다) */
function Tiles({ me, tiles }: { me: Me; tiles: Tile[] }) {
  return (
    <nav className="tiles">
      {tiles.map((t) => {
        // 고친 메뉴: 다른 색 테두리와 'UPDATE' (처음 들어간 뒤 하루 동안, updates.ts). '정보'는 안의 메뉴가 고쳐졌을 때도
        const updated = !t.locked && (showUpdate(me.id, t.to) || (t.to === "#/info" && INFO_TILES.some((x) => showUpdate(me.id, x.to))));
        const className =
          "tile" + (t.soon ? " tile-soon" : "") + (t.locked ? " tile-locked" : "") + (t.ring ? ` tile-ring tile-ring-${t.ring}` : "") + (updated ? " tile-new" : "");
        const inside = (
          <>
            {t.ribbon && <span className="tile-ribbon">{t.ribbon}</span>}
            {updated && <span className="tile-update">UPDATE</span>}
            <span className="tile-icon">
              <TileIcon t={t} />
            </span>
            {/* 칸 크기는 모두 같게 (제작자 요청: 작은 칸 기준): 이름은 줄을 바꾸지 않고 들어갈 만큼 글자를 줄인다 */}
            <FitLine className="tile-title" text={t.title} wrap={false} />
            {t.soon && <span className="tile-badge">{t.badge ?? "준비 중"}</span>}
          </>
        );
        return t.locked ? (
          <span key={t.title} className={className} aria-disabled="true">
            {inside}
          </span>
        ) : (
          <a key={t.title} className={className} href={t.to}>
            {inside}
          </a>
        );
      })}
    </nav>
  );
}

/** 정보 (#/info): 위키 자료 메뉴 모음 */
export function InfoPage({ me }: { me: Me }) {
  return (
    <>
      <TopBar title="정보" />
      <Tiles me={me} tiles={INFO_TILES} />
    </>
  );
}

export function Home({ me }: { me: Me }) {
  const shown = TILES.filter(
    (t) => (!t.androidOnly || (isAndroid && !inApp)) && (!t.managers || RANK[me.role] >= 1) && (!t.developer || me.role === "developer"),
  );

  return (
    <div className="home">
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

      <PushAsk />

      <a className="search-entry" href="#/search">
        <PixelIcon name="search" size={16} /> 아이템, 몬스터, 사냥터 검색
      </a>

      <Tiles me={me} tiles={shown} />

      {/* 아래 탭 챗봇 아이콘 바로 위에 아주 작게: 누르면 처음부터 지금까지의 패치 내역 (제작자 요청) */}
      <a className="home-version" href="#/patch">
        클로즈베타 v{VERSION}
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

