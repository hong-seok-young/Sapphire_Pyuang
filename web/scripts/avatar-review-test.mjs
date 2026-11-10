// 캐릭터 사진 AI 검수 시험 (제작자 2026-11-10 '발밑 회색 동그라미가 누끼가 안 따진다, AI 보정 제대로 되게').
// 비공개 자료 이미지/캐릭터사진/시험/ 의 <이름>.png (자른 스샷)와 <이름>_mask.png (배경 지우기 AI 결과의 불투명도)로
// 화면(AvatarMaker.tsx aiReview)과 같은 그림을 만들어 진짜 검수(server/avatarReview.ts)에 묻고, 찍은 점만 실행 기록에 찍는다 (그림은 찍지 않는다).
// GitHub Actions(.github/workflows/avatar-test.yml)에서 손으로 돌린다.
//   node --import ./scripts/ts-hooks.mjs --experimental-strip-types scripts/avatar-review-test.mjs ../자료/이미지/캐릭터사진/시험
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { reviewPoints } from "../server/avatarReview.ts";

const REVIEW_MAX = 960;
const dir = process.argv[2];
const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!dir || !key) throw new Error("폴더와 ANTHROPIC_API_KEY 가 있어야 해요");
const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic({ apiKey: key, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });

for (const file of readdirSync(dir).filter((f) => f.endsWith(".png") && !f.endsWith("_mask.png")).sort()) {
  const name = file.replace(/\.png$/, "");
  const img = await sharp(join(dir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = img.info;
  const mask = await sharp(join(dir, `${name}_mask.png`)).greyscale().resize(w, h).raw().toBuffer();
  const cut = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const on = mask[i] >= 128;
    cut[i * 3] = on ? img.data[i * 3] : 255;
    cut[i * 3 + 1] = on ? img.data[i * 3 + 1] : 0;
    cut[i * 3 + 2] = on ? img.data[i * 3 + 2] : 255;
  }
  const big = Math.max(w, h);
  const k = big <= REVIEW_MAX ? Math.max(1, Math.floor(REVIEW_MAX / big)) : REVIEW_MAX / big;
  const rw = Math.max(16, Math.round(w * k));
  const rh = Math.max(16, Math.round(h * k));
  const kernel = k < 1 ? "lanczos3" : "nearest";
  const original = (await sharp(img.data, { raw: { width: w, height: h, channels: 3 } }).resize(rw, rh, { kernel }).jpeg({ quality: 92 }).toBuffer()).toString("base64");
  const cutout = (await sharp(cut, { raw: { width: w, height: h, channels: 3 } }).resize(rw, rh, { kernel }).png().toBuffer()).toString("base64");
  const t = Date.now();
  const r = await reviewPoints(client, original, cutout, rw, rh);
  console.log(JSON.stringify({ name, w, h, k, rw, rh, seconds: Math.round((Date.now() - t) / 1000), ...r }));
}
