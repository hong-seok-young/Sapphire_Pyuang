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
// 움직임 (제작자 2026-11-05 '계속 보고 있거나 클릭했을 때의 애니메이션, 화면 전환 때 뜨는 건 빠르게 하려고 안 함'): 바뀐 값(%, +N, 평균)은 톡 튀고(`Pop`),
// ⇄ 는 돌고, 지금 선·'지금' 글자·빈 무기 칸은 숨 쉬듯 깜박이고, 기준선과 지금 선은 새 자리로 미끄러진다(끄는 동안은 손가락을 바로 따라감).
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
/** 무기를 처음 고를 때의 강화 (제작자 2026-11-05 '무기 선택하면 기본을 7강으로'): 강화를 적지 않으면 +7, 그 무기가 +7 까지 안 되면 될 수 있는 만큼 */
const START_PLUS = 7;
const EMPTY: Pick = { q: "", w: null, plus: START_PLUS };

function initial(d: Enhance | undefined, text: string | null): Pick {
  const p: Pick = { q: text ?? "", w: null, plus: START_PLUS };
  if (!d || !text) return p;
  const { plus, w } = readText(d, text);
  return { q: w ? w.name : text, w, plus: w ? Math.min(plus ?? START_PLUS, maxPlus(d, w)) : plus ?? START_PLUS };
}

/** 값이 바뀌면 톡 튀게 (제작자 2026-11-05 '계속 보고 있거나 클릭했을 때의 애니메이션'). 처음 그릴 때는 그대로 둔다: 화면이 뜰 때 움직임은 없다 */
function Pop({ value, off = false, className, children }: { value: string | number; off?: boolean; className?: string; children: ReactNode }) {
  const last = useRef(value);
  const n = useRef(0);
  if (last.current !== value) {
    last.current = value;
    if (!off) n.current += 1;
  }
  return (
    <span key={n.current} className={(className ?? "") + (n.current > 0 ? " enh-pop" : "")}>
      {children}
    </span>
  );
}

/** 적은 글로 찾는 중인지 (고른 무기 이름 그대로면 찾는 중이 아니다) */
function searching(d: Enhance, pick: Pick): string[] {
  const read = readText(d, pick.q);
  return read.qs.length > 0 && !(pick.w && read.w === pick.w) ? read.qs : [];
}

/** 무기 칸 하나 (지금 무기 왼쪽, 바꿀 무기 오른쪽에 나란히. 제작자 2026-11-05 '무기 고르는 거를 좌우로 배치', '좀 더 콤팩트하게' -> '행 높이 더 압축'):
 *  두 줄: ◀ 이름 ▶ (이름을 누르면 적는 칸과 그 직업 무기 목록), 그림(아래 구석에 작은 레벨)과 − +N + (데미지는 결과 칸에) */
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
      {/* ◀ ▶ 는 칸 양옆에 높이를 꽉 채우고, 이름·그림·강화는 그 안쪽에 (제작자 2026-11-05) */}
      <button type="button" className="pill enh-nav" onClick={() => prev && choose(prev)} disabled={!prev} aria-label={prev ? `이전 무기 ${prev.name}` : "이전 무기"}>
        ◀
      </button>
      <div className="enh-mid">
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
          )}
        </div>
        {pick.w && cur && (
          <div className="enh-ctl" title={`Lv.${pick.w.lv ?? "?"} · ${fmt(cur.min)}~${fmt(cur.max)}`}>
            <span className="enh-slot">
              {pic ? <PicImg pic={pic} max={20} /> : null}
              <small className="enh-lvtag">Lv{pick.w.lv ?? "?"}</small>
            </span>
            <span className="enh-step">
              <button type="button" className="pill" onClick={() => step(-1)} disabled={pick.plus <= 0} aria-label="강화 내리기">
                −
              </button>
              <b>
                <Pop value={pick.plus}>+{pick.plus}</Pop>
              </b>
              <button type="button" className="pill" onClick={() => step(1)} disabled={pick.plus >= top} aria-label="강화 올리기">
                +
              </button>
            </span>
          </div>
        )}
      </div>
      <button type="button" className="pill enh-nav" onClick={() => next && choose(next)} disabled={!next} aria-label={next ? `다음 무기 ${next.name}` : "다음 무기"}>
        ▶
      </button>
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

/** 결과 (제작자 2026-11-05 '+32.2 라인까지는 괜찮은데' -> '최소·최대는 텍스트로만 하지 말고 꾸며 봐, 대신 콤팩트하게' ->
 *  '막대 좌우 길이 줄이고 최소 몇 퍼 최대 몇 퍼를 막대 좌우에, 평균도 막대 안으로'):
 *  왼쪽 큰 % (공격력 중앙값), 오른쪽은 [최소 %] 두 무기의 데미지 범위 막대(지금 파랑, 바꿀 금색, 같은 눈금, 흰 금과 그 옆 숫자가 중앙값) [최대 %] */
function Result({ d, a, b }: { d: Enhance; a: Pick; b: Pick }) {
  // 막대 칸의 실제 폭: 채운 칸이 평균 숫자보다 좁으면 숫자를 막대 바깥(끝 옆)에 둔다
  const box = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(0);
  const shown = !!(a.w && b.w);
  useLayoutEffect(() => {
    const el = box.current?.querySelector(".enh-rbar-track");
    if (!el) return;
    const read = () => setTw(el.clientWidth);
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
    };
  }, [shown]);
  if (!a.w || !b.w) return null;
  const x = damage(d, a.w, a.plus);
  const y = damage(d, b.w, b.plus);
  const p = pct(x.avg, y.avg);
  const lo = Math.min(x.min, y.min);
  const hi = Math.max(x.max, y.max);
  const at = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const pMin = pct(x.min, y.min);
  const pMax = pct(x.max, y.max);
  return (
    <section className="enh-card enh-result">
      <div className="enh-res">
        {/* 큰 % 는 공격력 중앙값(최소와 최대의 가운데)이 몇 % 바뀌는지 (제작자 2026-11-05 '맨 왼쪽 퍼센트가 무엇인지, 공격력 중앙값이라고') */}
        <div className="enh-res-mid">
          <small>공격력 중앙값</small>
          <div className={"enh-big" + tone(p)}>
            <Pop value={pctText(p)}>{pctText(p)}</Pop>
          </div>
        </div>
        <div className="enh-res-range">
          <div className="enh-res-end">
            <small>최소</small>
            <b className={tone(pMin)}>
              <Pop value={pctText(pMin)}>{pctText(pMin)}</Pop>
            </b>
          </div>
          <div className="enh-res-bars" ref={box}>
            {[
              { s: x, side: "a" },
              { s: y, side: "b" },
            ].map(({ s, side }) => {
              // 중앙값 눈금(흰 금)과 그 옆 숫자 (제작자 2026-11-05 '평균 막대는 넣어 주고 거기에 수치는 적어 주고'):
              // 숫자는 눈금 바로 오른쪽, 막대 칸 끝을 넘으면 눈금 왼쪽. 채운 칸을 벗어나면 테두리 있는 밝은 글자로
              const text = fmt(s.avg);
              const need = text.length * 5.5 + 2;
              const avgPx = (at(s.avg) / 100) * tw;
              const leftPx = !tw ? 0 : avgPx + 3 + need <= tw ? avgPx + 3 : avgPx - 3 - need >= 0 ? avgPx - 3 - need : Math.max(0, tw - need);
              const inside = tw === 0 || (leftPx >= (at(s.min) / 100) * tw && leftPx + need <= (at(s.max) / 100) * tw);
              const style = tw ? { left: `${leftPx}px` } : { left: `calc(${at(s.avg)}% + 3px)` };
              return (
                <div key={side} className={"enh-rbar enh-rbar-" + side}>
                  <span className="enh-rbar-n">{fmt(s.min)}</span>
                  <span className="enh-rbar-track">
                    <i className="enh-rbar-fill" style={{ left: `${at(s.min)}%`, width: `${at(s.max) - at(s.min)}%` }} />
                    <i className="enh-rbar-avg" style={{ left: `${at(s.avg)}%` }} />
                    <em className={"enh-rbar-val" + (inside ? "" : " enh-rbar-val-out")} style={style}>
                      <Pop value={text}>{text}</Pop>
                    </em>
                  </span>
                  <span className="enh-rbar-n">{fmt(s.max)}</span>
                </div>
              );
            })}
          </div>
          <div className="enh-res-end">
            <small>최대</small>
            <b className={tone(pMax)}>
              <Pop value={pctText(pMax)}>{pctText(pMax)}</Pop>
            </b>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 사람들이 보통 쓰는 강화 (비슷한 무기 목록은 이 강화만, 제작자 2026-11-05 '6강부터 보여줘도 될 듯') */
const USUAL = [6, 7, 8, 9, 10];

/** 그 직업 무기 전부의 +6 ~ +10 을 약한 것부터 (지금 무기도 그 자리에), 칸 안에서 위아래로 스크롤하고 열면 지금 무기 줄이 가운데로
 *  (제작자 2026-11-05 '비슷한 무기는 위아래 스크롤되게 해, 목록은 모든 무기 강화별로 다 뜨게'. 그전에는 가까운 8개만) */
function Similar({ d, wiki, a, b, onPick }: { d: Enhance; wiki: Wiki; a: Pick; b: Pick; onPick: (w: EnhanceWeapon, plus: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const meKey = a.w ? `${a.w.name}+${a.plus}` : "";
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    const me = el?.querySelector<HTMLElement>(".enh-sim-me");
    if (!el || !me) return;
    const top = me.offsetTop - el.clientHeight / 2 + me.offsetHeight / 2;
    el.scrollTo({ top, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [meKey]);
  if (!a.w) return null;
  const A = a.w;
  const base = damage(d, A, a.plus).avg;
  if (!(base > 0)) return null;
  const rows = jobWeapons(d, A.job)
    .flatMap((w) => USUAL.filter((p) => p <= maxPlus(d, w) && !(w.name === A.name && p === a.plus)).map((plus) => ({ w, plus, avg: damage(d, w, plus).avg, me: false })))
    .concat([{ w: A, plus: a.plus, avg: base, me: true }])
    .sort((x, y) => x.avg - y.avg || Number(y.me) - Number(x.me));
  return (
    <section className="enh-card enh-sim">
      <div className="enh-sim-head">
        <b>비슷한 무기</b>
        <span className="muted">+6 ~ +10</span>
      </div>
      <div className="enh-sim-list" ref={box}>
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
/** 그래프 점 크기 (styles.css .enh-ch-dot 과 같게) */
const DOT = 14;

/** 기준선 = 지금 무기 (제작자 2026-11-05 '왼쪽 무기를 그래프에서도 기준으로, 수직선을 옮기면 기준도 바뀌게, 맨 위 버튼·비슷한 무기·그래프 3개가 같이 연동'):
 *  선을 끌거나 ◀ ▶ 로 옮기면 지금 무기(맨 위 왼쪽 칸)가 그 점의 무기·강화로 바뀌고, 비슷한 무기와 결과도 따라 바뀐다 */
function PowerChart({ d, wiki, job, a, b, onPick, onBase }: {
  d: Enhance; wiki: Wiki; job: string; a: Pick; b: Pick; onPick: (w: EnhanceWeapon, plus: number) => void; onBase: (w: EnhanceWeapon, plus: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 그래프 칸의 실제 폭: 점이 붙어 겹치는 줄은 점을 좁히고 숫자를 뺀다 (낮은 레벨 무기는 +6 ~ +10 이 몇 px 안에 모인다)
  const box = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(0);
  useLayoutEffect(() => {
    const el = box.current?.querySelector(".enh-ch-track");
    if (!el) return;
    const read = () => setTw(el.clientWidth);
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
    };
  }, []);
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
  // 기준선은 점(강화마다의 평균) 위로만 (제작자 2026-11-05 '버튼들 기준으로 한 칸씩, 그 버튼들 위로만 움직이게'): 끌면 가장 가까운 점으로, ◀ ▶ 는 한 칸씩
  const pts = rows
    .flatMap((r) => r.vals.map((v, i) => ({ v, w: r.w, plus: CHART_PLUS[i], label: `+${CHART_PLUS[i]} ${r.w.name}` })))
    .sort((p, q) => p.v - q.v);
  const snap = (v: number) => pts.reduce((best, p) => (Math.abs(p.v - v) < Math.abs(best.v - v) ? p : best), pts[0]);
  const base = now;
  const nowLabel = a.w ? `+${a.plus} ${a.w.name}` : "";
  const here = pts.findIndex((p) => p.label === nowLabel);
  const stepRef = (dir: 1 | -1) => {
    let j: number;
    if (here >= 0) j = here + dir;
    else if (base === null) j = dir > 0 ? 0 : pts.length - 1;
    else j = dir > 0 ? pts.findIndex((p) => p.v > base + 1e-9) : pts.map((p) => p.v < base - 1e-9).lastIndexOf(true);
    if (j < 0 || j >= pts.length) return;
    onBase(pts[j].w, pts[j].plus);
  };
  const firstRef = here >= 0 ? here === 0 : base !== null && !pts.some((p) => p.v < base - 1e-9);
  const lastRef = here >= 0 ? here === pts.length - 1 : base !== null && !pts.some((p) => p.v > base + 1e-9);
  return (
    <section className="enh-card enh-chart">
      {/* 제목과 기준 줄을 한 줄에 (제작자 2026-11-05 '이것도 한 행으로') */}
      <div className="enh-ch-base">
        <b className="enh-ch-title">{job} 무기</b>
        {base !== null && (
          <>
            <button type="button" className="pill enh-nav" onClick={() => stepRef(-1)} disabled={firstRef} aria-label="기준선 한 칸 왼쪽">
              ◀
            </button>
            <span className="enh-ch-basetext">
              <i className="enh-ch-key-now" />
              기준 {nowLabel} <b>{fmt(base)}</b>
            </span>
            <button type="button" className="pill enh-nav" onClick={() => stepRef(1)} disabled={lastRef} aria-label="기준선 한 칸 오른쪽">
              ▶
            </button>
          </>
        )}
      </div>
      <div ref={box} className={"enh-ch" + (dragging ? " enh-ch-dragging" : "")}>
        {rows.map((r) => {
          const isA = a.w?.name === r.w.name;
          const isB = b.w?.name === r.w.name;
          const shut = open !== r.w.name;
          const pic = (wiki.items[r.w.name] ?? wiki.items[key(r.w.name)])?.icon;
          // 기준선 바로 왼쪽·오른쪽 점 (제작자 2026-11-05 '6 7 사이에 있으면 6은 마이너스 몇, 7은 플러스 몇')
          const li = base === null ? -1 : r.vals.map((v) => v < base - 1e-9).lastIndexOf(true);
          const ri = base === null ? -1 : r.vals.findIndex((v) => v > base + 1e-9);
          // % 는 그 % 에 해당하는 점 바로 위에 (제작자 2026-11-05 '수직선 좌우 퍼센트를 그 수치에 해당하는 무기 행의 버튼에'): 두 글자가 겹치면 사이에서 비켜 선다
          const labs = (base === null ? [] : [li, ri].filter((i) => i >= 0)).map((i) => {
            const p = pct(base as number, r.vals[i]);
            const w = pctText(p).length * 5 + 6;
            return { i, p, w, left: (x(r.vals[i]) / 100) * tw - w / 2 };
          });
          if (labs.length === 2 && labs[0].left + labs[0].w + 1 > labs[1].left) {
            const mid = (labs[0].left + labs[0].w / 2 + labs[1].left + labs[1].w / 2) / 2;
            labs[0].left = mid - labs[0].w - 1;
            labs[1].left = mid + 1;
          }
          for (const l of labs) l.left = Math.max(0, Math.min(tw - l.w, l.left));
          const edge = (i: number) => (i === li && li >= 0 ? " enh-ch-dot-lo" : i === ri && ri >= 0 ? " enh-ch-dot-hi" : "");
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
                    if (!g.moved) setDragging(true);
                    g.moved = true;
                    const pt = snap(valueAt(e.currentTarget, e.clientX));
                    if (nowLabel !== pt.label) onBase(pt.w, pt.plus);
                  }}
                  onPointerUp={(e) => {
                    const g = drag.current;
                    drag.current = null;
                    setDragging(false);
                    if (!g || g.moved) return;
                    // 톡 누름: 이 줄에서 가장 가까운 강화 점에 기준선
                    const i = nearest(r.vals, valueAt(e.currentTarget, e.clientX));
                    if (nowLabel !== `+${CHART_PLUS[i]} ${r.w.name}`) onBase(r.w, CHART_PLUS[i]);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragging(false);
                  }}
                >
                  {ticks.map((t) => (
                    <i key={t} className="enh-ch-grid" style={{ left: `${x(t)}%` }} />
                  ))}
                  {now !== null && <i className="enh-ch-now" style={{ left: `${x(now)}%` }} />}
                  <i className="enh-ch-bar" style={{ left: `${x(r.vals[0])}%`, width: `${x(r.vals[4]) - x(r.vals[0])}%` }} />
                  {r.vals.map((v, i) => {
                    const p = CHART_PLUS[i];
                    const marked = (q: number) => (isA && a.plus === q) || (isB && b.plus === q);
                    const mark = isA && a.plus === p ? " enh-ch-dot-a" : isB && b.plus === p ? " enh-ch-dot-b" : "";
                    // 옆 점과의 거리(px)만큼만 넓게: 14px 가 안 되면 좁은 막대로, 숫자가 안 들어가면 숫자 없이.
                    // 고른 점은 그대로 크게(테두리까지 반 폭 10px) 위에 두고, 그 옆 점은 그만큼 비켜 좁힌다
                    const room1 = (j: number) => {
                      if (j < 0 || j >= r.vals.length) return Infinity;
                      const gap = (Math.abs(x(r.vals[j]) - x(v)) * tw) / 100;
                      return marked(CHART_PLUS[j]) ? 2 * (gap - 10) - 1 : gap - 1;
                    };
                    const room = tw > 0 && !mark ? Math.min(DOT, room1(i - 1), room1(i + 1)) : DOT;
                    const w = Math.max(3, Math.min(DOT, Math.floor(room)));
                    return (
                      <i
                        key={p}
                        className={"enh-ch-dot" + mark + (mark ? "" : edge(i)) + (i >= 2 ? " enh-ch-dot-ink" : "")}
                        style={{ left: `${x(v)}%`, background: PLUS_COLOR[i], ...(w < DOT ? { width: w, marginLeft: -w / 2 } : null) }}
                        title={`+${p} ${r.w.name} ${fmt(v)}`}
                      >
                        {w >= (p < 10 ? 8 : 11) ? p : null}
                      </i>
                    );
                  })}
                  {base !== null && (
                    <span className="enh-ch-labs">
                      {labs.map((l) => (
                        <span key={l.i} className={"enh-ch-lab" + tone(l.p)} style={tw ? { left: `${l.left}px`, width: `${l.w}px` } : { left: `${x(r.vals[l.i])}%`, transform: "translateX(-50%)" }}>
                          <Pop value={pctText(l.p)} off={dragging}>
                            {pctText(l.p)}
                          </Pop>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
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
  // 다른 직업끼리는 견주지 않는다 (제작자 2026-11-05 '타 직업군끼리 ㄴㄴ, 직업 넘어가면 무기 입력한 거 초기화'): 주소의 두 무기 직업이 다르면 바꿀 무기는 비운다
  const pb0 = b ?? initial(d, query.get("b"));
  const pb = pa.w && pb0.w && pa.w.job !== pb0.w.job ? EMPTY : pb0;
  const [jobPick, setJob] = useState<string | null>(null);
  const job = jobPick ?? pa.w?.job ?? (me.job ? JOB_OF[me.job] : null) ?? "전사";
  // 목록을 펼칠 줄: 처음은 비어 있는 첫 줄, 줄을 누르면 그 줄, 고르면 다음 빈 줄 (둘 다 차면 닫힘)
  const [listAt, setListAt] = useState<"a" | "b" | null | undefined>(undefined);
  const firstEmpty = !pa.w ? "a" : !pb.w ? "b" : null;
  const list = listAt === undefined ? firstEmpty : listAt;
  const after = (row: "a" | "b", p: Pick, other: Pick) => {
    if (!p.w) return;
    if (!jobPick || p.w.job !== job) setJob(p.w.job);
    setListAt(other.w ? null : row === "a" ? "b" : "a");
  };
  // 다른 직업 무기를 고르면 (적어서 찾은 것) 반대쪽 칸을 비운다
  const pickA = (p: Pick) => {
    const other = p.w && pb.w && p.w.job !== pb.w.job ? EMPTY : pb;
    setA(p);
    if (other !== pb) setB(EMPTY);
    keepInUrl(p, other);
    if (p.w && p.w !== pa.w) after("a", p, other);
  };
  const pickB = (p: Pick) => {
    const other = p.w && pa.w && p.w.job !== pa.w.job ? EMPTY : pa;
    setB(p);
    if (other !== pa) setA(EMPTY);
    keepInUrl(other, p);
    if (p.w && p.w !== pb.w) after("b", p, other);
  };
  // 비슷한 무기를 누르면 바꿀 무기로 넣고 결과 칸을 보인다
  const pickSimilar = (w: EnhanceWeapon, plus: number) => {
    pickB({ q: w.name, w, plus });
    window.setTimeout(() => {
      document.querySelector(".enh-result")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  };
  // 그래프 기준선을 옮기면 지금 무기를 그 점으로 (목록을 열거나 직업을 바꾸지 않는다)
  const setBase = (w: EnhanceWeapon, plus: number) => {
    const p = { q: w.name, w, plus };
    setA(p);
    keepInUrl(p, pb);
  };
  const [spin, setSpin] = useState(0);
  const swap = () => {
    setSpin((n) => n + 1);
    setA(pb);
    setB(pa);
    keepInUrl(pb, pa);
  };
  // 직업을 바꾸면 두 무기 칸을 비우고 지금 무기 칸부터 그 직업 무기 목록
  const pickJob = (j: string) => {
    setJob(j);
    if (j === job) {
      setListAt(list ?? firstEmpty ?? "a");
      return;
    }
    setA(EMPTY);
    setB(EMPTY);
    keepInUrl(EMPTY, EMPTY);
    setListAt("a");
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
              <button key={spin} type="button" className={"enh-swap" + (spin ? " enh-swap-spin" : "")} onClick={swap} aria-label="좌우 바꾸기">
                ⇄
              </button>
              <WeaponCard d={d} wiki={wiki} side="b" hint="바꿀 무기" pick={pb} onPick={pickB} open={list === "b"} onOpen={() => setListAt("b")} />
            </div>
            <WeaponList d={d} side="a" pick={pa} job={job} open={list === "a"} onPick={pickA} />
            <WeaponList d={d} side="b" pick={pb} job={job} open={list === "b"} onPick={pickB} />
          </section>
          <Result d={d} a={pa} b={pb} />
          <Similar d={d} wiki={wiki} a={pa} b={pb} onPick={pickSimilar} />
          <PowerChart key={job} d={d} wiki={wiki} job={job} a={pa} b={pb} onPick={pickSimilar} onBase={setBase} />
        </div>
      )}
    </>
  );
}
