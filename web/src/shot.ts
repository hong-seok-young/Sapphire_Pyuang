// 아이템 스샷 고르기와 읽기 (제작자 요청 2026-11-02: 중개인의 위키에 없는 물건, 장비대여 물건 추가).
// 길드원이 갤러리에서 직접 고른 스샷만 쓴다. 앱은 화면을 캡처하지 않는다 (CLAUDE.md '해도 되는 것').
// 읽은 값은 칸에 채울 뿐, 사람이 보고 고친 뒤 저장한다 (서버 functions/api/ai/read.ts).
import { api } from "./auth";

export interface Shot {
  type: "image/jpeg";
  /** base64 */
  data: string;
  /** 화면에 보일 data URL */
  preview: string;
}

/** 고른 그림을 긴 변 1400px JPEG 로 줄인다 (글자가 읽히는 크기, 보내고 저장하는 양은 작게) */
export async function shrinkShot(file: File, max = 1400): Promise<Shot> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = canvas.toDataURL("image/jpeg", 0.82);
  return { type: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1), preview };
}

/** 중개인: 이름, 강화, 종류, 속성부여 (옵션은 읽지 않는다) */
export interface MarketRead {
  name: string | null;
  enhance: number | null;
  category: string | null;
  enchant: string | null;
  enchantValue: number | null;
}
/** 장비대여: 무기 이름, 강화, 직업, 요구 레벨, 옵션 */
export interface RentalRead {
  name: string | null;
  enhance: number | null;
  job: string | null;
  level: number | null;
  options: { name: string; value: number }[];
}

export function readShot(kind: "market", shot: Shot): Promise<MarketRead>;
export function readShot(kind: "rental", shot: Shot): Promise<RentalRead>;
export function readShot(kind: "market" | "rental", shot: Shot) {
  return api("/api/ai/read", "POST", { kind, image: { type: shot.type, data: shot.data } });
}
