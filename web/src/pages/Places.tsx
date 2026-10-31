import { useCallback } from "react";
import type { Wiki } from "../types";
import { FavStar, PicImg, TopBar, levelText, Loading, NotFound } from "../ui";
import { MonsterCard } from "../wiki-ui";
import { Blocks } from "../Blocks";
import { loadPosts, postLink, useAsync } from "../data";

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

/**
 * 사냥터 화면: 몬스터는 카드로, 나머지(옆 사냥터로 가는 길, 지도, 퀘스트, NPC, 참고, 보상)는 원글 칸을 그대로 그린다.
 * 원글을 따로 열지 않아도 원글의 정보가 모두 보이게 한다. 어떤 칸을 그릴지는 build_data.py 의 post_parts 가 정한다.
 */
export function PlacePage({ wiki, id }: { wiki: Wiki; id: string }) {
  // 원글 칸은 글 본문 자료(posts.json)에 있어서 따로 불러온다
  const { data: posts, error } = useAsync(useCallback(() => loadPosts(), []));
  const p = wiki.places[id];
  if (!p) return <NotFound what="사냥터" />;
  const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
  const post = posts?.[id];
  const link = posts ? postLink(wiki, posts) : () => null;
  const part = (idx: number[]) =>
    post && idx.length > 0 && <Blocks blocks={idx.map((i) => post.blocks[i])} link={link} />;
  return (
    <>
      <TopBar title={p.name} star={<FavStar kind="place" fkey={id} name={p.name} className="topbar-me" />} />
      <div className="place-hero">
        <PicImg pic={p.banner} scale={2} max={318} className="place-banner" />
        <div className="place-hero-text">
          <div className="place-title">{p.title.replace(/\s*_ReMAKE$/, "")}</div>
          <div className="muted">
            {p.region} {levelText(p.level) && "· " + levelText(p.level)} {p.desc && "· " + p.desc}
          </div>
        </div>
      </div>
      {part(p.above)}
      {mons.map((m) => (
        <MonsterCard key={m.key} wiki={wiki} m={m} />
      ))}
      {posts ? part(p.below) : p.above.length + p.below.length > 0 && <Loading error={error} />}
    </>
  );
}
