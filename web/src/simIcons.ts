// 확률 시뮬레이터의 아이템 그림 (제작자 2026-11-04 '텍스트 말고 우리 가지고 있는 이미지 써'): 이름으로 우리가 가진 그림을 찾는다.
// 위키 아이템 그림(items.json) -> 위키 장비 표 그림(equipment.json) -> 시세 동향 그림(data/trend, 제작자가 보낸 도감 스샷에서 자른 코스튬 등, index.json 은 build_data.py 가 만든다).
// 이름의 괄호·대괄호 설명, 앞의 '+7', 뒤의 'x10'·'10개', 띄어쓰기는 떼고 맞춘다. 없으면 글자로 그린다
import { createContext, useContext } from "react";
import type { Pic, Wiki } from "./types";

export const iconKey = (s: string) =>
  s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/^\s*\+\d+\s*/, "")
    .replace(/\s*[xX×]\s*\d[\d,]*\s*(개)?\s*$/, "")
    .replace(/\s*\d[\d,]*\s*개\s*$/, "")
    .replace(/\s/g, "");

export type IconOf = (name: string) => Pic | null;

export function iconLookup(wiki: Wiki, trend: Record<string, [number, number]> | null): IconOf {
  const map = new Map<string, Pic>();
  const put = (name: string, pic: Pic | null) => {
    const k = iconKey(name);
    if (pic && k && !map.has(k)) map.set(k, pic);
  };
  for (const it of Object.values(wiki.items)) put(it.name, it.icon);
  for (const t of wiki.equipment) for (const r of t.rows) put(r.name, r.icon);
  if (trend) for (const [name, [w, h]] of Object.entries(trend)) put(name, { src: `/data/trend/${encodeURIComponent(name)}.png`, w, h });
  return (name) => map.get(iconKey(name)) ?? null;
}

export const IconCtx = createContext<IconOf>(() => null);
export const useIcon = () => useContext(IconCtx);
