import type { Wiki } from "../types";
import { PicImg, TopBar, levelText, NotFound } from "../ui";
import { MonsterCard, PlaceInfo } from "../wiki-ui";
import { cafeUrl } from "../data";

export function Places({ wiki }: { wiki: Wiki }) {
  return (
    <>
      <TopBar title="사냥터" />
      {wiki.regions.map((r) => (
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
      <div className="links">
        <a className="btn" href={"#/post/" + id}>원글 표 그대로 보기</a>
        <a className="btn btn-ghost" href={cafeUrl(id)} target="_blank" rel="noreferrer">카페에서 보기</a>
      </div>
    </>
  );
}
