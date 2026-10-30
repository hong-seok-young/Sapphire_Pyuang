import { useCallback, useState } from "react";
import { JOBS, JOB_NAME, ROLE_NAME, avatarUrl, expText, fetchRanking } from "../auth";
import type { Job, Me, RankEntry } from "../auth";
import { useAsync } from "../data";
import { JobEmblem, JobTab, MINE_TAG_PIC, PODIUM_PIC, RankMedal, RoleBadge } from "../emblems";
import { Loading, TopBar } from "../ui";

/** 최근 레벨업 표시 기간 */
const RECENT_MS = 7 * 86_400_000;

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

/** 시상대 위 꽃가루 (색, 자리, 늦게 떨어지기를 조금씩 다르게) */
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i * 0.37) % 3,
  color: ["#ffd75e", "#6f8fff", "#ff8fa3", "#7fe0c4", "#c59bff"][i % 5],
}));

/** 시상대 그림(433x465)에서 단 윗면 가운데: 2, 1, 3등 순서 */
const PODIUM_W = 433;
const PODIUM_H = 465;
const SPOTS = [
  { rank: 2, x: 95.5, y: 302 },
  { rank: 1, x: 213, y: 263.5 },
  { rank: 3, x: 331, y: 328.5 },
];
/** 캐릭터가 서는 칸 (시상대 그림 좌표). 발이 단 윗면 가운데에 오게 놓는다 */
const CHAR_W = 120;
const CHAR_H = 132;
const pct = (v: number, of: number) => (v / of) * 100 + "%";

/** 1, 2, 3 등 시상대: 게임 랭킹의 시상대 그림 위에 그 길드원이 올린 캐릭터를 세운다 (없으면 직업 엠블럼) */
function Podium({ top }: { top: Ranked[] }) {
  return (
    <div className="podium" style={{ backgroundImage: `url(${PODIUM_PIC})` }} aria-label="1~3위">
      <div className="confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <i key={i} style={{ left: c.left + "%", animationDelay: c.delay + "s", background: c.color }} />
        ))}
      </div>
      {SPOTS.map((s) => {
        const r = top[s.rank - 1];
        if (!r) return null;
        return (
          <div
            key={r.id}
            className="podium-char"
            style={{
              left: pct(s.x - CHAR_W / 2, PODIUM_W),
              width: pct(CHAR_W, PODIUM_W),
              top: pct(s.y + 5 - CHAR_H, PODIUM_H),
              height: pct(CHAR_H, PODIUM_H),
            }}
          >
            <span className="podium-tag">{r.id}</span>
            {r.avatar ? (
              <img className="podium-avatar" src={avatarUrl(r.id, r.avatar)} alt={r.id} draggable={false} />
            ) : (
              <JobEmblem job={r.job} level={r.level} rank={r.overall} size={52} />
            )}
          </div>
        );
      })}
    </div>
  );
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

/**
 * 길드 레벨 랭킹. 게임의 경험치 랭킹 화면처럼: 직업 필터, 시상대, 1~3위 메달, 맨 아래 '내순위'.
 * 마크와 시상대는 게임 랭킹 스샷에서 자른 그림이다 (emblems.tsx). 레벨, 직업, 경험치는 길드원이 직접 적은 것이고
 * 시상대 캐릭터도 본인이 올린 그림이다 (게임을 읽지 않는다. CLAUDE.md 게임 안전 규칙).
 * 순서는 레벨, 같으면 경험치 %, 그것도 같으면 그 레벨에 먼저 오른 사람 (서버가 이 순서로 준다).
 * 경험치 숫자는 본인 것만 보인다.
 */
export function RankingPage({ me }: { me: Me }) {
  const { data, error } = useAsync(useCallback(() => fetchRanking(), []));
  const [filter, setFilter] = useState<Job | "all">("all");
  if (!data) {
    return (
      <>
        <TopBar title="길드 랭킹" />
        <Loading error={error} />
      </>
    );
  }
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
      <TopBar title="길드 랭킹" />
      <div className="rank-banner">
        <span className="rank-banner-en">RANKING</span>
        <span className="rank-banner-ko">길드 레벨 랭킹</span>
      </div>
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

      <div className="rank-tabs" role="tablist">
        {(["all", ...JOBS] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={filter === t}
            className="rank-tab"
            onClick={() => setFilter(t)}
          >
            <JobTab job={t} on={filter === t} />
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">아직 {filter === "all" ? "" : JOB_NAME[filter] + " "}길드원이 없어요.</div>
      ) : (
        <>
          <Podium top={list.slice(0, 3)} />
          <ul className="rank-list">
            {list.map((r) => (
              <Row key={r.id} r={r} me={me} now={now} />
            ))}
          </ul>
        </>
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
