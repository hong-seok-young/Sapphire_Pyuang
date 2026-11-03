// 강화 비교 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 이제 몇 퍼센트가 강해지는지', 같은 날 '콤팩트하게, 고도화').
// 자료는 data/enhance.json (scripts/build_enhance.py: 카페 글 331665 첨부 '무기 강화수치 26.10' + 위키 장비 표).
// 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100): 전사·레인저·무도가는 공통 가산치, 마법사는 무기마다 다른 가산치.
// 화면: 무기마다 한 줄(그림 · 이름 칸 · − +N +), 결과(평균 % 차이, 최소·최대, 같은 데미지가 되는 강화), 톡방 시세(시세 동향 자료),
// 바꿀 무기 강화별 표(+N 마다 지금 무기 대비 %, 같은 강화끼리는 견주지 않는다: 제작자 2026-11-04 '그래프는 뭐고 같은 강화끼리 비교하면 뭐해').
// 맨 위 직업 칸을 고르면 그 직업 무기 목록(레벨 순)이 비어 있는 줄 아래에 뜨고, 무기를 고르면 ◀ ▶ 로 그 직업의 이전·다음 무기 (제작자 2026-11-04).
import { useCallback, useMemo, useState } from "react";
import type { Me } from "../auth";
import { loadEnhance, loadTrend, useAsync } from "../data";
import type { Enhance, EnhanceWeapon, Trend } from "../data";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";

const KNUM: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };
const key = (s: string) => s.replace(/\s+/g, "");
/** 톡방 줄임말의 한 글자 (닼 = 다크, 롭 = 로브) */
const squeeze = (s: string) => s.replace(/닼/g, "다크").replace(/롭/g, "로브");
const JOB_OF: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const JOBS = ["전사", "레인저", "마법사", "무도가"] as const;
/** 그 직업 무기, 레벨 순 (같은 레벨은 강화 수치가 있는 것 먼저) */
const jobWeapons = (d: Enhance, job: string) =>
  d.weapons.filter((w) => w.job === job).sort((a, b) => (a.lv ?? 0) - (b.lv ?? 0) || Number(!a.bonus) - Number(!b.bonus) || a.name.localeCompare(b.name));

/** '8윙의날개', '+8 윙의날개', '8강 윙의날개', '팔헌보' -> 강화와 이름 */
function parse(text: string): { plus: number | null; name: string } {
  const m = text.trim().match(/^\+?\s*(\d{1,2}|[일이삼사오육칠팔구십](?=\s*강|[^\s]))?\s*강?\s*(.*)$/);
  if (!m) return { plus: null, name: text.trim() };
  const raw = m[1];
  const plus = raw === undefined ? null : raw in KNUM ? KNUM[raw] : Number(raw);
  return { plus, name: m[2].trim() };
}

/** 이름 찾기: 같음 > 앞이 같음 > 들어 있음 > 글자가 차례로 들어 있음 (헌보 = 헌터보우) */
function score(q: string, name: string): number {
  const n = key(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 40 : 0;
}

function bonusOf(d: Enhance, w: EnhanceWeapon): number[] | null {
  if (w.bonus === "common") return d.common;
  if (w.bonus === "mage") return d.mage[key(w.name)] ?? null;
  return null;
}
const maxPlus = (d: Enhance, w: EnhanceWeapon) => (bonusOf(d, w)?.length ?? 1) - 1;

function damage(d: Enhance, w: EnhanceWeapon, plus: number) {
  const b = bonusOf(d, w)?.[plus] ?? 0;
  const min = w.min * (1 + b / 100);
  const max = w.max * (1 + b / 100);
  return { min, max, avg: (min + max) / 2 };
}

/** 다른 무기가 이 평균 데미지에 닿는 가장 낮은 강화 (못 닿으면 null) */
function reach(d: Enhance, w: EnhanceWeapon, avg: number): number | null {
  for (let p = 0; p <= maxPlus(d, w); p++) if (damage(d, w, p).avg >= avg - 1e-9) return p;
  return null;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (a > 0 ? (b / a - 1) * 100 : 0);
const pctText = (p: number) => (p > 0 ? "+" : "") + (Math.round(p * 10) / 10).toFixed(1) + "%";
const tone = (p: number) => (p > 0.05 ? " enh-up" : p < -0.05 ? " enh-down" : "");
/** 만 원 -> '38만', '1.5만', '6700원' */
const won = (man: number) => (man >= 1 ? `${Math.round(man * 10) / 10}만` : `${Math.round(man * 10000).toLocaleString("ko-KR")}원`);
const label = (w: EnhanceWeapon, plus: number) => `+${plus} ${w.name}`;

interface Pick {
  q: string;
  w: EnhanceWeapon | null;
  plus: number;
}

function initial(d: Enhance | undefined, text: string | null): Pick {
  const p: Pick = { q: text ?? "", w: null, plus: 0 };
  if (!d || !text) return p;
  const { plus, name } = parse(text);
  const k = squeeze(key(name));
  const w = d.weapons.find((x) => key(x.name) === k) ?? null;
  return { q: text, w, plus: w ? Math.min(plus ?? 0, maxPlus(d, w)) : plus ?? 0 };
}

/** 무기 한 줄: ◀ 그림 · 이름 칸 ▶, 아래에 레벨·데미지·다음 강화의 오름과 − +N +. 적는 동안은 찾은 무기, 목록을 펼친 줄은 고른 직업의 무기 전부 */
function WeaponRow({ d, wiki, side, hint, pick, onPick, job, list, onFocus }: {
  d: Enhance; wiki: Wiki; side: "a" | "b"; hint: string; pick: Pick; onPick: (p: Pick) => void;
  job: string; list: boolean; onFocus: () => void;
}) {
  const { name } = parse(pick.q);
  const q = squeeze(key(name));
  const typing = !!q && !(pick.w && key(pick.w.name) === q);
  const hits = useMemo(
    () =>
      typing
        ? d.weapons
            .map((w) => ({ w, s: score(q, w.name) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s || (a.w.lv ?? 0) - (b.w.lv ?? 0))
            .slice(0, 6)
            .map((x) => x.w)
        : [],
    [d, q, typing],
  );
  const all = useMemo(() => jobWeapons(d, job), [d, job]);
  const type = (text: string) => {
    const r = parse(text);
    const k = squeeze(key(r.name));
    const w = d.weapons.find((x) => key(x.name) === k) ?? null;
    const plus = r.plus ?? pick.plus;
    onPick({ q: text, w, plus: w ? Math.min(plus, maxPlus(d, w)) : plus });
  };
  const set = (w: EnhanceWeapon, plus: number) => onPick({ q: `${plus ? `+${plus} ` : ""}${w.name}`, w, plus });
  const choose = (w: EnhanceWeapon) => set(w, Math.min(pick.plus, maxPlus(d, w)));
  const step = (n: number) => pick.w && set(pick.w, Math.max(0, Math.min(maxPlus(d, pick.w), pick.plus + n)));
  // ◀ ▶: 고른 무기의 직업 목록에서 이전·다음 (강화는 그 무기가 되는 만큼까지 그대로)
  const mine = pick.w ? jobWeapons(d, pick.w.job) : [];
  const at = pick.w ? mine.findIndex((w) => w.name === pick.w!.name) : -1;
  const prev = at > 0 ? mine[at - 1] : null;
  const next = at >= 0 && at < mine.length - 1 ? mine[at + 1] : null;
  const pic = pick.w ? wiki.items[pick.w.name]?.icon : null;
  const top = pick.w ? maxPlus(d, pick.w) : 0;
  const cur = pick.w ? damage(d, pick.w, pick.plus) : null;
  const up = pick.w && pick.plus < top ? pct(cur!.avg, damage(d, pick.w, pick.plus + 1).avg) : null;
  const shown = typing ? hits : list ? all : [];
  return (
    <div className={"enh-pick enh-" + side}>
      <div className="enh-row">
        <button type="button" className="pill enh-nav" onClick={() => prev && choose(prev)} disabled={!prev} aria-label={prev ? `이전 무기 ${prev.name}` : "이전 무기"}>
          ◀
        </button>
        <span className="mk-slot enh-slot">{pic ? <PicImg pic={pic} max={26} /> : null}</span>
        <input className="enh-input" value={pick.q} placeholder={hint} onChange={(e) => type(e.target.value)} onFocus={onFocus} enterKeyHint="done" />
        <button type="button" className="pill enh-nav" onClick={() => next && choose(next)} disabled={!next} aria-label={next ? `다음 무기 ${next.name}` : "다음 무기"}>
          ▶
        </button>
      </div>
      {pick.w && cur && (
        <div className="enh-meta">
          <span className="enh-metatext">
            <span>
              Lv.{pick.w.lv ?? "?"} · {fmt(cur.min)}~{fmt(cur.max)}
            </span>
            {top === 0 ? <span className="muted">강화 수치 없음</span> : up !== null ? <span className="enh-up">다음 강화 {pctText(up)}</span> : null}
          </span>
          <span className="enh-step">
            <button type="button" className="pill" onClick={() => step(-1)} disabled={pick.plus <= 0} aria-label="강화 내리기">
              −
            </button>
            <b>+{pick.plus}</b>
            <button type="button" className="pill" onClick={() => step(1)} disabled={pick.plus >= top} aria-label="강화 올리기">
              +
            </button>
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <div className={"enh-hits" + (typing ? "" : " enh-list")}>
          {shown.map((w) => (
            <button
              key={w.name}
              type="button"
              className={"enh-hit" + (pick.w?.name === w.name ? " enh-hit-on" : "") + (w.bonus ? "" : " enh-hit-nob")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(w)}
            >
              <small>Lv.{w.lv ?? "?"}</small>
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 톡방 시세 (시세 동향 자료): 그 무기 그 강화의 팝니다 중간값 */
function priceOf(t: Trend | undefined, w: EnhanceWeapon, plus: number): { med: number; n: number } | null {
  if (!t) return null;
  const it = t.items.find((x) => key(x.name) === key(w.name));
  if (!it) return null;
  const g = it.groups.find((x) => x.label === `+${plus}` || (plus === 0 && x.label === "노강"));
  return g ? { med: g.med, n: g.n } : null;
}

function Result({ d, t, a, b }: { d: Enhance; t?: Trend; a: Pick; b: Pick }) {
  const [table, setTable] = useState(false);
  if (!a.w || !b.w) return null;
  const A = a as Pick & { w: EnhanceWeapon };
  const B = b as Pick & { w: EnhanceWeapon };
  const x = damage(d, A.w, A.plus);
  const y = damage(d, B.w, B.plus);
  const p = pct(x.avg, y.avg);
  const bReach = reach(d, B.w, x.avg);
  const aReach = reach(d, A.w, y.avg);
  const pa = priceOf(t, A.w, A.plus);
  const pb = priceOf(t, B.w, B.plus);
  return (
    <section className="enh-card enh-result">
      <div className="enh-head">
        <div className={"enh-big" + tone(p)}>{pctText(p)}</div>
        <div className="enh-headside">
          <div>
            평균 {fmt(x.avg)} → <b>{fmt(y.avg)}</b>
          </div>
          <div className="muted">
            최소 {fmt(x.min)} → {fmt(y.min)} <span className={tone(pct(x.min, y.min))}>{pctText(pct(x.min, y.min))}</span>
          </div>
          <div className="muted">
            최대 {fmt(x.max)} → {fmt(y.max)} <span className={tone(pct(x.max, y.max))}>{pctText(pct(x.max, y.max))}</span>
          </div>
        </div>
      </div>
      <div className="enh-eq">
        <div>
          <span className="enh-dot enh-dot-a" />
          {label(A.w, A.plus)} ≈ {B.w.name} {bReach === null ? <b className="enh-down">+{maxPlus(d, B.w)}로도 못 미침</b> : <b>+{bReach}</b>}
        </div>
        <div>
          <span className="enh-dot enh-dot-b" />
          {label(B.w, B.plus)} ≈ {A.w.name} {aReach === null ? <b className="enh-down">+{maxPlus(d, A.w)}로도 못 미침</b> : <b>+{aReach}</b>}
        </div>
      </div>
      {(pa || pb) && (
        <div className="enh-price">
          <span className="muted">톡방 시세</span>
          <span>
            <span className="enh-dot enh-dot-a" />
            {pa ? `${won(pa.med)} (${pa.n})` : "글 없음"}
          </span>
          <span>
            <span className="enh-dot enh-dot-b" />
            {pb ? `${won(pb.med)} (${pb.n})` : "글 없음"}
          </span>
          {pa && pb && <span className="muted">차이 {won(Math.abs(pb.med - pa.med))}</span>}
        </div>
      )}
      <button type="button" className="enh-more" onClick={() => setTable(!table)} aria-expanded={table}>
        {B.w.name} 강화별 {table ? "▴" : "▾"}
      </button>
      {table && (
        <table className="enh-table">
          <thead>
            <tr>
              <th>
                <span className="enh-dot enh-dot-b" />
                {B.w.name}
              </th>
              <th>평균</th>
              <th>
                <span className="enh-dot enh-dot-a" />
                {label(A.w, A.plus)} 대비
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPlus(d, B.w) + 1 }, (_, i) => {
              const v = damage(d, B.w, i).avg;
              return (
                <tr key={i} className={(i === B.plus ? "enh-on" : "") + (i === bReach ? " enh-cross" : "")}>
                  <th>+{i}</th>
                  <td>{fmt(v)}</td>
                  <td className={tone(pct(x.avg, v))}>{pctText(pct(x.avg, v))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 고른 두 무기를 주소에 남겨 링크로 보낼 수 있게 (기록 칸을 늘리지 않는다) */
function keepInUrl(a: Pick, b: Pick) {
  const enc = (p: Pick) => (p.w ? encodeURIComponent(`${p.plus}${p.w.name}`) : "");
  const qs = [a.w && `a=${enc(a)}`, b.w && `b=${enc(b)}`].filter(Boolean).join("&");
  const to = "#/enhance" + (qs ? `?${qs}` : "");
  if (location.hash !== to) history.replaceState(history.state, "", to);
}

export function EnhancePage({ wiki, query, me }: { wiki: Wiki; query: URLSearchParams; me: Me }) {
  const { data: d, error } = useAsync(useCallback(() => loadEnhance(), []));
  const { data: t } = useAsync(useCallback(() => loadTrend().catch(() => undefined as unknown as Trend), []));
  const [a, setA] = useState<Pick | null>(null);
  const [b, setB] = useState<Pick | null>(null);
  const pa = a ?? initial(d, query.get("a"));
  const pb = b ?? initial(d, query.get("b"));
  const [jobPick, setJob] = useState<string | null>(null);
  const job = jobPick ?? pa.w?.job ?? (me.job ? JOB_OF[me.job] : null) ?? "전사";
  // 목록을 펼칠 줄: 처음은 비어 있는 첫 줄, 줄을 누르면 그 줄, 고르면 다음 빈 줄 (둘 다 차면 닫힘)
  const [listAt, setListAt] = useState<"a" | "b" | null | undefined>(undefined);
  const firstEmpty = !pa.w ? "a" : !pb.w ? "b" : null;
  const list = listAt === undefined ? firstEmpty : listAt;
  const after = (row: "a" | "b", p: Pick) => {
    if (!p.w) return;
    if (!jobPick || p.w.job !== job) setJob(p.w.job);
    const other = row === "a" ? pb : pa;
    setListAt(other.w ? null : row === "a" ? "b" : "a");
  };
  const pickA = (p: Pick) => {
    setA(p);
    keepInUrl(p, pb);
    if (p.w && p.w !== pa.w) after("a", p);
  };
  const pickB = (p: Pick) => {
    setB(p);
    keepInUrl(pa, p);
    if (p.w && p.w !== pb.w) after("b", p);
  };
  const swap = () => {
    setA(pb);
    setB(pa);
    keepInUrl(pb, pa);
  };
  const pickJob = (j: string) => {
    setJob(j);
    setListAt(list ?? firstEmpty ?? "a");
  };
  return (
    <>
      <TopBar title="강화 비교" right={<span className="pill trend-dev">개발중</span>} />
      {!d ? (
        <Loading error={error?.includes("404") ? "강화 자료가 아직 없어요" : error} />
      ) : (
        <div className="enh">
          <section className="enh-card enh-picks">
            <div className="mk-sub enh-jobs" role="tablist">
              {JOBS.map((j) => (
                <button key={j} type="button" role="tab" aria-selected={job === j} className={"sub-tab" + (job === j ? " sub-tab-on" : "")} onClick={() => pickJob(j)}>
                  {j}
                </button>
              ))}
            </div>
            <WeaponRow d={d} wiki={wiki} side="a" hint="지금 무기" pick={pa} onPick={pickA} job={job} list={list === "a"} onFocus={() => setListAt("a")} />
            <button type="button" className="enh-swap" onClick={swap} aria-label="위아래 바꾸기">
              ⇅
            </button>
            <WeaponRow d={d} wiki={wiki} side="b" hint="바꿀 무기" pick={pb} onPick={pickB} job={job} list={list === "b"} onFocus={() => setListAt("b")} />
          </section>
          <Result d={d} t={t} a={pa} b={pb} />
        </div>
      )}
    </>
  );
}
