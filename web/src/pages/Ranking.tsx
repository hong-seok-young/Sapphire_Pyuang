import { useCallback, useState } from "react";
import { JOBS, JOB_NAME, ROLE_NAME, fetchRanking } from "../auth";
import type { Job, Me, RankEntry } from "../auth";
import { useAsync } from "../data";
import { JobEmblem, JobIcon, RankMedal, RoleBadge } from "../emblems";
import { Loading, TopBar } from "../ui";

/** 최근 레벨업 표시 기간 */
const RECENT_MS = 7 * 86_400_000;

interface Ranked extends RankEntry {
  rank: number;
}

/** 레벨 높은 순, 같은 레벨이면 그 레벨을 먼저 적은 사람이 위 (서버가 이 순서로 준다) */
const ranked = (list: RankEntry[]): Ranked[] => list.map((r, i) => ({ ...r, rank: i + 1 }));

/** 최근 7일 안에 오른 레벨 수 (없으면 0) */
function recentUp(r: RankEntry, now: number): number {
  return r.prevLevel !== null && r.level > r.prevLevel && now - r.levelAt < RECENT_MS ? r.level - r.prevLevel : 0;
}

/** 시상대 위 꽃가루 (색, 자리, 늦게 떨어지기를 조금씩 다르게) */
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i * 0.37) % 3,
  color: ["#ffd75e", "#6f8fff", "#ff8fa3", "#7fe0c4", "#c59bff"][i % 5],
}));

/** 1, 2, 3 등 시상대 */
function Podium({ top }: { top: Ranked[] }) {
  const order = [top[1], top[0], top[2]]; // 2등, 1등, 3등
  return (
    <div className="podium" aria-label="1~3위">
      <div className="confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <i key={i} style={{ left: c.left + "%", animationDelay: c.delay + "s", background: c.color }} />
        ))}
      </div>
      {order.map((r, i) =>
        r ? (
          <div key={r.id} className={"podium-spot podium-" + r.rank}>
            {r.rank === 1 && <span className="podium-crown">👑</span>}
            <JobEmblem job={r.job} level={r.level} size={r.rank === 1 ? 58 : 48} />
            <span className="podium-name">{r.id}</span>
            <span className="podium-block">{r.rank}</span>
          </div>
        ) : (
          <div key={"empty" + i} className="podium-spot podium-empty" />
        ),
      )}
    </div>
  );
}

function Row({ r, me, now }: { r: Ranked; me: Me; now: number }) {
  const up = recentUp(r, now);
  return (
    <li className={"rank-row" + (r.rank <= 3 ? " rank-top rank-top-" + r.rank : "") + (r.id === me.id ? " rank-mine" : "")}>
      <span className="rank-cell">
        <RankMedal rank={r.rank} />
      </span>
      <JobEmblem job={r.job} level={r.level} size={44} />
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
 * 길드 레벨 랭킹. 게임의 경험치 랭킹 화면처럼: 직업 필터, 1~3위 메달과 시상대, 맨 아래 '내 순위'.
 * 레벨과 직업은 길드원이 직접 적은 것이다 (게임을 읽지 않는다. CLAUDE.md 게임 안전 규칙).
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
  const list = ranked(filter === "all" ? data : data.filter((r) => r.job === filter));
  const mine = list.find((r) => r.id === me.id);
  const above = mine && mine.rank > 1 ? list[mine.rank - 2] : undefined;
  const avg = data.length ? Math.round((data.reduce((s, r) => s + r.level, 0) / data.length) * 10) / 10 : 0;
  const ups = data.filter((r) => recentUp(r, now) > 0).length;

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
        <button role="tab" className={"rank-tab" + (filter === "all" ? " rank-tab-on" : "")} onClick={() => setFilter("all")}>
          ALL
        </button>
        {JOBS.map((j) => (
          <button
            key={j}
            role="tab"
            className={"rank-tab" + (filter === j ? " rank-tab-on" : "")}
            onClick={() => setFilter(j)}
            aria-label={JOB_NAME[j]}
          >
            <JobIcon job={j} size={20} />
            <small>{data.filter((r) => r.job === j).length}</small>
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
        <span className="rank-mine-tag">내 순위</span>
        <span className="rank-cell">{mine ? <RankMedal rank={mine.rank} /> : <span className="rank-num">-</span>}</span>
        {me.job && me.level ? <JobEmblem job={me.job} level={me.level} size={44} /> : null}
        <span className="rank-name">
          <small>{mine ? (above ? (above.level > mine.level ? `한 칸 위까지 Lv.+${above.level - mine.level}` : "같은 레벨! 먼저 올린 사람이 위") : "👑 1등!") : filter === "all" ? "레벨을 정하면 올라가요" : "이 직업이 아니에요"}</small>
          <b>{me.id}</b>
        </span>
        <a className="pill rank-edit" href="#/me">
          레벨업
        </a>
      </div>
      <p className="rank-note">레벨과 직업은 각자 '내 정보'에서 바꿔요. 잘못 적힌 건 오피서에게 말해 주세요.</p>
    </>
  );
}
