// 확률 시뮬레이터 계급장 (제작자 2026-11-19 '말로만 견습 도박꾼 이렇게 하지 말고 앞에 계급장을, 누가 봐도 이 사람이 더 높구나 티나게',
// '테두리나 애니메이션도 높아질수록 점점 추가되고 완전 고급일수록 더 삐까뻔쩍하게'). 계급 규칙은 src/simTier.ts.
// 그림 파일 없이 28x24 도트 칸에 그린다: 재질(판 색과 모양: 나무·무쇠는 네모 판, 청동부터 방패, 금부터 성가퀴, 에메랄드부터 날개, 루비부터 꼭대기 보석),
// 가운데 그림(동전 · 망치 · 클로버 · 보석 · 별 · 왕관, 칭호 넷마다), 그 오른쪽 작은 줄 0 ~ 3개(그 넷 중 몇째), 아래 다섯 칸(그 칭호 안의 계급).
// 움직임은 재질이 오를수록 하나씩 더한다 (은: 빛 지나감, 에메랄드: 뒤 빛이 숨 쉼, 사파이어: 반짝이, 자수정: 도는 고리, 오팔: 도는 무지개, 우주: 도는 빛살). 모두 transform·opacity 만 (sim.css .rk-*)
import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import { GRADES, tierAt } from "../simTier";

interface Mat {
  plate: string;
  light: string;
  dark: string;
  field: string;
  glyph: string;
  shade: string;
  off: string;
}
const MATS: Mat[] = [
  { plate: "#8a5a34", light: "#b98552", dark: "#2e1a0c", field: "#5e3b20", glyph: "#f3deb4", shade: "#c9a56e", off: "#40260f" },
  { plate: "#6f7890", light: "#a3adc4", dark: "#1d2130", field: "#454c60", glyph: "#eef2fb", shade: "#aab3c8", off: "#2c3142" },
  { plate: "#b8703f", light: "#e7a674", dark: "#3d1c0b", field: "#7c4522", glyph: "#ffe9cd", shade: "#e0a878", off: "#532a12" },
  { plate: "#c3cbdd", light: "#ffffff", dark: "#3a4260", field: "#7d87a4", glyph: "#ffffff", shade: "#d3d9e8", off: "#5d6784" },
  { plate: "#efb93a", light: "#fff0a8", dark: "#5c3a05", field: "#a66f0e", glyph: "#fff6c8", shade: "#ffd766", off: "#7a520a" },
  { plate: "#2fb37c", light: "#92f5c8", dark: "#083323", field: "#17704d", glyph: "#eafff5", shade: "#8fe9c0", off: "#0f4f36" },
  { plate: "#3f7cf0", light: "#a5cbff", dark: "#0d1f5a", field: "#2450b4", glyph: "#f2f7ff", shade: "#a9c8ff", off: "#17358a" },
  { plate: "#e5475f", light: "#ffa9b6", dark: "#4e0b19", field: "#a82439", glyph: "#fff1f3", shade: "#ffb3be", off: "#7c172a" },
  { plate: "#a05fe8", light: "#dcb8ff", dark: "#2f1160", field: "#6d34b6", glyph: "#fbf5ff", shade: "#d6b3ff", off: "#4b2184" },
  { plate: "#eef2ff", light: "#ffffff", dark: "#4a5290", field: "#ffffff", glyph: "#2a2350", shade: "#6a5fb0", off: "#aab2de" },
  { plate: "#1a1740", light: "#8f7dff", dark: "#05040f", field: "#0b0a1a", glyph: "#ffe58a", shade: "#ffb24a", off: "#2c2760" },
  { plate: "#fff7da", light: "#ffffff", dark: "#7a5a0a", field: "#14122e", glyph: "#fff3b0", shade: "#ffc84a", off: "#3a3478" },
];
/** 재질의 색 (순위 줄 테두리와 이름 색) */
export const eraColor = (era: number) => {
  const m = MATS[Math.min(MATS.length - 1, Math.max(0, era))];
  // 이름 글자 색(l)은 어두운 바탕에서 읽히게: 나무·무쇠·청동은 판 색보다 밝게
  const text = ["#e2b98a", "#c8d0e4", "#f3b98c", "#e8edf8"][era] ?? (era === 10 ? "#c8beff" : m.light);
  return { c: era === 9 ? "#c9b8ff" : era === 10 ? "#8f7dff" : era === 11 ? "#ffe58a" : m.plate, l: text };
};
/** 움직임 단계 0 ~ 5 (순위 줄의 테두리 효과도 같은 단계) */
export const fxOf = (era: number) => (era >= 10 ? 5 : era >= 9 ? 4 : era >= 7 ? 3 : era >= 5 ? 2 : era >= 3 ? 1 : 0);

// 가운데 그림 (10 x 9 도트): # 밝은 색, + 그늘
const GLYPHS: string[][] = [
  ["..######..", ".########.", "###++++###", "##+####+##", "##+####+##", "##+####+##", "###++++###", ".########.", "..######.."],
  [".########.", "##########", "++++++++++", ".++++++++.", "....##....", "....##....", "....##....", "....++....", "....++...."],
  [".###..###.", "####..####", "####..####", ".###++###.", "....++....", ".###++###.", "####..####", "####..####", ".###..###."],
  ["..........", "..######..", ".########.", "##########", ".++++++++.", "..++++++..", "...++++...", "....++....", ".........."],
  ["....##....", "....##....", "...####...", "##########", ".########.", "..######..", "..++++++..", ".+++..+++.", ".+......+."],
  ["#...##...#", "#...##...#", "##.####.##", "##########", "##########", "++++++++++", "..........", "##########", "++++++++++"],
];
const WING = ["#...", "##..", "###.", "####", ".###", "####", ".###", "..##", "...#"];
type R = [x: number, y: number, w: number, h: number];

/** 판 모양 (칸 목록) */
function plateRects(era: number): R[] {
  const out: R[] =
    era < 2
      ? [
          [5, 2, 18, 1],
          [4, 3, 20, 18],
          [5, 21, 18, 1],
        ]
      : [
          [5, 2, 18, 1],
          [4, 3, 20, 15],
          [5, 18, 18, 1],
          [6, 19, 16, 1],
          [8, 20, 12, 1],
          [10, 21, 8, 1],
          [12, 22, 4, 1],
        ];
  // 금부터: 성가퀴 셋
  if (era >= 4) out.push([6, 0, 3, 2], [12, 0, 4, 2], [19, 0, 3, 2]);
  return out;
}

/** 도트 글자를 칸으로: 같은 줄에서 이어진 것은 한 칸으로 */
function bitmap(rows: string[], x0: number, y0: number, ch: string, flip = false): R[] {
  const out: R[] = [];
  rows.forEach((raw, y) => {
    const row = flip ? [...raw].reverse().join("") : raw;
    let s = -1;
    for (let x = 0; x <= row.length; x++) {
      const on = row[x] === ch;
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        out.push([x0 + s, y0 + y, x - s, 1]);
        s = -1;
      }
    }
  });
  return out;
}
const rect = (r: R, fill: string, key: string) => <rect key={key} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill={fill} />;

function draw(n: number) {
  const t = tierAt(n);
  const m = MATS[t.era];
  const plate = plateRects(t.era);
  const els: JSX.Element[] = [];
  // 테두리 (판을 한 칸씩 넓힌 것) -> 판 -> 위쪽 밝은 줄과 오른쪽·아래 그늘
  plate.forEach((r, i) => els.push(rect([r[0] - 1, r[1], r[2] + 2, r[3]], m.dark, `o${i}`), rect([r[0], r[1] - 1, r[2], r[3] + 2], m.dark, `p${i}`)));
  plate.forEach((r, i) => els.push(rect(r, m.plate, `f${i}`)));
  els.push(rect([5, 2, 18, 1], m.light, "hl"), rect([4, 3, 1, 14], m.light, "hl2"), rect([23, 4, 1, 14], m.shade, "sh"));
  if (t.era >= 4) els.push(rect([6, 0, 3, 1], m.light, "m1"), rect([12, 0, 4, 1], m.light, "m2"), rect([19, 0, 3, 1], m.light, "m3"));
  // 루비부터: 가운데 성가퀴에 보석
  if (t.era >= 7) els.push(rect([13, 0, 2, 2], "#ffffff", "jw"), rect([13, 1, 2, 1], m.glyph, "jw2"));
  // 가운데 칸 (그림 바탕): 오팔은 무지개 띠, 우주와 그 너머는 별
  els.push(rect([6, 4, 16, 11], m.field, "fd"));
  if (t.era === 9) ["#ffc9de", "#fff2b0", "#b9f5d0", "#b9dcff"].forEach((c, i) => els.push(rect([6 + i * 4, 4, 4, 11], c, `op${i}`)));
  if (t.era >= 10)
    [
      [7, 5],
      [20, 6],
      [8, 12],
      [19, 13],
      [14, 4],
    ].forEach(([x, y], i) => els.push(rect([x, y, 1, 1], t.era === 11 ? "#8f7dff" : "#ffffff", `st${i}`)));
  // 날개 (에메랄드부터)
  if (t.era >= 5) {
    bitmap(WING, 0, 6, "#").forEach((r, i) => els.push(rect(r, m.light, `wl${i}`)));
    bitmap(WING, 24, 6, "#", true).forEach((r, i) => els.push(rect(r, m.light, `wr${i}`)));
  }
  // 가운데 그림
  const g = GLYPHS[t.fam];
  bitmap(g, 9, 5, "+").forEach((r, i) => els.push(rect(r, m.shade, `gs${i}`)));
  bitmap(g, 9, 5, "#").forEach((r, i) => els.push(rect(r, m.glyph, `g${i}`)));
  // 오른쪽 작은 줄: 같은 그림을 쓰는 칭호 넷 중 몇째인가 (0 ~ 3개, 아래부터 쌓인다)
  for (let i = 0; i < t.sub; i++) els.push(rect([20, 12 - i * 3, 2, 2], t.era === 9 ? "#2a2350" : m.glyph, `sb${i}`), rect([20, 13 - i * 3, 2, 1], t.era === 9 ? "#6a5fb0" : m.shade, `sc${i}`));
  // 아래 다섯 칸: 그 칭호 안의 계급
  for (let i = 0; i < GRADES; i++) els.push(rect([7 + i * 3, 16, 2, 2], i < t.grade ? (t.era === 9 ? "#2a2350" : m.glyph) : m.off, `pp${i}`));
  return { t, els };
}

/** 반짝이 자리 (왼쪽 %, 위 %, 늦게 시작 s) */
const SPARKS: [number, number, number][] = [
  [86, 6, 0],
  [4, 62, 0.7],
  [70, 84, 1.3],
  [12, 8, 1.9],
  [96, 52, 0.4],
  [46, -8, 1.1],
];

/** 계급장. n = 계급 번호, size = 높이 px (폭은 30/26 배: 테두리 한 칸씩 더), still 이면 움직임 없이 */
export const RankBadge = memo(function RankBadge({ n, size = 24, still = false, dim = false }: { n: number; size?: number; still?: boolean; dim?: boolean }) {
  const { t, els } = useMemo(() => draw(n), [n]);
  const lv = still ? 0 : fxOf(t.era);
  const col = eraColor(t.era);
  const sparks = still ? 0 : t.era >= 11 ? 6 : t.era >= 10 ? 5 : t.era >= 9 ? 4 : t.era >= 7 ? 3 : t.era >= 6 ? 2 : 0;
  const style = { width: Math.round((size * 30) / 26), height: size, ["--rk-c"]: col.c, ["--rk-l"]: col.l, ["--rk-t"]: `${Math.max(2.2, 5.4 - t.era * 0.3)}s` } as CSSProperties;
  return (
    <span className={`rk rk-e${t.era}` + (dim ? " rk-dim" : "")} style={style} role="img" aria-label={t.name}>
      {lv >= 2 && <i className="rk-glow" aria-hidden />}
      {lv >= 5 && <i className="rk-rays" aria-hidden />}
      {lv >= 4 && <i className="rk-rainbow" aria-hidden />}
      {!still && t.era >= 8 && <i className="rk-ring" aria-hidden />}
      {!still && t.era >= 11 && <i className="rk-ring rk-ring-2" aria-hidden />}
      <svg viewBox="-1 -1 30 26" shapeRendering="crispEdges" aria-hidden>
        {els}
      </svg>
      {lv >= 1 && (
        <span className="rk-shine" aria-hidden>
          <i />
        </span>
      )}
      {SPARKS.slice(0, sparks).map(([x, y, d], i) => (
        <i key={i} className="rk-spark" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} aria-hidden />
      ))}
    </span>
  );
});
