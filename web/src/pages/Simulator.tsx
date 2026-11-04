// 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04). 자료와 규칙은 src/sim.ts (컴투스 공식 확률 표 106개).
// 맨 위 같은 폭 단추 강화 · 성장 · 옵션 · 보석 · 뽑기, 그 아래 어두운 띠에서 고르고, 해 보면서 확률을 몸으로 느끼게 결과마다 짧은 움직임(transform·opacity 만)을 준다.
// 그림은 아직 쓰지 않고 글자로만 그린다 (제작자 2026-11-04 '이미지 보여주는 건 텍스트로 대체, 나중에 강화하는 이미지나 동영상 주면 그대로'): 받으면 sim-item 자리를 그 모양으로 바꾼다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsync } from "../data";
import { loadOdds } from "../odds";
import type { Odds } from "../odds";
import { useEntryState } from "../router";
import { BOX_CATS, GEM_NAMES, atLeast, boxFor, boxOf, boxesOf, expectedTo, gemSynth, optionFor, optionSources, pick, repairItems, scrollsOf, stepsExpected, stepsOf, tierOf, weaponBonus } from "../sim";
import type { Box, Dist, OptItem, OptSource, Part, Scroll, Steps } from "../sim";
import { Loading, TopBar } from "../ui";
import { Nick } from "../kakao";
import { CAT_NAME, CoinCtx, fetchKing, luckOf, reachWithin, stepsWithin, useCoinState, useCoins, useRecord } from "../simRank";
import type { Cat, King, SimRec } from "../simRank";

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

export function SimulatorPage() {
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []), "odds");
  const [tabRaw, setTab] = useEntryState<Tab>("sim.tab", "enhance");
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "enhance";
  const coin = useCoinState();
  const today = coin.wallet?.rules.reduce((t, r) => t + r.n * r.coin, 0) ?? 0;
  return (
    <CoinCtx.Provider value={coin}>
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
        <small>{coin.coins === 0 ? "버는 법 ›" : today ? `오늘 +${today}` : "버는 법 ›"}</small>
      </button>
      {!odds ? (
        <Loading error={error} />
      ) : tab === "enhance" ? (
        <EnhanceTab odds={odds} />
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
    </CoinCtx.Provider>
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

/** 순위 칸: 도박왕(묶음마다 가장 드문 기록의 운을 더한 것), 시뮬레이터마다 1위, 코인 버는 법 */
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
          <b>도박왕</b>
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
function EnhanceTab({ odds }: { odds: Odds }) {
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
  return mode === "up" ? <EnhanceSim odds={odds} head={head} /> : <RepairSim odds={odds} head={head} />;
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
  /** ok 성공, keep 실패(그대로), break 파괴, plus2 대성공 */
  kind: "ok" | "keep" | "break" | "plus2";
  n: number;
}
type LogDot = { to: number; ok: boolean; broke?: boolean; plus?: number };

function EnhanceSim({ odds, head }: { odds: Odds; head: React.ReactNode }) {
  const all = useMemo(() => scrollsOf(odds), [odds]);
  const bonus = useMemo(() => weaponBonus(odds), [odds]);
  const [part, setPart] = useEntryState<Part>("sim.part", "무기");
  const [name, setName] = useEntryState("sim.scroll", "일반");
  const [ev, setEv] = useEntryState("sim.ev", false);
  const scroll = all.find((s) => s.part === part && s.name === name) ?? all.find((s) => s.part === part)!;
  const rates = ev && scroll.event ? scroll.event : scroll.rates;
  const rate = (lv: number) => rates[lv] ?? 0;
  const [lv, setLv] = useState(0);
  const [broken, setBroken] = useState(false);
  const [fx, setFx] = useState<Fx | null>(null);
  const [stats, setStats] = useState({ tries: 0, broke: 0, best: 0 });
  const [log, setLog] = useState<LogDot[]>([]);
  const [goal, setGoal] = useState(part === "무기" ? 8 : 6);
  const [auto, setAuto] = useState(false);
  const lvRef = useRef(lv);
  lvRef.current = lv;
  const brokenRef = useRef(broken);
  brokenRef.current = broken;
  const coins = useCoins();
  // 순위: 무기·갑옷과 마법서(이벤트 확률은 따로)마다. 새 장비로 시작해 몇 번 만에 몇 강 (중간에 마법서를 바꾸거나 보호로 건너뛴 장비는 기록하지 않는다)
  const game = `enh:${part}:${scroll.name}${ev && scroll.event ? ":ev" : ""}`;
  const rec = useRecord(game);
  const itemTries = useRef(0);
  const tainted = useRef(false);

  const reset = () => {
    setLv(0);
    setBroken(false);
    setFx(null);
    setAuto(false);
    itemTries.current = 0;
    tainted.current = false;
  };
  // 보호 마법서는 정해진 강화도만 (무기 +8·+9, 갑옷 +6·+7): 고르면 그 앞 강화도에서 시작
  const choose = (s: Scroll) => {
    setName(s.name);
    if (lvRef.current > 0 && s.name !== scroll.name) tainted.current = true;
    const first = Math.min(...Object.keys(s.rates).map(Number));
    if (!(s.rates[lvRef.current + 1] > 0) && first > 1) {
      setLv(first - 1);
      setBroken(false);
      tainted.current = true;
    }
  };

  const tryOnce = useCallback((): boolean => {
    if (brokenRef.current) return false;
    const cur = lvRef.current;
    const p = rates[cur + 1] ?? 0;
    if (!(p > 0)) return false;
    if (coins.take(1) < 1) {
      setAuto(false);
      return false;
    }
    itemTries.current++;
    const ok = Math.random() < p;
    if (ok && p < 1 && !tainted.current) {
      const n = itemTries.current;
      rec.submit("enhance", { label: `+${cur + 1}`, score: cur + 1, tries: n, luck: luckOf(reachWithin((k) => rates[k] ?? 0, scroll.keep, cur + 1, n)) });
    }
    setStats((s) => ({ tries: s.tries + 1, broke: s.broke + (!ok && !scroll.keep && p < 1 ? 1 : 0), best: Math.max(s.best, ok ? cur + 1 : cur) }));
    setLog((l) => [...l.slice(-39), { to: cur + 1, ok, broke: !ok && !scroll.keep }]);
    if (ok) {
      lvRef.current = cur + 1;
      setLv(cur + 1);
      setFx((f) => ({ kind: "ok", n: (f?.n ?? 0) + 1 }));
    } else if (scroll.keep) setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
    else {
      brokenRef.current = true;
      setBroken(true);
      setFx((f) => ({ kind: "break", n: (f?.n ?? 0) + 1 }));
    }
    return ok || scroll.keep;
  }, [rates, scroll.keep, coins, rec]);

  // 목표까지 자동: 0.18초마다 한 번, 목표에 닿거나 부서지면 멈춘다
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => {
      if (lvRef.current >= goal || brokenRef.current || !(rates[lvRef.current + 1] > 0)) {
        setAuto(false);
        return;
      }
      tryOnce();
    }, 180);
    return () => window.clearInterval(t);
  }, [auto, goal, rates, tryOnce]);

  const next = lv + 1;
  const p = rate(next);
  const failText = p >= 1 ? "반드시 성공" : scroll.keep ? "실패해도 그대로" : "실패하면 파괴";
  const effect = part === "무기" ? (bonus[lv] !== undefined ? `공격 가산 +${bonus[lv]}` : "") : `방어도 +${lv}`;
  const ladder = Array.from({ length: 15 }, (_, i) => i + 1).filter((k) => rate(k) > 0);

  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <div className="mk-cats" role="tablist">
          {(["무기", "갑옷"] as Part[]).map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={part === x}
              className={"sub-tab" + (part === x ? " sub-tab-on" : "")}
              onClick={() => {
                setPart(x);
                setGoal(x === "무기" ? 8 : 6);
                reset();
              }}
            >
              {x}
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
                if (lvRef.current > 0) tainted.current = true;
                setEv(!ev);
              }}
            >
              이벤트 확률
            </button>
          )}
        </div>
      </div>

      <section className={`panel sim-anvil${broken ? " sim-broken" : ""}`}>
        <div key={fx?.n ?? 0} className={`sim-item${fx ? ` sim-fx-${fx.kind}` : ""}`}>
          {fx && fx.kind !== "keep" && <Sparks kind={fx.kind} n={fx.kind === "break" ? 14 : 10} />}
          <span className="sim-ring" aria-hidden />
          <span className={`sim-icon sim-glow-${Math.min(4, Math.floor(lv / 3))}`} aria-hidden>
            <span className="sim-half sim-half-a">{part}</span>
            <span className="sim-half sim-half-b">{part}</span>
          </span>
          <b className="sim-lv">{broken ? "파괴" : `+${lv}`}</b>
        </div>
        <div className="sim-next">
          {broken ? (
            <span className="sim-bad">장비가 부서졌어요</span>
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
          {effect && !broken && <small className="sim-muted">{effect}</small>}
        </div>
      </section>

      <div className="sim-actions">
        <button type="button" className="btn sim-go" disabled={broken || !(p > 0) || auto || coins.coins === 0} onClick={() => tryOnce()}>
          강화
        </button>
        <span className="sim-goal">
          <button type="button" className="pill" onClick={() => setGoal(Math.max(lv + 1, goal - 1))} aria-label="목표 내리기">
            −
          </button>
          <button type="button" className={"btn btn-ghost" + (auto ? " sim-running" : "")} disabled={broken || (!auto && lv >= goal)} onClick={() => setAuto(!auto)}>
            {auto ? "멈춤" : `+${goal} 까지 자동`}
          </button>
          <button type="button" className="pill" onClick={() => setGoal(Math.min(15, goal + 1))} aria-label="목표 올리기">
            +
          </button>
        </span>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          새 장비
        </button>
      </div>

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
          <small>최고</small>
          <b className="sim-good">+{stats.best}</b>
        </span>
      </div>
      {log.length > 0 && (
        <div className="sim-log" aria-label="최근 결과">
          {log.map((d, i) => (
            <i key={i} className={d.ok ? "ok" : d.broke ? "bad" : "keep"} title={`+${d.to} ${d.ok ? "성공" : d.broke ? "파괴" : "실패"}`} />
          ))}
        </div>
      )}

      <RankBox rec={rec} title={`${part} · ${scroll.name}${ev && scroll.event ? " 이벤트" : ""}`} />
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
      if (cur === 0 && st.types) setType(pick(st.types).name);
      setFx((f) => ({ kind: up === 2 ? "plus2" : "ok", n: (f?.n ?? 0) + 1 }));
    } else setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
  }, [st, stageRef, setStage, setStats, setType, setFx, coins, rec, setAuto]);
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
  const report = (got: Dist["vals"][number][]) => {
    if (!game || !cat) return;
    const luck = luckOf(jointP(item, got));
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
  const record = (got: Pull[], k: number) => {
    const t = new Map(tally);
    for (const x of got) t.set(x.name, (t.get(x.name) ?? 0) + 1);
    setTally(t);
    setOpened(opened + k);
    setShake((s) => s + 1);
    const rare = got.reduce<Pull | null>((m, x) => (!m || x.p < m.p ? x : m), null);
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
        <div key={shake} className={`sim-chest${shake ? ` sim-chest-open sim-chest-${tierOf(best)}` : ""}`} aria-hidden>
          <span className="sim-chest-t">{shake ? (tierOf(best) === "sr" ? "대박" : tierOf(best) === "r" ? "희귀" : "열림") : "상자"}</span>
          {shake > 0 && <Sparks kind={`box-${tierOf(best)}`} n={tierOf(best) === "sr" ? 18 : 10} />}
        </div>
        <div className="sim-actions sim-actions-3">
          {[1, 10, 100].map((k) => (
            <button key={k} type="button" className={"btn" + (k === 1 ? " sim-go" : " btn-ghost")} disabled={coins.coins === 0} onClick={() => open(k)}>
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
  const reached = (stage: number, synths: number) => {
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
