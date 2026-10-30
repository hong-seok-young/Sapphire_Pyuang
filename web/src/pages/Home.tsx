import type { Wiki } from "../types";
import { inApp, isAndroid } from "../platform";

/** androidOnly: 안드로이드 폰 브라우저에서만 보인다 (앱 안, 아이폰에서는 숨김) */
const TILES: { title: string; to: string; icon: string; soon?: boolean; androidOnly?: boolean }[] = [
  { title: "사냥터", to: "#/places", icon: "🗺️" },
  { title: "장비", to: "#/equip", icon: "🛡️" },
  { title: "육성 공략", to: "#/menu/육성 공략", icon: "📈" },
  { title: "직업별 스킬", to: "#/menu/직업별 스킬", icon: "✨" },
  { title: "조합책", to: "#/menu/조합책", icon: "⚒️" },
  { title: "강화 · 보석 · 성장", to: "#/menu/강화 · 보석 · 성장", icon: "💎" },
  { title: "인던 · 길드던전", to: "#/menu/인던 · 길드던전", icon: "🏰" },
  { title: "전장 · 헌팅그라운드", to: "#/menu/전장 · 헌팅그라운드", icon: "🚩" },
  { title: "퀘스트 · 지도", to: "#/menu/퀘스트 · 지도", icon: "📜" },
  { title: "AI 챗봇", to: "#/chat", icon: "💬", soon: true },
  // 시계와 보스 타이머는 안드로이드 앱에만 있다. 웹앱은 위키와 챗봇만 맡는다
  { title: "안드로이드 앱 받기", to: "#/app", icon: "📲", androidOnly: true },
];

const SHOWN = TILES.filter((t) => !t.androidOnly || (isAndroid && !inApp));

export function Home({ wiki }: { wiki: Wiki }) {
  return (
    <div className="home">
      <header className="hero">
        <img className="hero-mark" src="icon-192.png" alt="" width={72} height={72} />
        <div>
          <h1 className="hero-title">Sapphire</h1>
          <p className="hero-sub">아이모 길드 위키</p>
        </div>
      </header>

      <a className="search-entry" href="#/search">
        <span>🔍</span> 아이템, 몬스터, 사냥터 검색
      </a>

      <nav className="tiles">
        {SHOWN.map((t) => (
          <a key={t.title} className={"tile" + (t.soon ? " tile-soon" : "")} href={t.to}>
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-title">{t.title}</span>
            {t.soon && <span className="tile-badge">준비 중</span>}
          </a>
        ))}
      </nav>

      <footer className="credit">
        자료 출처: <a href={wiki.meta.source.글} target="_blank" rel="noreferrer">{wiki.meta.source.제목}</a> (Made by{" "}
        {wiki.meta.source.작성자}) · {wiki.meta.source.패치} 패치
        <br />
        몬스터 {wiki.meta.counts.monsters} · 아이템 {wiki.meta.counts.items} · 사냥터 {wiki.meta.counts.places}
      </footer>
    </div>
  );
}
