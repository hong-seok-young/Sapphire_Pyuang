import { useCallback, useState } from "react";
import {
  GUILDS, GUILD_NAME, GUILD_TIER, JOBS, JOB_NAME, avatarUrl, errorText, expText, fetchGrowth, fetchRanking, growthText, saveMyProfile,
} from "../auth";
import type { GrowthEntry, GrowthPeriod, Guild, Job, Me, RankEntry } from "../auth";
import { useAsync } from "../data";
import { JobEmblem, JobGlyph, MINE_TAG_PIC, RankMedal, RoleBadge } from "../emblems";
import { FitLine, Loading, TopBar } from "../ui";

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

/** 길드 고르기: 통합(all), 1군 Sapphire, 2군 FairyTale */
type GuildFilter = Guild | "all";

/** 길드 이름 (예전에 안 고른 사람은 '길드 미정') */
const guildText = (g: Guild | null) => (g ? GUILD_NAME[g] : "길드 미정");

/** 평균 레벨 (한 자리 소수) */
function averageLevel(list: { level: number }[]): number | null {
  return list.length ? Math.round((list.reduce((s, r) => s + r.level, 0) / list.length) * 10) / 10 : null;
}

/**
 * 통합, 1군, 2군 칸: 사람 수와 평균 레벨을 따로 보여 주고, 누르면 그 길드만 본다.
 * withAverage 가 아니면 (성장 랭킹) 사람 수만.
 */
function GuildCards({ items, selected, onSelect, withAverage = true }: {
  items: { guild: Guild | null; level: number }[];
  selected: GuildFilter;
  onSelect: (g: GuildFilter) => void;
  withAverage?: boolean;
}) {
  const card = (key: GuildFilter, title: string, sub: string, list: { level: number }[]) => {
    const avg = averageLevel(list);
    return (
      <button key={key} type="button" className={"guild-stat" + (selected === key ? " guild-stat-on" : "")} aria-pressed={selected === key} onClick={() => onSelect(key)}>
        <b>{title}</b>
        <small>{sub}</small>
        <span>{list.length}명</span>
        {withAverage && <strong>{avg !== null ? `평균 Lv.${avg}` : "-"}</strong>}
      </button>
    );
  };
  return (
    <div className="guild-stats">
      {card("all", "통합", "사파이어 전체", items)}
      {GUILDS.map((g) => card(g, GUILD_TIER[g], GUILD_NAME[g], items.filter((r) => r.guild === g)))}
    </div>
  );
}

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
          {guildText(r.guild)} · {JOB_NAME[r.job]}
        </small>
        {/* 닉네임은 10글자까지: 넘치면 글자를 줄여서 한 줄에 다 보인다 (자르지 않는다) */}
        <FitLine className="rank-nick" text={r.id} wrap={false} />
        <ExpBar r={r} mine={r.id === me.id} />
      </span>
      {/* 레벨업 표시 자리는 늘 비워 두어서 표시가 떠도 닉네임이 밀리지 않는다 */}
      <span className="rank-up-slot">{up > 0 && <span className="rank-up">▲{up}</span>}</span>
      <RoleBadge role={r.role} />
    </li>
  );
}

/**
 * 닉네임 아래 경험치 막대 (0~100%, 제작자 요청). 안 적었으면 막대 없이 '경험치 입력 안 했어요'.
 * 내 줄이면 눌러서 랭킹 화면에서 바로 적는다 (직업, 레벨, 길드는 그대로 두고 경험치만 저장)
 */
function ExpBar({ r, mine }: { r: Ranked; mine: boolean }) {
  const [exp, setExp] = useState<number | null>(r.exp ?? null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.exp != null ? (r.exp / 1000).toFixed(3) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^\d{1,2}(\.\d{1,3})?$/.test(text.trim());

  async function save() {
    if (!valid || !r.guild) return;
    const value = Math.round(Number(text) * 1000);
    setBusy(true);
    setError("");
    try {
      await saveMyProfile(r.job, r.level, value, r.guild);
      setExp(value);
      setEditing(false);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="rank-exp-edit">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
          placeholder="12.345"
          aria-label="경험치 퍼센트"
          autoFocus
        />
        <b>%</b>
        <button disabled={busy || !valid} onClick={save}>
          저장
        </button>
        <button onClick={() => setEditing(false)}>취소</button>
        {error && <small className="rank-exp-error">{error}</small>}
      </span>
    );
  }
  const bar =
    exp !== null ? (
      <span className="rank-exp">
        <span className="rank-exp-track">
          <i style={{ width: `${Math.min(100, exp / 1000)}%` }} />
        </span>
        <small>{expText(exp)}</small>
      </span>
    ) : (
      <small className="rank-exp-none">경험치 입력 안 했어요</small>
    );
  return mine ? (
    <button className="rank-exp-btn" onClick={() => setEditing(true)} aria-label="경험치 입력">
      {bar}
    </button>
  ) : (
    bar
  );
}

/** 레벨 랭킹: 게임의 경험치 랭킹 목록처럼 (메달, 엠블럼, 맨 아래 '내순위'). 길드(통합/1군/2군)와 직업으로 거른다 */
function LevelRanking({ me, data, guild, onGuild }: { me: Me; data: RankEntry[]; guild: GuildFilter; onGuild: (g: GuildFilter) => void }) {
  const [filter, setFilter] = useState<Job | "all">("all");
  const now = Date.now();
  const overall = new Map(data.map((r, i) => [r.id, i + 1]));
  const inGuild = guild === "all" ? data : data.filter((r) => r.guild === guild);
  const list: Ranked[] = (filter === "all" ? inGuild : inGuild.filter((r) => r.job === filter)).map((r, i) => ({
    ...r,
    rank: i + 1,
    overall: overall.get(r.id) ?? i + 1,
  }));
  const mine = list.find((r) => r.id === me.id);
  const above = mine && mine.rank > 1 ? list[mine.rank - 2] : undefined;
  const ups = inGuild.filter((r) => recentUp(r, now) > 0).length;
  const hint = mine
    ? above
      ? above.level > mine.level
        ? `한 칸 위까지 Lv.+${above.level - mine.level}`
        : "같은 레벨! 경험치를 올려요"
      : "👑 1등!"
    : guild !== "all" && me.guild !== guild
      ? `${GUILD_TIER[guild]}이 아니에요`
      : filter === "all"
        ? "레벨을 정하면 올라가요"
        : "이 직업이 아니에요";

  return (
    <>
      <GuildCards items={data} selected={guild} onSelect={onGuild} />
      <div className="rank-stats">
        <span>
          최고 <b>Lv.{inGuild[0]?.level ?? "-"}</b>
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
          <small>{inGuild.length}</small>
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
              {JOB_NAME[j]} {inGuild.filter((r) => r.job === j).length}
            </small>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          아직 {guild === "all" ? "" : GUILD_NAME[guild] + " "}
          {filter === "all" ? "" : JOB_NAME[filter] + " "}길드원이 없어요.
        </div>
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
          <FitLine className="rank-nick" text={me.id} wrap={false} />
          {me.exp !== null && <small className="rank-hint">{hint}</small>}
        </span>
        <a className="pill rank-edit" href="#/me">
          레벨업
        </a>
      </div>
      <p className="rank-note">
        레벨, 경험치, 캐릭터 사진은 각자 '내 정보'에서 바꿔요. 잘못 적힌 레벨은 오피서에게 말해 주세요.
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
function GrowthRanking({ me, period, guild, onGuild }: { me: Me; period: GrowthPeriod; guild: GuildFilter; onGuild: (g: GuildFilter) => void }) {
  const { data, error } = useAsync(useCallback(() => fetchGrowth(period), [period]));
  if (!data) return <Loading error={error} />;
  const entries = guild === "all" ? data.entries : data.entries.filter((e) => e.guild === guild);
  const [first, ...rest] = entries;
  const mine = entries.findIndex((e) => e.id === me.id);
  return (
    <>
      <GuildCards items={data.entries} selected={guild} onSelect={onGuild} withAverage={false} />
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
            <FitLine className="growth-hero-name" text={first.id} wrap={false} />
            <span className="growth-hero-sub">
              {guildText(first.guild)} · {JOB_NAME[first.job]} · Lv.{first.fromLevel}
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
                    <FitLine className="growth-nick" text={e.id} wrap={false} />
                    <small>
                      {guildText(e.guild)} · {JOB_NAME[e.job]} · Lv.{e.fromLevel}
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
          ? `내 ${PERIOD_NAME[period]} 성장: ${mine + 1}등 ${growthText(entries[mine].growth)}`
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
  const [guild, setGuild] = useState<GuildFilter>("all");
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
        <GrowthRanking me={me} period={view} guild={guild} onGuild={setGuild} />
      ) : data ? (
        <LevelRanking me={me} data={data} guild={guild} onGuild={setGuild} />
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}
