/**
 * 홈·정보 칸 이모지 -> 그림 (public/icons/emoji/<이름>.png, scripts/make_emoji_icons.mjs 가 만든다).
 * 이모지는 기기 글꼴로 그려져 폰과 PC 가 달라서(제작자 2026-11-12 '아이콘 폰인데 pc랑 다르자너'), Microsoft Fluent Emoji Flat(MIT)에
 * 윈도우 이모지처럼 검은 테두리를 두른 그림으로 어디서나 같게 보인다. 새 칸에 이모지를 쓰면 여기에 더하고 스크립트를 다시 돌린다.
 */
const EMOJI: Record<string, string> = {
  "🏠": "house",
  "📢": "loudspeaker",
  "🔍": "magnifying-glass-tilted-left",
  "📚": "books",
  "💬": "speech-balloon",
  "✅": "check-mark-button",
  "🏆": "trophy",
  "💰": "money-bag",
  "📋": "clipboard",
  "🎰": "slot-machine",
  "📮": "postbox",
  "💡": "light-bulb",
  "🥊": "boxing-glove",
  "🎯": "bullseye",
  "📖": "open-book",
  "🏋️": "person-lifting-weights",
  "🤝": "handshake",
  "⚔️": "crossed-swords",
  "📲": "mobile-phone-with-arrow",
  "👥": "busts-in-silhouette",
  "📊": "bar-chart",
  "🛠️": "hammer-and-wrench",
  "🗺️": "world-map",
  "🛡️": "shield",
  "📈": "chart-increasing",
  "✨": "sparkles",
  "⚒️": "hammer-and-pick",
  "💎": "gem-stone",
  "🏰": "castle",
  "🚩": "triangular-flag",
  "📜": "scroll",
  "🎲": "game-die",
};

/** 그림을 다시 만들면 올린다 (/icons 는 하루 캐시) */
const V = 1;

/** 이모지의 그림 주소 (없으면 null: 글자 이모지 그대로) */
export const emojiPic = (emoji: string): string | null => {
  const name = EMOJI[emoji];
  return name ? `/icons/emoji/${name}.png?v=${V}` : null;
};
