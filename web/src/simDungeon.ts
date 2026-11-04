// 확률 시뮬레이터의 던전 (제작자 요청 2026-11-04: 방치형 게임 스샷을 보이며 '이런 식으로 가능? 내가 강화한 거 입히는 거임', '디자인은 우리랑 어울리게').
// 강화 칸에서 들고 있는 무기·방어구(부서지지 않은 것)를 입고 1층부터 내려간다. 층마다 위키 몬스터(층 = 몬스터 레벨 근처), 10층마다 보스.
// 몬스터 체력은 위키 체력 그대로, 내 한 방은 무기 데미지(강화 가산값 포함) x 그 층의 배율(그 레벨에 맞는 +0 무기면 보통 몬스터를 4번쯤에 잡는다).
// 그래서 무기를 강화하거나 높은 레벨 무기를 사면 더 깊이 간다. 방어구는 받는 피해를 줄인다. 쓰러지면 끝, 최고 층이 순위.
// 이 파일은 화면 없이 셈만 한다 (node 로도 시험한다): 화면은 pages/SimDungeon.tsx.

export interface DunMonster {
  name: string;
  level: number;
  hp: number;
  img: { src: string; w: number; h: number } | null;
}
/** 무기·방어구 하나 (simGear.ts 의 Gear 에서 셈에 쓰는 것만) */
export interface DunGear {
  name: string;
  lv: number;
  /** 무기: 강화한 데미지 최소·최대, 방어구: 강화한 방어도 */
  min: number;
  max: number;
  def: number;
}
export interface Hero {
  weapon: DunGear | null;
  armor: DunGear | null;
}

/** 레벨마다 보통 몬스터 체력(가운데 값)과 몬스터 목록 */
export interface Bands {
  med: (lv: number) => number;
  pool: (lv: number) => DunMonster[];
  top: number;
}
export function bandsOf(monsters: DunMonster[]): Bands {
  const ok = monsters.filter((m) => m.level >= 1 && m.hp >= 1 && m.img);
  const top = Math.max(...ok.map((m) => m.level), 1);
  const near = (lv: number, r: number) => ok.filter((m) => Math.abs(m.level - lv) <= r);
  // 레벨마다 아래쪽 40% 자리 체력 (보스·이름난 몬스터가 섞여도 덜 튀게), 레벨이 오를수록 줄지 않고 한 레벨에 15% 넘게 뛰지 않게 다듬는다
  const raw = (l: number) => {
    let r = 2;
    let xs = near(l, r);
    while (xs.length < 5 && r < 12) xs = near(l, ++r);
    const hs = xs.map((m) => m.hp).sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length * 0.4)] : 10;
  };
  const meds: number[] = [0];
  for (let l = 1; l <= top; l++) {
    const prev = meds[l - 1] || raw(1);
    meds[l] = l === 1 ? raw(1) : Math.min(Math.max(raw(l), prev), prev * 1.15);
  }
  const med = (lv: number) => meds[Math.min(top, Math.max(1, Math.round(lv)))];
  const pool = (lv: number) => {
    const l = Math.min(top, Math.max(1, Math.round(lv)));
    let r = 2;
    let xs = near(l, r);
    while (xs.length < 3 && r < 12) xs = near(l, ++r);
    return xs;
  };
  return { med, pool, top };
}

/** 그 레벨에 맞는 무기의 평균 데미지(+0)와 방어구의 방어도: 직업 목록에서 그 레벨까지 산 가장 좋은 것 */
export interface Refs {
  dmg: (lv: number) => number;
  def: (lv: number) => number;
}
export function refsOf(weapons: { lv: number; avg: number }[], armors: { lv: number; def: number }[]): Refs {
  const best = (xs: { lv: number; v: number }[], lv: number, fallback: number) => {
    const ok = xs.filter((x) => x.lv <= lv);
    if (ok.length) return Math.max(...ok.map((x) => x.v));
    return xs.length ? Math.min(...xs.map((x) => x.v)) : fallback;
  };
  const w = weapons.map((x) => ({ lv: x.lv, v: x.avg }));
  const a = armors.map((x) => ({ lv: x.lv, v: x.def }));
  return { dmg: (lv) => best(w, lv, 5), def: (lv) => best(a, lv, 2) };
}

export const BOSS_EVERY = 10;
/** 그 레벨에 맞는 +0 무기로 보통 몬스터를 몇 번에 잡나 */
const PAR_HITS = 3;
export const HERO_HP = 100;
/** 한 번 맞을 때 잃는 체력 (최대 체력의 몇 %, 맞는 방어구일 때) */
const HIT_PCT = 0.07;
const BOSS_HIT = 1.3;
/** 층을 깨면 최대 체력의 몇 %를 채운다 (보스는 다 채운다) */
const REGEN = 0.12;
export const HERO_GAP = 550;
export const MON_GAP = 1100;
const CRIT = 0.1;

export interface Foe {
  floor: number;
  boss: boolean;
  name: string;
  level: number;
  hp: number;
  img: DunMonster["img"];
  /** 내 한 방에 곱하는 배율 (그 층의 무기 기준) */
  mult: number;
  /** 한 번 맞을 때 잃는 체력 */
  hit: number;
}

/** 층의 몬스터: 층 = 몬스터 레벨 (위키 끝 레벨을 넘으면 그 위로 층마다 체력 8%), 10층마다 그 레벨대에서 가장 센 몬스터(체력은 보통의 2.5~4배) */
export function foeFor(floor: number, bands: Bands, refs: Refs, hero: Hero, rnd: () => number = Math.random): Foe {
  const lv = Math.min(floor, bands.top);
  const over = Math.max(0, floor - bands.top);
  const med = bands.med(lv);
  const pool = bands.pool(lv);
  const boss = floor % BOSS_EVERY === 0;
  let m: DunMonster;
  let hp: number;
  if (boss) {
    const strong = [...pool].sort((a, b) => b.hp - a.hp)[0];
    m = strong ?? pool[0];
    hp = Math.min(Math.max(m.hp, med * 2.5), med * 4);
  } else {
    const normal = pool.filter((x) => x.hp <= med * 3);
    const xs = normal.length ? normal : pool;
    m = xs[Math.floor(rnd() * xs.length)];
    hp = m.hp;
  }
  hp = Math.round(hp * Math.pow(1.08, over));
  // 깊이 갈수록 같은 무기로도 더 많이 때려야 하고(층마다 2.5%) 더 아프게 맞는다(층마다 2%)
  const mult = med / (PAR_HITS * Math.pow(1.025, floor) * refs.dmg(lv));
  const def = hero.armor?.def ?? 0;
  const ref = refs.def(lv);
  // 방어구: 그 레벨에 맞는 방어도면 1배, 좋을수록 덜 맞고(0.5배까지) 없거나 낮으면 더 맞는다(1.6배까지)
  const armorF = Math.min(1.6, Math.max(0.5, (ref + 6) / (def + 6)));
  const hit = HERO_HP * HIT_PCT * armorF * (boss ? BOSS_HIT : 1) * Math.pow(1.02, floor) * Math.pow(1.04, over);
  return { floor, boss, name: m.name, level: m.level, hp, img: m.img, mult, hit };
}

/** 내 한 방 (무기가 없으면 맨손 1~3) */
export function heroHit(hero: Hero, foe: Foe, rnd: () => number = Math.random): { dmg: number; crit: boolean } {
  const lo = hero.weapon?.min ?? 1;
  const hi = hero.weapon?.max ?? 3;
  const crit = rnd() < CRIT;
  const base = lo + (hi - lo) * rnd();
  return { dmg: Math.max(1, Math.round(base * foe.mult * (crit ? 2 : 1))), crit };
}

/** 층을 깨고 채우는 체력 (보스는 다 채운다), 보스 층에 들어갈 때 30% 더 */
export const regenAfter = (foe: Foe, hp: number) => (foe.boss ? HERO_HP : Math.min(HERO_HP, hp + HERO_HP * (REGEN + ((foe.floor + 1) % BOSS_EVERY === 0 ? 0.3 : 0))));

/** 화면 없이 한 판 끝까지 (시험·어림): 쓰러진 층 */
export function simulateRun(bands: Bands, refs: Refs, hero: Hero, rnd: () => number = Math.random, cap = 400): number {
  let hp = HERO_HP;
  for (let f = 1; f <= cap; f++) {
    const foe = foeFor(f, bands, refs, hero, rnd);
    let mhp = foe.hp;
    let t = 0;
    let nextHero = HERO_GAP;
    let nextMon = MON_GAP;
    while (mhp > 0) {
      if (nextHero <= nextMon) {
        t = nextHero;
        mhp -= heroHit(hero, foe, rnd).dmg;
        nextHero += HERO_GAP;
      } else {
        t = nextMon;
        hp -= foe.hit;
        if (hp <= 0) return f;
        nextMon += MON_GAP;
      }
    }
    void t;
    hp = regenAfter(foe, hp);
  }
  return cap;
}
