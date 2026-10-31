// 카페 원글로 보내는 것 (제작자 요청 2026-10-31): 게임을 하면 알 수 있는 사실(아이템, 몬스터, 장비, 조합책, 퀘스트 재료, NPC)은
// 앱에 그대로 두고, 길드원이 직접 만든 것(이어 붙인 지도, 큰 스샷 그림, 직접 쓴 공략 글)은 화면에 그대로 띄우지 않고
// 카페 원글(아이모 카페, 글 번호 = 위키 글 id)로 가서 보게 한다. 자료는 그대로 갖고 있고 챗봇도 그대로 쓴다.
import type { Wiki } from "./types";

/** 아이모 카페 원글 주소 (모바일. 카페 이름 대신 번호를 써야 열린다, 자료/README.md) */
export const cafeUrl = (postId: string) => `https://m.cafe.naver.com/ca-fe/web/cafes/20603221/articles/${postId}`;

/** 글 전체가 직접 쓴 공략인 메뉴 (그 글은 원글에서 본다) */
export const GUIDE_SECTIONS = ["육성 공략", "인던 · 길드던전", "전장 · 헌팅그라운드"];

export const isGuidePost = (wiki: Wiki, postId: string) =>
  wiki.menu.some((m) => GUIDE_SECTIONS.includes(m.title) && m.posts.some((p) => p.id === postId));

/** 원글에서만 보는 글: 직접 쓴 공략 글, 앱에 보일 것이 없는 글(지도, 스샷뿐. 제작자 요청 2026-11-01: 한 번 눌러 바로 원글로) */
export const isOriginalOnly = (wiki: Wiki, postId: string) =>
  isGuidePost(wiki, postId) || wiki.menu.some((m) => m.posts.some((p) => p.id === postId && p.orig === 1));

/** 이만큼 큰 그림은 직접 찍거나 이어 붙인 것(지도, 스샷)이라 원글에서 본다. 작은 아이템·스킬 그림은 그대로 */
export const isBigPicture = (w: number, h: number) => w >= 300 || h >= 300;
