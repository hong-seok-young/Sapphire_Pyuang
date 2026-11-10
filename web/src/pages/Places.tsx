import { useCallback, useState } from "react";
import type { Block, Place, PlaceGuide, Wiki } from "../types";
import { ImageViewer } from "./ImageViewer";
import { FavStar, PicImg, TopBar, levelText, Loading, NotFound } from "../ui";
import { MonsterCard } from "../wiki-ui";
import { Blocks, OriginalLink } from "../Blocks";
import { NEED_LOGIN, getJson, loadPosts, useAsync } from "../data";

/** 사냥터 화면이 그리는 원글 칸 (scripts/build_data.py write_place_parts, data/place/<글>.json) */
interface PlaceParts {
  above: Block[];
  below: Block[];
  /** 그 칸이 링크하는 글 중 위키에 있는 글 */
  posts: string[];
}

/** 그 사냥터의 원글 칸만 받는다 (글 전체 posts.json 1.4MB 를 받지 않게). 파일이 없으면 예전처럼 posts.json 에서 */
async function loadPlaceParts(p: Place): Promise<PlaceParts | null> {
  try {
    return await getJson<PlaceParts>(`place/${p.id}`);
  } catch (e) {
    if (String(e).includes(NEED_LOGIN)) throw e;
    const posts = await loadPosts();
    const post = posts[p.id];
    if (!post) return null;
    return { above: p.above.map((i) => post.blocks[i]), below: p.below.map((i) => post.blocks[i]), posts: Object.keys(posts) };
  }
}

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
/**
 * 사냥터 자리 안내 (제작자 2026-11-10 '데이터에 넣어 챗봇 등등이 활용하게': 길드 잡담방에서 마을모금함이 공유한 신전·루나프 자리 나누기).
 * 비공개 자료 길드/사냥터_자리.json -> build_data.py place_guides -> places 의 guide. 그림은 눌러서 크게 (ImageViewer, 뒤로 가기로 닫힘)
 */
function GuideBox({ g }: { g: PlaceGuide }) {
  const [view, setView] = useState<number | null>(null);
  return (
    <section className="place-guide">
      <div className="place-guide-head">
        <b>{g.title}</b>
        {g.by && <small>{g.by}</small>}
      </div>
      <ul className="place-guide-notes">
        {g.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      {g.pics.length > 0 && (
        <div className="place-guide-pics">
          {g.pics.map((pic, i) => (
            <button key={pic.src} type="button" onClick={() => setView(i)}>
              <img src={pic.src} alt={pic.caption} width={pic.w} height={pic.h} loading="lazy" />
              {pic.caption && <small>{pic.caption}</small>}
            </button>
          ))}
        </div>
      )}
      {view !== null && <ImageViewer images={g.pics.map((pic) => ({ src: pic.src, name: pic.caption }))} start={view} onClose={() => setView(null)} />}
    </section>
  );
}

export function PlacePage({ wiki, id }: { wiki: Wiki; id: string }) {
  const p = wiki.places[id];
  // 원글 칸은 그 사냥터 파일에서 따로 불러온다
  const { data: parts, error } = useAsync(useCallback(() => (p ? loadPlaceParts(p) : Promise.resolve(null)), [p]));
  if (!p) return <NotFound what="사냥터" />;
  const mons = p.monsters.map((k) => wiki.monsters[k]).filter(Boolean);
  const link = (pid: string) => (wiki.places[pid] ? "#/place/" + pid : parts?.posts.includes(pid) ? "#/post/" + pid : null);
  const part = (blocks: Block[] | undefined) => !!blocks?.length && <Blocks blocks={blocks} link={link} postId={id} />;
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
      <OriginalLink postId={id} />
      {p.guide && <GuideBox g={p.guide} />}
      {part(parts?.above)}
      {mons.map((m) => (
        <MonsterCard key={m.key} wiki={wiki} m={m} />
      ))}
      {parts !== undefined ? part(parts?.below) : p.above.length + p.below.length > 0 && <Loading error={error} />}
    </>
  );
}
