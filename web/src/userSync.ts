// 화면 기록 서버 저장 (제작자 2026-11-19 '여기 말고도 다른 메뉴들도 설마 로컬에만 남는 거 아니지? 모든 거를 서버에 기록을 하면 좋을 것 같아'):
// 여러 화면이 이 기기(localStorage)에 적어 두던 것 중 사람의 기록인 것(도감 내 수치·다른 캐릭 수치·보기 칸, 새 글 배지 본 때, UPDATE 표 본 메뉴,
// 튜토리얼 본 메뉴, 최근 검색어, 배경 설정, '다시 안 보기', 상점 예산 칸)을 캐릭터마다 계정에도 둔다 (functions/api/kv.ts, D1 user_kv).
// 화면 코드는 그대로 localStorage 를 쓰고, 여기서 localStorage.setItem·removeItem 을 지켜보다가 정한 열쇠(SYNC)만 3초 모아 서버로 보낸다.
// 앱을 열 때는 /api/me 와 같이 서버 값을 받아(2.5초까지 기다림) localStorage 에 먼저 넣은 뒤 화면을 그린다.
// 두 기기가 같이 고치면 늦게 고친 쪽이 이기고, 배지 본 때·튜토리얼 본 메뉴처럼 모아 두는 것은 합친다.
// 기기마다 따로여야 하는 것은 넣지 않는다: 기기 표(sapphire.dev), 로그인 열쇠, 받은 판, 설치 아이콘, 폰 알림, 날씨 위치(서버에 안 보낸다고 한 것),
// 생일 스티커 자리(화면 크기마다), 이미 따로 서버에 두는 것(도감 완료 체크, 홈 배치, 헬스 하는 중인 운동, 시뮬레이터 진행).

type Mode = "lww" | "max" | "set" | "at";
/** 열쇠 앞부분 -> 합치는 방법 (lww: 늦게 고친 쪽, max: {이름: 때} 의 큰 값, set: 배열 합집합, at: {이름: {at}} 의 늦은 것) */
const SYNC: [string, Mode][] = [
  ["sapphire.dex.have.", "lww"],
  ["sapphire.dex.other.", "lww"],
  ["sapphire.dex.mode.", "lww"],
  ["sapphire.dex.ev2.", "lww"],
  ["sapphire.newsSeen.", "max"],
  ["sapphire.newsThing.", "max"],
  ["sapphire.menuSeen.", "at"],
  ["sapphire.tut.seen", "set"],
  ["sapphire.recentSearch", "lww"],
  ["sapphire.bg.", "lww"],
  ["sapphire.openingNever.", "lww"],
  ["sapphire.rent.notice.", "lww"],
  ["sapphire.enh.dragHint2", "lww"],
  ["sapphire.gd.cols.", "lww"],
  ["sapphire-store-off", "lww"],
  ["sapphire-won-gold", "lww"],
];
const modeOf = (k: string): Mode | null => SYNC.find(([p]) => k === p || k.startsWith(p))?.[1] ?? null;

/** 열쇠마다 이 기기에서 마지막으로 고친 때 (서버와 견준다) */
const AT_KEY = "sapphire.kvAt";
const FLUSH_MS = 3000;
const WAIT_MS = 2500;

let rawSet: (k: string, v: string) => void = () => undefined;
let rawRemove: (k: string) => void = () => undefined;
let rawGet: (k: string) => string | null = () => null;
let ats: Record<string, number> = {};
const dirty = new Map<string, number>();
let timer = 0;
let ready = false;
let installed = false;

function readAts() {
  try {
    ats = JSON.parse(rawGet(AT_KEY) ?? "{}") as Record<string, number>;
  } catch {
    ats = {};
  }
}
function saveAts() {
  try {
    rawSet(AT_KEY, JSON.stringify(ats));
  } catch {
    /* 못 적으면 다음에 서버 값이 이긴다 */
  }
}

/** localStorage.setItem·removeItem 을 지켜본다 (Storage 원형에 건다: localStorage.setItem = … 은 그 이름의 항목을 만든다) */
function install() {
  if (installed || typeof Storage === "undefined") return;
  installed = true;
  const proto = Storage.prototype;
  const set = proto.setItem;
  const remove = proto.removeItem;
  const get = proto.getItem;
  let ls: Storage | null = null;
  try {
    ls = window.localStorage;
  } catch {
    return;
  }
  rawSet = (k, v) => set.call(ls, k, v);
  rawRemove = (k) => remove.call(ls, k);
  rawGet = (k) => get.call(ls, k);
  readAts();
  proto.setItem = function (this: Storage, k: string, v: string) {
    const before = this === ls && modeOf(k) ? get.call(this, k) : undefined;
    set.call(this, k, v);
    if (this === ls && modeOf(k) && before !== String(v)) touch(k);
  };
  proto.removeItem = function (this: Storage, k: string) {
    const had = this === ls && modeOf(k) ? get.call(this, k) !== null : false;
    remove.call(this, k);
    if (had) touch(k);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
}

function touch(k: string) {
  const at = Date.now();
  ats[k] = at;
  saveAts();
  dirty.set(k, at);
  if (!ready) return; // 서버 값을 받기 전에는 모아만 둔다 (받고 나서 합쳐 보낸다)
  window.clearTimeout(timer);
  timer = window.setTimeout(() => flush(false), FLUSH_MS);
}

function flush(leaving: boolean) {
  window.clearTimeout(timer);
  if (!ready || !dirty.size) return;
  const items = [...dirty].slice(0, 40).map(([k, at]) => ({ k, v: rawGet(k), at }));
  for (const { k } of items) dirty.delete(k);
  void fetch("/api/kv", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
    credentials: "same-origin",
    keepalive: leaving,
  }).then(
    (r) => {
      if (!r.ok && r.status !== 400 && r.status !== 401) for (const x of items) if (!dirty.has(x.k)) dirty.set(x.k, x.at);
      if (dirty.size && !leaving) timer = window.setTimeout(() => flush(false), FLUSH_MS);
    },
    () => {
      // 인터넷이 끊겼으면 다음에 다시
      for (const x of items) if (!dirty.has(x.k)) dirty.set(x.k, x.at);
    },
  );
}

function parse(v: string | null): unknown {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
/** 모아 두는 열쇠 합치기 (못 합치면 null: 늦은 쪽을 쓴다) */
function merge(mode: Mode, a: string | null, b: string | null): string | null {
  const x = parse(a);
  const y = parse(b);
  if (mode === "set" && Array.isArray(x) && Array.isArray(y)) return JSON.stringify([...new Set([...x, ...y])]);
  const obj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o);
  if ((mode === "max" || mode === "at") && obj(x) && obj(y)) {
    const out: Record<string, unknown> = { ...x };
    for (const [k, w] of Object.entries(y)) {
      const u = out[k];
      if (mode === "max") out[k] = typeof u === "number" && typeof w === "number" ? Math.max(u, w) : u ?? w;
      else {
        const ua = obj(u) && typeof u.at === "number" ? u.at : -1;
        const wa = obj(w) && typeof w.at === "number" ? w.at : -1;
        out[k] = wa > ua ? w : u ?? w;
      }
    }
    return JSON.stringify(out);
  }
  return null;
}

/** 로그아웃할 때: 남은 것을 보내고 다음 로그인까지 쉰다 */
export function resetUserSync() {
  flush(true);
  ready = false;
  dirty.clear();
}

/** 서버 값을 받아 이 기기에 넣는다. 앱을 열 때 /api/me 와 같이, 로그인한 뒤에 부르고, 2.5초가 넘으면 기다리지 않는다 (늦게 와도 넣는다) */
export function loadUserSync(): Promise<void> {
  install();
  if (!installed) return Promise.resolve();
  const job = fetch("/api/kv", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ items: [string, string | null, number][] }>) : null))
    .then((d) => {
      if (d) apply(d.items);
      ready = !!d;
      if (ready && dirty.size) flush(false);
    })
    .catch(() => undefined);
  return Promise.race([job, new Promise<void>((ok) => window.setTimeout(ok, WAIT_MS))]);
}

function apply(items: [string, string | null, number][]) {
  const seen = new Set<string>();
  const changed: string[] = [];
  for (const [k, sv, sat] of items) {
    const mode = modeOf(k);
    if (!mode) continue;
    seen.add(k);
    const lv = rawGet(k);
    const lat = ats[k] ?? 0;
    if (lv === sv) {
      ats[k] = Math.max(lat, sat);
      continue;
    }
    const m = mode !== "lww" && lv != null && sv != null ? merge(mode, lv, sv) : null;
    if (m != null) {
      if (m !== lv) {
        rawSet(k, m);
        changed.push(k);
      }
      if (m !== sv) dirty.set(k, Math.max(Date.now(), sat + 1));
      ats[k] = Math.max(Date.now(), sat + 1, lat);
      continue;
    }
    if (sat > lat) {
      // 서버가 늦다: 이 기기에 넣는다 (지운 것이면 지운다)
      if (sv == null) rawRemove(k);
      else rawSet(k, sv);
      ats[k] = sat;
      dirty.delete(k);
      changed.push(k);
    } else if (lat > sat) dirty.set(k, lat);
  }
  // 서버에 없는 이 기기 기록: 처음 올린다 (예전부터 이 기기에만 있던 것)
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || seen.has(k) || !modeOf(k) || rawGet(k) == null) continue;
      if (!ats[k]) ats[k] = 1;
      dirty.set(k, ats[k]);
    }
  } catch {
    /* 못 읽으면 다음에 */
  }
  saveAts();
  if (changed.length) window.dispatchEvent(new CustomEvent("sapphire:kv", { detail: changed }));
}

/** 서버 값을 받아 넣은 열쇠를 다시 읽어야 하는 곳(이미 읽어 둔 것)에서 */
export function onUserSync(fn: (keys: string[]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string[]>).detail);
  window.addEventListener("sapphire:kv", h);
  return () => window.removeEventListener("sapphire:kv", h);
}
