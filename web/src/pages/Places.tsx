import type { Wiki } from "../types";
import { PicImg, TopBar, levelText, NotFound } from "../ui";
import { MonsterCard, PlaceInfo } from "../wiki-ui";

/** 지역 버튼에 쓰는 짧은 이름 */
const SHORT: Record<string, string> = {
  "월드 서버 컨텐츠": "월드 서버",
  "인스턴스 던전 (매주 목요일 초기화)": "인스턴스 던전",
  "삭제된 컨텐츠": "삭제됨",
};

export function Places({ wiki, region }: { wiki: Wiki; region: string }) {
  const current = wiki.regions.find((r) => r.name === region) ?? wiki.regions[0];
  return (
    <>
      <TopBar title="사냥터" />
      <nav className="filter region-tabs">
        {wiki.regions.map((r) => (
          <a
            key={r.name}
            className={"pill" + (r === current ? " pill-on" : "")}
            href={"#/places?r=" + encodeURIComponent(r.name)}
          >
            {SHORT[r.name] ?? r.name}
          </a>
        ))}
      </nav>
      {[current].map((r) => (
        <section key={r.name} className="region">
          <h2 className="region-title">{r.name}</h2>
          <div className="place-grid">
            {r.places.map((id) => {
              const p = wiki.places[id];
              return (
                <a key={id} className="place-card" href={"#/place/" + id}>
                  <PicImg pic={p.banner} className="place-banner" />
                  <span className="place-meta">{levelText(p.level) || p.desc}</span>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function PlacePage({ wiki, id }: { wiki: Wiki; id: string }) {
  const p = wiki.places[id];
  if (!p) return <NotFound what="사냥터" />;
  const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
  return (
    <>
      <TopBar title={p.name} />
      <div className="place-hero">
        <PicImg pic={p.banner} scale={2} max={318} className="place-banner" />
        <div className="place-hero-text">
          <div className="place-title">{p.title.replace(/\s*_ReMAKE$/, "")}</div>
          <div className="muted">
            {p.region} {levelText(p.level) && "· " + levelText(p.level)} {p.desc && "· " + p.desc}
          </div>
        </div>
      </div>
      {mons.map((m) => (
        <MonsterCard key={m.key} wiki={wiki} m={m} />
      ))}
      {p.info && <PlaceInfo text={p.info} />}
    </>
  );
}
