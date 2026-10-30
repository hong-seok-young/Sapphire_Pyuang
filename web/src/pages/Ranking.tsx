import { useCallback, useState } from "react";
import { JOBS, JOB_NAME, ROLE_NAME, avatarUrl, expText, fetchGrowth, fetchRanking, growthText } from "../auth";
import type { GrowthEntry, GrowthPeriod, Job, Me, RankEntry } from "../auth";
import { useAsync } from "../data";
import { JobEmblem, JobGlyph, MINE_TAG_PIC, RankMedal, RoleBadge } from "../emblems";
import { Loading, TopBar } from "../ui";

/** 최근 레벨업 표시 기간 */
const RECENT_MS = 7 * 86_400_000;

type View = "level" | GrowthPeriod;
const VIEWS: { key: View; label: string }[] = [
  { key: "level", label: "레벨" },
  { key: "day", label: "오늘 성장" },
  { key: "week", label: "주간 성장" },
  { key: "month", label: "월간 성장" },
];
const PERIOD_NAME: Record<GrowthPeriod, string> = { day: "오늘", week: "이번 주", month: "이번 달" };

interface Ranked extends RankEntry {
  /** 지금 보는 목록(직업 필터)에서의 순위 */
  rank: number;
  /** 전체 순위 (엠블럼 색: 1~20위 보라, 21위부터 금색) */
  overall: number;
}

/** 최근 7일 안에 오른 레벨 수 (없으면 0) */
function recentUp(r: RankEntry, now: number): number {
  return r.prevLevel !== null && r.level > r.prevLevel && now - r.levelAt < RECENT_MS ? r.level - r.prevLevel : 0;
}

function Row({ r, me, now }: { r: Ranked; me: Me; now: number }) {
  const up = recentUp(r, now);
  return (
    <li className={"rank-row" + (r.rank <= 3 ? " rank-top-" + r.rank : "") + (r.id === me.id ? " rank-mine" : "")}>
      <span className="rank-cell">
        <RankMedal rank={r.rank} />
      </span>
      <JobEmblem job={r.job} level={r.level} rank={r.overall} size={50} />
      <span className="rank-name">
        <small>
          {ROLE_NAME[r.role]} · {JOB_NAME[r.job]}
        </small>
        <b>{r.id}</b>
      </span>
      {up > 0 && <span className="rank-up">▲{up}</span>}
      <RoleBadge role={r.role} />
    </li>
  );
}

/** 레벨 랭킹: 게임의 경험치 랭킹 목록처럼 (메달, 엠블럼, 맨 아래 '내순위') */
function LevelRanking({ me, data }: { me: Me; data: RankEntry[] }) {
  const [filter, setFilter] = useState<Job | "all">("all");
  const now = Date.now();
  const overall = new Map(data.map((r, i) => [r.id, i + 1]));
  const list: Ranked[] = (filter === "all" ? data : data.filter((r) => r.job === filter)).map((r, i) => ({
    ...r,
    rank: i + 1,
    overall: overall.get(r.id) ?? i + 1,
  }));
  const mine = list.find((r) => r.id === me.id);
  const above = mine && mine.rank > 1 ? list[mine.rank - 2] : undefined;
  const avg = data.length ? Math.round((data.reduce((s, r) => s + r.level, 0) / data.length) * 10) / 10 : 0;
  const ups = data.filter((r) => recentUp(r, now) > 0).length;
  const hint = mine
    ? above
      ? above.level > mine.level
        ? `한 칸 위까지 Lv.+${above.level - mine.level}`
        : "같은 레벨! 경험치를 올려요"
      : "👑 1등!"
    : filter === "all"
      ? "레벨을 정하면 올라가요"
      : "이 직업이 아니에요";

  return (
    <>
      <div className="rank-stats">
        <span>
          👥 <b>{data.length}</b>명
        </span>
        <span>
          평균 <b>Lv.{avg}</b>
        </span>
        <span>
          최고 <b>Lv.{data[0]?.level ?? "-"}</b>
        </span>
        {ups > 0 && (
          <span>
            🔥 이번 주 레벨업 <b>{ups}</b>명
          </span>
        )}
      </div>

      <div className="job-filter" role="tablist" aria-label="직업">
        <button role="tab" aria-selected={filter === "all"} className={"job-chip" + (filter === "all" ? " job-chip-on" : "")} onClick={() => setFilter("all")}>
          <span className="job-chip-all">ALL</span>
          <small>{data.length}</small>
        </button>
        {JOBS.map((j) => (
          <button
            key={j}
            role="tab"
            aria-selected={filter === j}
            className={"job-chip" + (filter === j ? " job-chip-on" : "")}
            onClick={() => setFilter(j)}
          >
            <JobGlyph job={j} size={22} />
            <small>
              {JOB_NAME[j]} {data.filter((r) => r.job === j).length}
            </small>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">아직 {filter === "all" ? "" : JOB_NAME[filter] + " "}길드원이 없어요.</div>
      ) : (
        <ul className="rank-list">
          {list.map((r) => (
            <Row key={r.id} r={r} me={me} now={now} />
          ))}
        </ul>
      )}

      <div className="rank-mine-bar">
        <img className="rank-mine-tag" src={MINE_TAG_PIC} alt="내 순위" draggable={false} />
        <span className="rank-cell">{mine ? <RankMedal rank={mine.rank} /> : <span className="rank-num">-</span>}</span>
        {me.job && me.level ? <JobEmblem job={me.job} level={me.level} rank={overall.get(me.id)} size={50} /> : null}
        <span className="rank-name">
          <small>{me.exp !== null ? `경험치 ${expText(me.exp)}` : hint}</small>
          <b>{me.id}</b>
          {me.exp !== null && <small className="rank-hint">{hint}</small>}
        </span>
        <a className="pill rank-edit" href="#/me">
          레벨업
        </a>
      </div>
      <p className="rank-note">
        레벨, 경험치, 캐릭터 사진은 각자 '내 정보'에서 바꿔요. 경험치 숫자는 본인에게만 보여요. 잘못 적힌 레벨은 오피서에게 말해 주세요.
      </p>
    </>
  );
}

/** 캐릭터 사진이 있으면 사진, 없으면 직업 엠블럼 */
function Face({ e, size }: { e: GrowthEntry; size: number }) {
  return e.avatar ? (
    <img className="growth-face" src={avatarUrl(e.id, e.avatar)} alt="" style={{ maxWidth: size, maxHeight: size }} draggable={false} />
  ) : (
    <JobEmblem job={e.job} level={e.level} size={size} />
  );
}

/** 2026-10-27(월) */
function dayText(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${"일월화수목금토"[d.getDay()]})`;
}

/**
 * 성장 랭킹: 오늘, 이번 주, 이번 달에 오른 만큼 (레벨 1 = 100%). 길드원이 레벨, 경험치를 적을 때마다 남긴 기록으로 센다.
 * 1등은 크게, 캐릭터 사진이 있으면 사진으로 보여 준다. 이 화면은 게임 그림 대신 이 앱 디자인으로 그린다.
 */
function GrowthRanking({ me, period }: { me: Me; period: GrowthPeriod }) {
  const { data, error } = useAsync(useCallback(() => fetchGrowth(period), [period]));
  if (!data) return <Loading error={error} />;
  const [first, ...rest] = data.entries;
  const mine = data.entries.findIndex((e) => e.id === me.id);
  return (
    <>
      <p className="growth-note">
        {period === "day" ? "오늘 0시" : `${dayText(data.start)} 0시`}부터 지금까지 오른 만큼이에요. 레벨, 경험치를 적을 때마다 기록돼요.
      </p>
      {!first ? (
        <div className="empty">{PERIOD_NAME[period]} 아직 오른 사람이 없어요. 레벨업 하면 '내 정보'에서 적어 주세요!</div>
      ) : (
        <>
          <div className="growth-hero">
            <span className="growth-crown">👑 {PERIOD_NAME[period]}의 성장왕</span>
            <span className="growth-hero-face">
              <Face e={first} size={96} />
            </span>
            <b className="growth-hero-name">{first.id}</b>
            <span className="growth-hero-sub">
              {JOB_NAME[first.job]} · Lv.{first.fromLevel}
              {first.level !== first.fromLevel && ` → ${first.level}`}
            </span>
            <span className="growth-hero-value">{growthText(first.growth)}</span>
          </div>
          {rest.length > 0 && (
            <ol className="growth-list">
              {rest.map((e, i) => (
                <li key={e.id} className={"growth-row" + (e.id === me.id ? " growth-mine" : "")}>
                  <span className={"growth-rank growth-rank-" + (i + 2)}>{i + 2}</span>
                  <span className="growth-row-face">
                    <Face e={e} size={40} />
                  </span>
                  <span className="growth-row-name">
                    <b>{e.id}</b>
                    <small>
                      {JOB_NAME[e.job]} · Lv.{e.fromLevel}
                      {e.level !== e.fromLevel && ` → ${e.level}`}
                    </small>
                  </span>
                  <span className="growth-row-value">{growthText(e.growth)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="growth-me">
        {mine >= 0
          ? `내 ${PERIOD_NAME[period]} 성장: ${mine + 1}등 ${growthText(data.entries[mine].growth)}`
          : `${PERIOD_NAME[period]} 내 성장은 아직 없어요.`}{" "}
        <a href="#/me">레벨, 경험치 적기 ▸</a>
      </p>
    </>
  );
}

/**
 * 길드 랭킹. '레벨'은 게임의 경험치 랭킹 화면처럼 (직업 필터, 1~3위 메달, 맨 아래 '내순위'),
 * '오늘, 주간, 월간 성장'은 그 기간에 많이 오른 순서. 레벨, 직업, 경험치, 캐릭터 사진은 길드원이 직접 적고 올린 것이다
 * (게임을 읽지 않는다. CLAUDE.md 게임 안전 규칙). 경험치 숫자는 본인 것만 보이고, 성장 랭킹에는 오른 양만 보인다.
 */
export function RankingPage({ me }: { me: Me }) {
  const { data, error } = useAsync(useCallback(() => fetchRanking(), []));
  const [view, setView] = useState<View>("level");
  return (
    <>
      <TopBar title="길드 랭킹" />
      <div className="rank-banner">
        <span className="rank-banner-en">RANKING</span>
        <span className="rank-banner-ko">길드 랭킹</span>
      </div>
      <div className="rank-views" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={"pill rank-view" + (view === v.key ? " pill-on" : "")}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view !== "level" ? (
        <GrowthRanking me={me} period={view} />
      ) : data ? (
        <LevelRanking me={me} data={data} />
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}
