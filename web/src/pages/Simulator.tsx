// 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04). 자료와 규칙은 src/sim.ts (컴투스 공식 확률 표 106개).
// 맨 위 같은 폭 단추 강화 · 성장 · 옵션 · 보석 · 뽑기, 그 아래 어두운 띠에서 고르고, 해 보면서 확률을 몸으로 느끼게 결과마다 짧은 움직임(transform·opacity 만)을 준다.
// 아이템은 우리가 가진 그림으로 그린다 (제작자 2026-11-04 '텍스트 말고 우리 가지고 있는 이미지 써', src/simIcons.ts). 그림이 없는 것만 글자. 강화 장면 이미지·동영상을 받으면 sim-item 자리를 그 모양으로 바꾼다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAsync } from "../data";
import { loadOdds } from "../odds";
import type { Odds } from "../odds";
import { useEntryState } from "../router";
import { BOX_CATS, GEM_NAMES, atLeast, boxFor, boxOf, boxesOf, expectedTo, gemSynth, optionFor, optionSources, pick, repairItems, scrollsOf, stepsExpected, stepsOf, tierOf } from "../sim";
import type { Box, Dist, OptItem, OptSource, Part, Scroll, Steps } from "../sim";
import { Loading, PicImg, TopBar } from "../ui";
import { ARMOR_SLOTS, CLEAR_LV, GEAR_JOBS, canBuy, gearOf, gearPower, gearStat, gearValue, unlockCost } from "../simGear";
import type { ArmorSlot, Gear, GearJob, Held } from "../simGear";
import type { Wiki } from "../types";
import { JOB_NAME } from "../auth";
import type { Me } from "../auth";
import { Nick } from "../kakao";
import { CAT_NAME, CoinCtx, SpaceCtx, fetchKing, luckOf, reachWithin, simUrl, stepsWithin, useCoinState, useCoins, useRecord, useSpace } from "../simRank";
import type { Cat, King, SimRec, Space } from "../simRank";
import { BAG_MAX, SaveCtx, expOf, legacySave, raiseExp, restoreFromRecords, useKept, useSave, useSaveState } from "../simState";
import type { SimSave } from "../simState";
import { QuestCtx, kstDay, titleOf, todayQuests, useQuest } from "../simQuest";
import type { SimEvent } from "../simQuest";
import { api } from "../auth";
import { fetchEventOdds } from "../official";
import { IconCtx, iconLookup, useIcon } from "../simIcons";
import { useBook } from "../data";
import { filterByName } from "../search";
import type { IconOf } from "../simIcons";
import type { Pic } from "../types";
import type { Book } from "../data";
import { useBackClose } from "../backClose";
import "./sim.css";

type Tab = "enhance" | "grow" | "option" | "gem" | "box" | "rank";
const TABS: { key: Tab; label: string }[] = [
  { key: "enhance", label: "강화" },
  { key: "grow", label: "성장" },
  { key: "option", label: "옵션" },
  { key: "gem", label: "보석" },
  { key: "box", label: "뽑기" },
  { key: "rank", label: "순위" },
];

/** 0.05 -> '5%', 0.00348 -> '0.348%', 아주 작으면 '0.0001% 미만' */
export function pctText(p: number): string {
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100;
  // 0.1% 보다 작으면 '1/66.7만' 처럼 (몇 번에 한 번인지가 더 와닿는다)
  if (p < 0.001) return `1/${n0(1 / p)}`;
  const d = v >= 10 ? 1 : v >= 1 ? 2 : 3;
  return `${Number(v.toFixed(d))}%`;
}
// 1억 ~ 10억은 '1.1억' (예전에는 '10667만'으로 보였다)
const n0 = (v: number) => (v >= 1e8 ? `${Number((v / 1e8).toFixed(v >= 1e9 ? 0 : 1))}억` : v >= 1e5 ? `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}만` : Math.round(v).toLocaleString());

/** 숫자가 바뀌면 잠깐 굴러가며 바뀐다 */
function Count({ value, ms = 500 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n0(shown)}</>;
}

/** 결과마다 한 번 터지는 조각 (자리와 방향은 CSS 변수로) */
function Sparks({ n = 10, kind }: { n?: number; kind: string }) {
  const parts = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
        const r = 38 + Math.random() * 34;
        return { dx: Math.cos(a) * r, dy: Math.sin(a) * r - 10, d: Math.random() * 0.12 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind],
  );
  return (
    <span className={`sim-sparks sim-sparks-${kind}`} aria-hidden>
      {parts.map((s, i) => (
        <i key={i} style={{ ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px`, animationDelay: `${s.d}s` }} />
      ))}
    </span>
  );
}

/** 이름으로 찾은 우리 그림 (없으면 아무것도 안 그린다) */
function NameIcon({ name, size = 24 }: { name: string; size?: number }) {
  const pic: Pic | null = useIcon()(name);
  return pic ? <PicImg pic={pic} fit={size} className="sim-pic" /> : null;
}

/** 그림 칸: 그림이 없으면 도트 보석 */
function IconBox({ name, size = 30 }: { name: string; size?: number }) {
  const pic: Pic | null = useIcon()(name);
  return <span className="sim-ib" style={{ width: size + 8, height: size + 8 }}>{pic ? <PicImg pic={pic} fit={size} className="sim-pic" /> : <i className="sim-ib-none" />}</span>;
}

/** 확률 막대: 칸마다 색 (ok 성공 · gold 대성공 · bad 파괴 · keep 그대로), 아래에 이름과 % */
function OddsBar({ parts }: { parts: { p: number; tone: "ok" | "gold" | "bad" | "keep"; label: string }[] }) {
  const shown = parts.filter((x) => x.p > 0);
  return (
    <div className="sim-odds">
      <div className="sim-odds-bar" aria-hidden>
        {shown.map((x, i) => (
          <i key={i} className={`sim-odds-${x.tone}`} style={{ flexGrow: Math.max(x.p, 0.012) }} />
        ))}
      </div>
      <div className="sim-odds-lab">
        {shown.map((x, i) => (
          <span key={i} className={`sim-odds-t-${x.tone}`}>
            {x.label} <b>{pctText(x.p)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 숫자 셋 한 줄 띠 */
function StatStrip({ items }: { items: { label: string; value: number; tone?: string; unit?: string }[] }) {
  return (
    <div className="sim-stats">
      {items.map((x) => (
        <span key={x.label}>
          <small>{x.label}</small>
          <b className={x.value ? (x.tone ?? "") : ""}>
            <Count value={x.value} ms={250} />
            {x.unit ?? ""}
          </b>
        </span>
      ))}
    </div>
  );
}

/** 접는 칸 (연 것은 기록 칸마다 기억) */
function Fold({ k, title, children }: { k: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useEntryState(`sim.fold.${k}`, false);
  return (
    <section className={"panel sim-fold" + (open ? " sim-fold-open" : "")}>
      <button type="button" className="sim-fold-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{title}</b>
        <i className="sim-chev" aria-hidden />
      </button>
      {open && <div className="sim-fold-b">{children}</div>}
    </section>
  );
}

export function SimulatorPage({ wiki, me, space }: { wiki: Wiki; me: Me; space: Space }) {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []), "odds");
  const [tabRaw, setTab] = useEntryState<Tab>("sim.tab", "enhance");
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "enhance";
  const coin = useCoinState(space);
  // 진행 상황 (장비, 보관함, 직접 겪은 것): 서버에 (src/simState.ts). 지갑을 받으면 시작
  const saveState = useSaveState(space, coin.wallet ? ((coin.wallet.state as SimSave | null) ?? null) : undefined);
  // 테스트판을 처음 열면 예전 폰 자료와 순위 기록의 장비를 한 번 옮긴다 (제작자 2026-11-04 '8강 참나무지팡이 어디 감')
  const restoring = useRef(false);
  useEffect(() => {
    if (!saveState.ready || space !== "test" || saveState.save.restored || restoring.current) return;
    restoring.current = true;
    const base: SimSave = Object.keys(saveState.save).length ? saveState.save : legacySave(me.id);
    fetchKing(space).then(
      (d) => saveState.set(restoreFromRecords(base, d.mine)),
      () => saveState.set({ ...base, restored: true }),
    );
  }, [saveState, space, me.id]);
  const today =
    (coin.wallet?.rules.reduce((t, r) => t + r.n * r.coin, 0) ?? 0) + (coin.wallet?.quests.filter(Boolean).length ?? 0) * (coin.wallet?.questCoin ?? 0) + (coin.wallet?.streak?.bonus ?? 0);
  // 오늘의 도전 (src/simQuest.ts): 결과마다 알리면 맞는 도전을 깨고 코인을 받는다.
  // 화면을 켜 둔 채 0시가 지나면 새 날의 도전으로 바꾼다 (예전에는 어제 도전을 깨면 오늘 같은 번호 도전의 코인이 들어갔다)
  const { reload } = coin;
  const [day, setDay] = useState(kstDay);
  const quests = useMemo(() => todayQuests(day), [day]);
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  const doneRef = useRef(done);
  const doneDay = useRef(day);
  useEffect(() => {
    if (!coin.wallet) return;
    // 서버 값에 이 화면에서 막 깬 것을 더한다 (보낸 도전이 서버에 닿기 전에 지갑을 다시 받으면 깬 표시가 풀리고 축하가 또 떴다)
    const now = kstDay();
    const mine = doneDay.current === now ? doneRef.current : [false, false, false];
    doneDay.current = now;
    setDay(now);
    doneRef.current = coin.wallet.quests.map((x, i) => x || !!mine[i]);
    setDone(doneRef.current);
  }, [coin.wallet]);
  const [cheer, setCheer] = useState<{ text: string; n: number } | null>(null);
  const emit = useCallback(
    (e: SimEvent) => {
      if (kstDay() !== day) {
        reload();
        return;
      }
      quests.forEach((q, i) => {
        if (doneRef.current[i] || !q.done(e)) return;
        doneRef.current = doneRef.current.map((x, j) => x || j === i);
        setDone(doneRef.current);
        setCheer((c) => ({ text: q.text, n: (c?.n ?? 0) + 1 }));
        api<{ coins: number; got: boolean }>(simUrl("/api/sim/wallet", space), "POST", { quest: i }).then(() => reload(), () => undefined);
      });
    },
    [quests, day, reload, space],
  );
  useEffect(() => {
    if (!cheer) return;
    const t = window.setTimeout(() => setCheer(null), 2600);
    return () => window.clearTimeout(t);
  }, [cheer]);
  // 전광판은 30초마다 다시 (예전에는 시도할 때마다 화면이 다시 그려지며 타이머가 새로 시작돼, 누르는 동안에는 전광판이 바뀌지 않았다)
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), 30_000);
    return () => window.clearInterval(t);
  }, [reload]);
  // 위키에 없는 물건(코스튬 등)의 그림 목록 (시세 동향 그림, 없으면 위키 그림만)
  const [trendPics, setTrendPics] = useState<Record<string, [number, number]> | null>(null);
  useEffect(() => {
    fetch("/data/trend/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v && typeof v === "object" && setTrendPics(v))
      .catch(() => {});
  }, []);
  const book = useBook();
  const iconOf: IconOf = useMemo(() => iconLookup(wiki, trendPics, book), [wiki, trendPics, book]);
  return (
    <SpaceCtx.Provider value={space}>
    <SaveCtx.Provider value={saveState}>
    <CoinCtx.Provider value={coin}>
      <QuestCtx.Provider value={emit}>
      <IconCtx.Provider value={iconOf}>
      <TopBar title="확률 시뮬레이터" />
      <div className="pill-row sim-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <SimHud coin={coin} today={today} quests={quests} done={done} onRank={() => setTab("rank")} />
      {cheer && (
        <div key={cheer.n} className="sim-cheer" role="status">
          <b>+{coin.wallet?.questCoin ?? 30}</b>
          <span>{cheer.text}</span>
        </div>
      )}
      {!odds || !saveState.ready || (space === "test" && !saveState.save.restored) ? (
        <Loading error={error} />
      ) : tab === "enhance" ? (
        <EnhanceTab odds={odds} wiki={wiki} me={me} />
      ) : tab === "grow" ? (
        <StatSim odds={odds} wiki={wiki} />
      ) : tab === "option" ? (
        <OptionSim odds={odds} />
      ) : tab === "gem" ? (
        <GemTab odds={odds} />
      ) : tab === "box" ? (
        <BoxSim odds={odds} />
      ) : (
        <RankTab odds={odds} wiki={wiki} me={me} />
      )}
      </IconCtx.Provider>
      </QuestCtx.Provider>
    </CoinCtx.Provider>
    </SaveCtx.Provider>
    </SpaceCtx.Provider>
  );
}

/** 맨 위 한 줄 (2026-11-19 개편: 설명 없이 콤팩트하게): 도는 동전과 코인 수(바뀌면 ±가 떠오른다), 오늘 번 코인, 연속 접속, 칭호, 오늘의 도전 점 셋(누르면 펼침), 전광판 */
function SimHud({ coin, today, quests, done, onRank }: { coin: ReturnType<typeof useCoinState>; today: number; quests: { id: string; text: string }[]; done: boolean[]; onRank: () => void }) {
  const w = coin.wallet;
  const streak = w?.streak?.days ?? 0;
  const empty = coin.coins === 0;
  const [open, setOpen] = useEntryState("sim.quests", false);
  // 코인이 바뀐 만큼 잠깐 떠오른다
  const prev = useRef<number | null>(coin.coins);
  const [delta, setDelta] = useState<{ v: number; n: number } | null>(null);
  useEffect(() => {
    const a = prev.current;
    prev.current = coin.coins;
    if (a === null || coin.coins === null || a === coin.coins) return;
    const v = coin.coins - a;
    setDelta((d) => ({ v, n: (d?.n ?? 0) + 1 }));
  }, [coin.coins]);
  return (
    <section className={"sim-hud" + (empty ? " sim-hud-empty" : "")}>
      <div className="sim-hud-row">
        <button type="button" className="sim-hud-coin" onClick={onRank} aria-label="행운 코인">
          <span className="sim-coin-pic" aria-hidden>
            <i />
          </span>
          <b key={coin.coins ?? -1}>{coin.coins === null ? "…" : coin.coins.toLocaleString()}</b>
          {delta && (
            <em key={delta.n} className={"sim-hud-delta" + (delta.v > 0 ? " sim-hud-plus" : "")} aria-hidden>
              {delta.v > 0 ? "+" : ""}
              {delta.v.toLocaleString()}
            </em>
          )}
        </button>
        <span className="sim-hud-chips">
          {today > 0 && <i className="sim-hud-today">+{today}</i>}
          {streak >= 2 && <i className="sim-hud-streak">{streak}일</i>}
          {w && <i className="sim-title">{titleOf(w.total)}</i>}
        </span>
        <button type="button" className="sim-hud-q" aria-expanded={open} aria-label="오늘의 도전" onClick={() => setOpen(!open)}>
          {quests.map((q, i) => (
            <i key={q.id} className={done[i] ? "on" : ""} />
          ))}
        </button>
      </div>
      {open && (
        <div className="sim-hud-quests">
          {quests.map((q, i) => (
            <span key={q.id} className={done[i] ? "sim-q-done" : ""}>
              <i className="sim-q-box" aria-hidden />
              {q.text}
              <small>+{w?.questCoin ?? 30}</small>
            </span>
          ))}
        </div>
      )}
      {w && w.feed.length > 0 && <Ticker feed={w.feed} />}
    </section>
  );
}

/** 전광판: 길드원들의 1/100 보다 드문 결과가 오른쪽에서 왼쪽으로 흐른다 */
function Ticker({ feed }: { feed: { user_id: string; label: string; luck: number; at: number }[] }) {
  const items = feed.map((f, i) => (
    <span key={i} className="sim-tick">
      <Nick name={f.user_id} /> <b>{f.label}</b> <small>{luckText(f.luck)}</small>
    </span>
  ));
  return (
    <div className="sim-ticker" aria-label="전광판">
      <div className="sim-ticker-run" style={{ animationDuration: `${Math.max(12, feed.length * 5)}s` }}>
        {items}
        {items}
      </div>
    </div>
  );
}

const luckText = (luck: number) => `1/${n0(Math.pow(10, luck))}`;

/** 시뮬레이터 하나의 순위 (5위까지와 내 기록). luck 이면 드문 정도로, 아니면 몇 번 만에. 기록이 없으면 그리지 않는다 */
export function RankBox({ rec, title, luck = false }: { rec: ReturnType<typeof useRecord>; title: string; luck?: boolean }) {
  const d = rec.data;
  if (!d) return null;
  const top = d.board.slice(0, 5);
  const mine = d.mine;
  if (!top.length && !mine) return null;
  const line = (r: SimRec) => (luck ? luckText(r.luck) : `${r.tries.toLocaleString()}번`);
  const row = (r: SimRec, rank: number, me = false) => (
    <div key={me ? "me" : r.user_id} className={`sim-rank-row sim-rank-${rank}` + (me ? " sim-rank-mine" : "")}>
      <em>{rank}</em>
      <span className="sim-rank-who">{me ? "나" : <Nick name={r.user_id} />}</span>
      <b>{r.label}</b>
      <small>{line(r)}</small>
    </div>
  );
  return (
    <section className="panel sim-rank">
      <div className="sim-head">
        <b>순위</b>
        <small>{title}</small>
      </div>
      {top.map((r, i) => row(r, i + 1))}
      {mine && (mine.rank ?? 99) > 5 && row(mine, mine.rank ?? 99, true)}
    </section>
  );
}

/** 이름표: 기록의 game 을 사람이 읽는 이름으로 */
function gameNamer(odds: Odds) {
  const boxes = new Map(boxesOf(odds).map((b) => [b.key, b]));
  const polish = boxOf(odds, "30201");
  if (polish) boxes.set(polish.key, polish);
  const steps = new Map(stepsOf(odds).map((x) => [x.key, x.name]));
  const srcs = new Map(optionSources(odds).map((x) => [x.key, x.name]));
  return (game: string) => {
    const [k, a, b, c] = game.split(":");
    if (k === "box" && !boxes.has(a) && eventBoxCache.has(a)) boxes.set(a, eventBoxCache.get(a)!);
    if (k === "enh") return `${a} · ${b} 마법서${c ? " (이벤트)" : ""}`;
    if (k === "stat") return steps.get(a) ?? "스탯 부여";
    if (k === "repair") return a;
    if (k === "opt") return `${srcs.get(a) ?? "옵션"} · ${b}`;
    if (k === "gem") return "보석 합성";
    if (k === "box") {
      const box = boxes.get(a);
      return box ? `${box.name}${b !== undefined && box.sections[Number(b)] ? ` · ${box.sections[Number(b)].title}` : ""}` : "상자";
    }
    return game;
  };
}

/** 순위 칸: 도박의 신(묶음마다 가장 드문 기록의 운을 더한 것), 시뮬레이터마다 1위, 강화 도감, 코인 버는 법 */
function RankTab({ odds, wiki, me }: { odds: Odds; wiki: Wiki; me: Me }) {
  const coin = useCoins() as ReturnType<typeof useCoinState>;
  const space = useSpace();
  const { save } = useSave();
  const [data, setData] = useState<{ king: King[]; firsts: SimRec[]; mine: SimRec[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchKing(space).then(setData, (e) => setErr(String(e)));
    coin.reload?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name = useMemo(() => gameNamer(odds), [odds]);
  const w = coin.wallet;
  const streak = w?.streak;
  if (!data) return <Loading error={err} />;
  const parts = (s: string) =>
    s
      .split(",")
      .map((x) => x.split(":"))
      .filter((x) => x.length === 2)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
  const done = w ? w.rules.filter((r) => r.n >= r.cap).length : 0;
  return (
    <div className="sim">
      {data.king.length > 0 && (
        <section className="panel sim-king">
          <div className="sim-head">
            <b>도박의 신</b>
          </div>
          {data.king.map((k, i) => (
            <div key={k.user_id} className={`sim-king-row sim-rank-${i + 1}`}>
              <em>{i + 1}</em>
              <span className="sim-rank-who">
                <Nick name={k.user_id} />
              </span>
              <b>{k.total.toFixed(1)}</b>
              <span className="sim-king-parts">
                {parts(k.parts).map(([c, v]) => (
                  <i key={c}>
                    {CAT_NAME[c as Cat] ?? c} {Number(v).toFixed(1)}
                  </i>
                ))}
              </span>
            </div>
          ))}
        </section>
      )}
      {data.firsts.length > 0 && (
        <section className="panel sim-rank">
          <div className="sim-head">
            <b>1위</b>
          </div>
          {data.firsts.map((r) => (
            <div key={r.game} className="sim-first-row">
              <small>{name(r.game ?? "")}</small>
              <span>
                <Nick name={r.user_id} /> <b>{r.label}</b>
              </span>
              <em>{/^(enh|stat):/.test(r.game ?? "") ? `${r.tries.toLocaleString()}번` : luckText(r.luck)}</em>
            </div>
          ))}
        </section>
      )}
      <GearDex odds={odds} wiki={wiki} me={me} best={save.best ?? {}} />
      {w && (
        <section className="panel sim-earn">
          <div className="sim-head">
            <b>코인 벌기</b>
            <small>
              {done}/{w.rules.length}
            </small>
          </div>
          <div className="sim-earn-grid">
            {streak && (
              <div className={"sim-earn-cell sim-earn-streak" + (streak.bonus ? "" : " sim-earn-wait")}>
                <span>연속 접속</span>
                <b>{streak.bonus ? `+${streak.bonus}` : `+${streak.step}`}</b>
                <small>{streak.days}일</small>
              </div>
            )}
            {w.rules.map((r) => {
              const body = (
                <>
                  <span>{r.label}</span>
                  <b>+{r.coin}</b>
                  <small>
                    {r.n}/{r.cap}
                  </small>
                  <i className="sim-earn-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${Math.min(1, r.n / r.cap)})` }} />
                  </i>
                </>
              );
              const cls = "sim-earn-cell" + (r.n >= r.cap ? " sim-earn-done" : "");
              return r.to && r.n < r.cap ? (
                <a key={r.key} className={cls} href={r.to}>
                  {body}
                </a>
              ) : (
                <div key={r.key} className={cls}>
                  {body}
                </div>
              );
            })}
            {w.sold && (
              <div className={"sim-earn-cell" + (w.sold.n >= w.sold.cap ? " sim-earn-done" : "")}>
                <span>장비 팔기</span>
                <b>시세</b>
                <small>
                  {w.sold.n}/{w.sold.cap}
                </small>
                <i className="sim-earn-bar" aria-hidden>
                  <i style={{ transform: `scaleX(${Math.min(1, w.sold.n / w.sold.cap)})` }} />
                </i>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** 강화 도감 (2026-11-17 고도화): 장비마다 닿은 가장 높은 강화도 (팔거나 부서져도 남는다). 무기는 직업마다, 방어구는 부위마다 한 칸 */
const DEX_SECTIONS: { key: string; label: string; part: Part; kind: string }[] = [
  ...GEAR_JOBS.map((j) => ({ key: j, label: `${j} 무기`, part: "무기" as Part, kind: j })),
  ...ARMOR_SLOTS.map((a) => ({ key: a, label: a, part: "갑옷" as Part, kind: a })),
];
function GearDex({ odds, wiki, me, best }: { odds: Odds; wiki: Wiki; me: Me; best: Record<string, number> }) {
  const gears = useMemo(() => gearOf(wiki, odds), [wiki, odds]);
  const myJob = (me.job ? JOB_NAME[me.job] : "전사") as GearJob;
  const [sec, setSec] = useEntryState("sim.dex", myJob as string);
  const cur = DEX_SECTIONS.find((x) => x.key === sec) ?? DEX_SECTIONS[0];
  const list = gears.filter((g) => g.part === cur.part && g.kind === cur.kind);
  const got = gears.filter((g) => (best[g.name] ?? 0) > 0);
  const top = got.reduce((m, g) => Math.max(m, best[g.name] ?? 0), 0);
  const count = (x: (typeof DEX_SECTIONS)[number]) => gears.filter((g) => g.part === x.part && g.kind === x.kind && (best[g.name] ?? 0) > 0).length;
  return (
    <section className="panel sim-dex">
      <div className="sim-head">
        <b>강화 도감</b>
        <small>
          {got.length}/{gears.length}
          {top ? ` · +${top}` : ""}
        </small>
      </div>
      <div className="mk-sub sim-dex-strip">
        <div className="mk-cats" role="tablist">
          {DEX_SECTIONS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={x.key === cur.key} className={"sub-tab" + (x.key === cur.key ? " sub-tab-on" : "")} onClick={() => setSec(x.key)}>
              {x.key}
              <small>{count(x)}</small>
            </button>
          ))}
        </div>
      </div>
      <ul className="sim-dex-grid" aria-label={cur.label}>
        {list.map((g) => {
          const lv = best[g.name] ?? 0;
          return (
            <li key={g.name} className={lv ? `sim-dex-got sim-aura-${auraOf(lv)}` : "sim-dex-none"} title={`${g.name} Lv.${g.lv}`}>
              <span className="sim-dex-pic">{g.icon ? <PicImg pic={g.icon} fit={30} className="sim-pic" /> : <small>{g.name.slice(0, 3)}</small>}</span>
              <b>{lv ? `+${lv}` : "?"}</b>
              <small>Lv.{g.lv}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ================================================================ 강화

/** 강화 칸: 장비 강화 · 장비 수리(수리하면 강화도가 다시 정해진다, 공식 표 80101) */
function EnhanceTab({ odds, wiki, me }: { odds: Odds; wiki: Wiki; me: Me }) {
  const [mode, setMode] = useEntryState<"up" | "repair">("sim.emode", "up");
  const head = (
    <div className="mk-cats" role="tablist">
      {(
        [
          ["up", "장비 강화"],
          ["repair", "장비 수리"],
        ] as const
      ).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={mode === k} className={"sub-tab sim-mode" + (mode === k ? " sub-tab-on" : "")} onClick={() => setMode(k)}>
          {l}
        </button>
      ))}
    </div>
  );
  return mode === "up" ? <EnhanceSim odds={odds} head={head} wiki={wiki} me={me} /> : <RepairSim odds={odds} head={head} />;
}

function RepairSim({ odds, head }: { odds: Odds; head: React.ReactNode }) {
  const items = useMemo(() => repairItems(odds), [odds]);
  const [i, setI] = useEntryState("sim.repair", 0);
  const item = items[i] ?? items[0];
  if (!item) return <div className="empty">수리 자료가 없어요</div>;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <div className="mk-cats" role="tablist">
          {items.map((x, j) => (
            <button key={x.name} type="button" role="tab" aria-selected={j === i} className={"sub-tab" + (j === i ? " sub-tab-on" : "")} onClick={() => setI(j)}>
              {x.name.replace(" 수리", "")}
            </button>
          ))}
        </div>
      </div>
      <OptionRoller key={item.name} item={item} verb="수리" game={`repair:${item.name}`} cat="enhance" />
    </div>
  );
}

interface Fx {
  /** ok 성공, keep 실패(그대로), break 파괴, plus2 대성공, buy 새로 산 장비 */
  kind: "ok" | "keep" | "break" | "plus2" | "buy";
  n: number;
  /** 크게 터뜨릴 성공 (드문 성공이나 높은 강화) */
  big?: boolean;
}
type LogDot = { to: number; ok: boolean; broke?: boolean; plus?: number };
/** 두근두근 한 번: 확률 p, 바늘이 멈출 자리(0~1, p 보다 왼쪽이면 성공), 걸리는 때 */
interface Charge {
  p: number;
  stop: number;
  dur: number;
  ok: boolean;
  n: number;
}
/** 모루 둘레에 떠오르는 불티 (가로 자리 %, 늦게 시작 s, 한 번 도는 때 s, 크기 px). 늘 도는 움직임이라 transform·opacity 만 */
const EMBERS: [number, number, number, number][] = [
  [8, 0, 5.2, 3], [18, 1.6, 6.1, 2], [31, 0.4, 4.6, 3], [44, 2.2, 5.8, 2], [57, 1.1, 5.1, 3], [69, 2.9, 6.4, 2], [82, 0.8, 4.9, 3], [93, 2.4, 5.5, 2], [25, 3.3, 7, 2], [75, 3.8, 6.8, 2],
];
/** 강화도마다 빛 단계: +4 파랑, +7 보라, +9 금빛, +11 무지개 */
const auraOf = (lv: number) => (lv >= 11 ? 4 : lv >= 9 ? 3 : lv >= 7 ? 2 : lv >= 4 ? 1 : 0);

/** 확률 게이지: 왼쪽 p 만큼이 성공 칸. 바늘이 흔들리다 점점 느려져 정해진 자리에 멈춘다 (결과는 누를 때 이미 정해져 있다) */
function Gauge({ c, keep, onDone }: { c: Charge; keep: boolean; onDone: () => void }) {
  const needle = useRef<HTMLElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => done.current(), 200);
      return () => window.clearTimeout(t);
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / c.dur);
      // 흔들림: 처음엔 크게 빠르게, 끝으로 갈수록 작고 느리게 멈출 자리로
      const amp = 0.55 * (1 - k) ** 1.6;
      const x = Math.min(1, Math.max(0, c.stop + amp * Math.sin(k * Math.PI * 2 * (5 - 3 * k))));
      if (needle.current) needle.current.style.transform = `translateX(${(x * 100).toFixed(2)}%)`;
      if (k < 1) raf = requestAnimationFrame(tick);
      else window.setTimeout(() => done.current(), 160);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [c]);
  return (
    <div className="sim-gauge" aria-hidden>
      <div className="sim-gauge-bar">
        <i className="sim-gauge-ok" style={{ width: `max(3px, ${(c.p * 100).toFixed(3)}%)` }} />
        <i className={"sim-gauge-no" + (keep ? " sim-gauge-keep" : "")} />
        <span className="sim-gauge-track">
          <b ref={needle} className="sim-needle" />
        </span>
      </div>
      <div className="sim-gauge-lab">
        <span className="sim-good">{pctText(c.p)}</span>
        <span className={keep ? "sim-muted" : "sim-bad"}>{keep ? "유지" : "파괴"}</span>
      </div>
    </div>
  );
}

/** 장비 상점: 실제 장비를 +0(노작)으로 산다. 레벨이 높을수록 비싸다 (src/simGear.ts) */
function GearShop({ gears, part, job, setJob, slot, setSlot, onBuy, coins, onClose, cleared, bag, onTake, valueOf, onSell }: {
  gears: Gear[];
  /** 내 장비 (보관함): 다른 장비를 사거나 꺼내도 남는다 (src/simState.ts) */
  bag: Held[];
  onTake: (i: number) => void;
  /** 장비 시세 (simGear.ts gearValue)와 보관함 장비 팔기 (2026-11-17) */
  valueOf: (g: Gear, lv: number) => number;
  onSell: (i: number, value: number) => void;
  cleared: Set<string>;
  part: Part;
  job: GearJob;
  setJob: (j: GearJob) => void;
  slot: ArmorSlot;
  setSlot: (s: ArmorSlot) => void;
  onBuy: (g: Gear) => void;
  coins: number | null;
  onClose?: () => void;
}) {
  const list = gears.filter((g) => g.part === part && g.jobs.includes(job) && (part === "무기" || g.kind === slot));
  // 보관함 장비 팔기는 두 번 눌러야 한다 (한 번 누르면 3초 동안 '정말 팔기')
  const [sellIdx, setSellIdx] = useState(-1);
  useEffect(() => {
    if (sellIdx < 0) return;
    const t = window.setTimeout(() => setSellIdx(-1), 3000);
    return () => window.clearTimeout(t);
  }, [sellIdx]);
  const openList = list.filter((_, i) => canBuy(list, i, cleared));
  const locked = list.filter((_, i) => !canBuy(list, i, cleared));
  return (
    <section className="panel sim-shop">
      <div className="mk-sub sim-shop-filter">
        <div className="mk-cats" role="tablist">
          {GEAR_JOBS.map((j) => (
            <button key={j} type="button" role="tab" aria-selected={job === j} className={"sub-tab" + (job === j ? " sub-tab-on" : "")} onClick={() => setJob(j)}>
              {j}
            </button>
          ))}
          {onClose && (
            <button type="button" className="sim-shop-x" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          )}
        </div>
        {part === "갑옷" && (
          <div className="mk-cats" role="tablist">
            {ARMOR_SLOTS.map((x) => (
              <button key={x} type="button" role="tab" aria-selected={slot === x} className={"sub-tab" + (slot === x ? " sub-tab-on" : "")} onClick={() => setSlot(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
      </div>
      {bag.length > 0 && (
        <>
          <div className="sim-head sim-head-sub">
            <b>내 장비</b>
            <small>{bag.length}</small>
          </div>
          <ul className="sim-shop-list sim-bag">
            {bag.map((h, i) => {
              const g = gears.find((x) => x.part === part && x.name === h.name);
              const v = g ? valueOf(g, h.lv) : 0;
              return (
                <li key={`${h.name}-${i}`} className={`sim-bag-${auraOf(h.lv)}`}>
                  <span className="sim-shop-pic">{g?.icon ? <PicImg pic={g.icon} fit={28} className="sim-pic" /> : null}</span>
                  <span className="sim-shop-name">
                    <b>
                      <em>+{h.lv}</em> {h.name}
                    </b>
                    <small>{g ? gearStat(g, h.lv) : ""}</small>
                  </span>
                  {v > 0 && (
                    <button type="button" className={"sim-mini sim-sell" + (sellIdx === i ? " sim-sell-sure" : "")} onClick={() => (sellIdx === i ? (setSellIdx(-1), onSell(i, v)) : setSellIdx(i))}>
                      {sellIdx === i ? "팔기?" : "팔기"} <small>{v.toLocaleString()}</small>
                    </button>
                  )}
                  <button type="button" className="sim-mini sim-take" onClick={() => onTake(i)}>
                    꺼내기
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="sim-head sim-head-sub">
            <b>상점</b>
          </div>
        </>
      )}
      <ul className="sim-shop-list">
        {openList.map((g) => (
          <li key={g.name}>
            <span className="sim-shop-pic">{g.icon ? <PicImg pic={g.icon} fit={28} className="sim-pic" /> : null}</span>
            <span className="sim-shop-name">
              <b>{g.name}</b>
              <small>
                Lv.{g.lv} · {gearStat(g, 0)}
              </small>
            </span>
            {cleared.has(g.name) && <span className="sim-shop-clear">+{CLEAR_LV[part]}</span>}
            <button type="button" className="sim-buy" disabled={coins === null || coins < g.price} onClick={() => onBuy(g)}>
              <i className="sim-c" aria-hidden />
              {g.price}
            </button>
          </li>
        ))}
        {!list.length && <li className="sim-muted">없음</li>}
      </ul>
      {locked.length > 0 && (
        <ul className="sim-locked" aria-label="잠김">
          {locked.map((g) => (
            <li key={g.name} title={`${g.name} Lv.${g.lv}`}>
              {g.icon ? <PicImg pic={g.icon} fit={24} className="sim-pic" /> : null}
              <small>{g.lv}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnhanceSim({ odds, head, wiki, me }: { odds: Odds; head: React.ReactNode; wiki: Wiki; me: Me }) {
  const all = useMemo(() => scrollsOf(odds), [odds]);
  const gears = useMemo(() => gearOf(wiki, odds), [wiki, odds]);
  const [part, setPart] = useEntryState<Part>("sim.part", "무기");
  const [name, setName] = useEntryState("sim.scroll", "일반");
  const [ev, setEv] = useEntryState("sim.ev", false);
  const myJob = (me.job ? JOB_NAME[me.job] : "전사") as GearJob;
  const [job, setJob] = useEntryState<GearJob>("sim.gjob", myJob);
  const [slot, setSlot] = useEntryState<ArmorSlot>("sim.gslot", "갑옷");
  const scroll = all.find((s) => s.part === part && s.name === name) ?? all.find((s) => s.part === part)!;
  const rates = ev && scroll.event ? scroll.event : scroll.rates;
  const rate = (lv: number) => rates[lv] ?? 0;
  // 들고 있는 장비·보관함·+8 기록·직접 겪은 것은 서버에 (src/simState.ts, 테스트판과 개발 중판 따로): 다시 열어도, 다른 폰에서도 그대로
  const { save, update } = useSave();
  const [held, setHeldState] = useState<Held | null>(() => save.held?.[part] ?? null);
  const heldRef = useRef(held);
  const setHeld = (h: Held | null, of: Part = part) => {
    heldRef.current = h;
    setHeldState(h);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [of]: h } }));
  };
  const gear = held ? gears.find((g) => g.part === part && g.name === held.name) : undefined;
  const bag = save.bag?.[part] ?? [];
  // 앞 장비를 +8(방어구 +6)까지 올려야 다음 장비를 산다 (simGear.ts CLEAR_LV)
  const cleared = useMemo(() => new Set(save.cleared ?? []), [save.cleared]);
  const shopList = (g: Gear) => gears.filter((x) => x.part === g.part && (g.part === "무기" ? x.kind === g.kind : x.kind === g.kind && x.jobs.includes(job)));
  const buyable = (g: Gear) => {
    const list = shopList(g);
    const i = list.findIndex((x) => x.name === g.name);
    return i >= 0 && canBuy(list, i, cleared);
  };
  const [shop, setShop] = useState(false);
  const lv = held?.lv ?? 0;
  const broken = held?.broken ?? false;
  // 장비 시세 (2026-11-17 고도화, simGear.ts gearValue): 지금 팔면, 다음 강화가 되면
  const valueOf = useCallback((g: Gear, k: number) => gearValue(g, k, all), [all]);
  const value = gear && !broken ? valueOf(gear, lv) : 0;
  const [selling, setSelling] = useState(false);
  useEffect(() => {
    if (!selling) return;
    const t = window.setTimeout(() => setSelling(false), 3000);
    return () => window.clearTimeout(t);
  }, [selling]);
  const [sold, setSold] = useState<{ name: string; lv: number; value: number; n: number } | null>(null);
  useEffect(() => {
    if (!sold) return;
    const t = window.setTimeout(() => setSold(null), 2600);
    return () => window.clearTimeout(t);
  }, [sold]);
  const afterSell = (h: Held, v: number) => {
    setSold((x) => ({ name: h.name, lv: h.lv, value: v, n: (x?.n ?? 0) + 1 }));
    update((s) => ({ ...s, sold: { n: (s.sold?.n ?? 0) + 1, coins: (s.sold?.coins ?? 0) + v } }));
  };
  // 들고 있는 장비 팔기 (두 번 눌러): 팔리면 빈손이 되어 상점이 열린다
  const sellHeld = async () => {
    const h = heldRef.current;
    if (!h || h.broken || !value) return;
    if (!selling) {
      setSelling(true);
      return;
    }
    setSelling(false);
    if (!(await coins.sell(value))) return;
    clearFx();
    heldRef.current = null;
    setHeldState(null);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [part]: null } }));
    afterSell(h, value);
  };
  const sellBag = async (i: number, v: number) => {
    const list = save.bag?.[part] ?? [];
    const h = list[i];
    if (!h || !(await coins.sell(v))) return;
    update((s) => ({ ...s, bag: { ...(s.bag ?? {}), [part]: (s.bag?.[part] ?? []).filter((_, j) => j !== i) } }));
    afterSell(h, v);
  };
  const [fx, setFx] = useState<Fx | null>(null);
  const [gain, setGain] = useState<{ from: string; to: string; pct: number; n: number } | null>(null);
  // 시도·부서진 장비·쓴 코인과 결과 점은 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const [stats, setStats] = useKept((s) => s.enh?.n, (s, v) => ({ ...s, enh: { ...s.enh, n: v } }), { tries: 0, broke: 0, best: 0, coins: 0 });
  const [log, setLog] = useKept<LogDot[]>((s) => s.enh?.log, (s, v) => ({ ...s, enh: { ...s.enh, log: v } }), []);
  const [goal, setGoal] = useState(part === "무기" ? 8 : 6);
  // 자동은 직접 강화해 닿아 본 강화도까지만 (제작자 2026-11-04 '자동 강화는 우리가 강화해 본 곳까지만, 내가 수동으로 겪은 것만 자동으로')
  const expMax = held ? expOf(save, `enh:${held.name}`) : 0;
  const autoGoal = Math.min(goal, expMax);
  const [auto, setAuto] = useState(false);
  const coins = useCoins();
  // 장비마다 해금 (코인): 자동 강화, 자동 구매(자동 강화 중에 부서지면 같은 장비를 다시 사서 목표까지 이어 간다)
  // 자동 구매 켬/끔도 진행 상황에 (캐릭터마다)
  const autoBuy = !!save.autoBuy;
  const setAutoBuy = (v: boolean) => update((s) => ({ ...s, autoBuy: v }));
  const autoKey = held ? `auto:${held.name}` : "";
  const buyKey = held ? `buy:${held.name}` : "";
  const autoOn = !!held && coins.unlocks.has(autoKey);
  const buyOn = !!held && coins.unlocks.has(buyKey);
  const rebuyOn = autoOn && buyOn && autoBuy;
  const rebuyRef = useRef(rebuyOn);
  rebuyRef.current = rebuyOn;
  const brokeAt = useRef(0);
  const [unlocking, setUnlocking] = useState(false);
  const doUnlock = async (key: string, cost: number) => {
    setUnlocking(true);
    await coins.unlock(key, cost);
    setUnlocking(false);
  };
  // 순위: 무기·갑옷과 마법서(이벤트 확률은 따로)마다. 산 장비로 몇 번 만에 몇 강, 점수는 강화한 장비의 세기(무기 평균 데미지, 방어구 방어도)라서 강한 장비일수록 위
  const game = `enh:${part}:${scroll.name}${ev && scroll.event ? ":ev" : ""}`;
  const rec = useRecord(game);
  const emit = useQuest();
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const [charge, setCharge] = useState<Charge | null>(null);

  const clearFx = () => {
    setFx(null);
    setGain(null);
    setSelling(false);
    setAuto(false);
    comboRef.current = 0;
    setCombo(0);
  };
  // 새로 사면 들고 있던 장비(부서지지 않은 것)는 보관함으로 (제작자 2026-11-04 '8강 참나무지팡이가 장비 바꾸기 누르니까 없어졌네')
  const buy = (g: Gear) => {
    if (!buyable(g) || coins.coins === null || coins.coins < g.price || coins.take(g.price) < g.price) return;
    clearFx();
    const cur = heldRef.current;
    const item: Held = { name: g.name, lv: 0, broken: false, tries: 0, tainted: false };
    heldRef.current = item;
    setHeldState(item);
    update((s) => {
      const list = s.bag?.[part] ?? [];
      return { ...s, held: { ...(s.held ?? {}), [part]: item }, bag: { ...(s.bag ?? {}), [part]: cur && !cur.broken ? [cur, ...list].slice(0, BAG_MAX) : list } };
    });
    setStats((s) => ({ ...s, coins: s.coins + g.price }));
    setShop(false);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
  };
  // 보관함에서 꺼내기: 들고 있던 것(부서지지 않은 것)은 보관함으로
  const takeOut = (i: number) => {
    const list = [...bag];
    const [item] = list.splice(i, 1);
    if (!item) return;
    const cur = heldRef.current;
    if (cur && !cur.broken) list.unshift(cur);
    clearFx();
    heldRef.current = item;
    setHeldState(item);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [part]: item }, bag: { ...(s.bag ?? {}), [part]: list.slice(0, BAG_MAX) } }));
    setShop(false);
  };
  // 자동 구매: 자동 강화를 멈추지 않고 같은 장비를 다시 산다 (코인이 모자라거나 살 수 없으면 false)
  const rebuy = (g: Gear) => {
    if (!buyable(g) || !coins.has(g.price) || coins.take(g.price) < g.price) return false;
    setHeld({ name: g.name, lv: 0, broken: false, tries: 0, tainted: false });
    setStats((s) => ({ ...s, coins: s.coins + g.price }));
    comboRef.current = 0;
    setCombo(0);
    setGain(null);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
    return true;
  };
  const choose = (s: Scroll) => {
    setName(s.name);
    const h = heldRef.current;
    if (h && h.lv > 0 && s.name !== scroll.name && !h.tainted) setHeld({ ...h, tainted: true });
  };

  const tryOnce = useCallback(
    (forced?: boolean, manual = false): boolean => {
      const h = heldRef.current;
      const g = h && gears.find((x) => x.part === scroll.part && x.name === h.name);
      if (!h || !g || h.broken) return false;
      const cur = h.lv;
      const p = rates[cur + 1] ?? 0;
      if (!(p > 0)) return false;
      if (coins.take(1) < 1) {
        setAuto(false);
        return false;
      }
      const tries = h.tries + 1;
      const ok = forced ?? Math.random() < p;
      if (p < 1) {
        comboRef.current = ok ? comboRef.current + 1 : 0;
        setCombo(comboRef.current);
      }
      if (ok && p < 1 && !h.tainted)
        rec.submit("enhance", {
          label: `+${cur + 1} ${g.name}`,
          score: Math.round(gearPower(g, cur + 1) * 10) / 10,
          tries,
          luck: luckOf(reachWithin((k) => rates[k] ?? 0, scroll.keep, cur + 1, tries)),
        });
      if (ok && !h.tainted) emit({ kind: "enh", part: scroll.part, scroll: scroll.name, level: cur + 1, combo: comboRef.current });
      setStats((s) => ({ ...s, tries: s.tries + 1, coins: s.coins + 1, broke: s.broke + (!ok && !scroll.keep && p < 1 ? 1 : 0), best: Math.max(s.best, ok ? cur + 1 : cur) }));
      setLog((l) => [...l.slice(-39), { to: cur + 1, ok, broke: !ok && !scroll.keep }]);
      // 강화 도감(best)에 닿은 강화도를 적고, 앞 장비 기준(+8·+6)에 닿으면 다음 장비를 연다
      if (ok)
        update((s) => {
          const b = s.best?.[g.name] ?? 0;
          const next = b >= cur + 1 ? s : { ...s, best: { ...(s.best ?? {}), [g.name]: cur + 1 } };
          return cur + 1 >= CLEAR_LV[scroll.part] && !(next.cleared ?? []).includes(g.name) ? { ...next, cleared: [...(next.cleared ?? []), g.name] } : next;
        });
      // 직접 눌러 닿은 강화도: 자동은 여기까지
      if (ok && manual) update((s) => raiseExp(s, `enh:${g.name}`, cur + 1));
      if (ok) {
        heldRef.current = { ...h, lv: cur + 1, tries };
        setHeld(heldRef.current, scroll.part);
        const big = p < 0.35 || cur + 1 >= (scroll.part === "무기" ? 8 : 6);
        setFx((f) => ({ kind: "ok", n: (f?.n ?? 0) + 1, big }));
        const a = gearPower(g, cur), b = gearPower(g, cur + 1);
        setGain((x) => ({ from: gearStat(g, cur), to: gearStat(g, cur + 1), pct: a ? Math.round(((b - a) / a) * 1000) / 10 : 0, n: (x?.n ?? 0) + 1 }));
      } else if (scroll.keep) {
        setHeld({ ...h, tries }, scroll.part);
        setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
      } else {
        brokeAt.current = Date.now();
        setHeld({ ...h, tries, broken: true }, scroll.part);
        setFx((f) => ({ kind: "break", n: (f?.n ?? 0) + 1 }));
        setGain(null);
      }
      return ok || scroll.keep;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, scroll.keep, scroll.part, scroll.name, coins, rec, emit, gears],
  );
  // 두근두근: 직접 누르면 결과를 먼저 정하고 게이지 바늘이 그 자리에 멈춘 뒤 보여 준다 (위험할수록 오래)
  const press = () => {
    const h = heldRef.current;
    if (charge || !h || h.broken || !coins.coins) return;
    const p = rates[h.lv + 1] ?? 0;
    if (!(p > 0)) return;
    if (p >= 1) {
      tryOnce(undefined, true);
      return;
    }
    const ok = Math.random() < p;
    const stop = ok ? p * (0.08 + Math.random() * 0.84) : p + (1 - p) * (0.04 + Math.random() * 0.92);
    setCharge((c) => ({ p, stop, ok, dur: p >= 0.5 ? 1000 : p >= 0.2 ? 1400 : 1900, n: (c?.n ?? 0) + 1 }));
  };
  const chargeRef = useRef<Charge | null>(null);
  chargeRef.current = charge;
  const landed = useCallback(() => {
    const c = chargeRef.current;
    chargeRef.current = null;
    setCharge(null);
    if (c) tryOnce(c.ok, true);
  }, [tryOnce]);

  // 목표까지 자동: 0.18초마다 한 번, 목표에 닿으면 멈춘다. 부서지면 멈추고, 자동 구매를 켰으면 부서지는 모습을 보인 뒤 다시 사서 이어 간다 (코인이 떨어질 때까지)
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      const h = heldRef.current;
      if (h?.broken) {
        const g = gears.find((x) => x.part === scroll.part && x.name === h.name);
        if (!rebuyRef.current || !g) setAuto(false);
        else if (Date.now() - brokeAt.current >= 700 && !rebuy(g)) setAuto(false);
        return;
      }
      if (!h || h.lv >= autoGoal || !(rates[h.lv + 1] > 0)) {
        setAuto(false);
        return;
      }
      tryOnce();
    }, 180);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, autoGoal, rates, tryOnce]);

  const switchPart = (x: Part) => {
    setPart(x);
    setGoal(x === "무기" ? 8 : 6);
    clearFx();
    setCharge(null);
    const h = save.held?.[x] ?? null;
    heldRef.current = h;
    setHeldState(h);
    setShop(false);
  };

  const next = lv + 1;
  const p = rate(next);
    const ladder = Array.from({ length: 15 }, (_, i) => i + 1).filter((k) => rate(k) > 0);
  const showShop = !gear || shop;
  // 장비 바꾸기 칸은 폰 뒤로 가기로 닫는다 (들고 있는 장비가 있을 때만 닫을 수 있다, backClose.ts)
  useBackClose(!!gear && shop, () => setShop(false));
  const label = gear?.name ?? part;
  const pic = gear?.icon ?? null;
  const nameSize = pic ? " sim-icon-pic" : label.length > 7 ? " sim-icon-long" : "";

  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <div className="mk-cats" role="tablist">
          {(["무기", "갑옷"] as Part[]).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={part === x} className={"sub-tab" + (part === x ? " sub-tab-on" : "")} onClick={() => switchPart(x)}>
              {x === "갑옷" ? "방어구" : x}
            </button>
          ))}
          <i className="sim-sep" aria-hidden />
          {all
            .filter((s) => s.part === part)
            .map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={s.name === scroll.name} className={"sub-tab" + (s.name === scroll.name ? " sub-tab-on" : "")} onClick={() => choose(s)}>
                {s.name}
              </button>
            ))}
          {scroll.event && (
            <button
              type="button"
              aria-pressed={ev}
              className={"sub-tab sim-ev" + (ev ? " sub-tab-on" : "")}
              onClick={() => {
                const h = heldRef.current;
                if (h && h.lv > 0 && !h.tainted) setHeld({ ...h, tainted: true });
                setEv(!ev);
              }}
            >
              이벤트
            </button>
          )}
        </div>
      </div>

      {showShop ? (
        <GearShop
          gears={gears}
          part={part}
          job={job}
          setJob={setJob}
          slot={slot}
          setSlot={setSlot}
          onBuy={buy}
          coins={coins.coins}
          onClose={gear ? () => setShop(false) : undefined}
          cleared={cleared}
          bag={bag}
          onTake={takeOut}
          valueOf={valueOf}
          onSell={sellBag}
        />
      ) : (
        <>
          <section
            className={`panel sim-anvil${broken ? " sim-broken" : ""}${charge ? " sim-charging" : ""}${charge && charge.p < 0.2 ? " sim-risky" : ""}${fx?.big && fx.kind === "ok" ? " sim-anvil-big" : ""}${fx?.kind === "break" ? " sim-anvil-break" : ""}`}
            key={`a${fx?.kind === "break" || fx?.big ? fx.n : 0}`}
          >
            <span className="sim-rays" aria-hidden />
            <span className="sim-vignette" aria-hidden />
            <div className="sim-gearline">
              <span>
                Lv.{gear!.lv} {gear!.kind}
              </span>
              {combo >= 2 && (
                <span key={combo} className="sim-combo">
                  {combo}연속
                </span>
              )}
              {value > 0 && (
                <button type="button" className={"sim-change sim-sell" + (selling ? " sim-sell-sure" : "")} onClick={sellHeld} disabled={!!charge || auto}>
                  {selling ? "팔기?" : "팔기"} <small key={`v${lv}`} className="sim-value">{value.toLocaleString()}</small>
                </button>
              )}
              <button type="button" className="sim-change" onClick={() => setShop(true)} disabled={!!charge || auto}>
                바꾸기
              </button>
            </div>
            <span className="sim-embers" aria-hidden>
              {EMBERS.map((e, i) => (
                <i key={i} style={{ ["--x" as string]: `${e[0]}%`, ["--d" as string]: `${e[1]}s`, ["--t" as string]: `${e[2]}s`, ["--s" as string]: `${e[3]}px` }} />
              ))}
            </span>
            {fx?.kind === "ok" && fx.big && (
              <span key={`b${fx.n}`} className="sim-burst" aria-hidden>
                <i />
              </span>
            )}
            <div key={fx?.n ?? 0} className={`sim-item${fx ? ` sim-fx-${fx.kind}` : ""}`}>
              {fx && fx.kind !== "keep" && fx.kind !== "buy" && <Sparks kind={fx.big ? "plus2" : fx.kind} n={fx.kind === "break" ? 16 : fx.big ? 24 : 10} />}
              <span className="sim-ring" aria-hidden />
              <span className={`sim-frame sim-aura-${broken ? 0 : auraOf(lv)}`}>
                <i className="sim-aura" aria-hidden />
                <span key={charge ? `c${charge.n}` : "i"} className={`sim-icon${nameSize}`} style={charge ? { ["--hit" as string]: `${Math.round(charge.dur / 3)}ms` } : undefined} aria-hidden>
                  <span className="sim-half sim-half-a">{pic ? <PicImg pic={pic} fit={64} className="sim-pic" /> : label}</span>
                  <span className="sim-half sim-half-b">{pic ? <PicImg pic={pic} fit={64} className="sim-pic" /> : label}</span>
                  {broken && <i className="sim-crack" />}
                </span>
                {charge && (
                  <b key={`h${charge.n}`} className="sim-tang" style={{ ["--hit" as string]: `${Math.round(charge.dur / 3)}ms` }} aria-hidden>
                    탕!
                  </b>
                )}
              </span>
              <i className="sim-floor" aria-hidden />
              <span className="sim-nameline">
                <b key={`l${lv}${broken}`} className={"sim-lv" + (broken ? " sim-lv-dead" : "")}>
                  +{lv}
                </b>
                {pic && <span className="sim-name">{label}</span>}
              </span>
              {fx?.kind === "break" && (
                <b key={`s${fx.n}`} className="sim-stamp" aria-hidden>
                  파괴
                </b>
              )}
              {fx?.kind === "keep" && (
                <b key={`k${fx.n}`} className="sim-stamp sim-stamp-keep" aria-hidden>
                  실패
                </b>
              )}
              {fx?.kind === "ok" && fx.big && (
                <b key={`w${fx.n}`} className="sim-win" aria-hidden>
                  +{lv}
                </b>
              )}
            </div>
            {charge ? (
              <Gauge c={charge} keep={scroll.keep} onDone={landed} />
            ) : broken ? null : p > 0 ? (
              <OddsBar
                parts={[
                  { p, tone: "ok", label: `+${next}` },
                  { p: 1 - p, tone: scroll.keep ? "keep" : "bad", label: scroll.keep ? "유지" : "파괴" },
                ]}
              />
            ) : (
              <span className="sim-max">{lv >= 15 ? "MAX" : `+${next} 불가`}</span>
            )}
            {!broken && (
              <div className="sim-facts">
                <span key={gain?.n ?? 0} className={gain ? "sim-gain" : ""}>
                  <small>{part === "무기" ? "공격" : "방어"}</small>
                  <b>{gearStat(gear!, lv)}</b>
                  {gain && <em>+{gain.pct}%</em>}
                </span>
                {value > 0 && p > 0 && p < 1 && (
                  <span>
                    <small>+{next} 시세</small>
                    <b className="sim-gold">{valueOf(gear!, next).toLocaleString()}</b>
                  </span>
                )}
              </div>
            )}
          </section>

          {broken && !auto ? (
            <div className="sim-actions sim-actions-2">
              <button type="button" className="btn sim-go" disabled={!buyable(gear!) || coins.coins === null || coins.coins < gear!.price} onClick={() => buy(gear!)}>
                다시 사기
                <small>
                  <i className="sim-c" aria-hidden />
                  {gear!.price}
                </small>
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShop(true)}>
                다른 장비
              </button>
            </div>
          ) : (
            <div className="sim-actions sim-actions-enh">
              <button type="button" className="btn sim-go" disabled={!(p > 0) || auto || !!charge || coins.coins === 0} onClick={press}>
                강화
              </button>
              {!autoOn ? (
                <button
                  type="button"
                  className="btn btn-ghost sim-unlock"
                  disabled={unlocking || coins.coins === null || coins.coins < unlockCost(gear!, "auto")}
                  onClick={() => doUnlock(autoKey, unlockCost(gear!, "auto"))}
                >
                  자동
                  <small>
                    <i className="sim-c" aria-hidden />
                    {unlockCost(gear!, "auto")}
                  </small>
                </button>
              ) : (
                <span className="sim-goal">
                  <button type="button" className="pill" onClick={() => setGoal(Math.max(lv + 1, autoGoal - 1))} aria-label="목표 내리기">
                    −
                  </button>
                  <button type="button" className={"btn btn-ghost" + (auto ? " sim-running" : "")} disabled={!!charge || (!auto && lv >= autoGoal)} onClick={() => setAuto(!auto)}>
                    {auto ? "멈춤" : lv >= expMax ? "직접 먼저" : `+${autoGoal} 자동`}
                  </button>
                  <button type="button" className="pill" onClick={() => setGoal(Math.min(15, expMax, autoGoal + 1))} aria-label="목표 올리기">
                    +
                  </button>
                </span>
              )}
              {autoOn &&
                (buyOn ? (
                  <button type="button" aria-pressed={autoBuy} className={"sim-autobuy sub-tab" + (autoBuy ? " sub-tab-on" : "")} onClick={() => setAutoBuy(!autoBuy)}>
                    자동 구매
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sim-autobuy sim-unlock sub-tab"
                    disabled={unlocking || coins.coins === null || coins.coins < unlockCost(gear!, "buy")}
                    onClick={() => doUnlock(buyKey, unlockCost(gear!, "buy"))}
                  >
                    자동 구매
                    <small>
                      <i className="sim-c" aria-hidden />
                      {unlockCost(gear!, "buy")}
                    </small>
                  </button>
                ))}
            </div>
          )}
        </>
      )}

      {sold && (
        <div key={sold.n} className="sim-cheer sim-sold" role="status">
          <b>+{sold.value.toLocaleString()}</b>
          <span>
            +{sold.lv} {sold.name}
          </span>
        </div>
      )}
      <StatStrip
        items={[
          { label: "시도", value: stats.tries },
          { label: "파괴", value: stats.broke, tone: "sim-bad" },
          { label: "코인", value: stats.coins },
        ]}
      />
      {log.length > 0 && (
        <div className="sim-log" aria-label="최근 결과">
          {log.map((d, i) => (
            <i key={i} className={d.ok ? "ok" : d.broke ? "bad" : "keep"} title={`+${d.to}`} />
          ))}
        </div>
      )}

      <RankBox rec={rec} title={`${part === "갑옷" ? "방어구" : part} · ${scroll.name}${ev && scroll.event ? " 이벤트" : ""}`} />
      <Fold k="chance" title="확률표">
        <ChanceTable rate={rate} keep={scroll.keep} ladder={ladder} from={broken ? 0 : lv} />
        <Thousand rate={rate} keep={scroll.keep} goal={goal} />
      </Fold>
    </div>
  );
}

/** 지금 강화도에서 목표마다: 한 번에 성공할 확률, 평균 마법서, 평균 부서지는 장비 */
function ChanceTable({ rate, keep, ladder, from }: { rate: (lv: number) => number; keep: boolean; ladder: number[]; from: number }) {
  const rows = ladder
    .filter((k) => k > from && rate(k) < 1)
    .map((k) => ({ k, e: expectedTo(rate, keep, from, k) }))
    .filter((r): r is { k: number; e: NonNullable<ReturnType<typeof expectedTo>> } => !!r.e);
  if (!rows.length) return null;
  return (
    <div className="sim-table">
      <div className={"sim-th" + (keep ? " sim-tr-3" : "")}>
        <b>+{from} →</b>
        <span>한 번에</span>
        <span>마법서</span>
        {!keep && <span>파괴</span>}
      </div>
      {rows.map(({ k, e }) => (
        <div key={k} className={"sim-tr" + (keep ? " sim-tr-3" : "")}>
          <b>+{k}</b>
          <span className={tierClass(e.once)}>{pctText(e.once)}</span>
          <span>{n0(e.tries)}장</span>
          {!keep && <span className="sim-bad">{n0(e.broken)}개</span>}
        </div>
      ))}
    </div>
  );
}
const tierClass = (p: number) => `sim-t-${tierOf(p)}`;

/** +0 장비 1000개를 목표까지 강화해 보기 (한 번에 가는 것: 부서지면 그 장비는 끝) */
function Thousand({ rate, keep, goal }: { rate: (lv: number) => number; keep: boolean; goal: number }) {
  const [res, setRes] = useState<{ ok: number; broke: number; used: number; at: number[]; n: number } | null>(null);
  const run = () => {
    const N = 1000;
    let ok = 0;
    let broke = 0;
    let used = 0;
    const at: number[] = Array(16).fill(0);
    for (let i = 0; i < N; i++) {
      let lv = 0;
      for (;;) {
        if (lv >= goal) {
          ok++;
          break;
        }
        const p = rate(lv + 1);
        if (!(p > 0)) break;
        used++;
        if (Math.random() < p) lv++;
        else if (!keep) {
          broke++;
          at[lv + 1]++;
          break;
        }
        if (used > 5_000_000) break;
      }
    }
    setRes({ ok, broke, used, at, n: (res?.n ?? 0) + 1 });
  };
  return (
    <div className="sim-thousand">
      <button type="button" className="btn btn-ghost" onClick={run}>
        1000개 → +{goal}
      </button>
      {res && (
        <div key={res.n} className="sim-thousand-res">
          <span>
            <small>성공</small>
            <b className="sim-good">
              <Count value={res.ok} />개
            </b>
          </span>
          {!keep && (
            <span>
              <small>파괴</small>
              <b className="sim-bad">
                <Count value={res.broke} />개
              </b>
            </span>
          )}
          <span>
            <small>마법서</small>
            <b>
              <Count value={res.used} />장
            </b>
          </span>
          {!keep && res.broke > 0 && (
            <div className="sim-breakbars" aria-label="어디서 부서졌나">
              {res.at.map((v, k) =>
                v ? (
                  <span key={k} style={{ ["--w" as string]: `${Math.max(4, (v / res.broke) * 100)}%` }}>
                    <em>+{k}</em>
                    <i />
                    <small>{v}</small>
                  </span>
                ) : null,
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================================================ 스탯 부여 · 펫 추가 옵션

const STATS = [
  { k: "힘", per: 1 },
  { k: "민첩", per: 1 },
  { k: "지능", per: 1 },
  { k: "체력", per: 10 },
  { k: "마나", per: 10 },
];

/** 성장 칸의 실제 물건 (2026-11-17 고도화, 제작자 '너무 허접해': 글자 상자 '장신구'·'펫' 대신 위키 장신구(벨트·망토·목걸이·반지)와 아이템 책의 펫 그림) */
interface StatPick {
  name: string;
  icon: Pic;
  sub: string;
  lv: number;
}
const ACC_SLOTS = ["벨트", "망토", "목걸이", "반지"];
function accessoriesOf(wiki: Wiki): StatPick[] {
  const out: StatPick[] = [];
  const seen = new Set<string>();
  for (const t of wiki.equipment) {
    if (!ACC_SLOTS.includes(t.slot)) continue;
    for (const row of t.rows) {
      const name = row.name.trim();
      if (!name || !row.icon || seen.has(name) || /^\+|\[/.test(name)) continue;
      seen.add(name);
      const h = row.h ?? t.headers;
      const lv = Number(String(row.cells[h.indexOf("레벨제한")] ?? "").replace(/\D/g, "")) || 0;
      out.push({ name, icon: row.icon, sub: `${t.slot} · Lv.${lv}`, lv });
    }
  }
  return out.sort((a, b) => a.lv - b.lv || a.name.localeCompare(b.name, "ko"));
}
function petsOf(book: Book | null): StatPick[] {
  if (!book) return [];
  const out: StatPick[] = [];
  for (const [name, vs] of Object.entries(book.items)) {
    const v = vs.find((x) => x.t === "펫" && x.pic);
    if (v?.pic) out.push({ name, icon: v.pic, sub: `펫${v.g ? ` · ${v.g}` : ""}`, lv: v.lv ?? 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function StatSim({ odds, wiki }: { odds: Odds; wiki: Wiki }) {
  const all = useMemo(() => stepsOf(odds), [odds]);
  const book = useBook();
  const accs = useMemo(() => accessoriesOf(wiki), [wiki]);
  const pets = useMemo(() => petsOf(book), [book]);
  const [key, setKey] = useEntryState("sim.steps", all[0]?.key ?? "");
  const st = all.find((s) => s.key === key) ?? all[0];
  const [stat, setStat] = useEntryState("sim.stat", "지능");
  // 표마다 지금 단계와 펫 옵션, 모든 표의 시도·성공 수는 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const kept = useSave().save.stat?.[st?.key ?? ""];
  const [stage, setStage] = useState(() => kept?.stage ?? 0);
  const [type, setType] = useState<string | null>(() => kept?.type ?? null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [stats, setStats] = useKept((s) => s.statN, (s, v) => ({ ...s, statN: v }), { tries: 0, ok: 0, big: 0 });
  const [auto, setAuto] = useState(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  if (!st) return <div className="empty">스탯 부여 자료가 없어요</div>;
  return (
    <StatInner
      st={st}
      all={all}
      setKey={setKey}
      stat={stat}
      setStat={setStat}
      stage={stage}
      setStage={setStage}
      stageRef={stageRef}
      type={type}
      setType={setType}
      fx={fx}
      setFx={setFx}
      stats={stats}
      setStats={setStats}
      auto={auto}
      setAuto={setAuto}
      picks={st.types ? pets : accs}
    />
  );
}

function StatInner(p: {
  st: Steps;
  all: Steps[];
  setKey: (k: string) => void;
  stat: string;
  setStat: (k: string) => void;
  stage: number;
  setStage: (n: number) => void;
  stageRef: { current: number };
  type: string | null;
  setType: (t: string | null) => void;
  fx: Fx | null;
  setFx: (f: (x: Fx | null) => Fx | null) => void;
  stats: { tries: number; ok: number; big: number };
  setStats: (f: (s: { tries: number; ok: number; big: number }) => { tries: number; ok: number; big: number }) => void;
  auto: boolean;
  setAuto: (v: boolean) => void;
  /** 고를 수 있는 실제 물건 (장신구나 펫) */
  picks: StatPick[];
}) {
  const { st, stage, stageRef, setStage, setFx, setStats, setType, auto, setAuto, picks } = p;
  const pet = !!st.types;
  const step = st.steps[stage];
  const coins = useCoins();
  // 순위: 처음부터 몇 번 만에 끝 단계
  const rec = useRecord(`stat:${st.key}`);
  // 자동은 직접 닿아 본 단계까지만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로')
  const { save, update } = useSave();
  // 처음부터 센 시도 (순위): 단계와 함께 진행 상황에 두어 다시 열어도 이어서 센다
  const since = useRef(save.stat?.[st.key]?.since ?? 0);
  const emit = useQuest();
  const expStage = expOf(save, `stat:${st.key}`);
  const cap = Math.min(st.max, expStage);
  // 고른 물건 (진행 상황에, 표마다): 없으면 처음 것
  const [itemName, setItemName] = useState<string>(() => save.stat?.[st.key]?.item ?? "");
  const [picking, setPicking] = useState(false);
  const [pq, setPq] = useState("");
  // 아직 안 골랐으면 Lv.40~46 반지(제일 많이 강화하는 것), 없으면 처음 것
  const item = picks.find((x) => x.name === itemName) ?? picks.filter((x) => x.sub.startsWith("반지") && x.lv >= 40 && x.lv <= 46).pop() ?? picks[0] ?? null;
  const found = pq.trim() ? filterByName(picks, pq, (x) => [x.name]) : picks;
  useBackClose(picking, () => setPicking(false));
  const keep = (key: string, v: { stage: number; type: string | null; since: number; item?: string }) => update((s) => ({ ...s, stat: { ...s.stat, [key]: v } }));
  // 단계·펫 옵션이 바뀌거나 한 번 시도할 때마다 적는다 (처음 그릴 때는 그대로)
  const firstKeep = useRef(true);
  useEffect(() => {
    if (firstKeep.current) {
      firstKeep.current = false;
      return;
    }
    keep(st.key, { stage, type: p.type, since: since.current, item: itemName || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.key, stage, p.type, p.stats.tries, itemName]);
  const reset = () => {
    setStage(0);
    stageRef.current = 0;
    setType(null);
    setFx(() => null);
    setAuto(false);
    since.current = 0;
    keep(st.key, { stage: 0, type: null, since: 0, item: itemName || undefined });
  };
  // 다른 표로 바꾸면 그 표에서 하던 단계로 (예전에는 늘 0 부터)
  const load = (key: string) => {
    const k = save.stat?.[key];
    setStage(k?.stage ?? 0);
    stageRef.current = k?.stage ?? 0;
    setType(k?.type ?? null);
    setFx(() => null);
    setAuto(false);
    since.current = k?.since ?? 0;
    setItemName(k?.item ?? "");
    setPicking(false);
  };
  const tryOnce = useCallback((manual = false) => {
    const cur = stageRef.current;
    const s = st.steps[cur];
    if (!s || cur >= st.max) return;
    if (coins.take(1) < 1) {
      setAuto(false);
      return;
    }
    since.current++;
    const r = Math.random();
    const up = r < s.b ? 2 : r < s.a + s.b ? 1 : 0;
    setStats((x) => ({ tries: x.tries + 1, ok: x.ok + (up ? 1 : 0), big: x.big + (up === 2 ? 1 : 0) }));
    if (up) {
      const to = Math.min(st.max, cur + up);
      stageRef.current = to;
      setStage(to);
      if (manual) update((s) => raiseExp(s, `stat:${st.key}`, to));
      if (to >= st.max) {
        const n = since.current;
        rec.submit("grow", { label: `${st.max}단계`, score: st.max, tries: n, luck: luckOf(stepsWithin(st, n)) });
      }
      emit({ kind: "stat", key: st.key, stage: to, max: st.max });
      if (cur === 0 && st.types) setType(pick(st.types).name);
      setFx((f) => ({ kind: up === 2 ? "plus2" : "ok", n: (f?.n ?? 0) + 1 }));
    } else setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
  }, [st, stageRef, setStage, setStats, setType, setFx, coins, rec, setAuto, emit, update]);
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      if (stageRef.current >= cap) {
        setAuto(false);
        return;
      }
      tryOnce();
    }, 120);
    return () => window.clearInterval(t);
  }, [auto, cap, stageRef, tryOnce, setAuto]);

  // 펫 스탯 리셋 (공식 표 40300): 지금 옵션을 뺀 다른 넷 중 하나로, 단계는 그대로
  const resetStat = () => {
    const others = (st.types ?? []).filter((x) => x.name !== p.type).map((x) => ({ ...x, p: 1 }));
    if (!others.length || coins.take(1) < 1) return;
    setType(pick(others).name);
    setFx((f) => ({ kind: "ok", n: (f?.n ?? 0) + 1 }));
  };
  const per = STATS.find((x) => x.k === p.stat)?.per ?? 1;
  const shown = pet ? (p.type ? `${p.type} +${stage}` : stage ? `+${stage}` : "옵션 없음") : stage ? `${p.stat} ${stage * per}` : `${p.stat} 0`;
  const left = stepsExpected(st, stage);
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <div className="mk-cats" role="tablist">
          {p.all.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === st.key}
              className={"sub-tab" + (s.key === st.key ? " sub-tab-on" : "")}
              onClick={() => {
                if (s.key === st.key) return;
                p.setKey(s.key);
                load(s.key);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        {!pet && (
          <div className="mk-cats" role="tablist">
            {STATS.map((x) => (
              <button key={x.k} type="button" role="tab" aria-selected={p.stat === x.k} className={"sub-tab" + (p.stat === x.k ? " sub-tab-on" : "")} onClick={() => p.setStat(x.k)}>
                {x.k}
              </button>
            ))}
          </div>
        )}
      </div>

      {picking ? (
        <section className="panel sim-shop">
          <div className="sim-search-row">
            <input className="sim-search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="이름" aria-label={pet ? "펫 찾기" : "장신구 찾기"} />
            <button type="button" className="sim-shop-x" onClick={() => setPicking(false)} aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="sim-items sim-pick-list">
            {found.slice(0, 80).map((x) => (
              <button
                key={x.name}
                type="button"
                className={"sim-pick" + (item?.name === x.name ? " sim-pick-on" : "")}
                onClick={() => {
                  setItemName(x.name);
                  setPicking(false);
                }}
              >
                <span className="sim-ib" style={{ width: 36, height: 36 }}>
                  <PicImg pic={x.icon} fit={28} className="sim-pic" />
                </span>
                <span className="sim-pick-t">
                  <b>{x.name}</b>
                  <small>{x.sub}</small>
                </span>
              </button>
            ))}
            {!found.length && <p className="sim-muted">없음</p>}
          </div>
        </section>
      ) : (
      <section className="panel sim-anvil sim-anvil-grow">
        <span className="sim-rays" aria-hidden />
        <div className="sim-gearline">
          <span>{item ? item.sub : pet ? "펫" : "장신구"}</span>
          {left !== null && stage < st.max && <span className="sim-avg">평균 {n0(left)}번</span>}
          {picks.length > 0 && (
            <button type="button" className="sim-change" onClick={() => setPicking(true)} disabled={auto}>
              바꾸기
            </button>
          )}
        </div>
        <div key={p.fx?.n ?? 0} className={`sim-item${p.fx ? ` sim-fx-${p.fx.kind}` : ""}`}>
          {p.fx && p.fx.kind !== "keep" && <Sparks kind={p.fx.kind} n={p.fx.kind === "plus2" ? 16 : 10} />}
          <span className="sim-ring" aria-hidden />
          <span className={`sim-frame sim-aura-${Math.min(4, stage + (stage >= st.max ? 1 : 0))}`}>
            <i className="sim-aura" aria-hidden />
            <span className={`sim-icon${item ? " sim-icon-pic" : ""}`} aria-hidden>
              <span className="sim-half sim-half-a">{item ? <PicImg pic={item.icon} fit={64} className="sim-pic" /> : pet ? "펫" : "장신구"}</span>
            </span>
          </span>
          <i className="sim-floor" aria-hidden />
          <span className="sim-nameline">
            <b key={`s${stage}${p.type ?? ""}`} className="sim-lv sim-lv-sm">{shown}</b>
            {item && <span className="sim-name">{item.name}</span>}
          </span>
        </div>
        <div className="sim-steps" aria-label="단계">
          {Array.from({ length: st.max }, (_, i) => (
            <i key={i} className={i < stage ? "on" : i === stage ? "next" : ""} />
          ))}
        </div>
        {step && stage < st.max ? (
          <OddsBar
            parts={[
              { p: step.a, tone: "ok", label: "+1" },
              { p: step.b, tone: "gold", label: "+2" },
              { p: 1 - step.a - step.b, tone: "keep", label: "유지" },
            ]}
          />
        ) : (
          <span className="sim-max">MAX</span>
        )}
      </section>
      )}

      <div className="sim-actions sim-actions-grow">
        <button type="button" className="btn sim-go" disabled={stage >= st.max || auto || coins.coins === 0} onClick={() => tryOnce(true)}>
          {pet ? "강화" : "부여"}
        </button>
        <button type="button" className={"btn btn-ghost" + (auto ? " sim-running" : "")} disabled={stage >= cap && !auto} onClick={() => setAuto(!auto)}>
          {auto ? "멈춤" : stage >= cap ? "직접 먼저" : `${cap}단계 자동`}
        </button>
        {pet && p.type && st.types && (
          <button type="button" className="btn btn-ghost" onClick={resetStat}>
            스탯 리셋
          </button>
        )}
        <button type="button" className="btn btn-ghost sim-again" onClick={reset} aria-label="처음부터">
          ↺
        </button>
      </div>
      <StatStrip
        items={[
          { label: "시도", value: p.stats.tries },
          { label: "성공", value: p.stats.ok, tone: "sim-good" },
          { label: "+2", value: p.stats.big, tone: "sim-gold" },
        ]}
      />
      <RankBox rec={rec} title={st.name} />
    </div>
  );
}

// ================================================================ 옵션

function OptionSim({ odds }: { odds: Odds }) {
  const sources = useMemo(() => optionSources(odds), [odds]);
  const [src, setSrc] = useEntryState("sim.osrc", sources[0]?.key ?? "");
  const source = sources.find((s) => s.key === src) ?? sources[0];
  const [q, setQ] = useEntryState("sim.oq", "");
  const [name, setName] = useEntryState("sim.oitem", "");
  const items = source?.items ?? [];
  const item = items.find((x) => x.name === name) ?? null;
  const found = q.trim() ? filterByName(items, q, (x) => [x.name]) : items;
  if (!source) return <div className="empty">옵션 자료가 없어요</div>;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <div className="mk-cats" role="tablist">
          {sources.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === source.key}
              className={"sub-tab" + (s.key === source.key ? " sub-tab-on" : "")}
              onClick={() => {
                setSrc(s.key);
                setName("");
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      {item ? (
        <OptionRoller
          key={source.key + item.name}
          item={item}
          onBack={() => setName("")}
          verb={source.name === "옵션 재설정" ? "재설정" : "굴리기"}
          reset={source.name === "옵션 재설정"}
          game={`opt:${source.key}:${item.name}`.slice(0, 60)}
          cat="option"
        />
      ) : (
        <>
          <input className="sim-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름" aria-label="아이템 찾기" />
          <div className="sim-items">
            {found.map((x) => (
              <button key={x.name} type="button" className="sim-pick" onClick={() => setName(x.name)}>
                <IconBox name={x.name} size={28} />
                <span className="sim-pick-t">
                  <b>{x.name}</b>
                  <small>{x.opts.map((o) => o.label).join(" · ")}</small>
                </span>
              </button>
            ))}
            {!found.length && <p className="sim-muted">없음</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** 한꺼번에 나온 옵션이 이만큼(이상) 나올 확률 (값이 하나뿐인 옵션은 뺀다) */
const jointP = (item: OptItem, vals: Dist["vals"][number][]) => item.opts.reduce((p, d, i) => (d.vals.length > 1 ? p * atLeast(d, vals[i].n) : p), 1);

function OptionRoller({ item, onBack, verb, game, cat, reset }: { item: OptItem; onBack?: () => void; verb: string; game?: string; cat?: Cat; reset?: boolean }) {
  const roll = useCallback(() => item.opts.map((d) => pick(d.vals)), [item]);
  const [vals, setVals] = useState(roll);
  const [n, setN] = useState(1);
  const [aim, setAim] = useState<{ i: number; min: number }>(() => ({ i: 0, min: Math.max(...item.opts[0].vals.map((v) => v.n)) }));
  const [hunt, setHunt] = useState<{ tries: number; expect: number; k: number; short: boolean } | null>(null);
  const coins = useCoins();
  // 순위: 가장 드문 옵션 (처음 연 한 번은 공짜라 세지 않는다)
  const rec = useRecord(game ?? "");
  const rolls = useRef(0);
  const emit = useQuest();
  const report = (got: Dist["vals"][number][]) => {
    if (!game || !cat) return;
    const luck = luckOf(jointP(item, got));
    if (game.startsWith("repair:")) emit({ kind: "repair", level: got[0]?.n ?? 0 });
    else emit({ kind: "opt", luck });
    if (luck < 0.3) return;
    const label = `${item.name} ${item.opts.map((o, i) => `${o.label} ${got[i].v}`).join(" ")}`.slice(0, 60);
    rec.submit(cat, { label, score: Math.round(luck * 1000) / 1000, tries: rolls.current, luck });
  };
  // 나올 때까지는 직접 굴려 본 값까지만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로'): 옵션마다 직접 본 가장 높은 값
  const { save, update } = useSave();
  const seenKey = (i: number) => `opt:${item.name}:${i}`;
  // 옵션 재설정은 게임처럼 '현재 옵션 / 신규 옵션' 창에서 하나를 골라 '선택' (제작자 2026-11-19 '옵션은 이런 식으로, 완전 똑같이'): 굴린 값은 신규로 두고 고르면 바뀐다
  const [fresh, setFresh] = useState<Dist["vals"][number][] | null>(null);
  const again = () => {
    if (coins.take(1) < 1) return;
    rolls.current++;
    const got = roll();
    update((s) => got.reduce((acc, v, i) => raiseExp(acc, seenKey(i), v.n), s));
    setHunt(null);
    report(got);
    if (reset) {
      setFresh(got);
      return;
    }
    setVals(got);
    setN((x) => x + 1);
  };
  const choose = (useNew: boolean) => {
    if (useNew && fresh) {
      setVals(fresh);
      setN((x) => x + 1);
    }
    setFresh(null);
  };
  const huntGoal = () => {
    const d = item.opts[aim.i];
    const P = atLeast(d, aim.min);
    const can = coins.coins ?? 0;
    if (!(P > 0) || can < 1) return;
    let tries = 0;
    let got = vals;
    let best = vals;
    let bestP = 2;
    for (;;) {
      tries++;
      got = roll();
      const jp = jointP(item, got);
      if (jp < bestP) {
        bestP = jp;
        best = got;
      }
      if (got[aim.i].n >= aim.min || tries >= can) break;
    }
    coins.take(tries);
    rolls.current += tries;
    setVals(got);
    setN((x) => x + 1);
    setHunt({ tries, expect: 1 / P, k: (hunt?.k ?? 0) + 1, short: got[aim.i].n < aim.min });
    report(best);
  };
  const d = item.opts[aim.i];
  const nums = [...new Set(d.vals.map((v) => v.n))].sort((a, b) => a - b);
  const P = atLeast(d, aim.min);
  const seen = expOf(save, seenKey(aim.i));
  const canHunt = aim.min <= seen;
  // 이번 결과가 얼마나 드문지 (모든 옵션이 이만큼 이상 나올 확률)
  const joint = jointP(item, vals);
  const step = (dir: number) => setAim({ ...aim, min: nums[Math.min(nums.length - 1, Math.max(0, nums.indexOf(aim.min) + dir))] ?? aim.min });
  return (
    <>
      <section className={`panel sim-opt sim-opt-${tierOf(joint)}`}>
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="sim-back" onClick={onBack} aria-label="다른 아이템">
              ◀
            </button>
          )}
          <IconBox name={item.name} size={28} />
          <b>{item.name}</b>
          {joint < 1 && (
            <em key={n} className={`sim-luck ${tierClass(joint)}`}>
              {luckText(luckOf(joint))}
            </em>
          )}
        </div>
        {item.opts.map((o, i) => (
          <OptLine key={i} d={o} v={vals[i]} n={n} i={i} aim={aim.i === i ? aim.min : null} onAim={(min) => setAim({ i, min })} />
        ))}
      </section>
      {fresh && <ResetDialog item={item} cur={vals} next={fresh} onChoose={choose} />}
      <div className="sim-actions sim-actions-opt">
        <button type="button" className="btn sim-go" disabled={coins.coins === 0} onClick={again}>
          {verb === "굴리기" ? "굴리기" : verb}
        </button>
        <span className="sim-aim">
          <button type="button" className="pill" onClick={() => step(-1)} aria-label="목표 내리기">
            −
          </button>
          <span className="sim-aim-t">
            <b>
              {d.label} {aim.min}↑
            </b>
            <small className={tierClass(P)}>{pctText(P)}</small>
          </span>
          <button type="button" className="pill" onClick={() => step(1)} aria-label="목표 올리기">
            +
          </button>
        </span>
        <button type="button" className="btn btn-ghost sim-hunt-go" disabled={!(P > 0) || coins.coins === 0 || !canHunt} onClick={huntGoal}>
          {canHunt ? "나올 때까지" : "직접 먼저"}
        </button>
      </div>
      {hunt && (
        <p key={hunt.k} className={"sim-hunt" + (hunt.short ? " sim-hunt-short" : "")}>
          <b>
            <Count value={hunt.tries} ms={700} />번
          </b>
          <small>평균 {n0(hunt.expect)}번</small>
        </p>
      )}
      {game && <RankBox rec={rec} title={item.name} luck />}
    </>
  );
}

/** 옵션 재설정 창: 게임의 '원하는 옵션을 선택하세요' 화면 (현재 옵션 / 신규 옵션 두 칸, 하나를 눌러 고르고 '선택'). 바깥을 누르거나 폰 뒤로 가기는 현재 옵션 그대로 */
function ResetDialog({ item, cur, next, onChoose }: { item: OptItem; cur: Dist["vals"][number][]; next: Dist["vals"][number][]; onChoose: (useNew: boolean) => void }) {
  const [sel, setSel] = useState<"cur" | "new" | null>(null);
  const keep = () => onChoose(false);
  useBackClose(true, keep);
  const panel = (key: "cur" | "new", title: string, vals: Dist["vals"][number][]) => (
    <button type="button" className={"rs-panel" + (sel === key ? " rs-on" : "")} onClick={() => setSel(key)} aria-pressed={sel === key}>
      <span className="rs-ph">{title}</span>
      {item.opts.map((o, i) => (
        <span key={i} className="rs-row">
          <span>{o.label}</span>
          <b>{vals[i]?.v}</b>
        </span>
      ))}
    </button>
  );
  return createPortal(
    <div className="rs-back" onClick={keep} role="presentation">
      <div className="rs-wrap" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="옵션 재설정">
        <div className="rs-title">옵션 재설정</div>
        <div className="rs-frame">
          <i className="rs-rv rs-tl" />
          <i className="rs-rv rs-tr" />
          <i className="rs-rv rs-bl" />
          <i className="rs-rv rs-br" />
          <p className="rs-ask">원하는 옵션을 선택하세요.</p>
          <div className="rs-item">
            <span className="rs-icon">
              <NameIcon name={item.name} size={44} />
            </span>
            <b className="rs-name">{item.name}</b>
          </div>
          <div className="rs-cols">
            {panel("cur", "현재 옵션", cur)}
            {panel("new", "신규 옵션", next)}
          </div>
          <button type="button" className="rs-ok" disabled={!sel} onClick={() => onChoose(sel === "new")}>
            선택
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 값마다 확률은 늘 % 로 (1/N 으로 바꾸지 않는다): 91.5%, 2.69%, 0.052% */
const pctOnly = (p: number) => {
  const v = p * 100;
  const t = v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4);
  return `${t.replace(/\.?0+$/, "")}%`;
};

/** 옵션 한 줄 (2026-11-19 개편): 이름 · 큰 값 · 등급, 그 아래 값마다 타일(값, %, 확률만큼 차오른 바탕).
    굴리면 불빛이 타일을 차례로 돌다가 느려지며 나온 값에 멈춘다. 타일을 누르면 그 값 이상이 목표 */
function OptLine({ d, v, n, i, aim, onAim }: { d: Dist; v: Dist["vals"][number]; n: number; i: number; aim: number | null; onAim: (min: number) => void }) {
  const at = Math.max(0, d.vals.indexOf(v));
  const [hot, setHot] = useState(at);
  const [rolling, setRolling] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    // 처음 그릴 때와 움직임 줄이기에서는 돌리지 않는다
    if (first.current || d.vals.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      first.current = false;
      setHot(at);
      setRolling(false);
      return;
    }
    const len = d.vals.length;
    const hops = Math.max(len, 9) + i * 5;
    let k = 0;
    let t = 0;
    setRolling(true);
    const tick = () => {
      k++;
      setHot((((at - (hops - k)) % len) + len) % len);
      if (k >= hops) {
        setRolling(false);
        return;
      }
      // 끝으로 갈수록 느리게
      t = window.setTimeout(tick, 26 + (k / hops) ** 3 * 150);
    };
    t = window.setTimeout(tick, 26);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, at]);
  const top = Math.max(...d.vals.map((x) => x.p)) || 1;
  const total = d.vals.reduce((a, x) => a + x.p, 0) || 1;
  const P = atLeast(d, v.n);
  const cols = d.vals.length <= 7 ? d.vals.length : Math.ceil(d.vals.length / Math.ceil(d.vals.length / 7));
  return (
    <div className={"sim-oline" + (rolling ? " sim-rolling" : "")}>
      <div className="sim-ohead">
        <span className="sim-oname">{d.label}</span>
        <b key={rolling ? "r" : `v${n}`} className={`sim-oval ${rolling ? "" : tierClass(P)}`}>
          {d.vals[hot]?.v ?? v.v}
        </b>
        {!rolling && n > 1 && P <= 0.05 && <Sparks key={n} kind={P <= 0.01 ? "plus2" : "box-r"} n={P <= 0.01 ? 16 : 9} />}
        {!rolling && P < 1 && <small className={`sim-otop ${tierClass(P)}`}>상위 {pctText(P)}</small>}
      </div>
      {d.vals.length > 1 && (
        <div className="sim-tiles" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {d.vals.map((x, j) => {
            const p = x.p / total;
            return (
              <button
                key={j}
                type="button"
                className={`sim-tile sim-tile-${tierOf(p)}` + (j === hot ? (rolling ? " sim-tile-run" : " sim-tile-on") : "") + (aim !== null && x.n >= aim ? " sim-tile-aim" : "")}
                onClick={() => onAim(x.n)}
                aria-label={`${d.label} ${x.v} ${pctOnly(p)}`}
              >
                <i className="sim-tile-fill" style={{ transform: `scaleY(${Math.max(0.06, Math.sqrt(x.p / top)).toFixed(3)})` }} aria-hidden />
                <b>{x.v}</b>
                <small>{pctOnly(p)}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ================================================================ 상자

/** 공식 이벤트 글 그림 속 확률표 상자 (제작자 2026-11-06 '시너지 다 하자', '이벤트 공지' 칸). 못 받으면 없이 */
const eventBoxCache = new Map<string, Box>();
function useEventBoxes(): Box[] {
  const [boxes, setBoxes] = useState<Box[]>(() => [...eventBoxCache.values()]);
  useEffect(() => {
    let alive = true;
    fetchEventOdds().then(
      (r) => {
        for (const b of r) eventBoxCache.set(b.key, b);
        if (alive) setBoxes(r);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return boxes;
}

function BoxSim({ odds }: { odds: Odds }) {
  const official = useMemo(() => boxesOf(odds), [odds]);
  const events = useEventBoxes();
  const boxes = useMemo(() => [...official, ...events], [official, events]);
  const sources = useMemo(() => optionSources(odds), [odds]);
  const cats = BOX_CATS.filter((c) => boxes.some((b) => b.cat === c));
  const [cat, setCat] = useEntryState("sim.bcat", cats[0] ?? "");
  const [key, setKey] = useEntryState("sim.box", "");
  const box = boxes.find((b) => b.key === key) ?? null;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <div className="mk-cats" role="tablist">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cat === c}
              className={"sub-tab" + (cat === c ? " sub-tab-on" : "")}
              onClick={() => {
                setCat(c);
                setKey("");
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {box ? (
        <BoxOpener
          key={box.key}
          box={box}
          onBack={() => setKey("")}
          boxes={boxes}
          sources={sources}
          onOpen={(b) => {
            setCat(b.cat);
            setKey(b.key);
          }}
        />
      ) : (
        <div className="sim-items">
          {boxes
            .filter((b) => b.cat === cat)
            .map((b) => (
              <button key={b.key} type="button" className="sim-pick" onClick={() => setKey(b.key)}>
                <IconBox name={b.name} size={28} />
                <span className="sim-pick-t">
                  <b>{b.name}</b>
                  <small>
                    {b.date ? `${b.date} · ` : ""}
                    {b.sections.length > 1 ? `${b.sections.length}종 · ` : ""}
                    {b.sections.reduce((s, x) => s + x.items.length, 0)}
                  </small>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface Pull {
  name: string;
  p: number;
  id: number;
}
function BoxOpener({
  box,
  onBack,
  boxes,
  sources,
  onOpen,
  cat = "box",
}: {
  box: Box;
  onBack?: () => void;
  boxes?: Box[];
  sources?: OptSource[];
  onOpen?: (b: Box) => void;
  cat?: Cat;
}) {
  const [si, setSi] = useState(0);
  const sec = box.sections[Math.min(si, box.sections.length - 1)];
  const total = sec.items.reduce((s, x) => s + x.p, 0) || 1;
  const [pulls, setPulls] = useState<Pull[]>([]);
  // 이번에 처음 나온 것 (2026-11-17: 카드에 NEW)
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  // 상자·묶음마다 연 수와 나온 것은 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const keptBox = useSave().save.box;
  const keptOf = (i: number) => keptBox?.[`${box.key}:${i}`];
  const [tally, setTally] = useState<Map<string, number>>(() => new Map(Object.entries(keptOf(0)?.tally ?? {})));
  const [opened, setOpened] = useState(() => keptOf(0)?.opened ?? 0);
  const [shake, setShake] = useState(0);
  // 표의 줄을 누르면 그것이 나올 때까지 열어 본다
  const [target, setTarget] = useState<string | null>(null);
  const [hunt, setHunt] = useState<{ name: string; tries: number; expect: number; k: number; short: boolean } | null>(null);
  // 뽑은 장비의 옵션 (이노티아의 축복, 과거의 유물): 카드를 누르면 아래에 옵션을 굴린다
  const [optItem, setOptItem] = useState<OptItem | null>(null);
  const seq = useRef(0);
  const prefix = sec.title.match(/^(Lv\.\S+)/)?.[1] ?? "";
  const coins = useCoins();
  const iconOf = useIcon();
  const chestPic = iconOf(box.name);
  // 나올 때까지는 직접 열어서 나온 것만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로')
  const { save, update } = useSave();
  const gotKey = (name: string) => `box:${box.key}:${si}:${name}`;
  // 순위: 가장 드문 것을 뽑은 사람 (상자마다, 묶음이 여럿이면 묶음마다)
  const rec = useRecord(`box:${box.key}${box.sections.length > 1 ? `:${si}` : ""}`);
  const emit = useQuest();
  // 두근두근: 1·10회는 상자가 0.6초 흔들린 뒤 열린다
  const [charging, setCharging] = useState(false);
  const openFx = (k: number) => {
    if (charging) return;
    if (k > 10) return open(k);
    setCharging(true);
    window.setTimeout(() => {
      setCharging(false);
      open(k);
    }, 600);
  };
  const boxKey = `${box.key}:${si}`;
  const record = (got: Pull[], k: number) => {
    const t = new Map(tally);
    for (const x of got) t.set(x.name, (t.get(x.name) ?? 0) + 1);
    setTally(t);
    setOpened(opened + k);
    update((s) => ({ ...s, box: { ...s.box, [boxKey]: { opened: opened + k, tally: Object.fromEntries(t) } } }));
    setShake((s) => s + 1);
    const rare = got.reduce<Pull | null>((m, x) => (!m || x.p < m.p ? x : m), null);
    if (rare && cat === "box") emit({ kind: "box", p: rare.p });
    if (rare && rare.p < 0.5) rec.submit(cat, { label: rare.name.slice(0, 60), score: Math.round(luckOf(rare.p) * 1000) / 1000, tries: opened + k, luck: luckOf(rare.p) });
  };
  const open = (want: number) => {
    const k = coins.take(want);
    if (k < 1) return;
    const got: Pull[] = [];
    for (let i = 0; i < k; i++) {
      const x = pick(sec.items);
      got.push({ name: x.name, p: x.p / total, id: seq.current++ });
    }
    setFresh(new Set(got.filter((x) => !expOf(save, gotKey(x.name))).map((x) => x.name)));
    update((s) => got.reduce((acc, x) => raiseExp(acc, gotKey(x.name), 1), s));
    // 많이 열면 드문 것부터 10개만 카드로
    setPulls(k > 10 ? [...got].sort((a, b) => a.p - b.p).slice(0, 10) : got);
    setHunt(null);
    record(got, k);
  };
  const untilTarget = () => {
    const goal = sec.items.find((x) => x.name === target);
    const can = coins.coins ?? 0;
    if (!goal || can < 1) return;
    const got: Pull[] = [];
    let tries = 0;
    let hit = false;
    for (;;) {
      tries++;
      const x = pick(sec.items);
      got.push({ name: x.name, p: x.p / total, id: seq.current++ });
      if (x.name === goal.name) hit = true;
      if (hit || tries >= can) break;
    }
    coins.take(tries);
    setFresh(new Set(got.filter((x) => !expOf(save, gotKey(x.name))).map((x) => x.name)));
    update((s) => got.reduce((acc, x) => raiseExp(acc, gotKey(x.name), 1), s));
    setPulls([...got].sort((a, b) => a.p - b.p).slice(0, 10));
    setHunt({ name: goal.name, tries, expect: total / goal.p, k: (hunt?.k ?? 0) + 1, short: !hit });
    record(got, tries);
  };
  // wipe: '지우기'를 눌렀을 때는 저장한 것도 지운다 (묶음을 바꿀 때는 그 묶음의 기록을 불러온다)
  const clear = (wipe = true) => {
    setPulls([]);
    setTally(new Map());
    setOpened(0);
    setHunt(null);
    setOptItem(null);
    if (wipe)
      update((s) => {
        const b = { ...s.box };
        delete b[boxKey];
        return { ...s, box: b };
      });
  };
  const best = pulls.reduce((m, x) => Math.min(m, x.p), 1);
  const rows = [...sec.items].sort((a, b) => a.p - b.p);
  const topP = Math.max(...sec.items.map((x) => x.p)) || 1;
  const tier = tierOf(best);
  return (
    <>
      <section className="panel sim-box">
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="sim-back" onClick={onBack} aria-label="다른 상자">
              ◀
            </button>
          )}
          <b>{box.name}</b>
          {opened > 0 && <em className="sim-luck">{opened.toLocaleString()}회</em>}
          {box.post && (
            <a className="sim-post" href={`#/official/${box.post}`}>
              공식 ›
            </a>
          )}
        </div>
        {box.sections.length > 1 && (
          <div className="mk-cats sim-secs">
            {box.sections.map((s, i) => (
              <button
                key={i}
                type="button"
                className={"sub-tab" + (i === si ? " sub-tab-on" : "")}
                onClick={() => {
                  setSi(i);
                  setTarget(null);
                  clear(false);
                  setTally(new Map(Object.entries(keptOf(i)?.tally ?? {})));
                  setOpened(keptOf(i)?.opened ?? 0);
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div key={charging ? "c" : shake} className={`sim-chest${charging ? " sim-charging" : shake ? ` sim-chest-open sim-chest-${tier}` : ""}`} aria-hidden>
          <span className="sim-rays" />
          <span className="sim-chest-t">{chestPic ? <PicImg pic={chestPic} fit={48} className="sim-pic" /> : <i className="sim-chest-box" />}</span>
          <i className="sim-floor" />
          {!charging && shake > 0 && tier !== "n" && tier !== "u" && <b className="sim-chest-tag">{tier === "sr" ? "대박" : "희귀"}</b>}
          {shake > 0 && !charging && <Sparks kind={`box-${tier}`} n={tier === "sr" ? 18 : 10} />}
        </div>
        <div className="sim-actions sim-actions-3">
          {[1, 10, 100].map((k) => (
            <button key={k} type="button" className={"btn" + (k === 1 ? " sim-go" : " btn-ghost")} disabled={coins.coins === 0 || charging} onClick={() => openFx(k)}>
              {k}회
            </button>
          ))}
        </div>
        {target && (
          <button type="button" className="btn btn-ghost sim-until" disabled={!expOf(save, gotKey(target))} onClick={untilTarget}>
            <NameIcon name={target} size={16} />
            {target} <small>{expOf(save, gotKey(target)) ? "나올 때까지" : "직접 먼저"}</small>
          </button>
        )}
        {hunt && (
          <p key={hunt.k} className={"sim-hunt" + (hunt.short ? " sim-hunt-short" : "")}>
            <b>
              <Count value={hunt.tries} ms={700} />번
            </b>
            <small>평균 {n0(hunt.expect)}번</small>
          </p>
        )}
        {pulls.length > 0 && (
          <div key={`p${shake}`} className="sim-pulls">
            {pulls.map((x, i) => {
              const next = boxes ? boxFor(boxes, x.name, box.key) : null;
              const opt = !next && sources ? optionFor(sources, x.name, prefix) : null;
              const xp = iconOf(x.name);
              const body = (
                <>
                  <span className="sim-card-pic">{xp ? <PicImg pic={xp} fit={30} className="sim-pic" /> : <i className="sim-ib-none" />}</span>
                  <span className="sim-card-name">{x.name}</span>
                  <small>
                    {pctText(x.p)}
                    {next ? " · 열기 ›" : opt ? " · 옵션 ›" : ""}
                  </small>
                  {fresh.has(x.name) && <em className="sim-new">NEW</em>}
                </>
              );
              const cls = `sim-card sim-t-${tierOf(x.p)}${optItem && opt === optItem ? " sim-card-on" : ""}`;
              const style = { animationDelay: `${0.25 + i * 0.06}s` };
              return next || opt ? (
                <button key={x.id} type="button" className={cls} style={style} onClick={() => (next ? onOpen?.(next) : setOptItem(opt))}>
                  {body}
                </button>
              ) : (
                <span key={x.id} className={cls} style={style}>
                  {body}
                </span>
              );
            })}
          </div>
        )}
      </section>
      {optItem && <OptionRoller key={optItem.name} item={optItem} verb="굴리기" onBack={() => setOptItem(null)} />}
      <RankBox rec={rec} title={box.sections.length > 1 ? sec.title : box.name} luck />
      <section className="panel sim-tally">
        {rows.map((x) => {
          const got = tally.get(x.name) ?? 0;
          const p = x.p / total;
          return (
            <button
              key={x.name}
              type="button"
              aria-pressed={target === x.name}
              className={`sim-trow sim-t-${tierOf(p)}` + (got ? " sim-got" : "") + (target === x.name ? " sim-target" : "")}
              onClick={() => setTarget(target === x.name ? null : x.name)}
            >
              <i className="sim-trow-bar" style={{ transform: `scaleX(${Math.max(0.02, Math.sqrt(x.p / topP)).toFixed(3)})` }} aria-hidden />
              <span className="sim-tname">
                <NameIcon name={x.name} size={18} />
                {x.name}
              </span>
              <b>{pctText(p)}</b>
              <em>{got ? `${got.toLocaleString()}` : ""}</em>
            </button>
          );
        })}
        {opened > 0 && (
          <button type="button" className="sim-reset" onClick={() => clear()} aria-label="처음부터">
            ↺
          </button>
        )}
      </section>
    </>
  );
}

// ================================================================ 보석 (합성 · 세공)

function GemTab({ odds }: { odds: Odds }) {
  const [mode, setMode] = useEntryState<"synth" | "polish">("sim.gmode", "synth");
  const polish = useMemo(() => boxOf(odds, "30201"), [odds]);
  const head = (
    <div className="mk-cats" role="tablist">
      {(
        [
          ["synth", "보석 합성"],
          ["polish", "보석 세공"],
        ] as const
      ).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={mode === k} className={"sub-tab sim-mode" + (mode === k ? " sub-tab-on" : "")} onClick={() => setMode(k)}>
          {l}
        </button>
      ))}
    </div>
  );
  if (mode === "synth") return <GemSynth odds={odds} head={head} />;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">{head}</div>
      {polish ? <BoxOpener box={polish} cat="gem" /> : <div className="empty">세공 자료가 없어요</div>}
    </div>
  );
}

const GEM_STARTS = [30, 90, 300, 1000];
/** 단계마다 보일 보석 그림 (아이템 책의 도감 아이콘, 세레인의 보석 1~4단계) */
const GEM_PIC = ["", "세레인의흑요석", "세레인의자수정", "세레인의사파이어", "세레인의아쿠아마린"];
/** 1단계 보석 N개로 시작해 같은 단계 3개씩 합성한다 (실패하면 3개가 같은 단계 1개로) */
function GemSynth({ odds, head }: { odds: Odds; head: React.ReactNode }) {
  const rules = useMemo(() => gemSynth(odds), [odds]);
  // 가진 보석과 합성 수는 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const kept = useSave().save.gem;
  const [start, setStart] = useEntryState("sim.gstart", kept?.start ?? 30);
  const [inv, setInv] = useState<number[]>(() => (kept?.inv?.length === 5 ? kept.inv : [0, start, 0, 0, 0]));
  const [runs, setRuns] = useState(kept?.runs ?? 0);
  const [fx, setFx] = useState<{ from: number; to: number; n: number } | null>(null);
  const [avg, setAvg] = useState<number[] | null>(null);
  const coins = useCoins();
  // 보석 그림이 없는 단계(아쿠아마린은 자료에 그림이 없다)는 그 색의 도트 보석
  const iconOf = useIcon();
  // 순위: 1단계 몇 개로 몇 단계까지 (같은 단계면 적은 보석으로, 그다음 적은 합성으로)
  const rec = useRecord("gem:synth");
  const best = useRef(kept?.best ?? 1);
  const can = (st: number, v = inv) => v[st] >= 3 && !!rules[st];
  const emit = useQuest();
  const reached = (stage: number, synths: number) => {
    emit({ kind: "gem", stage });
    if (stage <= best.current || stage < 2) return;
    best.current = stage;
    // 이 수로 이 단계까지 갈 확률 (400번 해 본다)
    let hit = 0;
    for (let i = 0; i < 400; i++) if (synthAll([0, start, 0, 0, 0]).best >= stage) hit++;
    const luck = luckOf(Math.max(hit, 0.5) / 400);
    rec.submit("gem", { label: `${stage}단계 · 1단계 ${start}개`, score: stage * 10000 - start, tries: synths, luck });
  };
  // 모두 합성은 직접 합성해 본 단계만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로')
  const { save, update } = useSave();
  const firstKeep = useRef(true);
  useEffect(() => {
    if (firstKeep.current) {
      firstKeep.current = false;
      return;
    }
    update((s) => ({ ...s, gem: { inv, runs, start, best: best.current } }));
  }, [inv, runs, start, update]);
  const tried = (st: number) => expOf(save, `gem:${st}`) > 0;
  const once = (st: number) => {
    if (!can(st) || coins.take(1) < 1) return;
    update((s) => raiseExp(s, `gem:${st}`, 1));
    const r = pick(rules[st]);
    const next = [...inv];
    next[st] -= 3;
    next[r.to] += 1;
    setInv(next);
    setRuns((n) => n + 1);
    setFx((f) => ({ from: st, to: r.to, n: (f?.n ?? 0) + 1 }));
    reached(r.to, runs + 1);
  };
  function synthAll(v: number[], limit = Infinity, only: (st: number) => boolean = () => true) {
    const next = [...v];
    let n = 0;
    let best = 0;
    for (;;) {
      const st = n < limit ? [1, 2, 3].find((k) => only(k) && can(k, next)) : undefined;
      if (!st) break;
      const r = pick(rules[st]);
      next[st] -= 3;
      next[r.to] += 1;
      n++;
      best = Math.max(best, r.to);
    }
    return { next, n, best };
  }
  const all = () => {
    const { next, n, best: top } = synthAll(inv, coins.coins ?? 0, tried);
    if (!n) return;
    coins.take(n);
    setInv(next);
    setRuns((x) => x + n);
    setFx((f) => ({ from: 1, to: top, n: (f?.n ?? 0) + 1 }));
    reached(top, runs + n);
  };
  const reset = (k: number) => {
    best.current = 1;
    setStart(k);
    setInv([0, k, 0, 0, 0]);
    setRuns(0);
    setFx(null);
    setAvg(null);
  };
  // 같은 수로 1000번 해 본 평균 (단계마다 남는 수)
  const average = () => {
    const sum = [0, 0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const { next } = synthAll([0, start, 0, 0, 0]);
      for (let k = 1; k <= 4; k++) sum[k] += next[k];
    }
    setAvg(sum.map((x) => x / 1000));
  };
  const TONE = ["keep", "ok", "gold"] as const;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <div className="mk-cats" role="tablist">
          {GEM_STARTS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={start === k} className={"sub-tab" + (start === k ? " sub-tab-on" : "")} onClick={() => reset(k)}>
              {k}개
            </button>
          ))}
        </div>
      </div>
      <section className="panel sim-gems">
        {[1, 2, 3, 4].map((st) => {
          const hit = fx && fx.to === st;
          return (
            <div key={st} className={`sim-gem sim-gem-${st}` + (hit ? (fx.to > fx.from ? " sim-gem-hit" : " sim-gem-same") : "") + (inv[st] ? "" : " sim-gem-zero")}>
              <small className="sim-gem-st">{GEM_NAMES[st]}</small>
              <span key={hit ? fx.n : 0} className="sim-gem-pic" aria-hidden>
                {iconOf(GEM_PIC[st]) ? <NameIcon name={GEM_PIC[st]} size={30} /> : <i className={`sim-gem-dot sim-gem-dot-${st}`} />}
                {hit && fx.to > fx.from && <Sparks kind={fx.to - fx.from > 1 ? "plus2" : "ok"} n={8} />}
              </span>
              <b key={`n${hit ? fx.n : 0}`} className="sim-gem-n">
                <Count value={inv[st]} ms={300} />
              </b>
              {rules[st] ? (
                <>
                  <span className="sim-gem-odds" aria-label={rules[st].map((r) => `${r.to}단계 ${pctText(r.p)}`).join(" ")}>
                    {rules[st].map((r) => (
                      <i key={r.to} className={`sim-odds-${TONE[Math.min(2, r.to - st)]}`} style={{ flexGrow: Math.max(r.p, 0.06) }} />
                    ))}
                  </span>
                  <small className="sim-gem-pct">{rules[st].map((r) => Math.round(r.p * 100)).join("·")}</small>
                  <button type="button" className="sim-mini sim-gem-go" disabled={!can(st) || coins.coins === 0} onClick={() => once(st)}>
                    합성
                  </button>
                </>
              ) : (
                <span className="sim-max">MAX</span>
              )}
            </div>
          );
        })}
      </section>
      <div className="sim-actions sim-actions-grow">
        <button type="button" className="btn sim-go" disabled={![1, 2, 3].some((k) => tried(k) && can(k)) || coins.coins === 0} onClick={all}>
          {[1, 2, 3].some(tried) ? "모두 합성" : "직접 먼저"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={average}>
          1000번 평균
        </button>
        <button type="button" className="btn btn-ghost sim-again" onClick={() => reset(start)} aria-label="처음부터">
          ↺
        </button>
      </div>
      {avg && (
        <div className="sim-avgs">
          {[1, 2, 3, 4]
            .filter((k) => avg[k] >= 0.005)
            .map((k) => (
              <span key={k} className={`sim-gem-${k}`}>
                {iconOf(GEM_PIC[k]) ? <NameIcon name={GEM_PIC[k]} size={18} /> : <i className={`sim-gem-dot sim-gem-dot-${k}`} />}
                <b>{avg[k] >= 10 ? avg[k].toFixed(0) : avg[k].toFixed(2)}</b>
              </span>
            ))}
        </div>
      )}
      <StatStrip
        items={[
          { label: "합성", value: runs },
          { label: "보석", value: inv.reduce((a, b) => a + b, 0) },
          { label: "최고", value: [4, 3, 2, 1].find((k) => inv[k] > 0) ?? 0, tone: "sim-good", unit: "단계" },
        ]}
      />
      <RankBox rec={rec} title="보석 합성" />
    </div>
  );
}
