import type { Fx } from "./birthdayFx";
import { PALETTE, pick } from "./birthdayFx";

/**
 * 맨 위 'HAPPY BIRTHDAY 마을모금함' 깃발 띠 (제작자 2026-11-07 '연타할수록 저 현수막이 난리 나게, 막 터지고 떨어지고, 다 떨어져서 아래 5개 버튼 위
 * 라인에 쌓이고, 연타 멈추면 현수막 하나씩 위로 날아가서 걸리게'). 깃발은 DOM 이고 움직임은 transform 만 바꾼다 (보는 동안·누를 때만 돈다).
 * 평소 살랑이는 것은 CSS (안쪽 i), 누를 때의 흔들림·떨어짐·쌓임·날아 걸림은 여기 (바깥 b). 떨어지면 안쪽 살랑임을 멈춰 두었다가(paused) 다시 걸리면
 * 그 자리에서 이어서 살랑여 튀지 않는다. 바닥은 아래 탭 위 선 (.tabbar 의 위).
 */
type State = "hang" | "fall" | "pile" | "fly";
interface Flag {
  i: number;
  el: HTMLElement;
  color: string;
  st: State;
  /** 걸려 있을 때: 흔들림 각과 각속도, 위아래 튐 */
  th: number;
  om: number;
  yb: number;
  vyb: number;
  kickAt: number;
  kickOm: number;
  kickV: number;
  /** 풀려 있을 때: 몸 가운데, 속도, 각, 각속도 */
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  /** 쌓였을 때 받치는 높이(바닥 위 px)와 눕는 각, 쌓인 차례 */
  rest: number;
  tipTo: number;
  order: number;
  /** 다시 날아 걸리는 때 (0 이면 아직) */
  flyAt: number;
  t: number;
  dur: number;
  sx: number;
  sy: number;
  sa: number;
  ta: number;
  bx: number;
  by: number;
}

const G = 1500;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const colorOf = (i: number) => `hsl(${(i * 47) % 360}, 80%, 55%)`;

export class Garland {
  private root: HTMLElement;
  private probe: HTMLElement;
  private rope: HTMLElement;
  private flags: Flag[] = [];
  private getFx: () => Fx | null;
  private raf = 0;
  private last = 0;
  private vw = 0;
  private fw = 19;
  private fh = 26;
  private top = 0;
  private slots: number[] = [];
  private floor = 0;
  private ropeY = 0;
  private ropeV = 0;
  private seq = 0;
  private still = reduced();
  private onResize = () => {
    this.layout();
    // 크기가 바뀌면 쌓인 것은 새 바닥으로 다시 떨어뜨린다
    for (const f of this.flags) if (f.st === "pile") this.loosen(f, 0, 0);
    this.kick();
  };

  constructor(root: HTMLElement, text: string, getFx: () => Fx | null) {
    this.root = root;
    this.getFx = getFx;
    this.probe = document.createElement("span");
    this.probe.className = "bday-garland-probe";
    this.rope = document.createElement("span");
    this.rope.className = "bday-rope";
    root.append(this.probe, this.rope);
    [...text].forEach((ch, i) => {
      const el = document.createElement("b");
      el.className = "bday-flag";
      el.style.setProperty("--i", String(i));
      const sway = document.createElement("i");
      const em = document.createElement("em");
      em.style.background = colorOf(i);
      em.textContent = ch === " " ? " " : ch;
      sway.append(em);
      el.append(sway);
      root.append(el);
      this.flags.push({
        i, el, color: colorOf(i), st: "hang", th: 0, om: 0, yb: 0, vyb: 0, kickAt: 0, kickOm: 0, kickV: 0,
        x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, rest: 0, tipTo: 0, order: 0, flyAt: 0, t: 0, dur: 0.6, sx: 0, sy: 0, sa: 0, ta: 0, bx: 0, by: 0,
      });
    });
    this.layout();
    window.addEventListener("resize", this.onResize);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("resize", this.onResize);
    this.root.replaceChildren();
  }

  /** 깃발 크기와 걸리는 자리: 글자 수에 맞춰 화면 폭 안으로 */
  private layout() {
    this.vw = window.innerWidth;
    const n = this.flags.length;
    this.fw = Math.min(19, (this.vw - 16) / n - 2);
    this.fh = this.fw * 1.37;
    this.top = this.probe.offsetTop + 2;
    const total = n * this.fw + (n - 1) * 2;
    const x0 = (this.vw - total) / 2 + this.fw / 2;
    this.slots = this.flags.map((_, i) => x0 + i * (this.fw + 2));
    this.root.style.setProperty("--fw", `${this.fw}px`);
    this.rope.style.top = `${this.top - 1}px`;
    for (const f of this.flags) {
      f.el.style.width = `${this.fw}px`;
      f.el.style.height = `${this.fh}px`;
    }
    this.floor = this.measureFloor();
    this.renderAll();
  }

  /** 바닥: 아래 탭(5개 단추) 위 선 */
  private measureFloor() {
    const r = document.querySelector(".tabbar")?.getBoundingClientRect();
    return r && r.height > 0 ? r.top - 2 : window.innerHeight - 2;
  }

  private ext(a: number) {
    return { hx: Math.abs(Math.cos(a)) * (this.fw / 2) + Math.abs(Math.sin(a)) * (this.fh / 2), hy: Math.abs(Math.sin(a)) * (this.fw / 2) + Math.abs(Math.cos(a)) * (this.fh / 2) };
  }

  /** 그 자리 아래에 쌓인 깃발의 높이 (바닥 위 px) */
  private support(f: Flag, x: number, hx: number) {
    let s = 0;
    for (const g of this.flags) {
      if (g === f || g.st !== "pile") continue;
      const e = this.ext(g.tipTo);
      const ov = Math.min(x + hx, g.x + e.hx) - Math.max(x - hx, g.x - e.hx);
      if (ov > 0.35 * Math.min(2 * hx, 2 * e.hx)) s = Math.max(s, g.rest + e.hy * 2 * 0.82);
    }
    return s;
  }

  /** 걸린 깃발의 지금 몸 가운데 */
  private hangCenter(f: Flag) {
    const px = this.slots[f.i];
    const py = this.top + f.yb;
    return { x: px - Math.sin(f.th) * (this.fh / 2), y: py + Math.cos(f.th) * (this.fh / 2) };
  }

  private loosen(f: Flag, vx: number, vy: number) {
    if (f.st === "hang") {
      const c = this.hangCenter(f);
      f.x = c.x;
      f.y = c.y;
      f.a = f.th;
      f.el.classList.add("loose");
    }
    f.st = "fall";
    f.vx = vx;
    f.vy = vy;
    f.va = rnd(-14, 14);
  }

  /** 깃발 하나가 터지며 떨어진다 */
  private knock(f: Flag, n: number) {
    this.loosen(f, rnd(-110, 110), -rnd(90, 280));
    f.flyAt = 0;
    const fx = this.getFx();
    if (!fx) return;
    const s = 0.3 + Math.min(n, 50) * 0.006;
    fx.explode(f.x, f.y, pick(["star", "pixel", "ring", "crossette", "peony"]), [f.color, "#ffffff", pick(PALETTE)], s);
    fx.confetti(f.x, f.y, -Math.PI / 2, 1.4, 10 + Math.min(n, 40) / 4, [120, 320]);
  }

  /**
   * 스티커·풍선을 누를 때 (n = 지금 콤보). 걸린 깃발은 물결처럼 흔들리고, 콤보 3부터 깃발이 터지며 떨어진다 (3~7 한 번에 1개, 8~14 2개, 15~24 3개, 25 넘게 4개).
   * 15 넘게는 쌓인 깃발도 튀어 오르고 (30 넘게는 모두), 다시 걸리던 것은 멈춘다 (연타 중에는 안 올라간다)
   */
  hit(n: number) {
    if (this.still) return;
    this.floor = this.measureFloor();
    const now = performance.now();
    this.ropeV += 70 + Math.min(n, 40) * 4;
    const hung = this.flags.filter((f) => f.st === "hang");
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const f of hung) {
      f.kickAt = now + f.i * 22;
      f.kickOm = dir * (2.2 + Math.min(n, 40) * 0.2) * rnd(0.7, 1.3);
      f.kickV = 80 + Math.min(n, 40) * 6;
    }
    for (const f of this.flags) if (f.st !== "fly") f.flyAt = 0;
    const k = n < 3 ? 0 : n < 8 ? 1 : n < 15 ? 2 : n < 25 ? 3 : 4;
    const can = this.flags.filter((f) => f.st === "hang" || f.st === "fly");
    for (let j = 0; j < k && can.length; j++) {
      const f = can.splice(Math.floor(Math.random() * can.length), 1)[0];
      if (f.st === "fly") {
        f.x = f.bx;
        f.y = f.by;
      }
      this.knock(f, n);
    }
    if (n >= 15) {
      const share = n >= 30 ? 1 : 0.5;
      const fx = this.getFx();
      let sparks = 0;
      for (const f of this.flags) {
        if (f.st !== "pile" || Math.random() > share) continue;
        this.loosen(f, rnd(-120, 120), -rnd(220, 420) * (n >= 30 ? 1.35 : 1));
        if (fx && n >= 30 && sparks < 3 && Math.random() < 0.35) {
          sparks++;
          fx.explode(f.x, f.y - 10, pick(["pixel", "star"]), [f.color, "#fff27a"], 0.28);
        }
      }
    }
    this.kick();
  }

  /** 생일 메인 폭죽: 걸린 깃발이 크게 출렁인다 */
  shake(power = 1) {
    if (this.still) return;
    const now = performance.now();
    this.ropeV += 160 * power;
    for (const f of this.flags) {
      if (f.st !== "hang") continue;
      f.kickAt = now + f.i * 18;
      f.kickOm = (f.i % 2 ? 1 : -1) * 6 * power;
      f.kickV = 220 * power;
    }
    this.kick();
  }

  /** 연타가 멈추면: 쌓인 맨 위 것부터 하나씩 날아가 제자리에 걸린다 */
  end() {
    if (this.still) return;
    const loose = this.flags.filter((f) => f.st === "pile" || f.st === "fall");
    if (!loose.length) return;
    loose.sort((p, q) => (p.st === q.st ? q.order - p.order : p.st === "pile" ? -1 : 1));
    const now = performance.now();
    loose.forEach((f, k) => (f.flyAt = now + 200 + k * 130));
    this.kick();
  }

  private settle(f: Flag, support: number) {
    f.st = "pile";
    f.rest = support;
    f.vx = f.vy = f.va = 0;
    const base = Math.round((f.a - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
    f.tipTo = base + rnd(-0.28, 0.28);
    f.order = ++this.seq;
  }

  private startFly(f: Flag) {
    f.st = "fly";
    f.t = 0;
    f.dur = rnd(0.55, 0.75);
    f.sx = f.x;
    f.sy = f.y;
    // 각은 한 바퀴 더 돌며 0 으로
    const a = Math.atan2(Math.sin(f.a), Math.cos(f.a));
    f.sa = a;
    f.ta = (a > 0 ? 1 : -1) * Math.PI * 2;
    f.flyAt = 0;
    // 아래 쌓인 것이 빠지면 그 위 것은 받침을 다시 본다 (pile 루프에서)
  }

  private arrive(f: Flag) {
    f.st = "hang";
    f.th = 0;
    f.om = (Math.random() < 0.5 ? -1 : 1) * rnd(3.5, 6.5);
    f.yb = 0;
    f.vyb = rnd(160, 240);
    f.el.classList.remove("loose");
    const fx = this.getFx();
    if (fx) {
      fx.flash(this.slots[f.i], this.top + this.fh / 2, f.color, 10, 90);
      fx.ring(this.slots[f.i], this.top + this.fh / 2, "#fff6c8", 70, 0, 0.35);
    }
  }

  private kick() {
    if (this.raf || this.still) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (t: number) => {
    this.raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    let busy = false;
    // 줄
    this.ropeV += (-180 * this.ropeY - 9 * this.ropeV) * dt;
    this.ropeY += this.ropeV * dt;
    this.ropeY = Math.max(-4, Math.min(10, this.ropeY));
    if (Math.abs(this.ropeY) > 0.05 || Math.abs(this.ropeV) > 0.5) busy = true;
    else this.ropeY = this.ropeV = 0;
    this.rope.style.transform = `translate3d(0, ${this.ropeY.toFixed(2)}px, 0)`;
    let pileLeft = false;
    for (const f of this.flags) {
      if (f.st === "hang") {
        if (f.kickAt && t >= f.kickAt) {
          f.om += f.kickOm;
          f.vyb += f.kickV;
          f.kickAt = 0;
        }
        f.om += (-38 * f.th - 2.6 * f.om) * dt;
        f.th = Math.max(-1.3, Math.min(1.3, f.th + f.om * dt));
        f.vyb += (-260 * f.yb - 11 * f.vyb) * dt;
        f.yb = Math.max(-6, Math.min(16, f.yb + f.vyb * dt));
        if (f.kickAt || Math.abs(f.th) > 0.003 || Math.abs(f.om) > 0.02 || Math.abs(f.yb) > 0.1 || Math.abs(f.vyb) > 1) busy = true;
        else f.th = f.om = f.yb = f.vyb = 0;
      } else if (f.st === "fall") {
        busy = true;
        f.vy += G * dt;
        f.vx *= 1 - 0.5 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.a += f.va * dt;
        const e = this.ext(f.a);
        if (f.x < e.hx) {
          f.x = e.hx;
          f.vx = Math.abs(f.vx) * 0.5;
        } else if (f.x > this.vw - e.hx) {
          f.x = this.vw - e.hx;
          f.vx = -Math.abs(f.vx) * 0.5;
        }
        if (f.vy > 0) {
          const s = this.support(f, f.x, e.hx);
          const bottom = this.floor - s;
          if (f.y + e.hy >= bottom) {
            f.y = bottom - e.hy;
            if (f.vy > 260) {
              f.vy = -f.vy * 0.3;
              f.vx *= 0.55;
              f.va *= 0.5;
            } else this.settle(f, s);
          }
        }
        if (f.flyAt && t >= f.flyAt) this.startFly(f);
      } else if (f.st === "pile") {
        const d = f.tipTo - f.a;
        if (Math.abs(d) > 0.002) {
          f.a += d * Math.min(1, dt * 12);
          busy = true;
        } else f.a = f.tipTo;
        f.y = this.floor - f.rest - this.ext(f.a).hy;
        if (f.flyAt) {
          busy = true;
          if (t >= f.flyAt) {
            this.startFly(f);
            pileLeft = true;
          }
        }
      } else {
        busy = true;
        f.t += dt / f.dur;
        const tx = this.slots[f.i];
        const ty = this.top + this.fh / 2;
        if (f.t >= 1) {
          f.x = tx;
          f.y = ty;
          this.arrive(f);
        } else {
          // 위로 솟구쳐 휘어 들어가 걸린다 (2차 베지어)
          const e = 1 - Math.pow(1 - f.t, 3);
          const cx = f.sx + (tx - f.sx) * 0.15 + (f.i % 2 ? 70 : -70);
          const cy = ty + (f.sy - ty) * 0.2;
          const u = 1 - e;
          f.x = u * u * f.sx + 2 * u * e * cx + e * e * tx;
          f.y = u * u * f.sy + 2 * u * e * cy + e * e * ty;
          f.a = f.sa + (f.ta - f.sa) * e;
          f.bx = f.x;
          f.by = f.y;
        }
      }
    }
    // 아래 것이 빠져 받침이 없어진 깃발은 다시 떨어진다
    if (pileLeft || this.flags.some((f) => f.st === "fall"))
      for (const f of this.flags) {
        if (f.st !== "pile") continue;
        const e = this.ext(f.tipTo);
        if (this.support(f, f.x, e.hx) < f.rest - 2) {
          const keep = f.flyAt;
          this.loosen(f, 0, 0);
          f.flyAt = keep;
          busy = true;
        }
      }
    this.renderAll();
    if (busy) this.raf = requestAnimationFrame(this.tick);
  };

  private renderAll() {
    const h2 = this.fh / 2;
    for (const f of this.flags) {
      let px: number;
      let py: number;
      let a: number;
      if (f.st === "hang") {
        px = this.slots[f.i] ?? 0;
        py = this.top + f.yb;
        a = f.th;
      } else {
        a = f.a;
        px = f.x + Math.sin(a) * h2;
        py = f.y - Math.cos(a) * h2;
      }
      f.el.style.transform = `translate3d(${(px - this.fw / 2).toFixed(1)}px, ${py.toFixed(1)}px, 0) rotate(${a.toFixed(3)}rad)`;
    }
  }
}
