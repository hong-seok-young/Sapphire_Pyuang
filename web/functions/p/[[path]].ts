// 정산서 링크 (로그인 없이): GET /p/<token> -> 그 정산 하나의 정산서 페이지, GET /p/<token>/i/<그림 번호> -> 그 정산 기록의 증거 사진.
// 링크는 화면의 '정산서 보내기'가 만든다 (api/diary/share.ts, 표 diary_shares). 앱 화면·코드를 받지 않는 글 한 장이라 길드 이름도 없다.
// 토큰을 모르면 404. 사용 기록에 남지 않는다 (/api 밖이라 사용 기록 미들웨어를 안 거친다).
import type { Env } from "../../server/auth";

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
const kstDay = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const pct = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
const gain = (r: Row) => (r.lv_to - r.lv_from) * 100 + r.exp_to - r.exp_from;

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
      .first<{ type: string; data: ArrayBuffer }>();
    if (!shot) return NOT();
    return new Response(shot.data, {
      headers: { "content-type": shot.type, "cache-control": "private, max-age=86400", "x-robots-tag": "noindex" },
    });
  }
  if (parts.length !== 1) return NOT();

  const [settle, runs, shots] = await Promise.all([
    env.DB.prepare("SELECT id, at, runs, sum, carry_in, pay, carry_out FROM diary_settles WHERE id = ?").bind(share.settle_id).first<Settle>(),
    env.DB.prepare(
      "SELECT id, day, lv_from, exp_from, t_from, lv_to, exp_to, t_to, won FROM diary_runs WHERE settle_id = ? ORDER BY day, lv_from, exp_from, id",
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

  const rows = runs.results
    .map((r) => {
      const g = gain(r);
      const w = r.won ?? 0;
      const per = g > 0 ? w / g : 0;
      const img = (side: string, name: string) => {
        const id = pic.get(`${r.id}:${side}`);
        return id
          ? `<figure><figcaption>${name}</figcaption><a href="${base}${id}" target="_blank" rel="noopener"><img loading="lazy" src="${base}${id}" alt="${name} 사진"></a></figure>`
          : `<figure class="none"><figcaption>${name}</figcaption><span>사진 없음</span></figure>`;
      };
      return `<details>
<summary>
<span class="d">${esc(dayText(r.day))}</span>
<span class="p"><b>Lv.${r.lv_from}</b> ${pct(r.exp_from)}%${r.t_from ? `<small>${esc(r.t_from)}</small>` : ""}</span>
<span class="p"><b>Lv.${r.lv_to}</b> ${pct(r.exp_to)}%${r.t_to ? `<small>${esc(r.t_to)}</small>` : ""}</span>
<span class="g">+${pct(g)}%</span>
<span class="w">${won(w)}</span>
</summary>
<div class="more"><p>1%당 ${won(per)}원 · 오른 ${pct(g)}% × ${won(per)} = ${won(w)}원</p><div class="pics">${img("from", "시작")}${img("to", "끝")}</div></div>
</details>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>정산서 ${esc(dayText(kstDay(settle.at)))}</title>
<style>
:root{--bg:#14122b;--card:#211d45;--line:#3a3470;--fg:#ece9ff;--dim:#a49fd0;--gold:#f6c84c;--green:#6fe0a3;}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}
main{max-width:560px;margin:0 auto;padding:20px 14px 40px}
h1{margin:0;font-size:15px;color:var(--dim);font-weight:600;letter-spacing:.04em}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.head small{color:var(--dim)}
.pay{margin:14px 0 18px;padding:18px 16px;border-radius:14px;background:linear-gradient(135deg,#2c2560,#1d1940);border:1px solid var(--line);text-align:center}
.pay small{display:block;color:var(--dim);font-size:13px}
.pay b{display:block;font-size:34px;color:var(--gold);letter-spacing:-.01em;margin-top:2px}
.pay em{display:block;font-style:normal;color:var(--dim);font-size:13px;margin-top:4px}
.tbl{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}
.th,summary{display:grid;grid-template-columns:4.6em minmax(0,1fr) minmax(0,1fr) 4.8em 4.6em;gap:6px;align-items:center;padding:8px 10px}
.th{font-size:12px;color:var(--dim);border-bottom:1px solid var(--line)}
.th span:nth-child(n+4),summary .g,summary .w{text-align:right}
details{border-bottom:1px solid var(--line)}details:last-child{border-bottom:0}
details:nth-child(odd) summary{background:rgba(255,255,255,.025)}
summary{list-style:none;cursor:pointer;font-size:13px}summary::-webkit-details-marker{display:none}
summary .p small{display:block;color:var(--dim);font-size:11px}
summary .p b{font-weight:600;color:var(--dim);font-size:11px;margin-right:2px}
summary .g{color:var(--green);font-weight:600}
summary .w{font-weight:700}
details[open] summary{background:#2a2556}
.more{padding:10px}
.more p{margin:0 0 8px;font-size:12px;color:var(--dim)}
.pics{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0}figcaption{font-size:12px;color:var(--dim);margin-bottom:3px}
figure img{display:block;width:100%;border-radius:8px;border:1px solid var(--line)}
figure.none span{display:block;padding:20px 0;text-align:center;color:var(--dim);border:1px dashed var(--line);border-radius:8px;font-size:12px}
.hint{font-size:12px;color:var(--dim);margin:6px 2px 16px}
.sum{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:6px 14px}
.sum div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
.sum div:last-child{border-bottom:0}
.sum .big{font-weight:700;color:var(--gold);font-size:16px}
.sum span:first-child{color:var(--dim)}
</style></head>
<body><main>
<div class="head"><h1>정산서</h1><small>${esc(dayText(kstDay(settle.at)))}</small></div>
<div class="pay"><small>정산 금액</small><b>${won(settle.pay)}원</b><em>기록 ${runs.results.length}개 · 경험치 +${pct(totalGain)}%</em></div>
<div class="tbl">
<div class="th"><span>날짜</span><span>시작</span><span>끝</span><span>증감</span><span>금액</span></div>
${rows || '<p class="hint" style="padding:10px">기록이 없어요</p>'}
</div>
<p class="hint">줄을 누르면 시작·끝 사진이 보여요</p>
<div class="sum">
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
