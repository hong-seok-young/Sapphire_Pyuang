// 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04). 자료와 규칙은 src/sim.ts (컴투스 공식 확률 표 106개).
// 맨 위 같은 폭 단추 강화 · 성장 · 옵션 · 보석 · 뽑기, 그 아래 어두운 띠에서 고르고, 해 보면서 확률을 몸으로 느끼게 결과마다 짧은 움직임(transform·opacity 만)을 준다.
// 그림은 아직 쓰지 않고 글자로만 그린다 (제작자 2026-11-04 '이미지 보여주는 건 텍스트로 대체, 나중에 강화하는 이미지나 동영상 주면 그대로'): 받으면 sim-item 자리를 그 모양으로 바꾼다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsync } from "../data";
import { loadOdds } from "../odds";
import type { Odds } from "../odds";
import { useEntryState } from "../router";
import { BOX_CATS, GEM_NAMES, atLeast, boxFor, boxOf, boxesOf, expectedTo, gemSynth, optionFor, optionSources, pick, repairItems, scrollsOf, stepsExpected, stepsOf, tierOf } from "../sim";
import type { Box, Dist, OptItem, OptSource, Part, Scroll, Steps } from "../sim";
import { Loading, PicImg, TopBar } from "../ui";
import { ARMOR_SLOTS, GEAR_JOBS, gearOf, gearPower, gearStat, loadHeld, saveHeld } from "../simGear";
import type { ArmorSlot, Gear, GearJob, Held } from "../simGear";
import type { Wiki } from "../types";
import { JOB_NAME } from "../auth";
import type { Me } from "../auth";
import { Nick } from "../kakao";
import { CAT_NAME, CoinCtx, fetchKing, luckOf, reachWithin, stepsWithin, useCoinState, useCoins, useRecord } from "../simRank";
import type { Cat, King, SimRec } from "../simRank";
import { QuestCtx, titleOf, todayQuests, useQuest } from "../simQuest";
import type { SimEvent } from "../simQuest";
import { api } from "../auth";

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
const n0 = (v: number) => (v >= 1e9 ? `${(v / 1e8).toFixed(0)}억` : v >= 1e5 ? `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}만` : Math.round(v).toLocaleString());

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

export function SimulatorPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []), "odds");
  const [tabRaw, setTab] = useEntryState<Tab>("sim.tab", "enhance");
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "enhance";
  const coin = useCoinState();
  const today = (coin.wallet?.rules.reduce((t, r) => t + r.n * r.coin, 0) ?? 0) + (coin.wallet?.quests.filter(Boolean).length ?? 0) * (coin.wallet?.questCoin ?? 0);
  // 오늘의 도전 (src/simQuest.ts): 결과마다 알리면 맞는 도전을 깨고 코인을 받는다
  const quests = useMemo(() => todayQuests(), []);
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  const doneRef = useRef(done);
  useEffect(() => {
    if (coin.wallet) {
      doneRef.current = coin.wallet.quests;
      setDone(coin.wallet.quests);
    }
  }, [coin.wallet]);
  const [cheer, setCheer] = useState<{ text: string; n: number } | null>(null);
  const emit = useCallback(
    (e: SimEvent) => {
      quests.forEach((q, i) => {
        if (doneRef.current[i] || !q.done(e)) return;
        doneRef.current = doneRef.current.map((x, j) => x || j === i);
        setDone(doneRef.current);
        setCheer((c) => ({ text: q.text, n: (c?.n ?? 0) + 1 }));
        api<{ coins: number; got: boolean }>("/api/sim/wallet", "POST", { quest: i }).then(() => coin.reload(), () => undefined);
      });
    },
    [quests, coin],
  );
  useEffect(() => {
    if (!cheer) return;
    const t = window.setTimeout(() => setCheer(null), 2600);
    return () => window.clearTimeout(t);
  }, [cheer]);
  // 전광판은 30초마다 다시
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && coin.reload(), 30_000);
    return () => window.clearInterval(t);
  }, [coin]);
  return (
    <CoinCtx.Provider value={coin}>
      <QuestCtx.Provider value={emit}>
      <TopBar title="확률 시뮬레이터" />
      <div className="pill-row sim-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* 행운 코인: 시도마다 하나 (웹에서 글쓰기·시간표 확정·챗봇 같은 일을 하면 쌓인다) */}
      <button type="button" className={"sim-coins" + (coin.coins === 0 ? " sim-coins-empty" : "")} onClick={() => setTab("rank")}>
        <span>행운 코인</span>
        <b key={coin.coins ?? -1}>{coin.coins === null ? "…" : coin.coins.toLocaleString()}</b>
        <em className="sim-title">{coin.wallet ? titleOf(coin.wallet.total) : ""}</em>
        <small>{coin.coins === 0 ? "버는 법 ›" : today ? `오늘 +${today}` : "버는 법 ›"}</small>
      </button>
      {coin.wallet && coin.wallet.feed.length > 0 && <Ticker feed={coin.wallet.feed} />}
      <div className="sim-quests" aria-label="오늘의 도전">
        <b>오늘의 도전</b>
        {quests.map((q, i) => (
          <span key={q.id} className={done[i] ? "sim-q-done" : ""}>
            {done[i] ? "✓ " : ""}
            {q.text}
            {!done[i] && <small> +{coin.wallet?.questCoin ?? 30}</small>}
          </span>
        ))}
      </div>
      {cheer && (
        <div key={cheer.n} className="sim-cheer" role="status">
          <b>도전 완료</b>
          <span>{cheer.text}</span>
          <small>+{coin.wallet?.questCoin ?? 30} 코인</small>
        </div>
      )}
      {!odds ? (
        <Loading error={error} />
      ) : tab === "enhance" ? (
        <EnhanceTab odds={odds} wiki={wiki} me={me} />
      ) : tab === "grow" ? (
        <StatSim odds={odds} />
      ) : tab === "option" ? (
        <OptionSim odds={odds} />
      ) : tab === "gem" ? (
        <GemTab odds={odds} />
      ) : tab === "box" ? (
        <BoxSim odds={odds} />
      ) : (
        <RankTab odds={odds} />
      )}
      </QuestCtx.Provider>
    </CoinCtx.Provider>
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

/** 시뮬레이터 하나의 순위 (5위까지와 내 기록). luck 이면 드문 정도로, 아니면 몇 번 만에 */
function RankBox({ rec, title, luck = false }: { rec: ReturnType<typeof useRecord>; title: string; luck?: boolean }) {
  const d = rec.data;
  if (!d) return null;
  const top = d.board.slice(0, 5);
  const mine = d.mine;
  const line = (r: SimRec) => (luck ? `${luckText(r.luck)} · ${r.tries.toLocaleString()}번째` : `${r.tries.toLocaleString()}번 만에`);
  return (
    <section className="panel sim-rank">
      <div className="sim-rank-head">
        <b>순위</b>
        <small>{title}</small>
      </div>
      {top.length ? (
        top.map((r, i) => (
          <div key={r.user_id} className={`sim-rank-row sim-rank-${i + 1}`}>
            <em>{i + 1}</em>
            <span className="sim-rank-who">
              <Nick name={r.user_id} />
            </span>
            <b>{r.label}</b>
            <small>{line(r)}</small>
          </div>
        ))
      ) : (
        <p className="sim-muted sim-rank-none">아직 기록이 없어요</p>
      )}
      {mine && (mine.rank ?? 99) > 5 && (
        <div className="sim-rank-row sim-rank-mine">
          <em>{mine.rank}</em>
          <span className="sim-rank-who">나</span>
          <b>{mine.label}</b>
          <small>{line(mine)}</small>
        </div>
      )}
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

/** 순위 칸: 도박의 신(묶음마다 가장 드문 기록의 운을 더한 것), 시뮬레이터마다 1위, 코인 버는 법 */
function RankTab({ odds }: { odds: Odds }) {
  const coin = useCoins() as ReturnType<typeof useCoinState>;
  const [data, setData] = useState<{ king: King[]; firsts: SimRec[]; mine: SimRec[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchKing().then(setData, (e) => setErr(String(e)));
    coin.reload?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name = useMemo(() => gameNamer(odds), [odds]);
  if (!data) return <Loading error={err} />;
  const parts = (s: string) =>
    s
      .split(",")
      .map((x) => x.split(":"))
      .filter((x) => x.length === 2)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
  return (
    <div className="sim">
      <section className="panel sim-king">
        <div className="sim-rank-head">
          <b>도박의 신</b>
          <small>1/10 = 1점 · 1/1000 = 3점</small>
        </div>
        {data.king.length ? (
          data.king.map((k, i) => (
            <div key={k.user_id} className={`sim-king-row sim-rank-${i + 1}`}>
              <em>{i + 1}</em>
              <span className="sim-rank-who">
                <Nick name={k.user_id} />
              </span>
              <b>{k.total.toFixed(1)}점</b>
              <span className="sim-king-parts">
                {parts(k.parts).map(([c, v]) => (
                  <i key={c}>
                    {CAT_NAME[c as Cat] ?? c} {Number(v).toFixed(1)}
                  </i>
                ))}
              </span>
            </div>
          ))
        ) : (
          <p className="sim-muted sim-rank-none">아직 기록이 없어요</p>
        )}
      </section>
      {data.firsts.length > 0 && (
        <section className="panel sim-rank">
          <div className="sim-rank-head">
            <b>시뮬레이터별 1위</b>
          </div>
          {data.firsts.map((r) => (
            <div key={r.game} className="sim-first-row">
              <small>{name(r.game ?? "")}</small>
              <span>
                <Nick name={r.user_id} /> <b>{r.label}</b> <em>{/^(enh|stat):/.test(r.game ?? "") ? `${r.tries.toLocaleString()}번 만에` : luckText(r.luck)}</em>
              </span>
            </div>
          ))}
        </section>
      )}
      {coin.wallet && (
        <section className="panel sim-earn">
          <div className="sim-rank-head">
            <b>행운 코인 버는 법</b>
            <small>하루마다 새로</small>
          </div>
          {coin.wallet.rules.map((r) => (
            <div key={r.key} className={"sim-earn-row" + (r.n >= r.cap ? " sim-earn-done" : "")}>
              <span>{r.label}</span>
              <b>+{r.coin}</b>
              <small>
                {r.n}/{r.cap}
              </small>
            </div>
          ))}
        </section>
      )}
    </div>
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
/** 받침이 있으면 a, 없으면 b ('나무지팡이가', '고대의봉이') */
const josa = (w: string, a: string, b: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? a : b;
};
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
        <span className="sim-good">성공 {pctText(c.p)}</span>
        <span className={keep ? "sim-muted" : "sim-bad"}>{keep ? "그대로" : "파괴"}</span>
      </div>
    </div>
  );
}

/** 장비 상점: 실제 장비를 +0(노작)으로 산다. 레벨이 높을수록 비싸다 (src/simGear.ts) */
function GearShop({ gears, part, job, setJob, slot, setSlot, onBuy, coins, onClose }: {
  gears: Gear[];
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
  return (
    <section className="panel sim-shop">
      <div className="sim-shop-head">
        <b>장비 상점</b>
        <small>노작 · 행운 코인</small>
        {onClose && (
          <button type="button" className="sim-shop-x" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      <div className="mk-sub sim-shop-filter">
        <div className="mk-cats" role="tablist">
          {GEAR_JOBS.map((j) => (
            <button key={j} type="button" role="tab" aria-selected={job === j} className={"sub-tab" + (job === j ? " sub-tab-on" : "")} onClick={() => setJob(j)}>
              {j}
            </button>
          ))}
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
      <ul className="sim-shop-list">
        {list.map((g, i) => (
          <li key={g.name} style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}>
            <span className="sim-shop-pic">{g.icon ? <PicImg pic={g.icon} max={28} /> : null}</span>
            <span className="sim-shop-name">
              <b>{g.name}</b>
              <small>
                Lv.{g.lv} · {part === "무기" ? `공격 ${gearStat(g, 0)}` : gearStat(g, 0)}
              </small>
            </span>
            <button type="button" className="btn sim-buy" disabled={coins === null || coins < g.price} onClick={() => onBuy(g)}>
              {g.price}
              <small>코인</small>
            </button>
          </li>
        ))}
        {!list.length && <li className="sim-muted">이 칸에 강화할 수 있는 장비가 없어요</li>}
      </ul>
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
  // 들고 있는 장비 (부위마다 이 기기에, 캐릭터마다): 다시 열어도 그 강화도 그대로
  const [held, setHeldState] = useState<Held | null>(() => loadHeld(me.id, part));
  const heldRef = useRef(held);
  const setHeld = (h: Held | null, of: Part = part) => {
    heldRef.current = h;
    setHeldState(h);
    saveHeld(me.id, of, h);
  };
  const gear = held ? gears.find((g) => g.part === part && g.name === held.name) : undefined;
  const [shop, setShop] = useState(false);
  const lv = held?.lv ?? 0;
  const broken = held?.broken ?? false;
  const [fx, setFx] = useState<Fx | null>(null);
  const [gain, setGain] = useState<{ from: string; to: string; pct: number; n: number } | null>(null);
  const [stats, setStats] = useState({ tries: 0, broke: 0, best: 0, coins: 0 });
  const [log, setLog] = useState<LogDot[]>([]);
  const [goal, setGoal] = useState(part === "무기" ? 8 : 6);
  const [auto, setAuto] = useState(false);
  const coins = useCoins();
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
    setAuto(false);
    comboRef.current = 0;
    setCombo(0);
  };
  const buy = (g: Gear) => {
    if (coins.coins === null || coins.coins < g.price || coins.take(g.price) < g.price) return;
    clearFx();
    setHeld({ name: g.name, lv: 0, broken: false, tries: 0, tainted: false });
    setStats((s) => ({ ...s, coins: s.coins + g.price }));
    setShop(false);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
  };
  const choose = (s: Scroll) => {
    setName(s.name);
    const h = heldRef.current;
    if (h && h.lv > 0 && s.name !== scroll.name && !h.tainted) setHeld({ ...h, tainted: true });
  };

  const tryOnce = useCallback(
    (forced?: boolean): boolean => {
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
      tryOnce();
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
    if (c) tryOnce(c.ok);
  }, [tryOnce]);

  // 목표까지 자동: 0.18초마다 한 번, 목표에 닿거나 부서지면 멈춘다
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      const h = heldRef.current;
      if (!h || h.lv >= goal || h.broken || !(rates[h.lv + 1] > 0)) {
        setAuto(false);
        return;
      }
      tryOnce();
    }, 180);
    return () => window.clearInterval(t);
  }, [auto, goal, rates, tryOnce]);

  const switchPart = (x: Part) => {
    setPart(x);
    setGoal(x === "무기" ? 8 : 6);
    clearFx();
    setCharge(null);
    const h = loadHeld(me.id, x);
    heldRef.current = h;
    setHeldState(h);
    setShop(false);
  };

  const next = lv + 1;
  const p = rate(next);
  const failText = p >= 1 ? "반드시 성공" : scroll.keep ? "실패해도 그대로" : "실패하면 파괴";
  const ladder = Array.from({ length: 15 }, (_, i) => i + 1).filter((k) => rate(k) > 0);
  const showShop = !gear || shop;
  const label = gear?.name ?? part;
  const nameSize = label.length > 7 ? " sim-icon-long" : "";

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
        </div>
        <div className="mk-cats" role="tablist">
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
              이벤트 확률
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
        />
      ) : (
        <>
          <section
            className={`panel sim-anvil${broken ? " sim-broken" : ""}${charge ? " sim-charging" : ""}${charge && charge.p < 0.2 ? " sim-risky" : ""}${fx?.big && fx.kind === "ok" ? " sim-anvil-big" : ""}${fx?.kind === "break" ? " sim-anvil-break" : ""}`}
            key={`a${fx?.kind === "break" || fx?.big ? fx.n : 0}`}
          >
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
              <button type="button" className="sim-change" onClick={() => setShop(true)} disabled={!!charge || auto}>
                장비 바꾸기
              </button>
            </div>
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
                  <span className="sim-half sim-half-a">{label}</span>
                  <span className="sim-half sim-half-b">{label}</span>
                  {broken && <i className="sim-crack" />}
                </span>
                {charge && (
                  <b key={`h${charge.n}`} className="sim-tang" style={{ ["--hit" as string]: `${Math.round(charge.dur / 3)}ms` }} aria-hidden>
                    탕!
                  </b>
                )}
              </span>
              <b key={`l${lv}${broken}`} className={"sim-lv" + (broken ? " sim-lv-dead" : "")}>
                +{lv}
              </b>
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
                  +{lv} 성공!
                </b>
              )}
            </div>
            {charge ? (
              <Gauge c={charge} keep={scroll.keep} onDone={landed} />
            ) : (
              <div className="sim-next">
                {broken ? (
                  <span className="sim-bad">{gear!.name}{josa(gear!.name, "이", "가")} 부서졌어요</span>
                ) : p > 0 ? (
                  <>
                    <span>
                      +{next} 도전 <b className={p < 0.11 ? "sim-bad" : p < 1 ? "sim-warn" : "sim-good"}>{pctText(p)}</b>
                    </span>
                    <small>{failText}</small>
                  </>
                ) : (
                  <span className="sim-muted">{lv >= 15 ? "최고 강화예요" : `${scroll.name} 마법서로는 +${next} 를 못 해요`}</span>
                )}
                {!broken &&
                  (gain ? (
                    <small key={gain.n} className="sim-gain">
                      {part === "무기" ? "공격 " : ""}
                      {gain.from} → <b>{gain.to}</b> <em>+{gain.pct}%</em>
                    </small>
                  ) : (
                    <small className="sim-muted">
                      {part === "무기" ? "공격 " : ""}
                      {gearStat(gear!, lv)}
                    </small>
                  ))}
              </div>
            )}
          </section>

          {broken ? (
            <div className="sim-actions sim-actions-2">
              <button type="button" className="btn sim-go" disabled={coins.coins === null || coins.coins < gear!.price} onClick={() => buy(gear!)}>
                다시 사기 <small>{gear!.price}코인</small>
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
              <span className="sim-goal">
                <button type="button" className="pill" onClick={() => setGoal(Math.max(lv + 1, goal - 1))} aria-label="목표 내리기">
                  −
                </button>
                <button type="button" className={"btn btn-ghost" + (auto ? " sim-running" : "")} disabled={!!charge || (!auto && lv >= goal)} onClick={() => setAuto(!auto)}>
                  {auto ? "멈춤" : `+${goal} 까지 자동`}
                </button>
                <button type="button" className="pill" onClick={() => setGoal(Math.min(15, goal + 1))} aria-label="목표 올리기">
                  +
                </button>
              </span>
            </div>
          )}
        </>
      )}

      <div className="sim-stats">
        <span>
          <small>시도</small>
          <b>
            <Count value={stats.tries} ms={250} />
          </b>
        </span>
        <span>
          <small>부서진 장비</small>
          <b className={stats.broke ? "sim-bad" : ""}>
            <Count value={stats.broke} ms={250} />
          </b>
        </span>
        <span>
          <small>쓴 코인</small>
          <b>
            <Count value={stats.coins} ms={250} />
          </b>
        </span>
      </div>
      {log.length > 0 && (
        <div className="sim-log" aria-label="최근 결과">
          {log.map((d, i) => (
            <i key={i} className={d.ok ? "ok" : d.broke ? "bad" : "keep"} title={`+${d.to} ${d.ok ? "성공" : d.broke ? "파괴" : "실패"}`} />
          ))}
        </div>
      )}

      <RankBox rec={rec} title={`${part === "갑옷" ? "방어구" : part} · ${scroll.name}${ev && scroll.event ? " 이벤트" : ""}`} />
      <ChanceTable rate={rate} keep={scroll.keep} ladder={ladder} from={broken ? 0 : lv} />
      <Thousand rate={rate} keep={scroll.keep} goal={goal} />
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
    <section className="panel sim-table">
      <div className="sim-th">
        <b>+{from} 에서</b>
        <span>한 번에</span>
        <span>평균 마법서</span>
        {!keep && <span>부서짐</span>}
      </div>
      {rows.map(({ k, e }) => (
        <div key={k} className={"sim-tr" + (keep ? " sim-tr-3" : "")}>
          <b>+{k}</b>
          <span className={tierClass(e.once)}>{pctText(e.once)}</span>
          <span>{n0(e.tries)}장</span>
          {!keep && <span className="sim-bad">{n0(e.broken)}개</span>}
        </div>
      ))}
    </section>
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
    <section className="panel sim-thousand">
      <button type="button" className="btn btn-ghost" onClick={run}>
        +0 장비 1000개를 +{goal} 까지
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
              <small>부서짐</small>
              <b className="sim-bad">
                <Count value={res.broke} />개
              </b>
            </span>
          )}
          <span>
            <small>쓴 마법서</small>
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
    </section>
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

function StatSim({ odds }: { odds: Odds }) {
  const all = useMemo(() => stepsOf(odds), [odds]);
  const [key, setKey] = useEntryState("sim.steps", all[0]?.key ?? "");
  const st = all.find((s) => s.key === key) ?? all[0];
  const [stat, setStat] = useEntryState("sim.stat", "지능");
  const [stage, setStage] = useState(0);
  const [type, setType] = useState<string | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [stats, setStats] = useState({ tries: 0, ok: 0, big: 0 });
  const [auto, setAuto] = useState(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  if (!st) return <div className="empty">스탯 부여 자료가 없어요</div>;
  return <StatInner st={st} all={all} setKey={setKey} stat={stat} setStat={setStat} stage={stage} setStage={setStage} stageRef={stageRef} type={type} setType={setType} fx={fx} setFx={setFx} stats={stats} setStats={setStats} auto={auto} setAuto={setAuto} />;
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
}) {
  const { st, stage, stageRef, setStage, setFx, setStats, setType, auto, setAuto } = p;
  const pet = !!st.types;
  const step = st.steps[stage];
  const coins = useCoins();
  // 순위: 처음부터 몇 번 만에 끝 단계
  const rec = useRecord(`stat:${st.key}`);
  const since = useRef(0);
  const emit = useQuest();
  const reset = () => {
    setStage(0);
    stageRef.current = 0;
    setType(null);
    setFx(() => null);
    setAuto(false);
    since.current = 0;
  };
  const tryOnce = useCallback(() => {
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
      if (to >= st.max) {
        const n = since.current;
        rec.submit("grow", { label: `${st.max}단계`, score: st.max, tries: n, luck: luckOf(stepsWithin(st, n)) });
      }
      emit({ kind: "stat", key: st.key, stage: to, max: st.max });
      if (cur === 0 && st.types) setType(pick(st.types).name);
      setFx((f) => ({ kind: up === 2 ? "plus2" : "ok", n: (f?.n ?? 0) + 1 }));
    } else setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
  }, [st, stageRef, setStage, setStats, setType, setFx, coins, rec, setAuto, emit]);
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      if (stageRef.current >= st.max) {
        setAuto(false);
        return;
      }
      tryOnce();
    }, 120);
    return () => window.clearInterval(t);
  }, [auto, st.max, stageRef, tryOnce, setAuto]);

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
                p.setKey(s.key);
                reset();
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

      <section className="panel sim-anvil">
        <div key={p.fx?.n ?? 0} className={`sim-item${p.fx ? ` sim-fx-${p.fx.kind}` : ""}`}>
          {p.fx && p.fx.kind !== "keep" && <Sparks kind={p.fx.kind} n={p.fx.kind === "plus2" ? 16 : 10} />}
          <span className="sim-ring" aria-hidden />
          <span className={`sim-icon sim-glow-${Math.min(4, stage + (stage >= st.max ? 1 : 0))}`} aria-hidden>
            <span className="sim-half sim-half-a">{pet ? "펫" : "장신구"}</span>
          </span>
          <b className="sim-lv sim-lv-sm">{shown}</b>
        </div>
        <div className="sim-steps" aria-label="단계">
          {Array.from({ length: st.max }, (_, i) => (
            <i key={i} className={i < stage ? "on" : ""} />
          ))}
        </div>
        <div className="sim-next">
          {step && stage < st.max ? (
            <>
              <span>
                {stage}단계 · +1 <b className="sim-warn">{pctText(step.a)}</b>
                {step.b > 0 && (
                  <>
                    {" "}
                    · +2 <b className="sim-gold">{pctText(step.b)}</b>
                  </>
                )}
              </span>
              <small>실패 {pctText(1 - step.a - step.b)} · 실패하면 그대로</small>
            </>
          ) : (
            <span className="sim-good">끝 단계예요</span>
          )}
        </div>
      </section>

      <div className="sim-actions">
        <button type="button" className="btn sim-go" disabled={stage >= st.max || auto || coins.coins === 0} onClick={tryOnce}>
          {pet ? "강화" : "스탯 부여"}
        </button>
        <button type="button" className={"btn btn-ghost" + (auto ? " sim-running" : "")} disabled={stage >= st.max && !auto} onClick={() => setAuto(!auto)}>
          {auto ? "멈춤" : "끝까지 자동"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          처음부터
        </button>
      </div>
      {pet && p.type && st.types && (
        <button type="button" className="btn btn-ghost sim-until" onClick={resetStat}>
          스탯 리셋 <small>(다른 스탯 넷 중 하나 · 각 25%)</small>
        </button>
      )}
      <div className="sim-stats">
        <span>
          <small>시도</small>
          <b>
            <Count value={p.stats.tries} ms={200} />
          </b>
        </span>
        <span>
          <small>성공</small>
          <b className="sim-good">
            <Count value={p.stats.ok} ms={200} />
          </b>
        </span>
        <span>
          <small>+2 성공</small>
          <b className="sim-gold">
            <Count value={p.stats.big} ms={200} />
          </b>
        </span>
      </div>
      <RankBox rec={rec} title={st.name} />
      {left !== null && stage < st.max && (
        <p className="sim-expect">
          {stage}단계에서 끝 단계까지 평균 <b>{n0(left)}번</b>
        </p>
      )}
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
  const flat = (s: string) => s.replace(/\s+/g, "");
  const found = q.trim() ? items.filter((x) => flat(x.name).includes(flat(q))) : items;
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
          game={`opt:${source.key}:${item.name}`.slice(0, 60)}
          cat="option"
        />
      ) : (
        <>
          <input className="sim-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="아이템 이름" aria-label="아이템 찾기" />
          <div className="sim-items">
            {found.map((x) => (
              <button key={x.name} type="button" className="sim-pick" onClick={() => setName(x.name)}>
                <span className="sim-pick-t">
                  <span>{x.name}</span>
                  <small>{x.opts.map((o) => o.label).join(" · ")}</small>
                </span>
              </button>
            ))}
            {!found.length && <p className="empty">찾는 아이템이 없어요</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** 한꺼번에 나온 옵션이 이만큼(이상) 나올 확률 (값이 하나뿐인 옵션은 뺀다) */
const jointP = (item: OptItem, vals: Dist["vals"][number][]) => item.opts.reduce((p, d, i) => (d.vals.length > 1 ? p * atLeast(d, vals[i].n) : p), 1);

function OptionRoller({ item, onBack, verb, game, cat }: { item: OptItem; onBack?: () => void; verb: string; game?: string; cat?: Cat }) {
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
  const again = () => {
    if (coins.take(1) < 1) return;
    rolls.current++;
    const got = roll();
    setVals(got);
    setN((x) => x + 1);
    setHunt(null);
    report(got);
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
  return (
    <>
      <section className="panel sim-opt">
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="pill" onClick={onBack} aria-label="다른 아이템">
              ◀
            </button>
          )}
          <b>{item.name}</b>
          <small>{n}번째</small>
        </div>
        {item.opts.map((o, i) => (
          <OptLine key={i} d={o} v={vals[i]} n={n} i={i} />
        ))}
      </section>
      <div className="sim-actions">
        <button type="button" className="btn sim-go" disabled={coins.coins === 0} onClick={again}>
          {verb === "굴리기" ? "한 번 더" : verb}
        </button>
      </div>
      <section className="panel sim-aim">
        <div className="mk-cats">
          {item.opts.map((o, i) => (
            <button key={i} type="button" className={"sub-tab" + (aim.i === i ? " sub-tab-on" : "")} onClick={() => setAim({ i, min: Math.max(...o.vals.map((v) => v.n)) })}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="sim-aim-row">
          <button type="button" className="pill" onClick={() => setAim({ ...aim, min: nums[Math.max(0, nums.indexOf(aim.min) - 1)] ?? aim.min })} aria-label="목표 내리기">
            −
          </button>
          <span>
            {d.label} <b>{aim.min}</b> 이상 · <b className={tierClass(P)}>{pctText(P)}</b>
          </span>
          <button type="button" className="pill" onClick={() => setAim({ ...aim, min: nums[Math.min(nums.length - 1, nums.indexOf(aim.min) + 1)] ?? aim.min })} aria-label="목표 올리기">
            +
          </button>
        </div>
        <button type="button" className="btn btn-ghost" disabled={!(P > 0) || coins.coins === 0} onClick={huntGoal}>
          나올 때까지 {verb}
        </button>
        {hunt && (
          <p key={hunt.k} className="sim-hunt">
            <b>
              <Count value={hunt.tries} ms={700} />번
            </b>{" "}
            {hunt.short ? "했는데 코인이 떨어졌어요" : "만에 나왔어요"} <small>(평균 {n0(hunt.expect)}번)</small>
          </p>
        )}
      </section>
      {game && <RankBox rec={rec} title={item.name} luck />}
    </>
  );
}

/** 옵션 한 줄: 이름, 굴러가다 멈추는 값, 그 옵션의 값마다 작은 막대(나온 값만 밝게) */
function OptLine({ d, v, n, i }: { d: Dist; v: Dist["vals"][number]; n: number; i: number }) {
  const [shown, setShown] = useState(v.v);
  useEffect(() => {
    let k = 0;
    const steps = 7 + i * 3;
    const t = window.setInterval(() => {
      k++;
      if (k >= steps) {
        setShown(v.v);
        window.clearInterval(t);
      } else setShown(d.vals[Math.floor(Math.random() * d.vals.length)].v);
    }, 45);
    return () => window.clearInterval(t);
  }, [n, v, d, i]);
  const top = Math.max(...d.vals.map((x) => x.p)) || 1;
  const P = atLeast(d, v.n);
  return (
    <div className="sim-oline">
      <span className="sim-oname">{d.label}</span>
      <b key={n} className={`sim-oval ${tierClass(P)}`} style={{ animationDelay: `${(7 + i * 3) * 0.045}s` }}>
        {shown}
      </b>
      <span className="sim-dist" aria-hidden>
        {d.vals.map((x, j) => (
          <i key={j} className={x === v ? "on" : ""} style={{ height: `${Math.max(8, (x.p / top) * 100)}%` }} />
        ))}
      </span>
      <small className="sim-muted">{P < 1 ? `상위 ${pctText(P)}` : ""}</small>
    </div>
  );
}

// ================================================================ 상자

function BoxSim({ odds }: { odds: Odds }) {
  const boxes = useMemo(() => boxesOf(odds), [odds]);
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
                <span className="sim-pick-t">
                  <span>{b.name}</span>
                  <small>
                    {b.sections.length > 1 ? `${b.sections.length}종 · ` : ""}
                    {b.sections.reduce((s, x) => s + x.items.length, 0)}가지
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
  const [tally, setTally] = useState<Map<string, number>>(new Map());
  const [opened, setOpened] = useState(0);
  const [shake, setShake] = useState(0);
  // 표의 줄을 누르면 그것이 나올 때까지 열어 본다
  const [target, setTarget] = useState<string | null>(null);
  const [hunt, setHunt] = useState<{ name: string; tries: number; expect: number; k: number; short: boolean } | null>(null);
  // 뽑은 장비의 옵션 (이노티아의 축복, 과거의 유물): 카드를 누르면 아래에 옵션을 굴린다
  const [optItem, setOptItem] = useState<OptItem | null>(null);
  const seq = useRef(0);
  const prefix = sec.title.match(/^(Lv\.\S+)/)?.[1] ?? "";
  const coins = useCoins();
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
  const record = (got: Pull[], k: number) => {
    const t = new Map(tally);
    for (const x of got) t.set(x.name, (t.get(x.name) ?? 0) + 1);
    setTally(t);
    setOpened(opened + k);
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
    setPulls([...got].sort((a, b) => a.p - b.p).slice(0, 10));
    setHunt({ name: goal.name, tries, expect: total / goal.p, k: (hunt?.k ?? 0) + 1, short: !hit });
    record(got, tries);
  };
  const clear = () => {
    setPulls([]);
    setTally(new Map());
    setOpened(0);
    setHunt(null);
    setOptItem(null);
  };
  const best = pulls.reduce((m, x) => Math.min(m, x.p), 1);
  const rows = [...sec.items].sort((a, b) => a.p - b.p);
  return (
    <>
      <section className="panel sim-box">
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="pill" onClick={onBack} aria-label="다른 상자">
              ◀
            </button>
          )}
          <b>{box.name}</b>
          <small>{opened ? `${opened.toLocaleString()}번 열었어요` : ""}</small>
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
                  clear();
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div key={charging ? "c" : shake} className={`sim-chest${charging ? " sim-charging" : shake ? ` sim-chest-open sim-chest-${tierOf(best)}` : ""}`} aria-hidden>
          <span className="sim-chest-t">{charging ? "두근…" : shake ? (tierOf(best) === "sr" ? "대박" : tierOf(best) === "r" ? "희귀" : "열림") : "상자"}</span>
          {shake > 0 && <Sparks kind={`box-${tierOf(best)}`} n={tierOf(best) === "sr" ? 18 : 10} />}
        </div>
        <div className="sim-actions sim-actions-3">
          {[1, 10, 100].map((k) => (
            <button key={k} type="button" className={"btn" + (k === 1 ? " sim-go" : " btn-ghost")} disabled={coins.coins === 0 || charging} onClick={() => openFx(k)}>
              {k}회
            </button>
          ))}
        </div>
        {target && (
          <button type="button" className="btn btn-ghost sim-until" onClick={untilTarget}>
            {target} 나올 때까지
          </button>
        )}
        {hunt && (
          <p key={hunt.k} className="sim-hunt">
            <b>
              <Count value={hunt.tries} ms={700} />번
            </b>{" "}
            {hunt.short ? "열었는데 코인이 떨어졌어요" : "만에 나왔어요"} <small>(평균 {n0(hunt.expect)}번)</small>
          </p>
        )}
        {pulls.length > 0 && (
          <div key={`p${shake}`} className="sim-pulls">
            {pulls.map((x, i) => {
              const next = boxes ? boxFor(boxes, x.name, box.key) : null;
              const opt = !next && sources ? optionFor(sources, x.name, prefix) : null;
              const body = (
                <>
                  <span>{x.name}</span>
                  <small>
                    {pctText(x.p)}
                    {next ? " · 열기 ›" : opt ? " · 옵션 ›" : ""}
                  </small>
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
        <div className="sim-th sim-tally-row">
          <b>나오는 것</b>
          <span>공식</span>
          <span>나온 수</span>
          <span>실제</span>
        </div>
        {rows.map((x) => {
          const got = tally.get(x.name) ?? 0;
          return (
            <button
              key={x.name}
              type="button"
              aria-pressed={target === x.name}
              className={"sim-tr sim-tally-row" + (got ? " sim-got" : "") + (target === x.name ? " sim-target" : "")}
              onClick={() => setTarget(target === x.name ? null : x.name)}
            >
              <span className={`sim-tname sim-t-${tierOf(x.p / total)}`}>{x.name}</span>
              <span>{pctText(x.p / total)}</span>
              <span>{got ? got.toLocaleString() : "-"}</span>
              <span>{opened && got ? pctText(got / opened) : "-"}</span>
            </button>
          );
        })}
        {opened > 0 && (
          <button type="button" className="btn btn-ghost sim-clear" onClick={clear}>
            처음부터
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
/** 1단계 보석 N개로 시작해 같은 단계 3개씩 합성한다 (실패하면 3개가 같은 단계 1개로) */
function GemSynth({ odds, head }: { odds: Odds; head: React.ReactNode }) {
  const rules = useMemo(() => gemSynth(odds), [odds]);
  const [start, setStart] = useEntryState("sim.gstart", 30);
  const [inv, setInv] = useState<number[]>(() => [0, start, 0, 0, 0]);
  const [runs, setRuns] = useState(0);
  const [fx, setFx] = useState<{ from: number; to: number; n: number } | null>(null);
  const [avg, setAvg] = useState<number[] | null>(null);
  const coins = useCoins();
  // 순위: 1단계 몇 개로 몇 단계까지 (같은 단계면 적은 보석으로, 그다음 적은 합성으로)
  const rec = useRecord("gem:synth");
  const best = useRef(1);
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
  const once = (st: number) => {
    if (!can(st) || coins.take(1) < 1) return;
    const r = pick(rules[st]);
    const next = [...inv];
    next[st] -= 3;
    next[r.to] += 1;
    setInv(next);
    setRuns((n) => n + 1);
    setFx((f) => ({ from: st, to: r.to, n: (f?.n ?? 0) + 1 }));
    reached(r.to, runs + 1);
  };
  function synthAll(v: number[], limit = Infinity) {
    const next = [...v];
    let n = 0;
    let best = 0;
    for (;;) {
      const st = n < limit ? [1, 2, 3].find((k) => can(k, next)) : undefined;
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
    const { next, n, best: top } = synthAll(inv, coins.coins ?? 0);
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
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <div className="mk-cats" role="tablist">
          {GEM_STARTS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={start === k} className={"sub-tab" + (start === k ? " sub-tab-on" : "")} onClick={() => reset(k)}>
              1단계 {k}개
            </button>
          ))}
        </div>
      </div>
      <section className="panel sim-gems">
        {[1, 2, 3, 4].map((st) => (
          <div key={st} className={`sim-gem sim-gem-${st}` + (fx && fx.to === st ? " sim-gem-hit" : "")}>
            <b>
              {st}단계 <span>{GEM_NAMES[st]}</span>
            </b>
            <span key={fx && fx.to === st ? fx.n : 0} className="sim-gem-n">
              <Count value={inv[st]} ms={300} />개
            </span>
            {rules[st] ? (
              <button type="button" className="pill" disabled={!can(st) || coins.coins === 0} onClick={() => once(st)}>
                3개 합성
              </button>
            ) : (
              <small className="sim-muted">끝 단계</small>
            )}
            {rules[st] && (
              <small className="sim-gem-odds">
                {rules[st].map((r) => `${r.to}단계 ${pctText(r.p)}`).join(" · ")}
              </small>
            )}
          </div>
        ))}
        {fx && (
          <p key={fx.n} className={"sim-gem-msg" + (fx.to > fx.from ? " sim-good" : " sim-muted")}>
            {fx.to > fx.from ? `${fx.to}단계가 나왔어요` : `${fx.from}단계 그대로`}
          </p>
        )}
      </section>
      <div className="sim-actions sim-actions-3">
        <button type="button" className="btn sim-go" disabled={![1, 2, 3].some((k) => can(k)) || coins.coins === 0} onClick={all}>
          모두 합성
        </button>
        <button type="button" className="btn btn-ghost" onClick={average}>
          1000번 평균
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => reset(start)}>
          처음부터
        </button>
      </div>
      <div className="sim-stats">
        <span>
          <small>합성</small>
          <b>
            <Count value={runs} ms={300} />번
          </b>
        </span>
        <span>
          <small>남은 보석</small>
          <b>
            <Count value={inv.reduce((a, b) => a + b, 0)} ms={300} />개
          </b>
        </span>
        <span>
          <small>최고</small>
          <b className="sim-good">{[4, 3, 2, 1].find((k) => inv[k] > 0) ?? 0}단계</b>
        </span>
      </div>
      {avg && (
        <p className="sim-expect">
          1단계 {start}개를 다 합성하면 평균{" "}
          {[4, 3, 2, 1]
            .filter((k) => avg[k] >= 0.005)
            .map((k) => `${k}단계 ${avg[k] >= 10 ? avg[k].toFixed(0) : avg[k].toFixed(2)}개`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
