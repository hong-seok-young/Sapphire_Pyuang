import { Fragment, useCallback, useEffect, useState } from "react";
import { useEntryState } from "../router";
import {
  GUILDS, GUILD_NAME, GUILD_TIER, JOBS, JOB_NAME, avatarUrl, errorText, expText, fetchGrowth, fetchRanking, growthText, saveMyProfile,
} from "../auth";
import type { ChangeKind, GrowthEntry, GrowthPeriod, Guild, Job, Me, RankEntry } from "../auth";
import { useAsync } from "../data";
import { JobEmblem, JobGlyph, MINE_TAG_PIC, RankMedal, RoleBadge } from "../emblems";
import { ChangeAsk, FitLine, Loading, TopBar } from "../ui";
import { weekStart } from "../week";
import { GrowthChart } from "./GrowthChart";
import { HeroHalo } from "../heroHalo";
import { useBackClose } from "../backClose";


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

/** 길드 칸, 직업 단추의 '평균 Lv.46.5' (아무도 없으면 '-') */
function avgText(list: { level: number }[]): string {
  const avg = averageLevel(list);
  return avg !== null ? `평균 Lv.${avg}` : "-";
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
    return (
      <button key={key} type="button" className={"guild-stat" + (selected === key ? " guild-stat-on" : "")} aria-pressed={selected === key} onClick={() => onSelect(key)}>
        <b>{title}</b>
        <small>{sub}</small>
        <span>{list.length}명</span>
        {withAverage && <strong>{avgText(list)}</strong>}
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

/** 경험치 오른 만큼: 2 / 0.5 / 0.12 처럼 짧게 (자리가 좁다) */
function expUpText(v: number): string {
  const pct = v / 1000;
  if (pct >= 10) return String(Math.round(pct));
  if (pct >= 1) return String(Math.round(pct * 10) / 10);
  return String(Math.max(0.01, Math.round(pct * 100) / 100));
}

/** 이번 주(목요일 오전 10시부터, 제작자 요청)에 오른 레벨 수 (없으면 0). 다음 목요일 10시에 표시가 사라진다 */
function recentUp(r: RankEntry, now: number): number {
  return r.prevLevel !== null && r.level > r.prevLevel && r.levelAt >= weekStart(now) ? r.level - r.prevLevel : 0;
}

/** 닉네임. 고스펙은 글자 색은 그대로 두고 글자에만 반짝임이 늘 흐른다 (제작자 요청) */
function Nick({ id, high, className }: { id: string; high?: boolean; className: string }) {
  return <FitLine className={className + (high ? " hs-text" : "")} text={id} wrap={false} />;
}

/** 누르면 아래에 레벨·경험치 그래프가 펼쳐지는 닉네임 (제작자 요청 2026-10-31) */
function NickButton({ open, onToggle, ...nick }: { id: string; high?: boolean; className: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={"nick-btn" + (open ? " nick-btn-open" : "")} aria-expanded={open} onClick={onToggle}>
      <Nick {...nick} />
    </button>
  );
}

function Row({ r, me, now, open, onToggle, onMe, onSaved }: {
  r: Ranked; me: Me; now: number; open: boolean; onToggle: () => void; onMe?: (p: Partial<Me>) => void; onSaved?: () => void;
}) {
  const up = recentUp(r, now);
  return (
    <li className={"rank-row" + (r.rank <= 3 ? " rank-top-" + r.rank : "") + (r.id === me.id ? " rank-mine" : "")}>
      <span className="rank-cell">
        <RankMedal rank={r.rank} />
      </span>
      <JobEmblem job={r.job} level={r.level} rank={r.overall} size={50} />
      <span className="rank-name">
        {/* 작은 글씨도 한 줄에 (넘치면 글자를 줄인다): 줄 높이가 사람마다 달라지지 않게 */}
        <FitLine className="rank-sub" text={`${guildText(r.guild)} · ${JOB_NAME[r.job]}`} wrap={false} />
        {/* 닉네임은 10글자까지: 넘치면 글자를 줄여서 한 줄에 다 보인다 (자르지 않는다) */}
        <NickButton className="rank-nick" id={r.id} high={r.highSpec} open={open} onToggle={onToggle} />
        <ExpBar r={r} mine={r.id === me.id} onMe={onMe} onSaved={onSaved} />
      </span>
      {/* 레벨업 표시 자리는 늘 비워 두어서 표시가 떠도 닉네임이 밀리지 않는다 */}
      <span className="rank-up-slot">
        {up > 0 && <span className="rank-up">▲{up}</span>}
        {/* 이번 주 오른 경험치 '+2%' (제작자 요청, 실제 성장으로 저장한 것만). 레벨업했으면 그 레벨에 올라온 뒤 오른 만큼을 ▲ 아래에
            (2026-11-02 제작자: '1업 한 사람은 경험치를 더 올려도 1업했다고만 뜬다') */}
        {!!r.expUp && <span className="rank-up rank-exp-up">+{expUpText(r.expUp)}%</span>}
      </span>
      <RoleBadge role={r.role} />
    </li>
  );
}

/**
 * 닉네임 아래 경험치 막대 (0~100%, 제작자 요청). 안 적었으면 막대 없이 '경험치 입력 안 했어요'.
 * 내 줄이면 눌러서 랭킹 화면에서 바로 적는다 (직업, 레벨, 길드는 그대로 두고 경험치만 저장).
 * 저장하면 목록을 다시 받는다 (onSaved): 이번 주 '+N%' 는 서버가 셈해서, 안 받으면 저장 전 값이 남았다 (2026-11-05 제작자 '50% 했는데 왜 우측에 안 뜸')
 */
function ExpBar({ r, mine, onMe, onSaved }: { r: Ranked; mine: boolean; onMe?: (p: Partial<Me>) => void; onSaved?: () => void }) {
  const [exp, setExp] = useState<number | null>(r.exp ?? null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.exp != null ? (r.exp / 1000).toFixed(3) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const valid = /^\d{1,2}(\.\d{1,3})?$/.test(text.trim());
  // 목록을 새로 받으면 그 값으로 (2026-11-09 제작자: 내 정보에서 36 0% 로 바꾸고 랭킹에 오니 35 때 경험치가 남아 있었다.
  // 다시 열 때 받아 둔 예전 목록으로 먼저 그리는데, 처음 그린 값을 붙잡고 있어서 새 목록이 와도 안 바뀌었다)
  useEffect(() => {
    setExp(r.exp ?? null);
  }, [r.exp, r.level]);

  async function save(change?: ChangeKind) {
    if (!valid || !r.guild) return;
    const value = Math.round(Number(text) * 1000);
    // 이미 적은 경험치를 바꾸면 실제로 오른 것인지 잘못 쓴 것을 고친 것인지 먼저 묻는다 (제작자 요청)
    if (!change && exp !== null && value !== exp) {
      setAsking(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveMyProfile(r.job, r.level, value, r.guild, change);
      onMe?.({ exp: value });
      setAsking(false);
      setExp(value);
      setEditing(false);
      onSaved?.();
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
        {asking ? (
          <ChangeAsk compact busy={busy} onPick={(c) => save(c)} onCancel={() => setAsking(false)} />
        ) : (
          <>
            <button disabled={busy || !valid} onClick={() => save()}>
              저장
            </button>
            <button onClick={() => setEditing(false)}>취소</button>
          </>
        )}
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
      <small className="rank-exp-none">경험치 미입력</small>
    );
  return mine ? (
    <button
      className="rank-exp-btn"
      onClick={() => {
        setText(exp !== null ? (exp / 1000).toFixed(3) : "");
        setEditing(true);
      }}
      aria-label="경험치 입력"
    >
      {bar}
    </button>
  ) : (
    bar
  );
}

/**
 * 맨 아래 '성장반영' 칸 (제작자 2026-11-09 '랭킹에서 레벨업 버튼을 성장반영으로'): 레벨(− +)과 경험치를 랭킹에서 바로 적는다 (제작자 2026-11-09 '여기 자체에서 레벨업과 경치 둘 다 적게해줘, 내정보로 가게 하지말고').
 * 레벨을 올리면 경험치는 0% 로 바뀐다 (그 레벨에서 다시 시작하니까). 이미 적은 값을 바꾸면 내 정보처럼 '실제 성장 / 오타 수정'을 묻는다
 */
function LevelEditor({ me, onMe, onSaved, onClose }: { me: Me; onMe?: (p: Partial<Me>) => void; onSaved?: () => void; onClose: () => void }) {
  const cur = me.level ?? 1;
  const [level, setLevel] = useState(cur);
  const [text, setText] = useState(me.exp !== null ? (me.exp / 1000).toFixed(3) : "");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackClose(true, onClose);
  const validExp = text.trim() === "" || /^\d{1,2}(\.\d{1,3})?$/.test(text.trim());
  const exp = text.trim() === "" ? null : Math.round(Number(text) * 1000);
  const changed = level !== cur || exp !== me.exp;

  function step(d: number) {
    const next = Math.min(99, Math.max(1, level + d));
    setLevel(next);
    setAsking(false);
    // 레벨이 바뀌면 경험치는 그 레벨의 0% 부터 (원래 레벨로 돌아오면 원래 경험치)
    setText(next === cur ? (me.exp !== null ? (me.exp / 1000).toFixed(3) : "") : "0.000");
  }

  async function save(change?: ChangeKind) {
    if (!me.job || !me.guild || !validExp || !changed) return;
    // 이미 적은 값이 있었으면 실제로 오른 것인지 잘못 쓴 것을 고친 것인지 묻는다 (제작자 요청, 내 정보와 같다)
    if (!change && (me.level !== null || me.exp !== null)) {
      setAsking(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveMyProfile(me.job, level, exp, me.guild, change);
      onMe?.({ level, exp });
      onSaved?.();
      onClose();
    } catch (x) {
      setError(errorText(x));
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  // 한 줄로 촘촘히 (제작자 2026-11-09 '성장치 적는 팝업 좀 더 콤팩트하게, 큼직하고 너저분해', '0퍼부터 이런 설명 빼고'): Lv − 36 + · 경험치 % · 저장 ✕.
  // 저장을 누르면 그 자리가 '실제 성장 / 오타 수정' 두 단추로 바뀐다
  return (
    <div className="rank-lv-edit">
      <span className="rank-lv-step">
        <button type="button" onClick={() => step(-1)} disabled={busy || level <= 1} aria-label="레벨 내리기">
          −
        </button>
        <b key={level} className={level > cur ? "rank-lv-up" : ""}>
          <small>Lv</small>
          {level}
        </b>
        <button type="button" onClick={() => step(1)} disabled={busy || level >= 99} aria-label="레벨 올리기">
          +
        </button>
      </span>
      <span className="rank-lv-exp">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/[^\d.]/g, "").slice(0, 6));
            setAsking(false);
          }}
          placeholder="0.000"
          aria-label="경험치 퍼센트"
        />
        <b>%</b>
      </span>
      <span className="rank-lv-actions">
        {asking ? (
          <>
            <button type="button" className="rank-lv-save" disabled={busy} onClick={() => save("grow")}>
              실제 성장
            </button>
            <button type="button" disabled={busy} onClick={() => save("fix")}>
              오타 수정
            </button>
          </>
        ) : (
          <button type="button" className="rank-lv-save" disabled={busy || !validExp || !changed} onClick={() => save()}>
            {busy ? "…" : "저장"}
          </button>
        )}
        <button type="button" className="rank-lv-x" onClick={asking ? () => setAsking(false) : onClose} aria-label={asking ? "취소" : "닫기"}>
          ✕
        </button>
      </span>
      {error && <small className="rank-exp-error">{error}</small>}
    </div>
  );
}

/** 레벨 랭킹: 게임의 경험치 랭킹 목록처럼 (메달, 엠블럼, 맨 아래 '내순위'). 길드(통합/1군/2군)와 직업으로 거른다 */
function LevelRanking({ me, data, guild, onGuild, onMe, onSaved, saved, editOpen, onEdit }: {
  me: Me; data: RankEntry[]; guild: GuildFilter; onGuild: (g: GuildFilter) => void; onMe?: (p: Partial<Me>) => void;
  /** 맨 아래 '성장반영' 칸 (레벨·경험치를 여기서 바로 적는다) */
  editOpen: boolean; onEdit: (open: boolean) => void;
  /** 내 경험치를 저장했을 때 (목록 다시 받기), saved 는 저장한 횟수 (펼친 그래프도 다시 받는다) */
  onSaved?: () => void; saved?: number;
}) {
  const [filter, setFilter] = useEntryState<Job | "all">("job", "all");
  const [openId, setOpenId] = useState<string | null>(null);
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
      {/* 아래 단계(길드, 직업)는 어두운 띠 안의 납작한 단추: 위 단계(레벨·성장)와 상하위가 구분되게 (제작자 요청 2026-11-02) */}
      <div className="rank-filters">
        <GuildCards items={data} selected={guild} onSelect={onGuild} />
        {/* 직업마다 사람 수와 평균 레벨 (제작자 요청 2026-11-01, 고른 길드 안에서) */}
        <div className="job-filter" role="tablist" aria-label="직업">
          <button role="tab" aria-selected={filter === "all"} className={"job-chip" + (filter === "all" ? " job-chip-on" : "")} onClick={() => setFilter("all")}>
            <span className="job-chip-all">ALL</span>
            <small>{inGuild.length}</small>
            <small className="job-chip-avg">{avgText(inGuild)}</small>
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
              <small className="job-chip-avg">{avgText(inGuild.filter((r) => r.job === j))}</small>
            </button>
          ))}
        </div>
      </div>
      {/* '최고 Lv.' 줄은 뺐다 (제작자 요청 2026-11-02) */}
      {ups > 0 && (
        <div className="rank-stats">
          <span>
            🔥 이번 주 레벨업 <b>{ups}</b>명
          </span>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">
          아직 {guild === "all" ? "" : GUILD_NAME[guild] + " "}
          {filter === "all" ? "" : JOB_NAME[filter] + " "}길드원이 없어요.
        </div>
      ) : (
        <ul className="rank-list">
          {list.map((r) => (
            <Fragment key={r.id}>
              <Row r={r} me={me} now={now} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} onMe={onMe} onSaved={onSaved} />
              {openId === r.id && (
                <li className="rank-chart">
                  <GrowthChart key={saved} id={r.id} />
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}

      <div className="rank-mine-wrap">
      {editOpen && <LevelEditor me={me} onMe={onMe} onSaved={onSaved} onClose={() => onEdit(false)} />}
      <div className="rank-mine-bar">
        <img className="rank-mine-tag" src={MINE_TAG_PIC} alt="내 순위" draggable={false} />
        <span className="rank-cell">{mine ? <RankMedal rank={mine.rank} /> : <span className="rank-num">-</span>}</span>
        {me.job && me.level ? <JobEmblem job={me.job} level={me.level} rank={overall.get(me.id)} size={50} /> : null}
        <span className="rank-name">
          <small>{me.exp !== null ? `경험치 ${expText(me.exp)}` : hint}</small>
          <Nick className="rank-nick" id={me.id} high={mine?.highSpec} />
          {me.exp !== null && <small className="rank-hint">{hint}</small>}
        </span>
        {/* 레벨·경험치는 여기서 바로 (제작자 2026-11-09 '여기 자체에서 레벨업과 경치 둘 다 적게, 내 정보로 가게 하지 말고') */}
        <button className={"pill rank-edit" + (editOpen ? " pill-on" : "")} onClick={() => onEdit(!editOpen)} disabled={!me.job || !me.guild}>
          성장반영
        </button>
      </div>
      </div>
      <p className="rank-note">
        닉네임을 누르면 레벨·경험치 그래프가 보여요. 내 레벨·경험치는 아래 '성장반영'이나 내 경험치 막대를 눌러 바로 적어요. 잘못 적힌 레벨은 오피서에게 말해 주세요.
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
/** 한국 시간 '10/29(목) 10:00' */
function whenText(t: number): string {
  const d = new Date(t + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]}) ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 기간이 끝나는 때: 오늘은 다음 날 0시, 주간은 다음 목요일 오전 10시, 월간은 다음 달 1일 0시 (한국 시간) */
function periodEnd(period: GrowthPeriod, start: number): number {
  if (period === "day") return start + 86_400_000;
  if (period === "week") return start + 7 * 86_400_000;
  const d = new Date(start + 9 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 9 * 3_600_000;
}

/**
 * 성장 랭킹: 오늘, 이번 주, 이번 달에 오른 만큼 (레벨 1 = 100%). 길드원이 레벨, 경험치를 적을 때마다 남긴 기록으로 센다.
 * 1등은 크게, 캐릭터 사진이 있으면 사진으로 보여 준다. 이 화면은 게임 그림 대신 이 앱 디자인으로 그린다.
 */
function GrowthRanking({ me, period, guild, onGuild, onEdit }: { me: Me; period: GrowthPeriod; guild: GuildFilter; onGuild: (g: GuildFilter) => void; onEdit: () => void }) {
  const { data, error } = useAsync(useCallback(() => fetchGrowth(period), [period]), `growth:${period}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId(openId === id ? null : id);
  if (!data || data.period !== period) return <Loading error={error} />;
  const entries = guild === "all" ? data.entries : data.entries.filter((e) => e.guild === guild);
  const [first, ...rest] = entries;
  const mine = entries.findIndex((e) => e.id === me.id);
  return (
    <>
      <div className="rank-filters">
        <GuildCards items={data.entries} selected={guild} onSelect={onGuild} withAverage={false} />
      </div>
      {/* 기간만 딱 (제작자 요청 2026-11-02: 설명은 빼고 언제부터 언제까지만) */}
      <p className="growth-note">
        {whenText(data.start)} ~ {whenText(periodEnd(period, data.start))}
      </p>
      {!first ? (
        <div className="empty">{PERIOD_NAME[period]} 아직 오른 사람이 없어요. 레벨업 하면 레벨 칸 아래 '성장반영'에서 적어 주세요!</div>
      ) : (
        <>
          <div className="growth-hero">
            <span className="growth-crown">👑 {PERIOD_NAME[period]}의 성장왕</span>
            <span className="growth-hero-face">
              <HeroHalo />
              <span className="gh-who">
                <Face e={first} size={96} />
              </span>
            </span>
            <NickButton className="growth-hero-name" id={first.id} high={first.highSpec} open={openId === first.id} onToggle={() => toggle(first.id)} />
            <span className="growth-hero-sub">
              {guildText(first.guild)} · {JOB_NAME[first.job]} · Lv.{first.fromLevel}
              {first.level !== first.fromLevel && ` → ${first.level}`}
            </span>
            <span className="growth-hero-value">{growthText(first.growth)}</span>
          </div>
          {openId === first.id && <GrowthChart id={first.id} />}
          {rest.length > 0 && (
            <ol className="growth-list">
              {rest.map((e, i) => (
                <Fragment key={e.id}>
                  <li className={"growth-row" + (e.id === me.id ? " growth-mine" : "")}>
                    <span className={"growth-rank growth-rank-" + (i + 2)}>{i + 2}</span>
                    <span className="growth-row-face">
                      <Face e={e} size={40} />
                    </span>
                    <span className="growth-row-name">
                      <NickButton className="growth-nick" id={e.id} high={e.highSpec} open={openId === e.id} onToggle={() => toggle(e.id)} />
                      <small>
                        {guildText(e.guild)} · {JOB_NAME[e.job]} · Lv.{e.fromLevel}
                        {e.level !== e.fromLevel && ` → ${e.level}`}
                      </small>
                    </span>
                    <span className="growth-row-value">{growthText(e.growth)}</span>
                  </li>
                  {openId === e.id && (
                    <li className="rank-chart">
                      <GrowthChart id={e.id} />
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="growth-me">
        {mine >= 0
          ? `내 ${PERIOD_NAME[period]} 성장: ${mine + 1}등 ${growthText(entries[mine].growth)}`
          : `${PERIOD_NAME[period]} 내 성장은 아직 없어요.`}{" "}
        <button className="growth-me-edit" onClick={onEdit}>
          레벨, 경험치 적기 ▸
        </button>
      </p>
    </>
  );
}

/**
 * 길드 랭킹. '레벨'은 게임의 경험치 랭킹 화면처럼 (직업 필터, 1~3위 메달, 맨 아래 '내순위'),
 * '오늘, 주간, 월간 성장'은 그 기간에 많이 오른 순서. 레벨, 직업, 경험치, 캐릭터 사진은 길드원이 직접 적고 올린 것이다
 * (게임을 읽지 않는다. CLAUDE.md 게임 안전 규칙). 경험치는 모두에게 보인다 (제작자 요청). 닉네임을 누르면
 * 그 사람의 레벨·경험치 그래프가 그 줄 아래에 펼쳐진다 (GrowthChart).
 */

export function RankingPage({ me, onMe }: { me: Me; onMe?: (p: Partial<Me>) => void }) {
  const [saved, setSaved] = useState(0);
  // saved 가 바뀌면 다시 받는다 (그동안은 받아 둔 목록 그대로)
  const { data, error } = useAsync(useCallback(() => fetchRanking(), [saved]), "ranking");
  const [view, setView] = useEntryState<View>("view", "level");
  const [guild, setGuild] = useEntryState<GuildFilter>("guild", "all");
  const [editMe, setEditMe] = useState(false);
  return (
    <>
      <TopBar title="길드 랭킹" />
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
        <GrowthRanking
          me={me}
          period={view}
          guild={guild}
          onGuild={setGuild}
          onEdit={() => {
            setView("level");
            setEditMe(true);
          }}
        />
      ) : data ? (
        <LevelRanking
          me={me}
          data={data}
          guild={guild}
          onGuild={setGuild}
          onMe={onMe}
          onSaved={() => setSaved((n) => n + 1)}
          saved={saved}
          editOpen={editMe}
          onEdit={setEditMe}
        />
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}
