import type { Wiki } from "../types";

const TILES: { title: string; to: string; icon: string; soon?: boolean }[] = [
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
  { title: "타이머", to: "#/timer", icon: "⏰", soon: true },
];

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
        {TILES.map((t) => (
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
