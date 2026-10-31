import { APP_OPEN, inApp, isAndroid } from "../platform";
import { RANK } from "../auth";
import type { Me } from "../auth";
import { Bell, FitLine, HeroTitle } from "../ui";
import { showUpdate } from "../updates";

interface Tile {
  title: string;
  to: string;
  icon: string;
  /** 이모지 대신 그림 (게임 스샷에서 자른 아이콘) */
  iconPic?: string;
  /** 칸 왼쪽 위 작은 띠 (예: 1군 전용) */
  ribbon?: string;
  /** 특정 사람만 들어가는 칸: 테두리에 빛이 돈다 (gold 1군 전용, blue 운영진, purple 개발자) */
  ring?: "gold" | "blue" | "purple";
  soon?: boolean;
  /** soon 일 때 오른쪽 위 표 (없으면 '준비 중') */
  badge?: string;
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
  { title: "육성 공략", to: "#/menu/육성 공략", icon: "📈" },
  { title: "직업별 스킬", to: "#/menu/직업별 스킬", icon: "✨" },
  { title: "조합책", to: "#/menu/조합책", icon: "⚒️" },
  { title: "강화 · 보석 · 성장", to: "#/menu/강화 · 보석 · 성장", icon: "💎" },
  { title: "인던 · 길드던전", to: "#/menu/인던 · 길드던전", icon: "🏰" },
  { title: "전장 · 헌팅그라운드", to: "#/menu/전장 · 헌팅그라운드", icon: "🚩" },
  { title: "퀘스트 · 지도", to: "#/menu/퀘스트 · 지도", icon: "📜" },
  { title: "AI 챗봇", to: "#/chat", icon: "💬" },
  { title: "길드 랭킹", to: "#/ranking", icon: "🏆" },
  { title: "사파이어 중개인", to: "#/market", icon: "💰" },
  { title: "길드원 의뢰소", to: "#/requests", icon: "📋" },
  // 시계와 보스 타이머는 안드로이드 앱에만 있다. 웹앱은 위키와 챗봇만 맡는다
  // 앱은 검토 후 오픈 (제작자 요청 2026-10-31: 지금은 웹만)
  { title: "안드로이드 앱 받기", to: "#/app", icon: "📲", androidOnly: true, soon: !APP_OPEN, badge: "검토 후 오픈" },
  { title: "길드원 관리", to: "#/admin", icon: "👥", managers: true, ribbon: "운영진", ring: "blue" },
  { title: "사용 기록", to: "#/log", icon: "📊", developer: true, ribbon: "개발자", ring: "purple" },
];

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
            아이모 길드 위키
            {/* 로그인한 사람: 초록 점과 닉네임. 닉네임은 10글자까지라 자르지 않고, 자리가 모자라면 다음 줄로 */}
            <span className="hero-user">
              {/* 알림: 닉네임 앞 작은 🔔 (위의 단추 줄은 좁은 폰에서 'web' 과 겹쳐서) */}
              <Bell className="hero-bell" />
              <i className="online-dot" aria-label="로그인 중" />
              {me.id}
            </span>
          </p>
        </div>
        {/* 내 정보 (직업, 레벨, 캐릭터 사진, 비밀번호, 로그아웃): 'web' 오른쪽의 사람 단추 (제작자 요청) */}
        <a className="pill hero-me" href="#/me" aria-label="내 정보" title="내 정보">
          👤
        </a>
      </header>

      <a className="search-entry" href="#/search">
        <span>🔍</span> 아이템, 몬스터, 사냥터 검색
      </a>

      <nav className="tiles">
        {shown.map((t) => {
          // 고친 메뉴: 다른 색 테두리와 'UPDATE' (처음 들어간 뒤 하루 동안, updates.ts)
          const updated = showUpdate(me.id, t.to);
          return (
            <a
              key={t.title}
              className={"tile" + (t.soon ? " tile-soon" : "") + (t.ring ? ` tile-ring tile-ring-${t.ring}` : "") + (updated ? " tile-new" : "")}
              href={t.to}
            >
              {t.ribbon && <span className="tile-ribbon">{t.ribbon}</span>}
              {updated && <span className="tile-update">UPDATE</span>}
              <span className="tile-icon">{t.iconPic ? <img className="tile-pic" src={t.iconPic} alt="" /> : t.icon}</span>
              {/* 이름은 한 줄에 맞추고, 안 되면 낱말 사이에서만 줄을 바꾼다 ('성장'이 '성/장'으로 갈리지 않게) */}
              <FitLine className="tile-title" text={t.title} />
              {t.soon && <span className="tile-badge">{t.badge ?? "준비 중"}</span>}
            </a>
          );
        })}
      </nav>

    </div>
  );
}
