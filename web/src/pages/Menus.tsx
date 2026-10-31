// 위키 메뉴 화면 (#/menu/이름). 제작자 요청 2026-10-31: 글 제목만 늘어놓지 말고 직업별로 묶고 단추를 잘 배치해서 꾸미기.
// 육성 공략은 직업 카드에 초급·중급·고급 단추 (내 직업 카드와 내 레벨 단계는 금색), 직업별 스킬은 직업 카드,
// 나머지 메뉴는 묶음(인스턴스 던전, 길드던전, 지도 ...)마다 아이콘 카드. 묶음에 안 맞는 글은 맨 아래 '그 밖의 글'에 모인다.
// 원글에서만 보는 글(cafe.ts isOriginalOnly: 공략 글, 지도·스샷뿐인 글)은 누르면 중간 화면 없이 바로 카페 원글이 열린다 (제작자 요청: 동선을 한 번에). 단추에 '원글 ↗'
import type { Job, Me } from "../auth";
import { JOB_NAME } from "../auth";
import { JobGlyph } from "../emblems";
import type { Wiki } from "../types";
import { NotFound, TopBar } from "../ui";
import { cafeUrl, isOriginalOnly } from "../cafe";

interface Item {
  id: string;
  title: string;
}

const JOBS = ["전사", "레인저", "마법사", "무도가"];
const JOB_OF = Object.fromEntries(Object.entries(JOB_NAME).map(([k, v]) => [v, k as Job])) as Record<string, Job>;
/** 육성 공략 단계 (제목에 레벨 범위가 없을 때 쓰는 기본 범위) */
const STAGES: { name: string; range: [number, number] }[] = [
  { name: "초급", range: [1, 33] },
  { name: "중급", range: [34, 43] },
  { name: "고급", range: [44, 55] },
];

/** 메뉴 안의 묶음: 이름, 아이콘, 어떤 글이 들어가는지 (위에서부터 먼저 맞는 묶음) */
const GROUPS: Record<string, { name: string; icon: string; match: (t: string) => boolean }[]> = {
  "인던 · 길드던전": [
    { name: "인스턴스 던전", icon: "🏰", match: (t) => /인던|인스턴스/.test(t) },
    { name: "길드던전", icon: "👑", match: (t) => /길드던전|길던/.test(t) },
  ],
  "전장 · 헌팅그라운드": [
    { name: "전장", icon: "⚔️", match: (t) => /전장|점령전/.test(t) },
    { name: "헌팅그라운드", icon: "🏹", match: (t) => /헌팅그라운드/.test(t) },
  ],
  "퀘스트 · 지도": [
    { name: "퀘스트", icon: "📜", match: (t) => /퀘스트/.test(t) },
    { name: "지도", icon: "🗺️", match: () => true },
  ],
};

/** 카드 아이콘 (제목 낱말로) */
const ICONS: [RegExp, string][] = [
  [/의상/, "👘"],
  [/조합/, "📕"],
  [/강화/, "⚒️"],
  [/보석/, "💎"],
  [/성장|계산기/, "📈"],
  [/유니크/, "✨"],
  [/공략표/, "📋"],
  [/리에티|전지의관/, "👑"],
  [/스펙/, "📊"],
  [/mp4|빌드/i, "🎬"],
  [/맞는법/, "🛡️"],
  [/점령전/, "🏯"],
  [/전장/, "⚔️"],
  [/거점|평야|습지/, "🏹"],
  [/퀘스트/, "📜"],
  [/지도|필드|구역|금서고/, "🗺️"],
  [/무기/, "🗡️"],
];
const iconOf = (t: string) => ICONS.find(([re]) => re.test(t))?.[1] ?? "📄";

/** 카드 글자: 영어 이름과 [말머리]는 아래 작은 글씨로 */
function labelOf(title: string): { label: string; sub: string } {
  const t = title.replace(/\s*_ReMAKE$/, "");
  const subs: string[] = [];
  const label = t
    .replace(/^\[([^\]]+)\]\s*/, (_, s: string) => (subs.push(s), ""))
    .replace(/\s*\(\(?([A-Za-z][^)]*)\)?\)/g, (_, s: string) => (subs.push(s.trim()), ""))
    .replace(/\s+/g, " ")
    .trim();
  return { label: label || t, sub: subs.join(" · ") };
}

/** 공략 제목의 레벨 범위 ('… Lv. 34～43' -> [34, 43]) */
function rangeOf(title: string): [number, number] | null {
  const m = title.match(/Lv\.?\s*(\d{1,3})\s*[～~-]\s*(\d{1,3})/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 글로 가는 링크: 원글에서만 보는 글(공략 글, 지도·스샷뿐인 글)은 카페 원글로 바로 (새 창), 나머지는 위키 글 화면 */
type LinkTo = (id: string) => { href: string; target?: string; rel?: string };
/** 원글로 바로 가는 글은 단추에 '원글 ↗' (제작자 요청 2026-11-01: 바로 원글 가는 건 단추에 써 놓고) */
const Out = ({ to, id }: { to: LinkTo; id: string }) => (to(id).target ? <i className="mn-out">원글 ↗</i> : null);

export function MenuPage({ wiki, title, me }: { wiki: Wiki; title: string; me?: Me }) {
  const sec = wiki.menu.find((m) => m.title === title);
  if (!sec) return <NotFound what="메뉴" />;
  const myJob = me?.job ? JOB_NAME[me.job] : null;
  const to: LinkTo = (id) => (isOriginalOnly(wiki, id) ? { href: cafeUrl(id), target: "_blank", rel: "noopener noreferrer" } : { href: "#/post/" + id });
  const body =
    title === "육성 공략" ? (
      <GuideJobs items={sec.posts} myJob={myJob} myLevel={me?.level ?? null} to={to} />
    ) : title === "직업별 스킬" ? (
      <SkillJobs items={sec.posts} myJob={myJob} to={to} />
    ) : (
      <Grouped items={sec.posts} groups={GROUPS[title]} to={to} />
    );
  return (
    <>
      <TopBar title={title} />
      {body}
    </>
  );
}

/** 직업 순서: 내 직업이 맨 위 */
const jobOrder = (myJob: string | null) => (myJob ? [myJob, ...JOBS.filter((j) => j !== myJob)] : JOBS);

function JobMark({ job, size }: { job: string; size: number }) {
  const code = JOB_OF[job];
  return <span className={"mn-mark mn-mark-" + code}>{code && <JobGlyph job={code} size={size} />}</span>;
}

/** 육성 공략: 직업 카드마다 초급·중급·고급 단추. 아직 없는 단계는 '준비 중' */
function GuideJobs({ items, myJob, myLevel, to }: { items: Item[]; myJob: string | null; myLevel: number | null; to: LinkTo }) {
  return (
    <div className="mn-jobs">
      {jobOrder(myJob).map((job) => {
        const mine = job === myJob;
        return (
          <section key={job} className={"panel mn-job" + (mine ? " mn-mine" : "")}>
            <header className="mn-job-head">
              <JobMark job={job} size={26} />
              <b>{job}</b>
              {mine && <em className="mn-tag">내 직업</em>}
            </header>
            <div className="mn-stages">
              {STAGES.map((st) => {
                const p = items.find((x) => x.title.includes(job) && x.title.includes(st.name));
                const [lo, hi] = (p && rangeOf(p.title)) || st.range;
                const here = mine && myLevel !== null && lo <= myLevel && myLevel <= hi;
                return p ? (
                  <a key={st.name} className={"mn-stage" + (here ? " mn-here" : "")} {...to(p.id)}>
                    {here && <em className="mn-here-tag">내 레벨</em>}
                    <Out to={to} id={p.id} />
                    <b>{st.name}</b>
                    <small>
                      Lv.{lo}~{hi}
                    </small>
                  </a>
                ) : (
                  <span key={st.name} className="mn-stage mn-soon">
                    <b>{st.name}</b>
                    <small>준비 중</small>
                  </span>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 직업별 스킬: 직업 카드 네 장 */
function SkillJobs({ items, myJob, to }: { items: Item[]; myJob: string | null; to: LinkTo }) {
  return (
    <div className="mn-skill-grid">
      {jobOrder(myJob).map((job) => {
        const p = items.find((x) => x.title.includes(job));
        if (!p) return null;
        const date = p.title.match(/\((\d{2}\.\d{2}\.\d{2})\)/)?.[1];
        return (
          <a key={job} className={"card mn-skill" + (job === myJob ? " mn-mine" : "")} {...to(p.id)}>
            {job === myJob && <em className="mn-tag mn-skill-tag">내 직업</em>}
            <JobMark job={job} size={34} />
            <b>{job} 스킬</b>
            {date && <small>{date} 기준</small>}
          </a>
        );
      })}
    </div>
  );
}

/** 묶음마다 아이콘 카드. 묶음이 없는 메뉴는 카드만, 인던 보물은 숫자 단추 한 줄 */
function Grouped({ items, groups, to }: { items: Item[]; groups?: { name: string; icon: string; match: (t: string) => boolean }[]; to: LinkTo }) {
  const left = [...items];
  const take = (match: (t: string) => boolean) => {
    const out: Item[] = [];
    for (let i = 0; i < left.length; ) {
      if (match(left[i].title)) out.push(...left.splice(i, 1));
      else i++;
    }
    return out;
  };
  const sections = (groups ?? []).map((g) => ({ ...g, items: take(g.match) })).filter((g) => g.items.length);
  if (left.length) sections.push({ name: groups ? "그 밖의 글" : "", icon: "", match: () => true, items: left });
  return (
    <>
      {sections.map((g) => {
        const treasure = g.items.filter((x) => /인던보물\d+/.test(x.title));
        const cards = g.items.filter((x) => !treasure.includes(x));
        return (
          <section key={g.name || "all"} className="mn-group">
            {g.name && (
              <h2 className="mn-group-head">
                {g.icon} {g.name} <small>{g.items.length}</small>
              </h2>
            )}
            <div className="mn-cards">
              {cards.map((x) => {
                const { label, sub } = labelOf(x.title);
                return (
                  <a key={x.id} className="card mn-card" {...to(x.id)}>
                    <Out to={to} id={x.id} />
                    <span className="mn-card-icon">{iconOf(x.title)}</span>
                    <span className="mn-card-text">
                      <b>{label}</b>
                      {sub && <small>{sub}</small>}
                    </span>
                  </a>
                );
              })}
            </div>
            {treasure.length > 0 && (
              <div className="card mn-treasure">
                <span className="mn-card-icon">🎁</span>
                <b>인던 보물</b>
                <span className="mn-chips">
                  {treasure.map((x) => (
                    <a key={x.id} className="pill" {...to(x.id)}>
                      {x.title.match(/\d+/)?.[0]}
                    </a>
                  ))}
                </span>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
