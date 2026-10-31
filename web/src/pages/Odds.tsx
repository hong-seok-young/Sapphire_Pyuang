// '정보' > '공식 확률' (#/odds, #/odds/<표 번호>). 제작자 요청 2026-10-31: 컴투스 공식 확률 정보를 위키에.
// 목록은 분류(가챠샵, 랜덤상자, 보석 ...)마다 카드, 위의 찾기 칸은 아이템·상자 이름이 든 표를 고른다.
// 표 화면은 섹션마다 표, 섹션이 많으면 접어 두고, 맨 위에 공식 페이지 링크.
import { useCallback, useState } from "react";
import { useAsync } from "../data";
import { loadOdds, matchedSections, oddsMatches, oddsName, oddsPage } from "../odds";
import type { OddsSection, OddsTable } from "../odds";
import { Loading, NotFound, TopBar } from "../ui";

const CATEGORY_ICON: Record<string, string> = {
  가챠샵: "🎰",
  랜덤상자: "🎁",
  보석: "💎",
  "펫 강화": "🐾",
  "스탯 부여": "📊",
  외형: "💇",
  아이템: "🧪",
  "장비 수리": "🔧",
  조합책: "📕",
  "랜덤 코스튬": "👘",
  염색: "🎨",
  "강화 확률": "⚒️",
  이벤트: "🎉",
};
/** 한 번에 그리는 행 수 (나머지는 '더 보기') */
const ROWS = 60;

/** 받은 날 (이 폰의 시간대로, '2026.11.01') */
function dateText(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}`;
}

export function OddsPage({ q: initial }: { q: string }) {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []));
  const [q, setQ] = useState(initial);
  if (!odds) {
    return (
      <>
        <TopBar title="공식 확률" />
        <Loading error={error} />
      </>
    );
  }
  const found = q.trim() ? odds.tables.filter((t) => oddsMatches(t, q)) : null;
  const groups = [...new Set(odds.tables.map((t) => t.path[0]))];
  const card = (t: OddsTable) => {
    const hits = found ? matchedSections(t, q).length : 0;
    return (
      <a key={t.key} className="card mn-card" href={`#/odds/${t.key}${q.trim() ? "?q=" + encodeURIComponent(q.trim()) : ""}`}>
        <span className="mn-card-icon">{CATEGORY_ICON[t.path[0]] ?? "🎲"}</span>
        <span className="mn-card-text">
          <b>{oddsName(t)}</b>
          <small>{found ? `${t.path[0]} · ${hits}곳` : t.sections.length > 1 ? `${t.sections.length}개` : ""}</small>
        </span>
      </a>
    );
  };
  return (
    <>
      <TopBar title="공식 확률" />
      <p className="odds-source">컴투스 공식 확률 정보 · {dateText(odds.fetched)} 기준</p>
      <input className="mk-input odds-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 아이템, 상자 이름" aria-label="공식 확률 찾기" />
      {found ? (
        found.length ? (
          <div className="mn-cards odds-found">{found.map(card)}</div>
        ) : (
          <div className="empty">'{q}'이 든 표가 없어요.</div>
        )
      ) : (
        groups.map((g) => {
          const list = odds.tables.filter((t) => t.path[0] === g);
          return (
            <section key={g} className="mn-group">
              <h2 className="mn-group-head">
                {CATEGORY_ICON[g] ?? "🎲"} {g} <small>{list.length}</small>
              </h2>
              <div className="mn-cards">{list.map(card)}</div>
            </section>
          );
        })
      )}
    </>
  );
}

export function OddsTablePage({ id, q }: { id: string; q: string }) {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []));
  if (!odds) {
    return (
      <>
        <TopBar title="공식 확률" />
        <Loading error={error} />
      </>
    );
  }
  const t = odds.tables.find((x) => x.key === id);
  if (!t) return <NotFound what="확률 표" />;
  const name = oddsName(t);
  const hits = q ? new Set(matchedSections(t, q)) : null;
  // 섹션이 많으면(옵션 재설정 202개 등) 접어 두고, 찾던 말이 든 섹션은 펼친다
  const fold = t.sections.length > 6;
  return (
    <>
      <TopBar title={name} />
      <a className="orig-link" href={oddsPage(odds, t.key)} target="_blank" rel="noopener noreferrer">
        <span>
          🎲 컴투스 공식 확률 · {t.path[0]} · {dateText(odds.fetched)}
        </span>
        <b>공식 페이지 ↗</b>
      </a>
      {t.sections.map((s, i) =>
        fold ? (
          <details key={i} className="odds-sec" open={!!hits?.has(i)}>
            <summary>
              {s.t || name} <small>{s.r.length}</small>
            </summary>
            <SectionTable s={s} q={q} />
          </details>
        ) : (
          <section key={i} className="odds-sec">
            {s.t && s.t !== name && <h2 className="odds-sec-title">{s.t}</h2>}
            <SectionTable s={s} q={q} />
          </section>
        ),
      )}
      <p className="odds-note">{odds.note}</p>
    </>
  );
}

function SectionTable({ s, q }: { s: OddsSection; q: string }) {
  const [all, setAll] = useState(false);
  const k = q.replace(/\s+/g, "");
  const rows = all ? s.r : s.r.slice(0, ROWS);
  return (
    <>
      {s.d && <p className="odds-desc">{s.d}</p>}
      <div className="odds-scroll">
        <table className="odds-table">
          <thead>
            <tr>
              {s.c.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={k && r.join("").replace(/\s+/g, "").includes(k) ? "odds-hit" : ""}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && s.r.length > ROWS && (
        <button className="pill odds-more" onClick={() => setAll(true)}>
          더 보기 ({s.r.length - ROWS})
        </button>
      )}
    </>
  );
}
