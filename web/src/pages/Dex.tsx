// 도감 계산기 (개발중, 제작자 요청 2026-11-10: '도감 항목 정리가 인게임에서 안 되어 있어서 이 웹에서', '영상 찍어서 하나하나 클릭했어, 다 보고 기록해').
// 자료는 제작자가 찍은 게임 도감 퀘스트 영상(일반 > 전체 > 미완료)을 사람이(Claude) 장면마다 보고 옮긴 것: 비공개 자료 `도감/일반.json`
// -> web/scripts/build_dex.py -> data/dex.json. 앱은 게임을 읽지 않는다. 사람이 '완료'를 직접 누르는 계산기 (게임 안전 규칙에 맞는다).
// - 완료로 표시한 항목의 효과를 게임 '획득 옵션' 창 순서(시세 동향 캐릭터의 도감 표와 같은 DEX_ORDER)로 합친다.
// - 지금 목록(칸 · 찾기 · 능력치 거르기)의 미완료 항목을 다 하면 더 오르는 값(+)과, 그러려면 필요한 재료 합계.
// - 완료 표시는 이 기기에 계정별로 (localStorage sapphire.dex.done.<아이디>).
import { useCallback, useMemo, useState } from "react";
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

/** 게임 도감 '획득 옵션' 창의 줄 순서 (제작자가 시세 동향 때 보낸 스샷 7장 2026-11-03, 2026-11-10 '그거로 전체 능력치 세팅'):
 *  [능력치, % 줄인지]. 체력·마나·PVE 데미지 같은 것은 고정값 줄과 % 줄이 따로 있다 */
const OPTION_ROWS: [string, boolean][] = [
  ["명중", false], ["회피", false], ["크리티컬", false], ["불저항", false], ["냉기저항", false], ["번개저항", false], ["속성저항", false],
  ["체력", false], ["마나", false], ["체력", true], ["마나", true], ["체력재생", false], ["마나재생", false], ["힘", false], ["지능", false], ["민첩", false],
  ["이동속도", false], ["막기", false], ["아머", false], ["PVE 데미지", false], ["PVP 데미지", false], ["PVE 데미지", true], ["PVP 데미지", true],
  ["PVE 데미지 감소", false], ["PVP 데미지 감소", false], ["PVE 데미지 감소", true], ["PVP 데미지 감소", true], ["아이템 드랍", false], ["골드 드랍", false],
  ["보스 데미지", true], ["크리티컬 저항", true], ["크리티컬 데미지 감소", false], ["크리티컬 데미지 감소", true], ["데들리 저항", true],
  ["데들리 데미지 감소", false], ["데들리 데미지 감소", true], ["경험치", true],
];
const rowKey = (s: string, pct: boolean) => s + (pct ? "%" : "");
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
  const matchStat = (e: DexEntry) => !stat || e.effects.some(([s]) => s === stat);
  const inCat = (e: DexEntry) => cat === "all" || (e.cat ?? "일반") === cat;
  const inTab = (e: DexEntry) => inCat(e) && (tab === "all" ? true : tab === "done" ? done.has(e.name) : !done.has(e.name));
  const listed = dex.entries.filter((e) => inTab(e) && matchQ(e) && matchStat(e));
  const doneEntries = dex.entries.filter((e) => done.has(e.name));
  const have = useMemo(() => addUp(doneEntries), [done, dex]); // eslint-disable-line react-hooks/exhaustive-deps
  const todoListed = listed.filter((e) => !done.has(e.name));
  const gain = addUp(todoListed);

  // 나오는 능력치 (게임 '획득 옵션' 순서, 순서표에 없는 것은 뒤에)
  const stats = useMemo(() => {
    const seen = new Set(dex.entries.flatMap((e) => e.effects.map(([s]) => s)));
    return [...dex.order.filter((s) => seen.has(s)), ...[...seen].filter((s) => !dex.order.includes(s))];
  }, [dex]);
  const countOf = (s: string) => dex.entries.filter((e) => inTab(e) && matchQ(e) && e.effects.some(([x]) => x === s)).length;

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
      <StatPanel have={have} gain={gain} full={full} over={over} setOver={setOver} stat={stat} doneN={doneEntries.length} total={dex.entries.length} todoN={todoListed.length} />

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

      <div className="mk-cats dex-stats">
        <button type="button" className={"sub-tab" + (!stat ? " sub-tab-on" : "")} onClick={() => setStat(null)}>
          전체 능력치
        </button>
        {stats.map((s) => {
          const n = countOf(s);
          return n || stat === s ? (
            <button key={s} type="button" className={"sub-tab" + (stat === s ? " sub-tab-on" : "")} onClick={() => setStat(stat === s ? null : s)}>
              {s} <small>{n}</small>
            </button>
          ) : null;
        })}
      </div>

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

      <ul className="dex-list">
        {listed.map((e) => (
          <EntryRow key={e.name} e={e} done={done.has(e.name)} onToggle={() => toggle(e.name)} iconOf={iconOf} stat={stat} onItem={(name) => setQ(name)} />
        ))}
      </ul>
      {!listed.length && <p className="muted dex-empty">맞는 항목이 없어요</p>}
      <p className="muted dex-src">{dex.source}</p>
    </div>
  );
}

/** 획득 옵션: 게임 창의 줄마다 내 수치(0 ~ 기록된 도감을 다 채웠을 때)를 슬라이더로 움직이거나 숫자로 적는다.
 *  손대지 않은 줄은 완료로 누른 항목의 합. 초록 + = 지금 목록의 미완료를 다 하면 더 오르는 값 (제작자 2026-11-10) */
function StatPanel({ have, gain, full, over, setOver, stat, doneN, total, todoN }: {
  have: Sum; gain: Sum; full: Sum; over: Record<string, number>; setOver: (v: Record<string, number>) => void;
  stat: string | null; doneN: number; total: number; todoN: number;
}) {
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const rows: [string, boolean][] = [...OPTION_ROWS];
  for (const [s, x] of full) for (const pct of [false, true]) if ((pct ? x.pct : x.flat) && !rows.some(([a, b]) => a === s && b === pct)) rows.push([s, pct]);
  const valueOf = (s: string, pct: boolean) => over[rowKey(s, pct)] ?? pick(have, s, pct);
  const set = (k: string, v: number) => setOver({ ...over, [k]: Math.max(0, Math.round(v * 100) / 100) });
  const shown = all ? rows : rows.filter(([s, pct]) => valueOf(s, pct) > 0 || pick(gain, s, pct) > 0 || rowKey(s, pct) in over);
  const touched = Object.keys(over).length > 0;
  return (
    <Panel className="dex-sum" title={<>획득 옵션 <small className="muted">완료 {doneN} / {total}</small></>}>
      {shown.length ? (
        <ul className="dex-rows">
          {shown.map(([s, pct]) => {
            const k = rowKey(s, pct);
            const v = valueOf(s, pct);
            const mx = pick(full, s, pct);
            const g = pick(gain, s, pct);
            const step = mx > 50 ? 0.5 : 0.01;
            return (
              <li key={k} className={"dex-row" + (stat === s ? " dex-row-on" : "") + (k in over ? " dex-row-set" : "")}>
                <span className="dex-row-name">
                  {s}
                  {pct && <small>%</small>}
                  {g > 0 && <small className="dex-gain">+{num(g)}</small>}
                </span>
                <input type="range" min={0} max={mx || 1} step={step} value={Math.min(v, mx || 1)} disabled={!mx} aria-label={`${s}${pct ? " %" : ""} 수치`}
                  onChange={(e) => set(k, Number(e.target.value))} />
                <input className="dex-row-num" type="number" inputMode="decimal" min={0} step={step} aria-label={`${s}${pct ? " %" : ""} 직접 적기`}
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
                <span className="dex-row-max muted">/{mx ? num(mx) : "-"}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted dex-empty">아직 완료한 항목이 없어요</p>
      )}
      <div className="dex-sum-foot">
        <button type="button" className="sub-tab" onClick={() => setAll(!all)}>{all ? "접기 ▲" : `전체 능력치 ${rows.length} ▼`}</button>
        {touched && (
          <button type="button" className="sub-tab" onClick={() => { setOver({}); setDraft({}); }}>
            완료 합계로
          </button>
        )}
      </div>
      <p className="dex-legend muted">
        끝 = 도감 {total}개를 다 채웠을 때 · <span className="dex-gain">+ 지금 목록의 미완료 {todoN}개를 다 하면</span>
      </p>
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
 *  완료 칸 · 제목과 효과(작게, 넘치면 …) · 오른쪽에 작은 아이템 칸 (칸이 5개 이상이면 제목이 잘리지 않게 칸을 제목 아래 줄로). 칸을 누르면 그 줄 아래에 이름·개수·강화·대체 스탬프와 '이 템 찾기' */
function EntryRow({ e, done, onToggle, iconOf, stat, onItem }: { e: DexEntry; done: boolean; onToggle: () => void; iconOf: IconOf; stat: string | null; onItem: (name: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const it = sel === null ? null : e.items[sel];
  return (
    <li className={"dex-entry" + (done ? " dex-done" : "") + (e.items.length > 4 ? " dex-entry-wide" : "")}>
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
            <span key={i} className={"dex-eff" + (stat === f[0] ? " dex-eff-on" : "")}>{effectText(f)}</span>
          ))}
        </div>
      </div>
      <div className="dex-items">
        {e.items.map((x, i) => (
          <button key={i} type="button" className={"dex-slot" + (x.name ? "" : " dex-slot-unknown") + (sel === i ? " dex-slot-on" : "")}
            aria-label={[plusLabel(x), itemLabel(x), x.n > 1 ? `${x.n}개` : ""].filter(Boolean).join(" ")} onClick={() => setSel(sel === i ? null : i)}>
            <ItemPic it={x} iconOf={iconOf} size={22} />
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
