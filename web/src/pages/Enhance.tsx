// 강화 비교 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 이제 몇 퍼센트가 강해지는지', 같은 날 '콤팩트하게, 고도화').
// 자료는 data/enhance.json (scripts/build_enhance.py: 카페 글 331665 첨부 '무기 강화수치 26.10' 의 무기 42개만, 제작자 2026-11-04 '내가 준 강화 데이터에 있는 무기들만').
// 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100): 전사·레인저·무도가는 공통 가산치, 마법사는 무기마다 다른 가산치.
// 화면: 지금 무기와 바꿀 무기 칸을 좌우로 나란히(◀ 이름 ▶ · 그림 − +N + · 레벨과 데미지, 제작자 2026-11-05 '좌우로', '콤팩트하게'),
// 결과는 평균 % 차이와 평균·최소·최대만 (제작자 2026-11-05: 같은 데미지가 되는 강화, 톡방 시세, 강화별 표는 '중복', '노쓸모'로 뺐다).
// 맨 위 직업 칸을 고르면 그 직업 무기 목록(레벨 순)이 무기 칸 아래에 뜨고, 무기를 고르면 ◀ ▶ 로 그 직업의 이전·다음 무기 (제작자 2026-11-04).
// 비슷한 무기 (제작자 2026-11-05 '보통 무기를 7·8강 쓰거든, 해당 무기와 파워가 비슷한 무기 리스트들도 알아서 뽑아줘' -> '7 8 9 10 으로' -> '6강부터', '항상 약한 것도', '행 높이 줄이기'): 지금 무기와 평균 데미지가 가까운
// 같은 직업 무기의 +6 ~ +10 (지금 무기의 다른 강화도) 중 약한 쪽 넷·센 쪽 넷, 약한 것부터 지금 무기와 함께 한 줄씩. 누르면 바꿀 무기로.
// 직업 무기 그래프 (제작자 2026-11-05 '직업별 모든 무기 6강부터 10강을 차트 그래프로 한방 정리'): 맨 위 직업 칸의 무기 전부, 무기마다 한 줄(+8 이 약한 것부터),
// 가로는 평균 데미지, 네모 점은 +6 → +10 (한 색의 진하기: 강할수록 밝게, 색은 dataviz 검사기로 이 앱 판 바탕 #262150 에서 통과), 지금 무기는 흰 세로선.
// 줄을 누르면 그 아래 강화마다 평균과 지금 대비 %, 누르면 바꿀 무기로.
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import type { Me } from "../auth";
import { loadEnhance, useAsync } from "../data";
import type { Enhance, EnhanceWeapon } from "../data";
import type { Wiki } from "../types";
import { FitLine, Loading, PicImg, TopBar } from "../ui";

const KNUM: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };
const key = (s: string) => s.replace(/\s+/g, "");
/** 톡방 줄임말의 한 글자 (닼 = 다크, 롭 = 로브) */
const squeeze = (s: string) => s.replace(/닼/g, "다크").replace(/롭/g, "로브");
const JOB_OF: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };
const JOBS = ["전사", "레인저", "마법사", "무도가"] as const;
/** 그 직업 무기, 레벨 순 (같은 레벨은 강화 수치가 있는 것 먼저) */
const jobWeapons = (d: Enhance, job: string) =>
  d.weapons.filter((w) => w.job === job).sort((a, b) => (a.lv ?? 0) - (b.lv ?? 0) || Number(!a.bonus) - Number(!b.bonus) || a.name.localeCompare(b.name));

/** '8윙의날개', '+8 윙의날개', '8강 윙의날개', '팔헌보' -> 강화와 이름. korean 이면 앞의 한글 숫자(팔 = 8)도 강화로 읽는다 */
function parse(text: string, korean = true): { plus: number | null; name: string } {
  const re = korean ? /^\+?\s*(\d{1,2}|[일이삼사오육칠팔구십](?=\s*강|[^\s]))?\s*강?\s*(.*)$/ : /^\+?\s*(\d{1,2})?\s*강?\s*(.*)$/;
  const m = text.trim().match(re);
  if (!m) return { plus: null, name: text.trim() };
  const raw = m[1];
  const plus = raw === undefined ? null : raw in KNUM ? KNUM[raw] : Number(raw);
  return { plus, name: m[2].trim() };
}

/** 두 가지로 읽어 본다: 한글 숫자를 강화로 안 읽은 것('오염된 순수', '이터니티'), 읽은 것('팔헌보'). 이름이 딱 맞는 쪽, 없으면 앞의 것 */
function readText(d: Enhance, text: string): { plus: number | null; name: string; w: EnhanceWeapon | null; qs: string[] } {
  const reads = [parse(text, false), parse(text, true)];
  const found = reads.map((r) => d.weapons.find((x) => key(x.name) === squeeze(key(r.name))) ?? null);
  const i = found[0] ? 0 : found[1] ? 1 : 0;
  return { ...reads[i], w: found[i], qs: [...new Set(reads.map((r) => squeeze(key(r.name))).filter(Boolean))] };
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

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (a > 0 ? (b / a - 1) * 100 : 0);
const pctText = (p: number) => (p > 0 ? "+" : "") + (Math.round(p * 10) / 10).toFixed(1) + "%";
const tone = (p: number) => (p > 0.05 ? " enh-up" : p < -0.05 ? " enh-down" : "");

interface Pick {
  q: string;
  w: EnhanceWeapon | null;
  plus: number;
}

function initial(d: Enhance | undefined, text: string | null): Pick {
  const p: Pick = { q: text ?? "", w: null, plus: 0 };
  if (!d || !text) return p;
  const { plus, w } = readText(d, text);
  return { q: w ? w.name : text, w, plus: w ? Math.min(plus ?? 0, maxPlus(d, w)) : plus ?? 0 };
}

/** 적은 글로 찾는 중인지 (고른 무기 이름 그대로면 찾는 중이 아니다) */
function searching(d: Enhance, pick: Pick): string[] {
  const read = readText(d, pick.q);
  return read.qs.length > 0 && !(pick.w && read.w === pick.w) ? read.qs : [];
}

/** 무기 칸 하나 (지금 무기 왼쪽, 바꿀 무기 오른쪽에 나란히. 제작자 2026-11-05 '무기 고르는 거를 좌우로 배치', '좀 더 콤팩트하게'):
 *  ◀ 이름 ▶ (이름을 누르면 적는 칸과 그 직업 무기 목록), 그 아래 그림과 − +N +, 맨 아래 레벨과 데미지 */
function WeaponCard({ d, wiki, side, hint, pick, onPick, open, onOpen }: {
  d: Enhance; wiki: Wiki; side: "a" | "b"; hint: string; pick: Pick; onPick: (p: Pick) => void; open: boolean; onOpen: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const type = (text: string) => {
    const r = readText(d, text);
    const plus = r.plus ?? pick.plus;
    onPick({ q: text, w: r.w, plus: r.w ? Math.min(plus, maxPlus(d, r.w)) : plus });
  };
  const set = (w: EnhanceWeapon, plus: number) => onPick({ q: w.name, w, plus });
  const step = (n: number) => pick.w && set(pick.w, Math.max(0, Math.min(maxPlus(d, pick.w), pick.plus + n)));
  // ◀ ▶: 고른 무기의 직업 목록에서 이전·다음 (강화는 그 무기가 되는 만큼까지 그대로)
  const mine = pick.w ? jobWeapons(d, pick.w.job) : [];
  const at = pick.w ? mine.findIndex((w) => w.name === pick.w!.name) : -1;
  const prev = at > 0 ? mine[at - 1] : null;
  const next = at >= 0 && at < mine.length - 1 ? mine[at + 1] : null;
  const choose = (w: EnhanceWeapon) => set(w, Math.min(pick.plus, maxPlus(d, w)));
  // 엑셀 이름은 띄어 쓴 것이 있다 ('오염된 순수'): 위키 그림은 띄어쓰기를 뺀 이름으로도 찾는다
  const pic = pick.w ? (wiki.items[pick.w.name] ?? wiki.items[key(pick.w.name)])?.icon : null;
  const top = pick.w ? maxPlus(d, pick.w) : 0;
  const cur = pick.w ? damage(d, pick.w, pick.plus) : null;
  return (
    <div className={"enh-pick enh-" + side + (open ? " enh-pick-on" : "")}>
      <div className="enh-row">
        {edit ? (
          <input
            className="enh-input"
            value={pick.q}
            placeholder={hint}
            autoFocus
            onChange={(e) => type(e.target.value)}
            onFocus={(e) => {
              e.target.select();
              onOpen();
            }}
            onBlur={() => setEdit(false)}
            enterKeyHint="done"
          />
        ) : (
          <>
            <button type="button" className="pill enh-nav" onClick={() => prev && choose(prev)} disabled={!prev} aria-label={prev ? `이전 무기 ${prev.name}` : "이전 무기"}>
              ◀
            </button>
            <button
              type="button"
              className={"enh-name" + (pick.w ? "" : " enh-name-empty")}
              onClick={() => {
                setEdit(true);
                onOpen();
              }}
            >
              <FitLine text={pick.w ? pick.w.name : pick.q || hint} wrap={false} />
            </button>
            <button type="button" className="pill enh-nav" onClick={() => next && choose(next)} disabled={!next} aria-label={next ? `다음 무기 ${next.name}` : "다음 무기"}>
              ▶
            </button>
          </>
        )}
      </div>
      {pick.w && cur && (
        <>
          <div className="enh-ctl">
            <span className="enh-slot">{pic ? <PicImg pic={pic} max={24} /> : null}</span>
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
          <FitLine className="enh-meta" text={`Lv.${pick.w.lv ?? "?"} · ${fmt(cur.min)}~${fmt(cur.max)}`} wrap={false} />
        </>
      )}
    </div>
  );
}

/** 무기 칸 아래 목록 (두 칸 너비): 적는 중이면 찾은 무기, 아니면 고른 직업의 무기 전부. 그 칸의 색 띠 */
function WeaponList({ d, side, pick, job, open, onPick }: { d: Enhance; side: "a" | "b"; pick: Pick; job: string; open: boolean; onPick: (p: Pick) => void }) {
  const qs = searching(d, pick);
  const qk = qs.join("|");
  const hits = useMemo(
    () =>
      qk
        ? d.weapons
            .map((w) => ({ w, s: Math.max(...qk.split("|").map((q) => score(q, w.name))) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s || (a.w.lv ?? 0) - (b.w.lv ?? 0))
            .slice(0, 6)
            .map((x) => x.w)
        : [],
    [d, qk],
  );
  const all = useMemo(() => jobWeapons(d, job), [d, job]);
  const shown = qk ? hits : open ? all : [];
  if (shown.length === 0) return null;
  return (
    <div className={"enh-hits enh-list enh-list-" + side}>
      {shown.map((w) => (
        <button
          key={w.name}
          type="button"
          className={"enh-hit" + (pick.w?.name === w.name ? " enh-hit-on" : "") + (w.bonus ? "" : " enh-hit-nob")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onPick({ q: w.name, w, plus: Math.min(pick.plus, maxPlus(d, w)) });
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <small>Lv.{w.lv ?? "?"}</small>
          {w.name}
        </button>
      ))}
    </div>
  );
}

/** 결과: 평균 데미지 % 차이와 평균·최소·최대 (제작자 2026-11-05 '중복된 거 빼자, +32.2 라인까지는 괜찮은데': 같은 데미지가 되는 강화, 톡방 시세, 강화별 표는 뺐다) */
function Result({ d, a, b }: { d: Enhance; a: Pick; b: Pick }) {
  if (!a.w || !b.w) return null;
  const x = damage(d, a.w, a.plus);
  const y = damage(d, b.w, b.plus);
  const p = pct(x.avg, y.avg);
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
    </section>
  );
}

/** 사람들이 보통 쓰는 강화 (비슷한 무기 목록은 이 강화만, 제작자 2026-11-05 '6강부터 보여줘도 될 듯') */
const USUAL = [6, 7, 8, 9, 10];
const SIMILAR_N = 8;

/** 지금 무기와 평균 데미지가 가까운 같은 직업 무기의 +6 ~ +10 (지금 무기의 다른 강화도), 약한 쪽 넷·센 쪽 넷을 약한 것부터 (지금 무기도 그 자리에).
 *  한쪽이 모자라면 다른 쪽으로 채운다 (제작자 2026-11-05 '8헌 넣었을 때 그 아래로는 안 뜨는데 항상 약한 것도 같이') */
function Similar({ d, wiki, a, b, onPick }: { d: Enhance; wiki: Wiki; a: Pick; b: Pick; onPick: (w: EnhanceWeapon, plus: number) => void }) {
  if (!a.w) return null;
  const A = a.w;
  const base = damage(d, A, a.plus).avg;
  if (!(base > 0)) return null;
  const dist = (x: { avg: number }) => Math.abs(Math.log(x.avg / base));
  const cands = jobWeapons(d, A.job).flatMap((w) =>
    USUAL.filter((p) => p <= maxPlus(d, w) && !(w.name === A.name && p === a.plus)).map((plus) => ({ w, plus, avg: damage(d, w, plus).avg, me: false })),
  );
  const weaker = cands.filter((x) => x.avg < base).sort((x, y) => dist(x) - dist(y));
  const stronger = cands.filter((x) => x.avg >= base).sort((x, y) => dist(x) - dist(y));
  const half = SIMILAR_N / 2;
  const nLo = Math.min(weaker.length, Math.max(half, SIMILAR_N - stronger.length));
  const near = [...weaker.slice(0, nLo), ...stronger.slice(0, SIMILAR_N - nLo)];
  if (near.length === 0) return null;
  const rows = [...near, { w: A, plus: a.plus, avg: base, me: true }].sort((x, y) => x.avg - y.avg || Number(y.me) - Number(x.me));
  return (
    <section className="enh-card enh-sim">
      <div className="enh-sim-head">
        <b>비슷한 무기</b>
        <span className="muted">+6 ~ +10</span>
      </div>
      <div className="enh-sim-list">
        {rows.map((r) => {
          const pic = (wiki.items[r.w.name] ?? wiki.items[key(r.w.name)])?.icon;
          const p = pct(base, r.avg);
          const on = !r.me && b.w?.name === r.w.name && b.plus === r.plus;
          return (
            <button
              key={r.w.name + r.plus + (r.me ? "-me" : "")}
              type="button"
              className={"enh-sim-row" + (r.me ? " enh-sim-me" : "") + (on ? " enh-sim-on" : "")}
              disabled={r.me}
              onClick={() => onPick(r.w, r.plus)}
            >
              <span className="enh-sim-pic">{pic ? <PicImg pic={pic} max={18} /> : null}</span>
              <span className="enh-sim-name">
                +{r.plus} {r.w.name} <small>Lv.{r.w.lv ?? "?"}</small>
              </span>
              <span className="enh-sim-avg">{fmt(r.avg)}</span>
              <span className={"enh-sim-pct" + (r.me ? "" : tone(p))}>{r.me ? "지금" : pctText(p)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 그래프에 그리는 강화와 그 색 (파랑 한 색, +6 진함 -> +10 밝음. 바탕 --panel #262150 에서 dataviz validate_palette --ordinal 통과) */
const CHART_PLUS = [6, 7, 8, 9, 10];
const PLUS_COLOR = ["#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"];

/** 가로 범위는 자료에 딱 맞게 (양끝 3% 여유), 눈금은 그 안의 1·2·2.5·5 x 10^n 간격으로 n 칸쯤 */
function niceAxis(min: number, max: number, n = 4): { lo: number; hi: number; ticks: number[] } {
  const pad = (max - min) * 0.03 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

/** vals 중 v 에 가장 가까운 것의 자리 */
const nearest = (vals: number[], v: number) => vals.reduce((k, x, i) => (Math.abs(x - v) < Math.abs(vals[k] - v) ? i : k), 0);

/** 그 직업 무기 전부의 +6 ~ +10 평균 데미지를 한 그래프로.
 *  기준선 (제작자 2026-11-05 '선 하나를 좌우로 움직이면서 혹은 칸 하나를 선택하면 세로선이 생겨서 다른 인접한 것들이랑 퍼센트 차이'):
 *  처음은 지금 무기(흰 선), 그래프를 좌우로 끌면 금색 기준선이 따라오고, 줄을 톡 누르면 그 줄에서 가장 가까운 강화 점에 기준선을 둔다.
 *  줄마다 오른쪽에 기준선에 가장 가까운 강화와 기준 대비 % (그 점은 조금 크게) */
function PowerChart({ d, wiki, job, a, b, onPick }: { d: Enhance; wiki: Wiki; job: string; a: Pick; b: Pick; onPick: (w: EnhanceWeapon, plus: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [ref, setRef] = useState<{ v: number; label: string | null } | null>(null);
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  const rows = jobWeapons(d, job)
    .filter((w) => maxPlus(d, w) >= CHART_PLUS[CHART_PLUS.length - 1])
    .map((w) => ({ w, vals: CHART_PLUS.map((p) => damage(d, w, p).avg) }))
    .sort((x, y) => x.vals[2] - y.vals[2]);
  if (rows.length === 0) return null;
  const now = a.w && a.w.job === job ? damage(d, a.w, a.plus).avg : null;
  const all = rows.flatMap((r) => r.vals).concat(now === null ? [] : [now]);
  const { lo, hi, ticks } = niceAxis(Math.min(...all), Math.max(...all));
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const valueAt = (el: Element, clientX: number) => {
    const r = el.getBoundingClientRect();
    return lo + Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1))) * (hi - lo);
  };
  const base = ref?.v ?? now;
  const nowLabel = a.w ? `+${a.plus} ${a.w.name}` : "";
  return (
    <section className="enh-card enh-chart">
      <div className="enh-sim-head">
        <b>{job} 무기</b>
        <span className="enh-legend">
          {CHART_PLUS.map((p, i) => (
            <span key={p}>
              <i style={{ background: PLUS_COLOR[i] }} />+{p}
            </span>
          ))}
        </span>
      </div>
      {base !== null && (
        <div className="enh-ch-base">
          <span>
            <i className={ref ? "enh-ch-key-ref" : "enh-ch-key-now"} />
            기준 {ref ? (ref.label ?? "") : `지금 ${nowLabel}`} <b>{fmt(base)}</b>
          </span>
          {ref && (
            <button type="button" className="pill enh-ch-reset" onClick={() => setRef(null)}>
              {now !== null ? "지금으로" : "지우기"}
            </button>
          )}
        </div>
      )}
      <div className="enh-ch">
        {rows.map((r) => {
          const isA = a.w?.name === r.w.name;
          const isB = b.w?.name === r.w.name;
          const shut = open !== r.w.name;
          const pic = (wiki.items[r.w.name] ?? wiki.items[key(r.w.name)])?.icon;
          const k = base === null ? -1 : nearest(r.vals, base);
          const kp = k >= 0 ? CHART_PLUS[k] : 0;
          const diff = k >= 0 && base !== null ? pct(base, r.vals[k]) : 0;
          const self = k >= 0 && (ref ? ref.label === `+${kp} ${r.w.name}` : isA && a.plus === kp);
          return (
            <Fragment key={r.w.name}>
              <div className={"enh-ch-row" + (isA ? " enh-ch-a" : isB ? " enh-ch-b" : "")}>
                <button
                  type="button"
                  className="enh-ch-name"
                  title={`Lv.${r.w.lv ?? "?"} ${r.w.name}`}
                  onClick={() => setOpen(shut ? r.w.name : null)}
                  aria-expanded={!shut}
                >
                  <span className="enh-ch-pic">{pic ? <PicImg pic={pic} max={16} /> : null}</span>
                  <FitLine text={r.w.name} wrap={false} />
                </button>
                <div
                  className="enh-ch-track"
                  onPointerDown={(e) => {
                    drag.current = { x0: e.clientX, moved: false };
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const g = drag.current;
                    if (!g) return;
                    if (!g.moved && Math.abs(e.clientX - g.x0) < 6) return;
                    g.moved = true;
                    setRef({ v: valueAt(e.currentTarget, e.clientX), label: null });
                  }}
                  onPointerUp={(e) => {
                    const g = drag.current;
                    drag.current = null;
                    if (!g || g.moved) return;
                    // 톡 누름: 이 줄에서 가장 가까운 강화 점에 기준선
                    const i = nearest(r.vals, valueAt(e.currentTarget, e.clientX));
                    setRef({ v: r.vals[i], label: `+${CHART_PLUS[i]} ${r.w.name}` });
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                >
                  {ticks.map((t) => (
                    <i key={t} className="enh-ch-grid" style={{ left: `${x(t)}%` }} />
                  ))}
                  {now !== null && <i className={"enh-ch-now" + (ref ? " enh-ch-now-dim" : "")} style={{ left: `${x(now)}%` }} />}
                  {ref && <i className="enh-ch-ref" style={{ left: `${x(ref.v)}%` }} />}
                  <i className="enh-ch-bar" style={{ left: `${x(r.vals[0])}%`, width: `${x(r.vals[4]) - x(r.vals[0])}%` }} />
                  {r.vals.map((v, i) => {
                    const p = CHART_PLUS[i];
                    const mark = isA && a.plus === p ? " enh-ch-dot-a" : isB && b.plus === p ? " enh-ch-dot-b" : "";
                    return (
                      <i
                        key={p}
                        className={"enh-ch-dot" + mark + (i === k ? " enh-ch-dot-near" : "")}
                        style={{ left: `${x(v)}%`, background: PLUS_COLOR[i] }}
                        title={`+${p} ${r.w.name} ${fmt(v)}`}
                      />
                    );
                  })}
                </div>
                <span className={"enh-ch-pct" + (self ? "" : tone(diff))}>
                  {k >= 0 && (
                    <>
                      <small>+{kp}</small>
                      {self ? (ref ? "기준" : "지금") : pctText(diff)}
                    </>
                  )}
                </span>
              </div>
              {!shut && (
                <div className="enh-ch-detail">
                  <span className="enh-ch-lv">Lv.{r.w.lv ?? "?"}</span>
                  {r.vals.map((v, i) => {
                    const p = CHART_PLUS[i];
                    const me = isA && a.plus === p;
                    const on = isB && b.plus === p;
                    return (
                      <button key={p} type="button" className={"enh-ch-chip" + (me ? " enh-ch-chip-a" : on ? " enh-ch-chip-b" : "")} disabled={me} onClick={() => onPick(r.w, p)}>
                        <b>+{p}</b>
                        <span>{fmt(v)}</span>
                        {now !== null && <small className={me ? "" : tone(pct(now, v))}>{me ? "지금" : pctText(pct(now, v))}</small>}
                      </button>
                    );
                  })}
                </div>
              )}
            </Fragment>
          );
        })}
        <div className="enh-ch-axis">
          <span className="muted">평균 데미지</span>
          <span className="enh-ch-ticks">
            {ticks
              .filter((t) => x(t) > 6 && x(t) < 94)
              .map((t) => (
                <span key={t} style={{ left: `${x(t)}%` }}>
                  {t}
                </span>
              ))}
          </span>
          <span />
        </div>
      </div>
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
  // 비슷한 무기를 누르면 바꿀 무기로 넣고 결과 칸을 보인다
  const pickSimilar = (w: EnhanceWeapon, plus: number) => {
    pickB({ q: w.name, w, plus });
    window.setTimeout(() => {
      document.querySelector(".enh-result")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
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
            <div className="enh-duo">
              <WeaponCard d={d} wiki={wiki} side="a" hint="지금 무기" pick={pa} onPick={pickA} open={list === "a"} onOpen={() => setListAt("a")} />
              <button type="button" className="enh-swap" onClick={swap} aria-label="좌우 바꾸기">
                ⇄
              </button>
              <WeaponCard d={d} wiki={wiki} side="b" hint="바꿀 무기" pick={pb} onPick={pickB} open={list === "b"} onOpen={() => setListAt("b")} />
            </div>
            <WeaponList d={d} side="a" pick={pa} job={job} open={list === "a"} onPick={pickA} />
            <WeaponList d={d} side="b" pick={pb} job={job} open={list === "b"} onPick={pickB} />
          </section>
          <Result d={d} a={pa} b={pb} />
          <Similar d={d} wiki={wiki} a={pa} b={pb} onPick={pickSimilar} />
          <PowerChart key={job} d={d} wiki={wiki} job={job} a={pa} b={pb} onPick={pickSimilar} />
        </div>
      )}
    </>
  );
}
