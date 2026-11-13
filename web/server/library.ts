// 자료 저장소 전체를 챗봇이 읽는다 (제작자 2026-11-10 '앞으로 내가 올리는 데이터들은 모조리 아이모 데이터 레포에 넣고, 챗봇은 새로운 데이터가 레포에 등록되면
// 내가 별다른 말 안 해도 그걸 모조리 읽어서 답변하는 데 활용해').
// 자료 저장소의 글 파일은 scripts/library-sync.mjs 가 조각으로 D1 lib_chunks 에 넣는다 (저장소 main 이 바뀌면 30분 안에, data-watch.yml).
// 여기서는 질문 낱말이 든 조각을 골라 '<길드 자료 저장소>' 로 붙인다. 조각 글은 자르지 않는다 (CLAUDE.md 'AI 는 무조건 품질'), 몇 조각을 붙일지만 고른다.
// 길드/ 아래(staff 1)는 운영진(오피서 이상)에게만.
import { RANK } from "./auth";
import type { Env, User } from "./auth";
import { ASK_WORD } from "./official";
import { slangOf } from "./officialImages";

/** 한 질문에 붙이는 조각 수, 한 파일에서 몇 조각까지, 카톡에서 몇 조각까지 */
const TAKE = 10;
const PER_FILE = 4;
const PER_TALK = 4;

const PARTICLE = /(은|는|이|가|을|를|에|의|도|로|으로|에서|에게|한테|께|부터|까지|처럼|보다|이나|이랑|랑|하고|만|요|야|좀|이야|인데|이에요|예요)$/;

/** 질문에서 찾을 낱말 (묻는 말과 조사는 뺀다) */
export function libraryWords(question: string): string[] {
  const words = (q: string) =>
    q
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.replace(PARTICLE, ""))
      .filter((w) => w.length >= 2 && !ASK_WORD.test(w));
  return [...new Set([...words(question), ...words(slangOf(question))])].slice(0, 12);
}

interface Hit {
  path: string;
  part: number;
  s: number;
}

async function chunkCount(env: Env, staff: number): Promise<number> {
  const key = new Request(`https://cache.sapphire/lib-count/v1/${staff}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return Number(await hit.text()) || 0;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lib_chunks WHERE staff <= ?").bind(staff).first<{ n: number }>())?.n ?? 0;
  await cache.put(key, new Response(String(n), { headers: { "cache-control": "max-age=86400" } })).catch(() => undefined);
  return n;
}

export async function libraryContext(env: Env, me: User, question: string): Promise<string> {
  const words = libraryWords(question);
  if (!words.length) return "";
  const staff = RANK[me.role] >= 1 ? 1 : 0;
  // 조각마다 어느 낱말이 들었는지만 받는다 (글은 고른 뒤에, 요청 CPU 한도). 드문 낱말일수록 무겁게 (흔한 '시세', '얼마' 보다 '사멧')
  const flags = words.map((_, i) => `(instr(text, ?${i + 2}) > 0) AS w${i}`).join(", ");
  const any = words.map((_, i) => `instr(text, ?${i + 2}) > 0`).join(" OR ");
  let rows: Record<string, number | string>[];
  let total = 0;
  try {
    // 조각 수는 배포 때만 바뀌어 하루 캐시 (2026-11-14 D1 하루 읽기: 질문마다 5천 줄을 셌다)
    const [r, n] = await Promise.all([
      env.DB.prepare(`SELECT path, part, ${flags} FROM lib_chunks WHERE staff <= ?1 AND (${any})`).bind(staff, ...words).all(),
      chunkCount(env, staff),
    ]);
    rows = r.results as Record<string, number | string>[];
    total = n;
  } catch {
    return ""; // 아직 표가 없다 (자료를 한 번도 넣기 전)
  }
  const df = words.map((_, i) => rows.filter((r) => r[`w${i}`]).length);
  const weight = df.map((d) => (d ? Math.log((total + 1) / d) : 0));
  const hits: Hit[] = rows
    .map((r) => ({ path: String(r.path), part: Number(r.part), s: words.reduce((t, _, i) => t + (r[`w${i}`] ? weight[i] : 0), 0) }))
    .sort((a, b) => b.s - a.s || a.path.localeCompare(b.path) || a.part - b.part);
  if (!hits.length) return "";
  const perFile = new Map<string, number>();
  let talk = 0;
  const pick: Hit[] = [];
  for (const h of hits) {
    if (pick.length >= TAKE) break;
    const n = perFile.get(h.path) ?? 0;
    if (n >= PER_FILE) continue;
    const isTalk = h.path.startsWith("카톡/");
    if (isTalk && talk >= PER_TALK) continue;
    perFile.set(h.path, n + 1);
    if (isTalk) talk++;
    pick.push(h);
  }
  const texts = await env.DB.prepare(
    `SELECT path, part, text FROM lib_chunks WHERE (path, part) IN (${pick.map(() => "(?, ?)").join(", ")})`,
  )
    .bind(...pick.flatMap((h) => [h.path, h.part]))
    .all<{ path: string; part: number; text: string }>();
  const byKey = new Map(texts.results.map((t) => [`${t.path}#${t.part}`, t.text]));
  const files = await env.DB.prepare(
    `SELECT path, parts, updated_at FROM lib_files WHERE path IN (${[...perFile.keys()].map(() => "?").join(", ")})`,
  )
    .bind(...perFile.keys())
    .all<{ path: string; parts: number; updated_at: number }>();
  const info = new Map(files.results.map((f) => [f.path, f]));
  // 같은 파일 조각은 붙여서 순서대로
  const order = [...perFile.keys()];
  const out: string[] = [`찾은 낱말: ${words.join(", ")}`];
  for (const path of order) {
    const f = info.get(path);
    const day = f ? new Date(f.updated_at + 9 * 3_600_000).toISOString().slice(0, 10) : "";
    const parts = pick.filter((h) => h.path === path).sort((a, b) => a.part - b.part);
    for (const h of parts) {
      const text = byKey.get(`${h.path}#${h.part}`);
      if (!text) continue;
      out.push(`[자료: ${path}${f && f.parts > 1 ? ` (${h.part + 1}/${f.parts})` : ""}${day ? ` · 넣은 날 ${day}` : ""}]\n${text}`);
    }
  }
  return out.length > 1 ? out.join("\n\n") : "";
}
