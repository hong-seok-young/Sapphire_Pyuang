// 캐릭터 사진 AI 검수 시험 (제작자 2026-11-10 '발밑 회색 동그라미가 누끼가 안 따진다, AI 보정 제대로 되게').
// 비공개 자료 이미지/캐릭터사진/시험/ 의 <이름>.png (자른 스샷)와 <이름>_mask.png (배경 지우기 AI 결과의 불투명도)로
// 화면(AvatarMaker.tsx autoCut)과 같은 순서(첫 검수 -> 지우기 -> 둘째 검수 -> 다시 가르기)를 진짜 검수(server/avatarReview.ts)로 돌리고,
// 찍은 점만 실행 기록에 찍는다 (그림은 찍지 않는다). 점으로 그림을 다시 만드는 것은 같은 계산(src/avatarCut.ts)이라 로컬에서 그대로 된다.
// GitHub Actions(.github/workflows/avatar-test.yml)에서 손으로 돌린다.
//   node --import ./scripts/ts-hooks.mjs --experimental-strip-types scripts/avatar-review-test.mjs ../자료/이미지/캐릭터사진/시험
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { reviewPoints } from "../server/avatarReview.ts";
import { cleanThin, cutWithMarks, fillHoles, keepBiggest, markBox, markIndex, onMagenta, reviewScale } from "../src/avatarCut.ts";

const dir = process.argv[2];
const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!dir || !key) throw new Error("폴더와 ANTHROPIC_API_KEY 가 있어야 해요");
const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });

for (const file of readdirSync(dir).filter((f) => f.endsWith(".png") && !f.endsWith("_mask.png")).sort()) {
  const name = file.replace(/\.png$/, "");
  const img = await sharp(join(dir, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = img.info;
  const src = { width: w, height: h, data: img.data };
  const mk = await sharp(join(dir, `${name}_mask.png`)).greyscale().resize(w, h).raw().toBuffer();
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = mk[i] >= 128 ? 255 : 0;
  const base = keepBiggest(raw, w, h);
  let alpha = cleanThin(base, w, h);
  const k = reviewScale(w, h);
  const rw = Math.max(16, Math.round(w * k));
  const rh = Math.max(16, Math.round(h * k));
  const kernel = k < 1 ? "lanczos3" : "nearest";
  const encode = (rgba, fmt) =>
    sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: w, height: h, channels: 4 } })
      .resize(rw, rh, { kernel })
      [fmt](fmt === "jpeg" ? { quality: 92 } : {})
      .toBuffer()
      .then((b) => b.toString("base64"));
  const own = new Uint8Array(w * h).fill(255);
  const original = await encode(onMagenta(src, own), "jpeg");
  const marks = { keep: [], remove: [], boxes: [] };
  for (const again of [false, true]) {
    const t = Date.now();
    const r = await reviewPoints(client, original, await encode(onMagenta(src, alpha), "png"), rw, rh, again);
    console.log(JSON.stringify({ name, again, w, h, k, rw, rh, seconds: Math.round((Date.now() - t) / 1000), ...r }));
    marks.keep.push(...r.keep.map((p) => markIndex(p, k, w, h)));
    marks.remove.push(...r.remove.map((p) => markIndex(p, k, w, h)));
    marks.boxes.push(...r.remove.map((p) => markBox(p, k, w, h)));
    alpha = cutWithMarks(src, fillHoles(base, w, h, marks.keep), marks) ?? alpha;
  }
}
