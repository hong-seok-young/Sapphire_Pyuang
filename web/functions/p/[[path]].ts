// 정산서 링크 (로그인 없이): GET /p/<token> -> 그 정산 하나의 정산서 페이지, GET /p/<token>/i/<그림 번호> -> 그 정산 기록의 증거 사진.
// 링크는 화면의 '정산서 보내기'가 만든다 (api/diary/share.ts, 표 diary_shares). 앱 화면·코드를 받지 않는 글 한 장이라 길드 이름도 없다.
// 토큰을 모르면 404. 사용 기록에 남지 않는다 (/api 밖이라 사용 기록 미들웨어를 안 거친다).
import type { Env } from "../../server/auth";
import { blobBytes } from "../../server/auth";
import { diaryOwner, perPct } from "../../server/diary";
import type { Rate } from "../../server/diary";

interface Row {
  id: number;
  day: string;
  lv_from: number;
  exp_from: number;
  t_from: string;
  lv_to: number;
  exp_to: number;
  t_to: string;
  won: number | null;
  rate: number | null;
}
interface Settle {
  id: number;
  at: number;
  runs: number;
  sum: number;
  carry_in: number;
  pay: number;
  carry_out: number;
}

const NOT = () => new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dayText = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} (${WEEK[new Date(Date.parse(d + "T12:00:00+09:00")).getUTCDay()]})`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const week = (d: string) => WEEK[new Date(Date.parse(d + "T12:00:00+09:00")).getUTCDay()];
const hm = (t: string) => t.slice(0, 5);
const kstDay = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const pct = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
const gain = (r: Row) => (r.lv_to - r.lv_from) * 100 + r.exp_to - r.exp_from;
const num = (n: number) => String(Math.round(n * 1000) / 1000);
/** 단가 글: 1시간 시험으로 정한 단가는 '4.499%에 7,000원', 그 밖은 '5%에 5,000원' */
const priceText = (rates: Rate[], level: number | null, p: number) => {
  const r = level === null ? undefined : rates.find((x) => x.level === level);
  if (r && !(r.per_pct && r.per_pct > 0) && r.per_hour && r.test_pct) return `${num(r.test_pct)}%에 ${won(r.per_hour)}원`;
  return `5%에 ${won(p * 5)}원`;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const parts = ([] as string[]).concat(params.path ?? []);
  const token = parts[0] ?? "";
  if (!/^[\w-]{16,40}$/.test(token)) return NOT();
  const share = await env.DB.prepare("SELECT settle_id FROM diary_shares WHERE token = ?").bind(token).first<{ settle_id: number }>();
  if (!share) return NOT();

  // 사진: 그 정산의 기록 것만
  if (parts.length === 3 && parts[1] === "i") {
    const sid = Number(parts[2]);
    if (!Number.isInteger(sid)) return NOT();
    const shot = await env.DB.prepare(
      "SELECT s.type, s.data FROM diary_shots s JOIN diary_runs r ON r.id = s.run_id WHERE s.id = ? AND r.settle_id = ?",
    )
      .bind(sid, share.settle_id)
      .first<{ type: string; data: unknown }>();
    if (!shot) return NOT();
    return new Response(blobBytes(shot.data), {
      headers: { "content-type": shot.type, "cache-control": "private, max-age=86400", "x-robots-tag": "noindex" },
    });
  }
  if (parts.length !== 1) return NOT();

  const [settle, rateRows, runs, shots] = await Promise.all([
    env.DB.prepare("SELECT id, at, runs, sum, carry_in, pay, carry_out FROM diary_settles WHERE id = ?").bind(share.settle_id).first<Settle>(),
    env.DB.prepare("SELECT level, per_pct, per_hour, test_pct FROM diary_rates").all<Rate>(),
    env.DB.prepare(
      "SELECT id, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, won, rate FROM diary_runs WHERE settle_id = ? ORDER BY day, lv_from, exp_from, id",
    )
      .bind(share.settle_id)
      .all<Row>(),
    env.DB.prepare("SELECT s.id, s.run_id, s.side FROM diary_shots s JOIN diary_runs r ON r.id = s.run_id WHERE r.settle_id = ?")
      .bind(share.settle_id)
      .all<{ id: number; run_id: number; side: string }>(),
  ]);
  if (!settle) return NOT();
  const pic = new Map<string, number>(shots.results.map((s) => [`${s.run_id}:${s.side}`, s.id]));
  const base = `/p/${token}/i/`;
  const total = settle.sum + settle.carry_in;
  const totalGain = runs.results.reduce((t, r) => t + gain(r), 0);

  const rates = rateRows.results;
  // 이 정산에 든 레벨의 단가 (줄마다 따로 정한 단가는 그 줄에)
  const levels = [...new Set(runs.results.filter((r) => !(r.rate && r.rate > 0)).flatMap((r) => Array.from({ length: r.lv_to - r.lv_from + 1 }, (_, k) => r.lv_from + k)))].sort((a, b) => a - b);
  const priceRows = levels
    .map((lv) => {
      const p = perPct(rates, lv);
      if (p === null) return "";
      return `<div><span>Lv.${lv}</span><span><b>${priceText(rates, lv, p)}</b><small>1%당 ${won(p)}원</small></span></div>`;
    })
    .join("");
  // 줄마다 단가: 그 줄만 정한 단가, 한 레벨이면 그 레벨 단가, 레벨이 오른 줄은 레벨마다
  const rowPrice = (r: Row, per: number) => {
    if (r.rate && r.rate > 0) return esc(priceText(rates, null, r.rate));
    if (r.lv_from === r.lv_to) return `Lv.${r.lv_from} ${esc(priceText(rates, r.lv_from, perPct(rates, r.lv_from) ?? per))}`;
    return Array.from({ length: r.lv_to - r.lv_from + 1 }, (_, k) => r.lv_from + k)
      .map((lv) => {
        const p = perPct(rates, lv);
        return p === null ? `Lv.${lv} ?` : `Lv.${lv} ${esc(priceText(rates, lv, p))}`;
      })
      .join(" · ");
  };
  const owner = diaryOwner(env);
  const pos = (lv: number, exp: number) => lv * 100 + exp;
  const rows = runs.results
    .map((r, i) => {
      // 앞 기록 끝과 이 기록 시작 사이가 비면 그 구간은 본주가 직접 한 것
      const before = runs.results[i - 1];
      const jump = before ? pos(r.lv_from, r.exp_from) - pos(before.lv_to, before.exp_to) : 0;
      const gapRow =
        before && jump > 0.0005
          ? `<div class="gap"><span>${esc(owner ? owner + "님이 직접" : "본주가 직접")}</span><span>${before.lv_to} · ${pct(before.exp_to)} → ${r.lv_from} · ${pct(r.exp_from)}</span><span>+${pct(jump)}</span><span>-</span></div>`
          : "";
      const g = gain(r);
      const w = r.won ?? 0;
      const per = g > 0 ? w / g : 0;
      const img = (side: string, name: string) => {
        const id = pic.get(`${r.id}:${side}`);
        return id
          ? `<figure><a href="${base}${id}" target="_blank" rel="noopener"><img src="${base}${id}" alt="${name} 사진"></a><figcaption>${name}</figcaption></figure>`
          : `<figure><span class="none">사진 없음</span><figcaption>${name}</figcaption></figure>`;
      };
      return `${gapRow}<div class="run">
<div class="tr">
<span class="d">${esc(md(r.day))}<small>${esc(week(r.day))}</small></span>
<span>${r.lv_from} · ${pct(r.exp_from)}${r.t_from ? `<small>${esc(hm(r.t_from))}</small>` : ""}</span>
<span>${r.lv_to} · ${pct(r.exp_to)}${r.t_to ? `<small>${esc(hm(r.t_to))}</small>` : ""}</span>
<span class="g">+${pct(g)}</span>
<span class="w">${won(w)}</span>
</div>
<div class="u">단가 ${rowPrice(r, per)}</div>
<div class="shots">${img("from", "시작")}${img("to", "끝")}</div>
</div>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>정산서 ${esc(dayText(kstDay(settle.at)))}</title>
<link rel="preload" href="/fonts/Galmuri11.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:Galmuri11;src:url(/fonts/Galmuri11.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Galmuri11;src:url(/fonts/Galmuri11-Bold.woff2) format("woff2");font-weight:700;font-display:swap}
:root{--panel:#262150;--edge:#07060f;--hi:#4a3f86;--text:#f3f0ff;--muted:#a9a2cf;--gold:#ffc35c;--won:#f2c94c;--green:#4fd18b;--px:2px;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0}
body{background:#141831;background-image:radial-gradient(1px 1px at 20% 12%,#6e85e2 50%,transparent 51%),radial-gradient(1px 1px at 72% 6%,#c6d5ff 50%,transparent 51%),radial-gradient(1px 1px at 88% 30%,#3e52a8 50%,transparent 51%),linear-gradient(180deg,#11142e 0%,#1c1d4e 55%,#2b205b 100%);background-attachment:fixed;color:var(--text);font-family:Galmuri11,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:14px;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere;-webkit-font-smoothing:none}
main{max-width:560px;margin:0 auto;padding:12px 12px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.top{display:flex;justify-content:center;align-items:center;padding:6px 0 2px;text-align:center}
.top div{display:grid;justify-items:center;line-height:1.15}
.top small{font-size:9px;letter-spacing:.2em;color:var(--muted)}
.top h1{margin:0;font-size:17px;color:var(--gold);text-shadow:0 0 8px rgba(255,195,92,.45)}
.top h1::before,.top h1::after{content:"◆";color:#6f8fff;font-size:10px;margin:0 8px;vertical-align:middle}
.box{padding:8px;background:var(--panel);border:var(--px) solid var(--edge);box-shadow:inset var(--px) var(--px) 0 var(--hi);display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.box-head{display:flex;align-items:baseline;gap:8px}.box-head b{color:var(--gold);font-size:14px}.box-head small{font-size:11px;color:var(--muted)}
.pay{text-align:center;padding:12px 8px}
.pay small{font-size:12px;color:var(--muted)}
.pay b{display:block;font-size:30px;color:var(--gold);line-height:1.2;margin:2px 0}
.pay em{font-style:normal;font-size:12px;color:var(--muted)}
.tr{display:grid;grid-template-columns:36px minmax(0,1fr) minmax(0,1fr) 58px 52px;align-items:center;gap:4px;min-height:34px;padding:4px;font-size:12px}
.tr>span{min-width:0;display:flex;flex-direction:column;line-height:1.25}
.tr small{font-size:10px;color:var(--muted)}
.th{min-height:22px;font-size:10px;color:var(--muted);border-bottom:1px solid rgba(169,162,207,.35)}
.th span:nth-child(n+4){text-align:right}
.run{border-bottom:1px solid rgba(169,162,207,.15);padding-bottom:6px}
.run:nth-child(even){background:rgba(255,255,255,.03)}
.d{color:var(--gold)}
.g{color:var(--green);font-weight:700;text-align:right;align-items:flex-end}
.w{color:var(--won);font-weight:700;text-align:right;align-items:flex-end}
.u{padding:0 4px 4px;font-size:11px;color:var(--gold);text-align:right}
.shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:0 4px}
figure{margin:0;display:flex;flex-direction:column;gap:2px;min-width:0}
figure a{display:block;border:var(--px) solid var(--edge);background:#000}
figure img{display:block;width:100%;height:auto;aspect-ratio:2340/1080;object-fit:cover}
figcaption{font-size:11px;color:var(--muted);text-align:center}
.none{display:grid;place-items:center;aspect-ratio:2340/1080;font-size:11px;color:var(--muted);border:var(--px) dashed var(--edge)}
.gap{display:grid;grid-template-columns:6em minmax(0,1fr) 4.2em 2em;gap:4px;align-items:center;padding:5px 8px;font-size:11px;color:var(--muted);background:repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 6px,transparent 6px 12px);border-top:1px dashed rgba(255,255,255,.12);border-bottom:1px dashed rgba(255,255,255,.12)}
.gap span:first-child{color:#8fb4ff;font-weight:700}.gap span:nth-child(n+3){text-align:right}
.price div{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:4px;font-size:13px;border-top:1px solid rgba(169,162,207,.15)}
.price div span:first-child{color:var(--muted)}
.price b{color:var(--gold)}.price small{color:var(--muted);font-size:11px;margin-left:6px}
.sum div{display:flex;justify-content:space-between;gap:8px;padding:5px 4px;font-size:13px;border-top:1px solid rgba(169,162,207,.15)}
.sum div:first-child{border-top:0}
.sum span:first-child{color:var(--muted)}
.sum .big{font-size:15px;border-top:var(--px) solid var(--edge)}.sum .big span{color:var(--gold)!important;font-weight:700}
.empty{margin:4px 0;padding:12px 6px;text-align:center;font-size:13px;color:var(--muted)}
</style></head>
<body><main>
<div class="top"><div><small>SETTLEMENT</small><h1>정산서</h1></div></div>
<div class="box pay"><small>${esc(dayText(kstDay(settle.at)))} 정산</small><b>${won(settle.pay)}원</b><em>기록 ${runs.results.length}개 · 경험치 +${pct(totalGain)}%</em></div>
<div class="box">
<div class="box-head"><b>기록</b><small>사진을 누르면 크게 보여요</small></div>
<div>
<div class="tr th"><span>날짜</span><span>시작</span><span>끝</span><span>증감</span><span>금액</span></div>
${rows || '<p class="empty">기록이 없어요</p>'}
</div>
</div>
${priceRows ? `<div class="box price"><div class="box-head"><b>단가</b></div>${priceRows}</div>` : ""}
<div class="box sum">
<div><span>기록 합</span><span>${won(settle.sum)}원</span></div>
${settle.carry_in > 0.5 ? `<div><span>지난 이월</span><span>+${won(settle.carry_in)}원</span></div>` : ""}
<div><span>합계</span><span>${won(total)}원</span></div>
<div class="big"><span>정산 (1,000원 단위)</span><span>${won(settle.pay)}원</span></div>
<div><span>다음으로 이월</span><span>${won(settle.carry_out)}원</span></div>
</div>
</main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=60",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
};
