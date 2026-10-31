// '정보' > '공식 확률' (#/odds, #/odds/<표 번호>). 제작자 요청 2026-10-31: 컴투스 공식 확률 정보를 위키에.
// 목록은 위에 분류(가챠샵, 랜덤상자, 보석 ...) 아이콘 칸, 아래에 고른 분류의 표 목록(같은 상자는 묶어서). 찾기 칸은 아이템·상자 이름이 든 표를 고른다.
// 표 화면은 섹션마다 표, 섹션이 많으면 접어 두고, 맨 위에 공식 페이지 링크.
import { useCallback, useState } from "react";
import { useAsync } from "../data";
import { loadOdds, matchedSections, oddsMatches, oddsName, oddsPage } from "../odds";
import type { OddsSection, OddsTable } from "../odds";
import { go } from "../router";
import { FitLine, Loading, NotFound, TopBar } from "../ui";

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

/** 메뉴 끝의 '개별 획득 확률' 같은 말 (하나뿐이면 이름에 붙이지 않는다) */
const GENERIC_LEAF = /^(개별 )?획득 확률$/;

interface OddsGroup {
  /** 묶음 이름 (공식 메뉴의 두 번째 칸: '별똥별의 실타래') */
  name: string;
  /** 묶음 안의 표와 그 표의 이름 ('개별 획득 확률', '코스튬 옵션 개별 확률') */
  rows: { t: OddsTable; label: string }[];
}

/** 한 분류의 표를 공식 메뉴 두 번째 칸으로 묶는다. 표가 하나뿐이고 이름이 '개별 획득 확률'이면 묶음 이름만 */
function groupsOf(tables: OddsTable[]): OddsGroup[] {
  const groups: OddsGroup[] = [];
  for (const t of tables) {
    const name = t.path[1] ?? t.path[0];
    const leaf = t.path.slice(2).join(" · ");
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, rows: [] }));
    g.rows.push({ t, label: leaf });
  }
  return groups;
}

export function OddsPage({ q: initial, cat: initialCat }: { q: string; cat: string }) {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []));
  const [q, setQ] = useState(initial);
  const [cat, setCat] = useState(initialCat);
  if (!odds) {
    return (
      <>
        <TopBar title="공식 확률" />
        <Loading error={error} />
      </>
    );
  }
  const found = q.trim() ? odds.tables.filter((t) => oddsMatches(t, q)) : null;
  const cats = [...new Set(odds.tables.map((t) => t.path[0]))];
  const current = cats.includes(cat) ? cat : cats[0];
  // 고른 분류는 주소에 남겨 표를 보고 돌아와도 그대로 (기록은 늘리지 않는다)
  const pick = (c: string) => {
    setCat(c);
    go(`#/odds?c=${encodeURIComponent(c)}`, true);
  };
  const href = (t: OddsTable) => `#/odds/${t.key}${q.trim() ? "?q=" + encodeURIComponent(q.trim()) : ""}`;
  const row = (t: OddsTable, label: string, meta: string, key: string = t.key) => (
    <a key={key} className="odds-row" href={href(t)}>
      <span>{label}</span>
      {meta && <small>{meta}</small>}
      <i aria-hidden>›</i>
    </a>
  );
  const sectionMeta = (t: OddsTable) => (t.sections.length > 1 ? `표 ${t.sections.length}개` : "");
  return (
    <>
      <TopBar title="공식 확률" />
      <p className="odds-source">컴투스 공식 확률 정보 · {dateText(odds.fetched)} 기준</p>
      <input className="mk-input odds-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 아이템, 상자 이름" aria-label="공식 확률 찾기" />
      {found ? (
        found.length ? (
          // 찾은 표는 분류마다 묶어서
          cats
            .filter((c) => found.some((t) => t.path[0] === c))
            .map((c) => (
              <section key={c} className="panel odds-panel">
                <h2 className="odds-panel-head">
                  {CATEGORY_ICON[c] ?? "🎲"} {c}
                </h2>
                {found.filter((t) => t.path[0] === c).map((t) => row(t, oddsName(t), `${matchedSections(t, q).length}곳`))}
              </section>
            ))
        ) : (
          <div className="empty">'{q}'이 든 표가 없어요.</div>
        )
      ) : (
        <>
          {/* 분류: 아이콘 칸 (제작자 요청 2026-11-01: 분류와 내용이 구분되게, 단추만 늘어놓지 말고) */}
          <div className="odds-cats" role="tablist" aria-label="분류">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={c === current} className={"odds-cat" + (c === current ? " odds-cat-on" : "")} onClick={() => pick(c)}>
                <span className="odds-cat-icon">{CATEGORY_ICON[c] ?? "🎲"}</span>
                <FitLine className="odds-cat-name" text={c} wrap={false} />
                <small>{odds.tables.filter((t) => t.path[0] === c).length}</small>
              </button>
            ))}
          </div>
          {/* 내용: 고른 분류의 표 목록. 같은 상자의 표는 상자 이름 아래로 묶는다 */}
          <section className="panel odds-panel">
            <h2 className="odds-panel-head">
              {CATEGORY_ICON[current] ?? "🎲"} {current} <small>표 {odds.tables.filter((t) => t.path[0] === current).length}개</small>
            </h2>
            {groupsOf(odds.tables.filter((t) => t.path[0] === current)).map((g) =>
              g.rows.length === 1 && (!g.rows[0].label || GENERIC_LEAF.test(g.rows[0].label)) ? (
                row(g.rows[0].t, g.name, sectionMeta(g.rows[0].t))
              ) : (
                <div key={g.name} className="odds-group">
                  <div className="odds-group-name">{g.name}</div>
                  {g.rows.map((r) => row(r.t, r.label || g.name, sectionMeta(r.t)))}
                </div>
              ),
            )}
          </section>
        </>
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
