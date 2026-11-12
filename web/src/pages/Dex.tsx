import { useEntryState } from "../router";
// 도감 계산기 (개발중, 제작자 요청 2026-11-10: '도감 항목 정리가 인게임에서 안 되어 있어서 이 웹에서', '영상 찍어서 하나하나 클릭했어, 다 보고 기록해').
// 자료는 제작자가 찍은 게임 도감 퀘스트 영상(일반 > 전체 > 미완료)을 사람이(Claude) 장면마다 보고 옮긴 것: 비공개 자료 `도감/일반.json`
// -> web/scripts/build_dex.py -> data/dex.json. 앱은 게임을 읽지 않는다. 사람이 '완료'를 직접 누르는 계산기 (게임 안전 규칙에 맞는다).
// - 완료로 표시한 항목의 효과를 게임 '획득 옵션' 창 순서(시세 동향 캐릭터의 도감 표와 같은 DEX_ORDER)로 합친다.
// - 지금 목록(칸 · 찾기 · 능력치 거르기)의 미완료 항목을 다 하면 더 오르는 값(+)과, 그러려면 필요한 재료 합계.
// - 완료 표시는 이 기기에 계정별로 (localStorage sapphire.dex.done.<아이디>).
// - 기간이 있는 이벤트 도감은 '이벤트' 칸, 기간(한국 시간 시작 날 ~ 끝 날, 둘 다 정기 점검 시작 10:30) 안의 것만 보인다 (제작자 2026-11-12 '이벤트로 따로 넣고 기간 끝나면 자동으로 사라지게').
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadDex, useAsync } from "../data";
import { fetchMarket, wonText } from "../market";
import type { Dex, DexEntry, DexItem, DexPrice } from "../data";
import { MODES, STAMP_GRADES, amgeoText, gearKey, fmtGold, isCostSlot, pickWay, readPriceSet, saleOn, scrollLabel, slotCost, totals, wayText, writePriceSet } from "../dexPrice";
import type { PriceSet, Totals } from "../dexPrice";
import type { Me } from "../auth";
import { fetchMe } from "../auth";
import type { Wiki } from "../types";
import { iconLookup } from "../simIcons";
import { weaponOf } from "../rental";
import type { IconOf } from "../simIcons";
import { Loading, Panel, PicImg, TopBar } from "../ui";

type Tab = "todo" | "done" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "todo", label: "미완료" },
  { key: "done", label: "완료" },
  { key: "all", label: "전체" },
];

/** 이벤트 도감 기간: 시작 날 정기 점검(10:30) ~ 끝 날 정기 점검 시작(10:30) 전 (한국 시간. 공식 패치노트 '점검 후 ~ 11/12 점검 전까지') */
const startAt = (e: DexEntry) => (e.from ? Date.parse(e.from + "T10:30:00+09:00") : -Infinity);
const endAt = (e: DexEntry) => (e.to ? Date.parse(e.to + "T10:30:00+09:00") : Infinity);
const isLive = (e: DexEntry, now: number) => startAt(e) <= now && now < endAt(e);
/** 이벤트 도감이 끝나거나 시작하는 때가 오면 다시 그린다 (켜 둔 화면도, 폰이 잠들었다 돌아와도) */
function useEventClock(entries: DexEntry[]): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const check = () => setNow(Date.now());
    const cur = Date.now();
    const next = Math.min(...entries.flatMap((e) => [startAt(e), endAt(e)]).filter((t) => t > cur));
    const t = Number.isFinite(next) ? window.setTimeout(check, Math.min(next - cur + 1000, 86400_000)) : 0;
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [entries, now]);
  return now;
}
/** '이벤트 ~11/26' */
const untilText = (to?: string) => (to ? `~${+to.slice(5, 7)}/${+to.slice(8, 10)}` : "");
const CATS = ["all", "일반", "코스튬", "펫", "라이딩", "이벤트"];

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
/** 펫 도감 달성 보상 (퓨앙 스샷 2026-11-12): 펫 항목을 n 개 채웠으면 n 이하 보상을 더한다 */
function withRewards(base: Sum, rewards: Dex["petRewards"], petN: number): Sum {
  if (!rewards?.length) return base;
  const s: Sum = new Map([...base].map(([k, v]) => [k, { ...v }]));
  for (const [n, stat, v, pct] of rewards) {
    if (n > petN) continue;
    const cur = s.get(stat) ?? { flat: 0, pct: 0 };
    if (pct) cur.pct += v;
    else cur.flat += v;
    s.set(stat, cur);
  }
  return s;
}
const num = (v: number) => String(Math.round(v * 100) / 100);
/** 효과 글자 (긴 이름은 획득 옵션 칸과 같은 줄임말 SHORT, 제작자 2026-11-10 '아래쪽도 위처럼 줄임말') */
const effectText = ([stat, v, pct]: [string, number, boolean]) => `${SHORT[stat] ?? stat} +${num(v)}${pct ? "%" : ""}`;

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
  [["아머", false], ["보스 데미지", true]],
  [["PVE 데미지", false], ["PVP 데미지", false]],
  [["PVE 데미지", true], ["PVP 데미지", true]],
  [["PVE 데미지 감소", false], ["PVP 데미지 감소", false]],
  [["PVE 데미지 감소", true], ["PVP 데미지 감소", true]],
  [["크리티컬 데미지 감소", false], ["크리티컬 데미지 감소", true]],
  [["아이템 드랍", false], ["골드 드랍", false]],
  [["경험치", true], null],
];
/** 접어 두는 8줄: '전체 능력치'를 펼칠 때만 맨 아래에 (제작자 2026-11-12 '이 8개는 접어놓자': 막기, 불·냉기·번개·속성저항, 데들리 뎀감·뎀감%·저항%) */
const FOLDED_PAIRS: [Row | null, Row | null][] = [
  [["불저항", false], ["냉기저항", false]],
  [["번개저항", false], ["속성저항", false]],
  [["막기", false], ["데들리 저항", true]],
  [["데들리 데미지 감소", false], ["데들리 데미지 감소", true]],
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

function DexBody({ dex: all, wiki, me }: { dex: Dex; wiki: Wiki | null; me: Me }) {
  const now = useEventClock(all.entries);
  const liveKey = all.entries.map((e) => (isLive(e, now) ? 1 : 0)).join("");
  // 이벤트 도감 넣기·빼기 (제작자 2026-11-12 '체크박스와 이벤트, 이벤트 제외하거나 포함해서 최대치도 비용 계산도'): 빼면 최대·합계·비용·목록 모두에서 뺀다. 이 기기에 계정별로
  const [withEv, setWithEvState] = useState(() => {
    try {
      // 처음엔 뺀다 (제작자 2026-11-12 '이벤트 도감은 디폴트로 빼고 생각해'). 켠 것만 기억 (예전 키 ev 는 처음엔 켜짐이라 새 키 ev2)
      return localStorage.getItem(`sapphire.dex.ev2.${me.id}`) === "1";
    } catch {
      return false;
    }
  });
  const setWithEv = (v: boolean) => {
    setWithEvState(v);
    try {
      localStorage.setItem(`sapphire.dex.ev2.${me.id}`, v ? "1" : "0");
    } catch {
      /* 이번에 연 동안만 */
    }
  };
  const dex = useMemo(() => ({ ...all, entries: all.entries.filter((e) => isLive(e, now) && (withEv || e.cat !== "이벤트")) }), [all, liveKey, withEv]); // eslint-disable-line react-hooks/exhaustive-deps
  const [done, setDone] = useState<Set<string>>(() => readDone(me));
  const [tab, setTab] = useEntryState<Tab>("dex.tab", "todo");
  const [q, setQ] = useEntryState("dex.q", "");
  const [stat, setStat] = useEntryState<string | null>("dex.stat", null);
  const [cat, setCat] = useEntryState<string>("dex.cat", "all");
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
  // 시세 비교에서 손으로 고친 마법서·스탬프 값 (제작자 2026-11-11)
  const [pset, setPsetState] = useState<PriceSet>(() => readPriceSet(me));
  const setPset = (v: PriceSet) => {
    setPsetState(v);
    writePriceSet(me, v);
  };
  // 슬라이더 끝 = 기록된 도감을 다 채웠을 때
  const petTotal = dex.entries.filter((e) => e.cat === "펫").length;
  const full = useMemo(() => withRewards(addUp(dex.entries), dex.petRewards, petTotal), [dex]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const doneEntries = dex.entries.filter((e) => done.has(e.name));
  const petDone = doneEntries.filter((e) => e.cat === "펫").length;
  const have = useMemo(() => withRewards(addUp(doneEntries), dex.petRewards, petDone), [done, dex]); // eslint-disable-line react-hooks/exhaustive-deps
  const price = dex.price;
  // 목표 수치까지 (제작자 2026-11-12 '수치 입력하거나 좌우로 조정하면 그 수치까지 도감 싼 순서대로 찍는 데 얼마'):
  // 아직 안 한 항목 중 그 능력치 1 당 골드가 가장 싼 것부터 (평소 값, 칸마다 골드로 사기 vs 스탬프 중 싼 쪽). 값을 모르는 칸이 있는 항목은 맨 뒤
  const entryGold = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!price) return m;
    for (const e of dex.entries) {
      let g = 0;
      let ok = true;
      for (const it of e.items) {
        const w = pickWay(slotCost(it, price, pset), "normal");
        if (!w) {
          ok = false;
          break;
        }
        g += w.v;
      }
      m.set(e.name, ok ? g : null);
    }
    return m;
  }, [dex, price, pset]);
  const planFor = (k: string): GoalStep[] => {
    const c = dex.entries
      .filter((e) => !done.has(e.name))
      .map((e) => ({ e, v: e.effects.filter(([st, , pct]) => rowKey(st, pct) === k).reduce((a, [, v]) => a + v, 0), g: entryGold.get(e.name) ?? null }))
      .filter((x) => x.v > 0);
    c.sort((a, b) => (a.g == null ? 1 : 0) - (b.g == null ? 1 : 0) || (a.g != null && b.g != null ? a.g / a.v - b.g / b.v : b.v - a.v));
    return c;
  };
  const curOf = (k: string) => pick(have, k.replace(/%$/, ""), k.endsWith("%"));
  const goalOf = (k: string, target: number): Goal | null => {
    const need = target - curOf(k);
    if (need <= 1e-9) return null;
    const steps: GoalStep[] = [];
    let got = 0;
    let gold = 0;
    let unknown = 0;
    for (const x of planFor(k)) {
      if (got >= need - 1e-9) break;
      steps.push(x);
      got += x.v;
      if (x.g == null) unknown++;
      else gold += x.g;
    }
    return { steps, gold, unknown, reached: got >= need - 1e-9 };
  };
  const goal = stat && over[stat] != null ? goalOf(stat, over[stat]) : null;
  const goalNames = goal ? new Map(goal.steps.map((x, i) => [x.e.name, i])) : null;
  const listed = goalNames
    ? dex.entries.filter((e) => goalNames.has(e.name) && matchQ(e)).sort((a, b) => goalNames.get(a.name)! - goalNames.get(b.name)!)
    : dex.entries.filter((e) => inTab(e) && matchQ(e) && matchStat(e));
  const rewards = (dex.petRewards ?? []).filter(([n]) => n <= petTotal);
  const nextReward = rewards.find(([n]) => n > petDone);
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
  // 지금 목록의 미완료를 다 채우는 값: 칸마다 골드로 사기 vs 스탬프 중 싼 쪽, 평소 · 아바돈 이벤트
  // 효과 없는 항목(코스튬 '옵션 없음' 43, 라이딩 2)은 능력치를 주지 않아 비용에서 뺀다 (제작자 2026-11-12 '도감 효과 없는 건 몰라도 되지 않나')
  const tot = price ? totals(todoListed.filter((e) => e.effects.length > 0).flatMap((e) => e.items), price, pset) : null;


  return (
    <div className="dex">
      <StatPanel have={have} full={full} over={over} setOver={setOver} stat={stat} onPick={pickStat} doneN={doneEntries.length} total={dex.entries.length}
        goalOf={price ? goalOf : null} stepsOf={(k) => planFor(k).map((x) => x.v)} withEv={withEv} setWithEv={setWithEv} />

      <div className="mk-cats dex-cats">
        {CATS.map((c) => {
          const n = c === "all" ? dex.entries.length : dex.entries.filter((e) => (e.cat ?? "일반") === c).length;
          return n ? (
            <button key={c} type="button" className={"sub-tab" + (cat === c ? " sub-tab-on" : "")} onClick={() => setCat(c)}>
              {c === "all" ? "전체" : c} <small>{n}</small>
            </button>
          ) : null;
        })}
      </div>

      {cat === "펫" && rewards.length > 0 && (
        <p className="dex-petrw">
          펫 달성 보상 <b>{rewards.filter(([n]) => n <= petDone).length}/{rewards.length}</b>
          {nextReward && (
            <span className="muted">
              {" "}· {nextReward[0]}개 {effectText([nextReward[1], nextReward[2], nextReward[3]])}
            </span>
          )}
        </p>
      )}

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
            <b>{SHORT[stat.replace(/%$/, "")] ?? stat.replace(/%$/, "")}{stat.endsWith("%") ? "%" : ""}</b>{" "}
            {goal ? (
              <>
                {num(over[stat])}까지 싼 순서 <b>{goal.steps.length}</b>개 · <b>{fmtGold(goal.gold)}</b>
                {goal.unknown > 0 && <> · 값 모름 {goal.unknown}</>}
                {!goal.reached && <> · 다 해도 모자람</>}
              </>
            ) : (
              <>주는 항목 <b>{listed.length}</b>개</>
            )}
          </span>
          <button type="button" className="sub-tab" onClick={() => setStat(null)}>
            ✕ 전체 보기
          </button>
        </div>
      )}

      {price && tot && todoListed.length > 0 && tot.slots > 0 && <CostPanel price={price} tot={tot} pset={pset} setPset={setPset} n={todoListed.length} />}

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
          <EntryRow key={e.name} e={e} listW={listW} done={done.has(e.name)} onToggle={() => toggle(e.name)} iconOf={iconOf} stat={stat} onItem={(name) => setQ(name)} wiki={wiki} price={price} pset={pset} />
        ))}
      </ul>
      {!listed.length && <p className="muted dex-empty">맞는 항목이 없어요</p>}
      <p className="muted dex-src">{dex.source}</p>
    </div>
  );
}

interface GoalStep { e: DexEntry; v: number; g: number | null }
interface Goal { steps: GoalStep[]; gold: number; unknown: number; reached: boolean }

/** 획득 옵션: 게임 창의 37줄을 비슷한 것끼리 좌우 두 칸으로 (OPTION_PAIRS). 칸마다 이름, 그 아래 '최대'(도감을 다 채웠을 때, 제작자 2026-11-10 '최대치만'),
 *  오른쪽 숫자 칸은 완료로 누른 항목의 합, 거기에 목표를 적거나 좌우로 끌면 이름 아래에 그 수치까지 1 당 싼 항목부터 채우는 골드와 항목 수 (제작자 2026-11-12),
 *  이름을 누르면 그 항목들이 싼 순서로 아래 목록에 (슬라이더는 '바를 빼는 게 좋을 듯'으로 뺐다) */
function StatPanel({ have, full, over, setOver, stat, onPick, doneN, total, goalOf, stepsOf, withEv, setWithEv }: {
  have: Sum; full: Sum; over: Record<string, number>; setOver: (v: Record<string, number>) => void;
  stat: string | null; onPick: (k: string) => void; doneN: number; total: number;
  goalOf: ((k: string, target: number) => Goal | null) | null; stepsOf: (k: string) => number[];
  withEv: boolean; setWithEv: (v: boolean) => void;
}) {
  // 숫자 칸을 좌우로 끌면 싼 순서의 다음 항목만큼 오르내린다 (제작자 2026-11-12 '바로 좌우로 조정', 바는 '목록이 길어져서 싫다')
  const drag = useRef<{ k: string; x: number; moved: boolean; marks: number[]; i0: number } | null>(null);
  const dragged = useRef(0);
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const pairs: [Row | null, Row | null][] = [...OPTION_PAIRS];
  // 짝 목록에 없는 능력치가 자료에 생기면 끝에 붙인다
  const known = new Set([...OPTION_PAIRS, ...FOLDED_PAIRS].flat().filter((r): r is Row => !!r).map(([a, b]) => rowKey(a, b)));
  const extra: Row[] = [];
  for (const [s, x] of full) for (const pct of [false, true]) if ((pct ? x.pct : x.flat) && !known.has(rowKey(s, pct))) extra.push([s, pct]);
  for (let i = 0; i < extra.length; i += 2) pairs.push([extra[i], extra[i + 1] ?? null]);
  const valueOf = (s: string, pct: boolean) => over[rowKey(s, pct)] ?? pick(have, s, pct);
  const set = (k: string, v: number) => setOver({ ...over, [k]: Math.max(0, Math.round(v * 100) / 100) });
  const live = (r: Row | null) => !!r && (valueOf(r[0], r[1]) > 0 || pick(full, r[0], r[1]) > 0 || rowKey(r[0], r[1]) in over);
  const shown = all ? pairs : pairs.filter(([a, b]) => live(a) || live(b));
  const folded = all ? FOLDED_PAIRS : [];
  const touched = Object.keys(over).length > 0;
  const cell = (r: Row | null, i: number) => {
    if (!r) return <div key={i} className="dex-cell dex-cell-empty" />;
    const [s, pct] = r;
    const k = rowKey(s, pct);
    const v = valueOf(s, pct);
    const mx = pick(full, s, pct);
    const cur = pick(have, s, pct);
    const g = goalOf && k in over ? goalOf(k, over[k]) : null;
    return (
      <div key={k} className={"dex-cell" + (stat === k ? " dex-cell-on" : "") + (k in over ? " dex-cell-set" : "") + (g ? " dex-cell-goal" : "")}>
        <button type="button" className="dex-cell-name" onClick={() => onPick(k)} disabled={!mx} aria-pressed={stat === k}>
          <b title={s}>{SHORT[s] ?? s}{pct && <small>%</small>}</b>
          {g ? (
            <small className="dex-goal">
              {fmtGold(g.gold)}{g.unknown ? "+?" : ""} · {g.steps.length}개{g.reached ? "" : " 모자람"}
            </small>
          ) : (
            <small className="muted">{mx ? `최대 ${num(mx)}` : "최대 -"}</small>
          )}
        </button>
        <input className="dex-row-num" type="number" inputMode="decimal" min={0} step={mx > 50 ? 0.5 : 0.01} aria-label={`${s}${pct ? " %" : ""} 내 수치`}
          value={draft[k] ?? num(v)}
          onFocus={(e) => {
            // 0 은 지우고 쓰지 않게 비우고, 다른 값은 통째로 골라 바로 덮어쓴다 (제작자 2026-11-12)
            if (Date.now() - dragged.current < 400) {
              e.currentTarget.blur();
              return;
            }
            if (v === 0) setDraft({ ...draft, [k]: "" });
            else e.currentTarget.select();
          }}
          onPointerDown={(e) => {
            const marks = [cur];
            for (const x of stepsOf(k)) marks.push(Math.round((marks[marks.length - 1] + x) * 100) / 100);
            const i0 = Math.max(0, marks.findIndex((m) => m >= v - 1e-9));
            drag.current = { k, x: e.clientX, moved: false, marks, i0: marks.some((m) => m >= v - 1e-9) ? i0 : marks.length - 1 };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.k !== k) return;
            const dx = e.clientX - d.x;
            if (!d.moved) {
              if (Math.abs(dx) < 8) return;
              d.moved = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.blur();
            }
            const i = Math.min(d.marks.length - 1, Math.max(0, d.i0 + Math.round(dx / 14)));
            set(k, d.marks[i]);
          }}
          onPointerUp={() => {
            if (drag.current?.moved) dragged.current = Date.now();
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
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
        <div className="dex-cells">
          {shown.map(([a, b], i) => [cell(a, i * 2), cell(b, i * 2 + 1)])}
          {folded.length > 0 && <div className="dex-fold-sep muted">접어 둔 능력치</div>}
          {folded.map(([a, b], i) => [cell(a, 1000 + i * 2), cell(b, 1001 + i * 2)])}
        </div>
      ) : (
        <p className="muted dex-empty">아직 완료한 항목이 없어요</p>
      )}
      <div className="dex-sum-foot">
        <button type="button" className="sub-tab" onClick={() => setAll(!all)}>{all ? "접기 ▲" : "전체 능력치 ▼"}</button>
        {touched && (
          <button type="button" className="sub-tab" onClick={() => { setOver({}); setDraft({}); }}>
            목표 지우기
          </button>
        )}
      </div>
      <button type="button" className="dex-evtoggle" aria-pressed={withEv} onClick={() => setWithEv(!withEv)}>
        <span className="dex-evbox">{withEv ? "✓" : ""}</span>이벤트
      </button>
    </Panel>
  );
}

function ItemPic({ it, iconOf, size = 30 }: { it: DexItem; iconOf: IconOf; size?: number }) {
  // 영상에서 오린 아이콘(it.pic)이 먼저, 없으면 위키 그림 (제작자 2026-11-12 '화질 구린 거 이번 영상 화질로')
  if (it.pic) return <img className="dex-pic" src={encodeURI(it.pic)} alt="" style={{ width: size, height: size }} />;
  const pic = it.name ? iconOf(it.name) : null;
  if (pic) return <PicImg pic={pic} fit={size} />;
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

/** 칸 상세의 아이템 정보: 영상 툴팁에서 받아 적은 것(요구 레벨·방어력·옵션, 재료면 설명) + 위키의 옵션 범위·직업·얻는 곳 (제작자 2026-11-10 '이미지랑 내용 장비옵션 다') */
function ItemInfo({ it, wiki }: { it: DexItem; wiki: Wiki | null }) {
  const base = it.name?.replace(/^\+\d+\s*/, "");
  const w = wiki && base ? weaponOf(wiki, base) : undefined;
  const eq = w?.equip?.[0]?.info;
  const from = (eq?.["획득처"] ? [eq["획득처"]] : (w?.from ?? []).map((f) => f.split("@")[0])).filter(Boolean);
  const lines = [
    it.info,
    eq?.["옵션"] ? `옵션 ${eq["옵션"]}` : "",
    eq?.["직업"] ? `직업 ${eq["직업"]}` : "",
    from.length ? `얻는 곳 ${[...new Set(from)].slice(0, 6).join(", ")}` : "",
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <span className="dex-info">
      {lines.map((l, i) => (
        <small key={i}>{l}</small>
      ))}
    </span>
  );
}

function EntryRow({ e, listW, done, onToggle, iconOf, stat, onItem, wiki, price, pset }: {
  e: DexEntry; listW: number; done: boolean; onToggle: () => void; iconOf: IconOf; stat: string | null; onItem: (name: string) => void; wiki: Wiki | null;
  price?: DexPrice; pset: PriceSet;
}) {
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
          {e.cat && <small className={"dex-cat" + (e.to ? " dex-cat-ev" : "")}>{e.cat}{e.to ? " " + untilText(e.to) : ""}</small>}
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
          {price && <SlotPrice it={it} price={price} pset={pset} />}
          <ItemInfo it={it} wiki={wiki} />
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

/** 숫자 칸: 비우면 자료 값으로 되돌린다. 손댄 칸은 금색 (획득 옵션 칸과 같은 방식) */
function NumIn({ value, def, onSet, label }: { value: number | undefined; def: number | null; onSet: (v: number | null) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input className={"dex-row-num" + (value != null ? " dex-num-set" : "")} type="number" inputMode="decimal" min={0} aria-label={label}
      value={draft ?? (value ?? def ?? "")} placeholder={def == null ? "값" : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value === "") return onSet(null);
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n) && n >= 0) onSet(n);
      }}
      onBlur={() => setDraft(null)} />
  );
}

/** 도감 비용 (제작자 요청 2026-11-11): 지금 목록의 미완료 칸을 다 채우는 골드. 칸마다 '골드로 장비 사기'와 '장비스탬프' 중 싼 쪽을 더한다.
 *  평소와 아바돈 이벤트(스탬프가 싸진다)를 나란히, 이벤트 때 아끼는 골드. 아래에서 마법서·스탬프·플래티넘 값을 직접 고친다 */
/** 가장 큰 단위의 정수로: 59.7억 -> '60억', 8008.3만 -> '8008만' (제작자 2026-11-12 '정수 단위 반올림') */
function intUnit(v: number): string {
  if (v >= 1e8) return `${Math.round(v / 1e8).toLocaleString("ko-KR")}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`;
  return Math.round(v).toLocaleString("ko-KR");
}
function CostPanel({ price, tot, pset, setPset, n }: { price: DexPrice; tot: Totals; pset: PriceSet; setPset: (v: PriceSet) => void; n: number }) {
  const [open, setOpen] = useState(false);
  const on = saleOn(price);
  // 현금 어림 (제작자 2026-11-12 '현금으로 얼만지도 평소와 아바돈 아래에'): 중개인 골드 팝니다 평균 시세, 없으면 75:1 (1만 원에 75만 골드)
  const { data: market } = useAsync(useCallback(() => fetchMarket(), []), "market");
  const rate = market?.goldRate || 75;
  // 아바돈 칸을 누르면 판매 기간 설명이 잠깐 (제작자 2026-11-12 '누르면 설명 간단히, 다른 곳 누르면 사라지거나 잠시 뒤 사라지게')
  const [tip, setTip] = useState(false);
  const tipTimer = useRef(0);
  const showTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip((v) => !v);
    tipTimer.current = window.setTimeout(() => setTip(false), 4000);
  };
  useEffect(() => {
    if (!tip) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.(".dex-cost-now, .dex-cost-col")) setTip(false);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [tip]);
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const save = tot.by.normal.sum - tot.by.event.sum;
  const setScroll = (k: string, v: number | null) => {
    const scroll = { ...pset.scroll };
    if (v == null) delete scroll[k];
    else scroll[k] = v;
    setPset({ ...pset, scroll });
  };
  const setStamp = (k: string, v: number | null) => {
    const stamp = { ...pset.stamp };
    if (v == null) delete stamp[k];
    else stamp[k] = v;
    setPset({ ...pset, stamp });
  };
  const scrolls = [...new Set([...tot.scrolls.keys(), ...Object.keys(pset.scroll)])].sort();
  const touched = Object.keys(pset.scroll).length + Object.keys(pset.stamp).length > 0 || pset.plat != null;
  const missingN = [...tot.missing.values()].reduce((a, b) => a + b, 0);
  return (
    <Panel className="dex-need dex-cost">
      <button type="button" className="dex-need-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>도감 비용</b>
        {!open && (
          <span className="muted">
            평소 {intUnit(tot.by.normal.sum)} ({intUnit(tot.by.normal.sum / rate)}원) · 이벤트 {intUnit(tot.by.event.sum)} ({intUnit(tot.by.event.sum / rate)}원)
          </span>
        )}
        {on && !open && <span className="dex-sale-dot">판매 중</span>}
        <span className="dex-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="dex-cost-body">
          <div className="dex-cost-cols">
            {MODES.map((m) => (
              <div key={m.key} className={"dex-cost-col" + (m.key === "event" && on ? " dex-cost-now" : "")}
                onClick={m.key === "event" && price.sale ? showTip : undefined} role={m.key === "event" && price.sale ? "button" : undefined}>
                {m.key === "event" && tip && price.sale && (
                  <span className={"dex-cost-tip" + (on ? " dex-sale-on" : "")}>
                    아바돈 스탬프를 살 수 있을 때 값
                    <br />
                    {on ? "판매 중" : "지난 판매"} · {price.sale.text}
                  </span>
                )}
                <small>{m.label}</small>
                <b>{fmtGold(tot.by[m.key].sum)} 골드</b>
                <small className="muted">≈ {wonText(Math.round(tot.by[m.key].sum / rate / 10_000) * 10_000)}</small>
              </div>
            ))}
          </div>
          <p className="dex-cost-note">
            미완료 {n}개의 값 있는 칸 {tot.slots}개{save > 0 ? <> · 이벤트 때 채우면 <b>{fmtGold(save)}</b> 골드 아껴요</> : null}
            {tot.none > 0 && <span className="muted"> · 값 없는 칸 {tot.none}개 (거래소 시세가 없고 스탬프로도 안 됨)</span>}
            {missingN > 0 && <span className="muted"> · 마법서 값이 없어 골드로 못 센 칸 {missingN}개</span>}
          </p>

          {scrolls.length > 0 && (
            <div className="dex-cost-set">
              <b>마법서 1장 (골드)</b>
              <div className="dex-cost-inputs">
                {scrolls.map((k) => {
                  const [kind, grade] = k.split(" ") as ["무기" | "갑옷", string];
                  return (
                    <label key={k} className={tot.missing.has(k) ? "dex-need-scroll" : ""}>
                      <span>{scrollLabel(k)}</span>
                      <NumIn value={pset.scroll[k]} def={price.scroll?.[kind]?.[grade] ?? null} onSet={(v) => setScroll(k, v)} label={`${scrollLabel(k)} 골드`} />
                    </label>
                  );
                })}
              </div>
              <small className="muted">마법서 등급은 장비 요구 레벨로 (D 10 미만 · C 20 · B 30 · A 40 · S 50 미만). 값을 넣으면 강화 칸도 '노강 + 마법서'로 셈</small>
            </div>
          )}

          {price.stamp && (
            <div className="dex-cost-set">
              <b>스탬프 1장 (플래티넘)</b>
              <div className="dex-cost-grid">
                <span />
                {STAMP_GRADES.map((g) => (
                  <small key={g} className={"dex-stamp dex-stamp-" + g}>{g}</small>
                ))}
                {MODES.map((m) => (
                  <Row key={m.key} label={m.key === "normal" ? "평소" : "이벤트"}>
                    {STAMP_GRADES.map((g) => (
                      <NumIn key={g} value={pset.stamp[`${m.key} ${g}`]} def={price.stamp?.[m.key]?.[g] ?? null} onSet={(v) => setStamp(`${m.key} ${g}`, v)} label={`${m.label} 장비스탬프${g} 플래티넘`} />
                    ))}
                  </Row>
                ))}
              </div>
              <label className="dex-cost-plat">
                <span>플래티넘 100 =</span>
                <NumIn value={pset.plat != null ? pset.plat * 100 : undefined} def={Math.round((price.stamp.platGold ?? 700) * 100)}
                  onSet={(v) => setPset({ ...pset, plat: v == null ? undefined : v / 100 })} label="플래티넘 100 의 골드" />
                <span>골드</span>
              </label>
              <small className="muted">아바돈 스탬프 1장 = 일반 {price.stamp.abaddon}장. 이벤트 값은 봉인된스탬프함 A/B 와 왜곡된수정구 평균으로 셈</small>
            </div>
          )}

          <div className="dex-sum-foot">
            {touched && (
              <button type="button" className="sub-tab" onClick={() => setPset({ scroll: {}, stamp: {} })}>
                자료 값으로
              </button>
            )}
          </div>
          <p className="dex-legend muted">
            장비 시세 {amgeoText(price.dates?.length ? price.dates : [price.date])} (옵션은 안 보고 가장 싼 매물)
            {price.stamp?.date ? ` · 스탬프 상점 ${price.stamp.date}` : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <small className="muted">{label}</small>
      {children}
    </>
  );
}

/** 칸 상세의 값: 골드로(어떻게 셌는지), 스탬프로(평소 · 이벤트), 싼 쪽 */
function SlotPrice({ it, price, pset }: { it: DexItem; price: DexPrice; pset: PriceSet }) {
  if (!isCostSlot(it, price)) return it.nt ? <span className="dex-price"><small>거래불가</small></span> : null;
  const c = slotCost(it, price, pset);
  const rec = MODES.map((m) => [m.label, pickWay(c, m.key)] as const);
  const same = rec[0][1]?.by === rec[1][1]?.by;
  const recText = (w: ReturnType<typeof pickWay>) => (w ? (w.by === "gold" ? "골드로 사기" : "스탬프") : "값 없음");
  return (
    <span className="dex-price">
      <small>
        골드{" "}
        {c.gold != null && c.way ? (
          <>
            <b>{fmtGold(c.gold)}</b> = {wayText(c.way, c.scroll, isGear(it))}
            {it.n > 1 ? ` × ${it.n}` : ""}
            {c.date ? ` · ${amgeoText([c.date])}` : ""}
            {price.gear[it.pk ?? ""]?.noench ? " · 속성부여 매물이라 같은 등급 노작 값" : ""}
            {price.gear[it.pk ?? gearKey(it.name ?? "")]?.m ? " · 매물 없어 정한 값" : ""}
          </>
        ) : c.grade ? (
          <>
            <b>{fmtGold(c.gold!)}</b> = {c.grade.name} 어림 ({fmtGold(c.grade.lo)} ~ {fmtGold(c.grade.hi)}, 같은 등급 매물 {c.grade.n}개)
            {it.n > 1 ? ` × ${it.n}` : ""}
          </>
        ) : c.missing ? (
          `${scrollLabel(c.missing)} 값을 넣으면 셈`
        ) : it.nt ? (
          "거래불가"
        ) : (
          "암거 시세 없음"
        )}
      </small>
      <small>
        스탬프{" "}
        {c.stamp.normal != null ? (
          <>
            평소 <b>{fmtGold(c.stamp.normal)}</b> · 이벤트 <b>{fmtGold(c.stamp.event ?? c.stamp.normal)}</b>
          </>
        ) : it.sg === "불가" ? (
          "대체 불가"
        ) : (
          "값 없음"
        )}
      </small>
      <small className="dex-rec">
        추천 {same ? recText(rec[0][1]) : rec.map(([l, w]) => `${l} ${recText(w)}`).join(" · ")}
      </small>
    </span>
  );
}

/* ───────── 챗봇 답 속 도감 계산기 (제작자 2026-11-12 '챗봇에 물어보면 우리 도감계산기 그대로 띄워서, 시세 동향처럼') ─────────
 * [[도감:명중=4;크리티컬=2;체력=244.3;체력%=7.4;PVE 데미지=13;PVE 데미지%=6]] -> 그 수치를 처음부터(완료 0) 채우는 데 드는 골드·현금.
 * 여러 능력치를 한꺼번에: 아직 모자란 만큼을 목표로 나눈 비율의 합을 골드로 나눠 가장 효율 좋은 항목부터 고르고, 다 채운 뒤 없어도 되는 비싼 항목은 뺀다.
 * 장비 칸은 골드로 사기 vs 스탬프 중 싼 쪽(평소 값으로 골랐고 같은 항목을 아바돈 이벤트 값으로도 센다). 값을 모르는 칸이 있는 항목은 효율 좋은 것이 없을 때만 넣고 '값 모름'으로 센다.
 * 펫 도감 달성 보상은 넣지 않는다. */
const STAT_ALIAS: Record<string, string> = {
  크리: "크리티컬", 크리저항: "크리티컬 저항", 크뎀감: "크리티컬 데미지 감소", 크리뎀감: "크리티컬 데미지 감소", 데들리뎀감: "데들리 데미지 감소",
  체재: "체력재생", 마재: "마나재생", 이속: "이동속도", 아드: "아이템 드랍", 골드: "골드 드랍", 경험치: "경험치", 보스뎀: "보스 데미지", 속저: "속성저항",
};
function statRow(raw: string, order: string[]): Row | null {
  let t = raw.trim().replace(/\s/g, "");
  const pct = t.endsWith("%");
  if (pct) t = t.slice(0, -1);
  t = t.replace(/뎀감$/, "데미지감소").replace(/뎀$/, "데미지").toUpperCase();
  const byKey = new Map(order.map((n) => [n.replace(/\s/g, "").toUpperCase(), n]));
  for (const [a, n] of Object.entries(STAT_ALIAS)) byKey.set(a.toUpperCase(), n);
  for (const [n, sh] of Object.entries(SHORT)) byKey.set(sh.replace(/\s/g, "").toUpperCase(), n);
  const n = byKey.get(t);
  return n ? [n, pct] : null;
}
interface MultiPlan { picks: { e: DexEntry; g: number | null; ge: number | null }[]; got: Map<string, number>; gold: number; goldEv: number; unknown: number }
function planTargets(entries: DexEntry[], targets: Map<string, number>, costOf: (e: DexEntry, mode: "normal" | "event") => number | null): MultiPlan {
  const val = (e: DexEntry, k: string) => e.effects.filter(([s, , p]) => rowKey(s, p) === k).reduce((a, [, v]) => a + v, 0);
  const cands = entries
    .map((e) => ({ e, vs: new Map([...targets.keys()].map((k) => [k, val(e, k)] as const).filter(([, v]) => v > 0)), g: costOf(e, "normal") }))
    .filter((c) => c.vs.size > 0);
  const got = new Map([...targets.keys()].map((k) => [k, 0]));
  const left = (k: string) => Math.max(0, targets.get(k)! - got.get(k)!);
  const gain = (c: (typeof cands)[number]) => [...c.vs].reduce((a, [k, v]) => a + Math.min(v, left(k)) / targets.get(k)!, 0);
  const chosen: typeof cands = [];
  const used = new Set<number>();
  while ([...targets.keys()].some((k) => left(k) > 1e-9)) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      if (used.has(i)) continue;
      const gn = gain(cands[i]);
      if (gn <= 1e-12) continue;
      // 값 모르는 항목은 값 있는 것보다 뒤 (아주 큰 값으로 친다)
      const sc = (cands[i].g ?? 1e15) / gn;
      if (sc < bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    if (best < 0) break;
    used.add(best);
    chosen.push(cands[best]);
    for (const [k, v] of cands[best].vs) got.set(k, got.get(k)! + v);
  }
  // 다 채운 뒤 없어도 되는 항목은 비싼 것부터 뺀다
  for (const c of [...chosen].sort((a, b) => (b.g ?? 1e15) - (a.g ?? 1e15))) {
    if (![...c.vs].every(([k, v]) => got.get(k)! - v >= targets.get(k)! - 1e-9)) continue;
    chosen.splice(chosen.indexOf(c), 1);
    for (const [k, v] of c.vs) got.set(k, got.get(k)! - v);
  }
  const picks = chosen.map((c) => ({ e: c.e, g: c.g, ge: costOf(c.e, "event") }));
  return { picks, got, gold: picks.reduce((a, p) => a + (p.g ?? 0), 0), goldEv: picks.reduce((a, p) => a + (p.ge ?? p.g ?? 0), 0), unknown: picks.filter((p) => p.g == null).length };
}

export function DexSnippet({ spec }: { spec: string }) {
  const { data: all } = useAsync(useCallback(() => loadDex(), []), "dex");
  // 손으로 고친 마법서·스탬프 값과 '도감 계산기에서 보기'의 목표는 계정별로 둬서 누구인지 묻는다
  const { data: me } = useAsync(useCallback(() => fetchMe(), []), "me");
  const { data: market } = useAsync(useCallback(() => fetchMarket(), []), "market");
  const [withEv, setWithEv] = useState(false); // 이벤트 도감은 처음엔 뺀다 (제작자 2026-11-12)
  const [open, setOpen] = useState(false);
  const rate = market?.goldRate || 75;
  const plan = useMemo(() => {
    if (!all) return null;
    const now = Date.now();
    const entries = all.entries.filter((e) => isLive(e, now) && (withEv || e.cat !== "이벤트"));
    const targets = new Map<string, number>();
    const bad: string[] = [];
    for (const part of spec.split(/[;,]/)) {
      const m = part.match(/^\s*([^=:]+?)\s*[=:]\s*([\d.]+)\s*%?\s*$/);
      if (!m) continue;
      const pctMark = /%\s*$/.test(part) && !/%/.test(m[1]);
      const row = statRow(m[1] + (pctMark ? "%" : ""), all.order);
      const v = Number(m[2]);
      if (!row || !(v > 0)) {
        bad.push(m[1].trim());
        continue;
      }
      targets.set(rowKey(row[0], row[1]), v);
    }
    const price = all.price;
    const pset: PriceSet = me ? readPriceSet(me) : { scroll: {}, stamp: {} };
    const costOf = (e: DexEntry, mode: "normal" | "event") => {
      if (!price) return null;
      let g = 0;
      for (const it of e.items) {
        const w = pickWay(slotCost(it, price, pset), mode);
        if (!w) return null;
        g += w.v;
      }
      return g;
    };
    const max = addUp(entries);
    return { targets, bad, max, ...planTargets(entries, targets, costOf) };
  }, [all, spec, withEv, me]);
  if (!all || !plan || !plan.targets.size) return null;
  const goDex = () => {
    if (me) writeStats(me, Object.fromEntries(plan.targets));
    window.location.hash = "#/dex";
  };
  return (
    <div className="dex-snip">
      <div className="dex-snip-head">
        <b>도감 계산기</b>
        <small className="muted">처음부터 · 싼 순서</small>
        <button type="button" className="dex-evtoggle" aria-pressed={withEv} onClick={() => setWithEv(!withEv)}>
          <span className="dex-evbox">{withEv ? "✓" : ""}</span>이벤트
        </button>
      </div>
      <div className="dex-snip-stats">
        {[...plan.targets].map(([k, v]) => {
          const g = plan.got.get(k) ?? 0;
          const short = g < v - 1e-9;
          const name = k.replace(/%$/, "");
          return (
            <div key={k} className={"dex-snip-stat" + (short ? " dex-snip-short" : "")}>
              <span>{SHORT[name] ?? name}{k.endsWith("%") ? "%" : ""}</span>
              <b>{num(v)}</b>
              <small className="muted">{short ? `최대 ${num(pick(plan.max, name, k.endsWith("%")))}` : `채움 ${num(g)}`}</small>
            </div>
          );
        })}
      </div>
      <div className="dex-cost-cols">
        <div className="dex-cost-col">
          <small>평소</small>
          <b>{fmtGold(plan.gold)} 골드</b>
          <small className="muted">≈ {wonText(Math.round(plan.gold / rate / 10_000) * 10_000)}</small>
        </div>
        <div className="dex-cost-col">
          <small>아바돈 이벤트</small>
          <b>{fmtGold(plan.goldEv)} 골드</b>
          <small className="muted">≈ {wonText(Math.round(plan.goldEv / rate / 10_000) * 10_000)}</small>
        </div>
      </div>
      <button type="button" className="dex-snip-list-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        항목 {plan.picks.length}개{plan.unknown ? ` · 값 모름 ${plan.unknown}` : ""}
        {plan.bad.length > 0 && <span className="muted"> · 모르는 능력치 {plan.bad.join(", ")}</span>}
        <span className="dex-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="dex-snip-list">
          {plan.picks.map(({ e, g }) => (
            <li key={e.name}>
              <span>
                {e.name}
                {e.cat && <small className="dex-cat">{e.cat}</small>}
                <small className="muted"> {e.effects.map(effectText).join(" · ")}</small>
              </span>
              <b>{g == null ? "값 모름" : fmtGold(g)}</b>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="sub-tab dex-snip-go" onClick={goDex}>
        도감 계산기에서 보기 ›
      </button>
    </div>
  );
}
