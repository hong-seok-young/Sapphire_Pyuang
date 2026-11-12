// 홈·정보 칸의 이모지 아이콘을 그림으로 (제작자 2026-11-12 '크롬으로 볼 때의 아이콘이 더 이쁘다, 폰도 이렇게', '아이콘 폰인데 pc랑 다르자너'):
// 이모지는 기기 글꼴로 그려져 폰(안드로이드 Noto)과 PC(윈도우 Segoe)가 다르다. 윈도우 그림은 Microsoft 글꼴이라 그대로 쓸 수 없어서,
// Microsoft 가 MIT 로 푼 Fluent Emoji Flat 을 그리고 윈도우 10 이모지처럼 굵은 검은 테두리를 둘러 public/icons/emoji/<코드>.png 로 저장한다.
// 개발 요청(📮)은 윈도우처럼 파란 우체통, 길드원 관리(👥)는 회색으로 바꾼다. 라이선스는 public/icons/emoji/LICENSE.txt.
//
//   npm pack @iconify-json/fluent-emoji-flat && tar -xzf iconify-json-fluent-emoji-flat-*.tgz   (아무 폴더에서)
//   node scripts/make_emoji_icons.mjs <그 폴더>/package/icons.json
//
// 새 칸에 이모지를 쓰면 src/emojiIcons.ts 의 EMOJI 에 더하고 이 스크립트를 다시 돌린다 (EMOJI 표를 읽는다).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// playwright 는 이 PC·세션에 깔린 것을 require 로 (web 의 의존성에 넣지 않는다)
const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "icons", "emoji");
const SIZE = 128;
/** 테두리 두께 (128 칸에서, 칸에 36px 로 보이면 1.4px 쯤) */
const RING = 5;
/** 그림마다 색 바꾸기 (canvas filter) */
const TINT = { postbox: "hue-rotate(232deg) saturate(1.05)", "busts-in-silhouette": "grayscale(1) brightness(1.5)" };

const iconsPath = process.argv[2];
if (!iconsPath) throw new Error("icons.json 경로를 주세요 (@iconify-json/fluent-emoji-flat)");
const set = JSON.parse(readFileSync(iconsPath, "utf8"));
const src = readFileSync(join(here, "..", "src", "emojiIcons.ts"), "utf8");
const table = [...src.matchAll(/"([^"]+)":\s*"([a-z0-9-]+)"/g)].map((m) => m[2]);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of [...new Set(table)]) {
  const icon = set.icons[name];
  if (!icon) throw new Error("Fluent 에 없는 이름: " + name);
  const w = icon.width ?? set.width ?? 32;
  const h = icon.height ?? set.height ?? 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${SIZE}" height="${SIZE}">${icon.body}</svg>`;
  const b64 = await page.evaluate(
    async ({ svg, size, ring, tint }) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      const inner = size - ring * 2 - 2;
      g.filter = tint || "none";
      g.drawImage(img, (size - inner) / 2, (size - inner) / 2, inner, inner);
      g.filter = "none";
      const art = g.getImageData(0, 0, size, size);
      // 바깥 테두리: 그림(불투명 칸)을 원 모양으로 ring 만큼 넓힌 자리를 검게 칠하고 그 위에 그림을 얹는다
      const solid = (x, y) => art.data[(y * size + x) * 4 + 3] > 60;
      const out = g.createImageData(size, size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          let near = false;
          for (let dy = -ring; dy <= ring && !near; dy++)
            for (let dx = -ring; dx <= ring; dx++) {
              if (dx * dx + dy * dy > ring * ring + ring) continue;
              const xx = x + dx, yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < size && yy < size && solid(xx, yy)) { near = true; break; }
            }
          if (near) out.data[(y * size + x) * 4 + 3] = 255;
        }
      g.clearRect(0, 0, size, size);
      g.putImageData(out, 0, 0);
      const top = document.createElement("canvas");
      top.width = top.height = size;
      top.getContext("2d").putImageData(art, 0, 0);
      g.drawImage(top, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    },
    { svg, size: SIZE, ring: RING, tint: TINT[name] ?? "" },
  );
  writeFileSync(join(OUT, name + ".png"), Buffer.from(b64, "base64"));
  console.log("icon:", name);
}
await browser.close();
