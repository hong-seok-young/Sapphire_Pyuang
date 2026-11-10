// 도감 계산기 (개발중, 제작자 요청 2026-11-10: '도감 항목 정리가 인게임에서 안 되어 있어서 이 웹에서', '영상 찍어서 하나하나 클릭했어, 다 보고 기록해').
// 자료는 제작자가 찍은 게임 도감 퀘스트 영상(일반 > 전체 > 미완료)을 사람이(Claude) 장면마다 보고 옮긴 것: 비공개 자료 `도감/일반.json`
// -> web/scripts/build_dex.py -> data/dex.json. 앱은 게임을 읽지 않는다. 사람이 '완료'를 직접 누르는 계산기 (게임 안전 규칙에 맞는다).
// - 완료로 표시한 항목의 효과를 게임 '획득 옵션' 창 순서(시세 동향 캐릭터의 도감 표와 같은 DEX_ORDER)로 합친다.
// - 지금 목록(칸 · 찾기 · 능력치 거르기)의 미완료 항목을 다 하면 더 오르는 값(+)과, 그러려면 필요한 재료 합계.
// - 완료 표시는 이 기기에 계정별로 (localStorage sapphire.dex.done.<아이디>).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDex, useAsync } from "../data";
import type { Dex, DexEntry, DexItem } from "../data";
import type { Me } from "../auth";
import type { Wiki } from "../types";
import { iconLookup } from "../simIcons";
import type { IconOf } from "../simIcons";
import { Loading, Panel, PicImg, TopBar } from "../ui";

type Tab = "todo" | "done" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "todo", label: "미완료" },
  { key: "done", label: "완료" },
  { key: "all", label: "전체" },
];

const storeKey = (me: Me) => `sapphire.dex.done.${me.id}`;
function readDone(me: Me): Set<string> {
  try {
    const raw = localStorage.getItem(storeKey(me));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeDone(me: Me, done: Set<string>) {
  try {
    localStorage.setItem(storeKey(me), JSON.stringify([...done]));
  } catch {
    /* 저장 못 하는 브라우저: 이번에 연 동안만 */
  }
}

/** 능력치마다 고정값과 % 값을 따로 더한다 ('체력 +2.0', '보스 데미지 +1.0%') */
type Sum = Map<string, { flat: number; pct: number }>;
function addUp(entries: DexEntry[]): Sum {
  const s: Sum = new Map();
  for (const e of entries)
    for (const [stat, v, pct] of e.effects) {
      const cur = s.get(stat) ?? { flat: 0, pct: 0 };
      if (pct) cur.pct += v;
      else cur.flat += v;
      s.set(stat, cur);
    }
  return s;
}
const num = (v: number) => String(Math.round(v * 100) / 100);
const effectText = ([stat, v, pct]: [string, number, boolean]) => `${stat} +${num(v)}${pct ? "%" : ""}`;

/** 게임 도감 '획득 옵션' 창의 37줄 (제작자가 시세 동향 때 보낸 스샷 7장, 2026-11-03). 체력·마나·PVE 데미지 같은 것은 고정값 줄과 % 줄이 따로 있다.
 *  좌우 두 칸 짝으로 둔다 (제작자 2026-11-10 '바를 빼고 최대한 유사한 것들끼리 좌우 2열 배치'). null = 빈 칸. 37줄이 모두 한 번씩 들어 있다 */
type Row = [string, boolean];
const OPTION_PAIRS: [Row | null, Row | null][] = [
  [["체력", false], ["마나", false]],
  [["체력", true], ["마나", true]],
  [["체력재생", false], ["마나재생", false]],
  [["힘", false], ["지능", false]],
  [["민첩", false], ["이동속도", false]],
  [["명중", false], ["회피", false]],
  [["크리티컬", false], ["크리티컬 저항", true]],
  [["아머", false], ["막기", false]],
  [["불저항", false], ["냉기저항", false]],
  [["번개저항", false], ["속성저항", false]],
  [["PVE 데미지", false], ["PVP 데미지", false]],
  [["PVE 데미지", true], ["PVP 데미지", true]],
  [["PVE 데미지 감소", false], ["PVP 데미지 감소", false]],
  [["PVE 데미지 감소", true], ["PVP 데미지 감소", true]],
  [["크리티컬 데미지 감소", false], ["크리티컬 데미지 감소", true]],
  [["데들리 데미지 감소", false], ["데들리 데미지 감소", true]],
  [["데들리 저항", true], ["보스 데미지", true]],
  [["아이템 드랍", false], ["골드 드랍", false]],
  [["경험치", true], null],
];
const rowKey = (s: string, pct: boolean) => s + (pct ? "%" : "");
/** 두 칸 배치에서 잘리는 긴 이름은 줄여 보인다 (고정값 칸과 % 칸이 구분되게) */
const SHORT: Record<string, string> = { "PVE 데미지 감소": "PVE 뎀감", "PVP 데미지 감소": "PVP 뎀감", "크리티컬 데미지 감소": "크리 뎀감", "크리티컬 저항": "크리 저항", "데들리 데미지 감소": "데들리 뎀감" };
const pick = (sum: Sum, s: string, pct: boolean) => (pct ? sum.get(s)?.pct : sum.get(s)?.flat) ?? 0;

/** 손으로 맞춘 내 능력치 (줄마다, 없으면 완료 합계). 이 기기에 계정별로 (localStorage sapphire.dex.stat.<아이디>) */
const statKey = (me: Me) => `sapphire.dex.stat.${me.id}`;
function readStats(me: Me): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(statKey(me)) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function writeStats(me: Me, v: Record<string, number>) {
  try {
    localStorage.setItem(statKey(me), JSON.stringify(v));
  } catch {
    /* 이번에 연 동안만 */
  }
}

/** 이름 찾기용: 띄어쓰기·대소문자·앞의 +N 무시 */
const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
/** 장비 칸인지 (강화 단계나 장비스탬프가 있다). 장비는 칸의 강화 단계와 같은 것만 등록된다: 노강 칸은 노강, +1 칸은 +1 만 (제작자 2026-11-10) */
const isGear = (it: DexItem) => !!it.plus || (!!it.sg && it.sg !== "불가");
const plusLabel = (it: DexItem) => (it.plus ? `+${it.plus}` : isGear(it) ? "노강" : "");
const stampText = (it: DexItem) => (it.sg === "불가" ? "대체 불가" : it.sg ? `${it.sg} ${it.sn}` : "");
/** 스탬프 색: S 금색, A 보라, B 파랑, 아바돈 빨강, 대체 불가 회색 */
const stampCls = (g?: string) => "dex-stamp dex-stamp-" + (!g ? "" : g.startsWith("아바돈") ? "AB" : g === "불가" ? "no" : g);
const itemLabel = (it: DexItem) => it.name ?? `이름 모름 · ${it.icon ?? ""}`;

export function DexPage({ wiki, me }: { wiki: Wiki | null; me: Me }) {
  const { data: dex, error } = useAsync(useCallback(() => loadDex(), []), "dex");
  return (
    <>
      <TopBar title="도감 계산기" right={<span className="pill trend-dev">개발중</span>} />
      {!dex ? <Loading error={error?.includes("404") ? "도감 자료가 아직 없어요" : error} /> : <DexBody dex={dex} wiki={wiki} me={me} />}
    </>
  );
}

function DexBody({ dex, wiki, me }: { dex: Dex; wiki: Wiki | null; me: Me }) {
  const [done, setDone] = useState<Set<string>>(() => readDone(me));
  const [tab, setTab] = useState<Tab>("todo");
  const [q, setQ] = useState("");
  const [stat, setStat] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [showNeed, setShowNeed] = useState(false);
  // 목록 폭 (한 줄에 아이템 칸을 몇 px 로 넣을지 정한다)
  const listRef = useRef<HTMLUListElement>(null);
  const [listW, setListW] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListW(el.clientWidth));
    ro.observe(el);
    setListW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [over, setOverState] = useState<Record<string, number>>(() => readStats(me));
  const setOver = (v: Record<string, number>) => {
    setOverState(v);
    writeStats(me, v);
  };
  // 슬라이더 끝 = 기록된 도감을 다 채웠을 때
  const full = useMemo(() => addUp(dex.entries), [dex]);
  const iconOf: IconOf = useMemo(() => (wiki ? iconLookup(wiki, null) : () => null), [wiki]);

  const toggle = (name: string) => {
    const next = new Set(done);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setDone(next);
    writeDone(me, next);
  };

  const query = norm(q);
  const matchQ = (e: DexEntry) =>
    !query || norm(e.name).includes(query) || e.items.some((it) => it.name && norm(it.name).replace(/^\+\d+/, "").includes(query.replace(/^\+\d+/, "")));
  // 능력치 칸을 누르면 그 능력치(고정값·% 따로)를 주는 항목만 (제작자 2026-11-10 '해당 속성 누르면 해당하는 리스트가 아래에 뜨게, 밑에 필터링 버튼들 없애고')
  const matchStat = (e: DexEntry) => !stat || e.effects.some(([s, , pct]) => rowKey(s, pct) === stat);
  const statBar = useRef<HTMLDivElement>(null);
  const pickStat = (k: string) => {
    const next = stat === k ? null : k;
    setStat(next);
    if (next) window.setTimeout(() => statBar.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const inCat = (e: DexEntry) => cat === "all" || (e.cat ?? "일반") === cat;
  const inTab = (e: DexEntry) => inCat(e) && (tab === "all" ? true : tab === "done" ? done.has(e.name) : !done.has(e.name));
  const listed = dex.entries.filter((e) => inTab(e) && matchQ(e) && matchStat(e));
  const doneEntries = dex.entries.filter((e) => done.has(e.name));
  const have = useMemo(() => addUp(doneEntries), [done, dex]); // eslint-disable-line react-hooks/exhaustive-deps
  const todoListed = listed.filter((e) => !done.has(e.name));


  // 지금 목록의 미완료를 다 하려면 필요한 재료 (같은 이름·강화끼리 더한다)
  const need = useMemo(() => {
    const m = new Map<string, { it: DexItem; n: number; entries: number }>();
    for (const e of todoListed)
      for (const it of e.items) {
        const k = plusLabel(it) + " " + itemLabel(it) + (it.name ? "" : ` (${it.icon ?? ""})`);
        const cur = m.get(k) ?? { it, n: 0, entries: 0 };
        cur.n += it.n;
        cur.entries += 1;
        m.set(k, cur);
      }
    return [...m.entries()].sort((a, b) => b[1].entries - a[1].entries || b[1].n - a[1].n);
  }, [todoListed.map((e) => e.name).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // 장비를 모두 장비스탬프로 대체하면 드는 스탬프 (등급별 합)
  const stamps = new Map<string, number>();
  for (const e of todoListed) for (const it of e.items) if (it.sg && it.sn) stamps.set(it.sg, (stamps.get(it.sg) ?? 0) + it.sn * it.n);
  const stampSum = ["S", "A", "B", ...[...stamps.keys()].filter((g) => !["S", "A", "B"].includes(g)).sort()].filter((g) => stamps.has(g));


  return (
    <div className="dex">
      <StatPanel have={have} full={full} over={over} setOver={setOver} stat={stat} onPick={pickStat} doneN={doneEntries.length} total={dex.entries.length} />

      <div className="mk-cats dex-cats">
        {["all", "일반", "코스튬", "펫"].map((c) => {
          const n = c === "all" ? dex.entries.length : dex.entries.filter((e) => (e.cat ?? "일반") === c).length;
          return n ? (
            <button key={c} type="button" className={"sub-tab" + (cat === c ? " sub-tab-on" : "")} onClick={() => setCat(c)}>
              {c === "all" ? "전체" : c} <small>{n}</small>
            </button>
          ) : null;
        })}
      </div>

      <nav className="pill-row" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={"pill" + (tab === x.key ? " pill-on" : "")} onClick={() => setTab(x.key)}>
            {x.label} <small>{x.key === "all" ? dex.entries.length : x.key === "done" ? doneEntries.length : dex.entries.length - doneEntries.length}</small>
          </button>
        ))}
      </nav>

      <div className="mk-search">
        <input className="mk-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="항목 · 아이템 이름" aria-label="도감 찾기" />
        {q && (
          <button type="button" className="pill" onClick={() => setQ("")}>
            지우기
          </button>
        )}
      </div>

      {stat && (
        <div className="dex-statbar" ref={statBar}>
          <span>
            <b>{SHORT[stat.replace(/%$/, "")] ?? stat.replace(/%$/, "")}{stat.endsWith("%") ? "%" : ""}</b> 주는 항목 <b>{listed.length}</b>개
          </span>
          <button type="button" className="sub-tab" onClick={() => setStat(null)}>
            ✕ 전체 보기
          </button>
        </div>
      )}

      {todoListed.length > 0 && (
        <Panel className="dex-need">
          <button type="button" className="dex-need-head" onClick={() => setShowNeed(!showNeed)} aria-expanded={showNeed}>
            <b>필요 재료</b> <span className="muted">미완료 {todoListed.length}개 · 재료 {need.length}종</span>
            <span className="dex-caret">{showNeed ? "▲" : "▼"}</span>
          </button>
          {showNeed && stampSum.length > 0 && (
            <p className="dex-stampsum">
              장비스탬프로 대체하면{" "}
              {stampSum.map((g) => (
                <span key={g} className={stampCls(g)}>{g} {stamps.get(g)!.toLocaleString("ko-KR")}</span>
              ))}
            </p>
          )}
          {showNeed && (
            <ul className="dex-need-list">
              {need.map(([k, { it, n, entries }]) => (
                <li key={k}>
                  <button type="button" onClick={() => it.name && setQ(it.name.replace(/^\+\d+\s*/, ""))} disabled={!it.name}>
                    <ItemPic it={it} iconOf={iconOf} />
                    <span className="dex-need-name">
                      {plusLabel(it) && <em className={"dex-need-plus" + (it.plus ? "" : " dex-noplus")}>{plusLabel(it)}</em>}
                      {itemLabel(it)}
                      {stampText(it) && <small className={stampCls(it.sg)}>{stampText(it)}</small>}
                    </span>
                    <span className="muted">{entries}칸</span>
                    <b>×{n.toLocaleString("ko-KR")}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <ul className="dex-list" ref={listRef}>
        {listed.map((e) => (
          <EntryRow key={e.name} e={e} listW={listW} done={done.has(e.name)} onToggle={() => toggle(e.name)} iconOf={iconOf} stat={stat} onItem={(name) => setQ(name)} />
        ))}
      </ul>
      {!listed.length && <p className="muted dex-empty">맞는 항목이 없어요</p>}
      <p className="muted dex-src">{dex.source}</p>
    </div>
  );
}

/** 획득 옵션: 게임 창의 37줄을 비슷한 것끼리 좌우 두 칸으로 (OPTION_PAIRS). 칸마다 이름, 그 아래 '최대'(도감을 다 채웠을 때, 제작자 2026-11-10 '최대치만'),
 *  오른쪽 숫자 칸에 내 수치를 직접 적는다. 손대지 않은 칸은 완료로 누른 항목의 합 (제작자 2026-11-10, 슬라이더는 '바를 빼는 게 좋을 듯'으로 뺐다) */
function StatPanel({ have, full, over, setOver, stat, onPick, doneN, total }: {
  have: Sum; full: Sum; over: Record<string, number>; setOver: (v: Record<string, number>) => void;
  stat: string | null; onPick: (k: string) => void; doneN: number; total: number;
}) {
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const pairs: [Row | null, Row | null][] = [...OPTION_PAIRS];
  // 짝 목록에 없는 능력치가 자료에 생기면 끝에 붙인다
  const known = new Set(OPTION_PAIRS.flat().filter((r): r is Row => !!r).map(([a, b]) => rowKey(a, b)));
  const extra: Row[] = [];
  for (const [s, x] of full) for (const pct of [false, true]) if ((pct ? x.pct : x.flat) && !known.has(rowKey(s, pct))) extra.push([s, pct]);
  for (let i = 0; i < extra.length; i += 2) pairs.push([extra[i], extra[i + 1] ?? null]);
  const valueOf = (s: string, pct: boolean) => over[rowKey(s, pct)] ?? pick(have, s, pct);
  const set = (k: string, v: number) => setOver({ ...over, [k]: Math.max(0, Math.round(v * 100) / 100) });
  const live = (r: Row | null) => !!r && (valueOf(r[0], r[1]) > 0 || pick(full, r[0], r[1]) > 0 || rowKey(r[0], r[1]) in over);
  const shown = all ? pairs : pairs.filter(([a, b]) => live(a) || live(b));
  const touched = Object.keys(over).length > 0;
  const cell = (r: Row | null, i: number) => {
    if (!r) return <div key={i} className="dex-cell dex-cell-empty" />;
    const [s, pct] = r;
    const k = rowKey(s, pct);
    const v = valueOf(s, pct);
    const mx = pick(full, s, pct);
    return (
      <div key={k} className={"dex-cell" + (stat === k ? " dex-cell-on" : "") + (k in over ? " dex-cell-set" : "")}>
        <button type="button" className="dex-cell-name" onClick={() => onPick(k)} disabled={!mx} aria-pressed={stat === k}>
          <b title={s}>{SHORT[s] ?? s}{pct && <small>%</small>}</b>
          <small className="muted">{mx ? `최대 ${num(mx)}` : "최대 -"}</small>
        </button>
        <input className="dex-row-num" type="number" inputMode="decimal" min={0} step={mx > 50 ? 0.5 : 0.01} aria-label={`${s}${pct ? " %" : ""} 내 수치`}
          value={draft[k] ?? num(v)}
          onChange={(e) => {
            setDraft({ ...draft, [k]: e.target.value });
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n)) set(k, n);
          }}
          onBlur={() => {
            const d = { ...draft };
            delete d[k];
            setDraft(d);
          }} />
      </div>
    );
  };
  return (
    <Panel className="dex-sum" title={<>획득 옵션 <small className="muted">완료 {doneN} / {total}</small></>}>
      {shown.length ? (
        <div className="dex-cells">{shown.map(([a, b], i) => [cell(a, i * 2), cell(b, i * 2 + 1)])}</div>
      ) : (
        <p className="muted dex-empty">아직 완료한 항목이 없어요</p>
      )}
      <div className="dex-sum-foot">
        <button type="button" className="sub-tab" onClick={() => setAll(!all)}>{all ? "접기 ▲" : "전체 능력치 ▼"}</button>
        {touched && (
          <button type="button" className="sub-tab" onClick={() => { setOver({}); setDraft({}); }}>
            완료 합계로
          </button>
        )}
      </div>
      <p className="dex-legend muted">최대 = 도감 {total}개를 다 채웠을 때</p>
    </Panel>
  );
}

function ItemPic({ it, iconOf, size = 30 }: { it: DexItem; iconOf: IconOf; size?: number }) {
  const pic = it.name ? iconOf(it.name) : null;
  if (pic) return <PicImg pic={pic} fit={size} />;
  if (it.pic) return <img className="dex-pic" src={encodeURI(it.pic)} alt="" style={{ width: size, height: size }} />;
  return <span className="dex-noimg">{(it.name ?? "?").replace(/^\+\d+/, "").slice(0, 1)}</span>;
}

/** 도감 한 줄 (제작자 2026-11-10 '한 행으로, 높이 높을 필요 없어, 템 크기 줄여도 되니 최대한 콤팩트하게 한눈에'):
 *  완료 칸 · 제목과 효과(작게, 넘치면 …) · 오른쪽에 작은 아이템 칸 (칸이 많으면 칸을 줄여 한 줄에, 그래도 안 들어가면 제목 아래 줄로). 칸을 누르면 그 줄 아래에 이름·개수·강화·대체 스탬프와 '이 템 찾기' */
/** 한 줄에 아이템 칸을 넣을 크기: 제목이 TITLE_MIN px 는 남도록 28 → 26 → 24 → 22 → 20px 로 줄여 본다. 그래도 안 되면 칸을 제목 아래 줄로 (null)
 *  (제작자 2026-11-10 '아이템을 왜 한 행에 안 했어? 최대한 한 행에 넣어 봐'. 줄 안쪽 = 목록 폭 - 테두리·여백 14 - 완료 칸 22 - 사이 12) */
const TITLE_MIN = 100;
const SLOT_SIZES = [28, 26, 24, 22, 20];
function slotSize(n: number, listW: number): number | null {
  if (!listW) return 28;
  const room = listW - 14 - 22 - 12 - TITLE_MIN;
  return SLOT_SIZES.find((sz) => n * (sz + 2) <= room) ?? null;
}

function EntryRow({ e, listW, done, onToggle, iconOf, stat, onItem }: { e: DexEntry; listW: number; done: boolean; onToggle: () => void; iconOf: IconOf; stat: string | null; onItem: (name: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const it = sel === null ? null : e.items[sel];
  const ref = useRef<HTMLLIElement>(null);
  // 칸을 연 채로 다른 곳을 누르면 닫는다 (제작자 2026-11-10)
  useEffect(() => {
    if (sel === null) return;
    const close = (ev: PointerEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setSel(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [sel]);
  const sz = slotSize(e.items.length, listW);
  const box = sz ?? 28;
  return (
    <li ref={ref} className={"dex-entry" + (done ? " dex-done" : "") + (sz === null ? " dex-entry-wide" : "")}>
      <button type="button" className="dex-check" onClick={onToggle} aria-pressed={done} aria-label={done ? "완료 취소" : "완료"}>
        {done ? "✓" : ""}
      </button>
      <div className="dex-main">
        <div className="dex-title">
          <b>{e.name}</b>
          {e.cat && <small className="dex-cat">{e.cat}</small>}
        </div>
        <div className="dex-effects">
          {e.effects.map((f, i) => (
            <span key={i} className={"dex-eff" + (stat === rowKey(f[0], f[2]) ? " dex-eff-on" : "")}>{effectText(f)}</span>
          ))}
        </div>
      </div>
      <div className="dex-items">
        {e.items.map((x, i) => (
          <button key={i} type="button" className={"dex-slot" + (x.name ? "" : " dex-slot-unknown") + (sel === i ? " dex-slot-on" : "")} style={box === 28 ? undefined : { width: box, height: box }}
            aria-label={[plusLabel(x), itemLabel(x), x.n > 1 ? `${x.n}개` : ""].filter(Boolean).join(" ")} onClick={() => setSel(sel === i ? null : i)}>
            <ItemPic it={x} iconOf={iconOf} size={box - 6} />
            {x.plus ? <i className="dex-plus">+{x.plus}</i> : null}
            {x.n > 1 && <i className="dex-n">{x.n >= 1000 ? `${Math.round(x.n / 100) / 10}k` : x.n}</i>}
          </button>
        ))}
      </div>
      {it && (
        <div className="dex-detail">
          {plusLabel(it) && <em className={"dex-need-plus" + (it.plus ? "" : " dex-noplus")}>{plusLabel(it)}</em>}
          <b>{itemLabel(it)}{it.est ? "?" : ""}</b>
          <span className="muted">×{it.n.toLocaleString("ko-KR")}</span>
          {stampText(it) && <small className={stampCls(it.sg)}>{it.sg === "불가" ? stampText(it) : `${it.sg?.startsWith("아바돈") ? "아바돈 " : ""}장비스탬프 ${it.sg?.replace("아바돈", "")} ${it.sn}개`}</small>}
          {it.name && (
            <button type="button" className="sub-tab dex-find" onClick={() => onItem(it.name!.replace(/^\+\d+\s*/, ""))}>
              이 템 찾기
            </button>
          )}
        </div>
      )}
    </li>
  );
}
