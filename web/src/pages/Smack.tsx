// 운영진 때리기 (개발 요청 #10: 현금술사 님 신청, 길마 결재. 제작자 2026-11-09 '우선 나한테만 보이게 해줘, 알아서 만들고').
// 길드마스터·오피서의 캐릭터 사진(없으면 직업 엠블럼)을 두드린다: 데미지 숫자, 크리티컬, 죽음의 일격, HP 가 0 이 되면 K.O. 와 다시 차오름, 콤보.
// 타격 모양은 src/smackFx.ts HIT_FX 한 곳 (제작자가 보낸 인게임 영상을 따랐다, 숫자와 CRITICAL! · DEADLY! 는 영상에서 오린 그림). 기록은 3초마다 모아 서버에 (functions/api/smack).
// 누를 때마다 React 를 다시 그리지 않고 DOM 을 바로 고친다 (초당 25번 눌러도 느린 폰에서 멈추지 않게, 생일 스티커와 같은 방법).
// 게임과 상관없는 놀이라 게임 안전 규칙에 맞는다
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as RKeyboardEvent, PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, api, avatarUrl } from "../auth";
import type { Job, Me, Role } from "../auth";
import { JobEmblem } from "../emblems";
import { Nick } from "../kakao";
import { Fx } from "../birthdayFx";
import { HIT_FX, hpOf, koBurst, loadSmackArt, restartAs, rollHit, spawnNumber, replayAnim } from "../smackFx";
import { Loading, TopBar } from "../ui";

interface Target {
  id: string;
  role: Role;
  job: Job | null;
  level: number | null;
  avatar: number | null;
}
interface Row {
  hits: number;
  damage: number;
  kos: number;
  crits: number;
  deadly: number;
  best: number;
}
interface SmackData {
  targets: Target[];
  mine: Record<string, Row>;
  topTargets: { id: string; hits: number; damage: number; kos: number }[];
  topHitters: { id: string; hits: number; damage: number; kos: number; best: number }[];
  hitMe: { hits: number; damage: number; kos: number; people: number } | null;
}

const TITLE = "운영진 때리기";
/** 이 안에 다시 누르면 콤보가 이어진다 (생일 스티커와 같다) */
const COMBO_MS = 1300;
/** 모아 둔 기록을 보내는 간격 */
const FLUSH_MS = 3000;
/** K.O. 뒤 다시 차오를 때까지 */
const KO_MS = 1300;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const empty = (): Row => ({ hits: 0, damage: 0, kos: 0, crits: 0, deadly: 0, best: 0 });
const addRow = (a: Row, b: Row): Row => ({
  hits: a.hits + b.hits,
  damage: a.damage + b.damage,
  kos: a.kos + b.kos,
  crits: a.crits + b.crits,
  deadly: a.deadly + b.deadly,
  best: Math.max(a.best, b.best),
});
/** 큰 수는 짧게 (12.3만, 1.2억) */
export function shortNum(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, "")}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}만`;
  return n.toLocaleString("ko-KR");
}

// ---------- 기록 모으기 (화면을 오가도 이어지게 모듈에 둔다) ----------
/** 아직 안 보낸 것 */
const pending = new Map<string, Row>();
/** 마지막으로 받은 서버 기록 뒤에 더한 것 (보낸 것 포함, 화면 합계용) */
const sinceLoad = new Map<string, Row>();
/** 운영진마다 남은 HP (이번에 연 동안) */
const hpLeft = new Map<string, number>();
let flushing: Promise<void> | null = null;

function note(target: string, d: Partial<Row>) {
  const row = { ...empty(), ...d };
  pending.set(target, addRow(pending.get(target) ?? empty(), row));
  sinceLoad.set(target, addRow(sinceLoad.get(target) ?? empty(), row));
}
function takePending() {
  const items = [...pending.entries()].filter(([, r]) => r.hits > 0 || r.kos > 0).map(([target, r]) => ({ target, ...r }));
  pending.clear();
  return items;
}
function flush(): Promise<void> {
  if (flushing) return flushing;
  const items = takePending();
  if (!items.length) return Promise.resolve();
  flushing = api<{ ok: true }>("/api/smack", "POST", { items })
    .then(() => undefined)
    .catch((e) => {
      // 권한·형식 오류(4xx)면 버리고, 인터넷이면 다음에 다시
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) for (const it of items) pending.set(it.target, addRow(pending.get(it.target) ?? empty(), it));
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}
/** 화면을 떠날 때(다른 앱, 닫기): 브라우저가 끊기 전에 보낸다 */
function beacon() {
  const items = takePending();
  if (!items.length) return;
  try {
    if (navigator.sendBeacon("/api/smack", new Blob([JSON.stringify({ items })], { type: "application/json" }))) return;
  } catch {
    /* 아래로 */
  }
  for (const it of items) pending.set(it.target, addRow(pending.get(it.target) ?? empty(), it));
}

export function SmackPage({ me, arg }: { me: Me; arg: string }) {
  const [data, setData] = useState<SmackData | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [tryN, setTryN] = useState(0);
  // 목록으로 돌아올 때마다 보내고 새로 받는다
  const listing = !arg;
  // 영상에서 오린 숫자·글씨 그림을 미리 받아 둔다
  useEffect(() => {
    void loadSmackArt();
  }, []);
  useEffect(() => {
    let live = true;
    setError(undefined);
    void flush()
      .then(() => api<SmackData>("/api/smack"))
      .then((d) => {
        if (!live) return;
        sinceLoad.clear();
        for (const [k, r] of pending) sinceLoad.set(k, { ...r });
        setData(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [listing, tryN]);
  // 3초마다 보내고, 떠날 때도
  useEffect(() => {
    const t = window.setInterval(() => void flush(), FLUSH_MS);
    const onHide = () => document.visibilityState === "hidden" && beacon();
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, []);

  if (!data) {
    return (
      <>
        <TopBar title={TITLE} />
        <Loading error={error} onRetry={() => setTryN((n) => n + 1)} />
      </>
    );
  }
  if (arg) {
    const t = data.targets.find((x) => x.id === arg);
    if (!t) {
      return (
        <>
          <TopBar title={TITLE} />
          <div className="empty">때릴 수 없는 사람이에요</div>
        </>
      );
    }
    return <Arena key={t.id} target={t} base={data.mine[t.id] ?? empty()} />;
  }
  return <TargetList me={me} data={data} />;
}

const roleTag = (r: Role) => (r === "master" ? "길마" : "오피서");

function TargetPic({ t, size }: { t: Target; size: number }) {
  // 사진은 무대 높이에 맞춰 키운다 (도트 그대로, 폭이 모자라면 비율대로 줄인다)
  if (t.avatar) return <img className="smk-pic" src={avatarUrl(t.id, t.avatar)} alt="" draggable={false} style={{ height: size }} />;
  if (t.job) return <JobEmblem job={t.job} level={t.level ?? 1} size={Math.round(size * 0.8)} />;
  return <span className="smk-pic-none" style={{ fontSize: Math.round(size * 0.5) }}>😤</span>;
}

function TargetList({ me, data }: { me: Me; data: SmackData }) {
  const mine = (id: string) => addRow(data.mine[id] ?? empty(), sinceLoad.get(id) ?? empty());
  return (
    <>
      <TopBar title={TITLE} />
      {data.hitMe && (
        <div className="smk-hitme">
          <b>나를 때린 사람 {data.hitMe.people}명</b>
          <span>
            데미지 {shortNum(data.hitMe.damage)} · K.O. {data.hitMe.kos.toLocaleString("ko-KR")}
          </span>
        </div>
      )}
      {!data.targets.length ? (
        <div className="empty">때릴 운영진이 없어요</div>
      ) : (
        <div className="smk-cards">
          {data.targets.map((t) => {
            const r = mine(t.id);
            return (
              <a key={t.id} className="smk-card" href={`#/smack/${encodeURIComponent(t.id)}`}>
                <span className={"smk-card-tag smk-tag-" + t.role}>{roleTag(t.role)}</span>
                <span className="smk-card-pic">
                  <TargetPic t={t} size={72} />
                </span>
                <span className="smk-card-name">
                  <Nick name={t.id} />
                </span>
                <span className="smk-card-sub">
                  {t.level ? `Lv.${t.level}` : "Lv.?"}
                  {r.kos ? ` · K.O. ${r.kos.toLocaleString("ko-KR")}` : ""}
                </span>
              </a>
            );
          })}
        </div>
      )}
      <section className="panel smk-rank">
        <h2 className="panel-title">가장 많이 맞은 운영진</h2>
        {!data.topTargets.length ? (
          <div className="smk-rank-empty">아직 아무도 안 맞았어요</div>
        ) : (
          <ol>
            {data.topTargets.map((r, k) => (
              <li key={r.id}>
                <span className="smk-rank-r">{k + 1}</span>
                <span className="smk-rank-n">
                  <Nick name={r.id} />
                </span>
                <span className="smk-rank-v">
                  {shortNum(r.damage)}
                  <small>K.O. {r.kos.toLocaleString("ko-KR")}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel smk-rank">
        <h2 className="panel-title">가장 많이 때린 길드원</h2>
        {!data.topHitters.length ? (
          <div className="smk-rank-empty">아직 아무도 안 때렸어요</div>
        ) : (
          <ol>
            {data.topHitters.map((r, k) => (
              <li key={r.id} className={r.id === me.id ? "mine" : undefined}>
                <span className="smk-rank-r">{k + 1}</span>
                <span className="smk-rank-n">
                  <Nick name={r.id} />
                </span>
                <span className="smk-rank-v">
                  {shortNum(r.damage)}
                  <small>
                    K.O. {r.kos.toLocaleString("ko-KR")} · 콤보 {r.best.toLocaleString("ko-KR")}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** 때리는 화면 */
function Arena({ target, base }: { target: Target; base: Row }) {
  const max = hpOf(target.level);
  const stage = useRef<HTMLDivElement>(null);
  const shakeEl = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const nums = useRef<HTMLDivElement>(null);
  const hpFill = useRef<HTMLSpanElement>(null);
  const hpGhost = useRef<HTMLSpanElement>(null);
  const hpBar = useRef<HTMLDivElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const comboBox = useRef<HTMLDivElement>(null);
  const comboNum = useRef<HTMLElement>(null);
  const koBox = useRef<HTMLDivElement>(null);
  const koCount = useRef<HTMLElement>(null);
  const slash = useRef<HTMLSpanElement>(null);
  const flashEl = useRef<HTMLDivElement>(null);
  const stat = {
    hits: useRef<HTMLElement>(null),
    damage: useRef<HTMLElement>(null),
    kos: useRef<HTMLElement>(null),
    best: useRef<HTMLElement>(null),
  };
  const fx = useRef<Fx | null>(null);
  const st = useRef({ hp: Math.min(max, hpLeft.get(target.id) ?? max), combo: 0, lastTap: 0, ko: false, comboT: 0, koT: 0, live: 0, rect: null as DOMRect | null });
  const total = () => addRow(base, sinceLoad.get(target.id) ?? empty());

  useEffect(() => {
    const f = new Fx();
    f.mount("smk-canvas");
    fx.current = f;
    const s = st.current;
    const measure = () => {
      s.rect = stage.current?.getBoundingClientRect() ?? null;
    };
    measure();
    // 그림이 늦게 떠서 무대 크기가 바뀌어도 다시 잰다
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (stage.current) ro?.observe(stage.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      window.clearTimeout(s.comboT);
      window.clearTimeout(s.koT);
      // K.O. 중에 떠나면 다시 차오른 채로
      hpLeft.set(target.id, s.ko || s.hp <= 0 ? max : s.hp);
      f.destroy();
      fx.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    paintHp(true);
    paintStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paintHp(instant = false) {
    const s = st.current;
    const k = Math.max(0, s.hp) / max;
    if (instant && hpGhost.current) hpGhost.current.style.transition = "none";
    if (hpFill.current) hpFill.current.style.transform = `scaleX(${k})`;
    if (hpGhost.current) {
      hpGhost.current.style.transform = `scaleX(${k})`;
      if (instant) {
        void hpGhost.current.offsetWidth;
        hpGhost.current.style.transition = "";
      }
    }
    if (hpText.current) hpText.current.textContent = `${Math.max(0, s.hp).toLocaleString("ko-KR")} / ${max.toLocaleString("ko-KR")}`;
    hpBar.current?.classList.toggle("smk-hp-low", k < 0.25);
  }
  function paintStats() {
    const t = total();
    if (stat.hits.current) stat.hits.current.textContent = t.hits.toLocaleString("ko-KR");
    if (stat.damage.current) stat.damage.current.textContent = shortNum(t.damage);
    if (stat.kos.current) stat.kos.current.textContent = t.kos.toLocaleString("ko-KR");
    if (stat.best.current) stat.best.current.textContent = t.best.toLocaleString("ko-KR");
    if (koCount.current) koCount.current.textContent = t.kos.toLocaleString("ko-KR");
  }

  function endCombo() {
    const s = st.current;
    comboBox.current?.classList.remove("on");
    s.combo = 0;
    paintStats();
  }

  function knockOut() {
    const s = st.current;
    s.ko = true;
    note(target.id, { kos: 1 });
    const r = s.rect;
    const f = fx.current;
    const calm = reduced();
    if (f && r && !calm) koBurst(f, r.left + r.width / 2, r.top + r.height * 0.45);
    body.current?.classList.add("smk-ko");
    restartAs(koBox.current, "smk-ko-", "smk-ko-on");
    paintStats();
    s.koT = window.setTimeout(() => {
      s.ko = false;
      s.hp = max;
      body.current?.classList.remove("smk-ko");
      restartAs(body.current, "smk-recoil-", calm ? undefined : "smk-recoil-respawn");
      koBox.current?.classList.remove("smk-ko-on");
      hpBar.current?.classList.add("smk-hp-refill");
      paintHp();
      window.setTimeout(() => hpBar.current?.classList.remove("smk-hp-refill"), 600);
    }, KO_MS);
  }

  /** 한 대 (x, y 는 화면 좌표) */
  function hit(x: number, y: number) {
    const s = st.current;
    const now = performance.now();
    s.combo = now - s.lastTap < COMBO_MS ? s.combo + 1 : 1;
    s.lastTap = now;
    window.clearTimeout(s.comboT);
    s.comboT = window.setTimeout(endCombo, COMBO_MS);
    if (s.combo >= 2 && comboBox.current && comboNum.current) {
      comboNum.current.textContent = String(s.combo);
      comboBox.current.classList.add("on");
      replayAnim(comboNum.current);
    }
    // K.O. 중에는 콤보만 이어진다
    if (s.ko) return;
    const { kind, dmg } = rollHit(s.combo);
    const spec = HIT_FX[kind];
    const real = Math.min(dmg, s.hp);
    s.hp -= dmg;
    note(target.id, { hits: 1, damage: real, crits: kind === "critical" ? 1 : 0, deadly: kind === "deadly" ? 1 : 0, best: s.combo });
    const r = s.rect;
    const calm = reduced();
    const f = fx.current;
    const q = f?.quality ?? 1;
    // 숫자: 화면이 끊기면 일반 타격 숫자부터 덜 띄운다 (크리티컬·죽음의 일격은 늘)
    const cap = q < 0.6 ? 6 : 14;
    if (r && nums.current && (kind !== "normal" || s.live < cap)) {
      const jitter = kind === "normal" ? 18 : 6;
      s.live++;
      spawnNumber(nums.current, x - r.left + (Math.random() - 0.5) * jitter, y - r.top - 18 + (Math.random() - 0.5) * jitter, kind, dmg, calm);
      window.setTimeout(() => (s.live = Math.max(0, s.live - 1)), spec.numMs);
    }
    if (!calm) {
      restartAs(body.current, "smk-recoil-", spec.recoil);
      if (spec.shake) restartAs(shakeEl.current, "smk-shake-", spec.shake);
      if (spec.flash) restartAs(flashEl.current, "smk-flash-", spec.flash);
      if (spec.slash) restartAs(slash.current, "smk-slash-", "smk-slash-on");
      if (f) spec.burst(f, x, y);
    }
    paintHp();
    if (s.hp <= 0) knockOut();
    // 합계 칸은 10번에 한 번만 고친다 (콤보가 끝나면 다 고친다)
    if (s.combo % 10 === 1 || kind !== "normal") paintStats();
  }

  function down(e: RPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    hit(e.clientX, e.clientY);
  }
  function key(e: RKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const r = st.current.rect ?? stage.current?.getBoundingClientRect();
    if (r) hit(r.left + r.width / 2, r.top + r.height / 2);
  }

  return (
    <>
      <TopBar title={TITLE} />
      <div className="smk-head">
        <span className={"smk-card-tag smk-tag-" + target.role}>{roleTag(target.role)}</span>
        <b className="smk-head-name">
          <Nick name={target.id} />
        </b>
        <span className="smk-head-lv">{target.level ? `Lv.${target.level}` : ""}</span>
        <span className="smk-head-ko">
          K.O. <b ref={koCount}>0</b>
        </span>
      </div>
      <div ref={hpBar} className="smk-hp" role="img" aria-label="HP">
        <span ref={hpGhost} className="smk-hp-ghost" />
        <span ref={hpFill} className="smk-hp-fill" />
        <span ref={hpText} className="smk-hp-text" />
      </div>
      <div ref={shakeEl} className="smk-shake">
        <div
          ref={stage}
          className="smk-stage"
          role="button"
          tabIndex={0}
          aria-label={`${target.id} 님 때리기`}
          onPointerDown={down}
          onKeyDown={key}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div ref={body} className="smk-body">
            <span className="smk-shadow" aria-hidden />
            <span className="smk-target">
              <TargetPic t={target} size={210} />
            </span>
            <span ref={slash} className="smk-slash" aria-hidden />
          </div>
          <div ref={nums} className="smk-nums" aria-hidden />
          <div ref={comboBox} className="smk-combo" aria-hidden>
            <b ref={comboNum}>0</b>
            <small>COMBO</small>
          </div>
          <div ref={koBox} className="smk-kotext" aria-hidden>
            K.O.
          </div>
        </div>
      </div>
      <div className="smk-stats">
        <div>
          <small>때린 횟수</small>
          <b ref={stat.hits}>0</b>
        </div>
        <div>
          <small>데미지</small>
          <b ref={stat.damage}>0</b>
        </div>
        <div>
          <small>K.O.</small>
          <b ref={stat.kos}>0</b>
        </div>
        <div>
          <small>최고 콤보</small>
          <b ref={stat.best}>0</b>
        </div>
      </div>
      {createPortal(<div ref={flashEl} className="smk-flash" aria-hidden />, document.body)}
    </>
  );
}
