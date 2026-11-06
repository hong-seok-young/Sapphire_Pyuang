// 성장왕 카드의 캐릭터 뒤 후광: 길드 랭킹 성장 1위(Ranking.tsx)와 캐릭터 사진 등록의 성장왕 카드 미리 보기(AvatarMaker.tsx)가 같이 쓴다. 모양은 styles.css 의 .gh-*

/**
 * 성장왕 후광 (제작자 2026-11-06 초안 다섯 개 중 'D+B 조합 2 · 마법진 물결 이대로'): 발밑 도트 마법진이 돌고(금빛 겉고리, 반대로 도는 파란 별),
 * 빛기둥이 솟고, 마법진에서 금·사파이어 고리가 바닥을 따라 퍼지고, 빛기둥 안에서 별이 반짝인다. 움직임은 transform·opacity 만
 */
const HALO_SPARKS: [number, number, number][] = [
  [14, 34, 0],
  [98, 22, 0.5],
  [26, 76, 1],
  [92, 68, 1.5],
  [58, 2, 0.75],
];
export function HeroHalo() {
  return (
    <>
      <span className="gh-pillar" aria-hidden />
      <span className="gh-ripple" aria-hidden>
        <i />
        <i className="gh-blue" />
        <i className="gh-late" />
      </span>
      <span className="gh-circle" aria-hidden>
        <svg viewBox="0 0 100 100" shapeRendering="crispEdges">
          <g fill="none" stroke="#ffcf6e" strokeWidth="2">
            <circle cx="50" cy="50" r="47" />
            <circle cx="50" cy="50" r="40" strokeDasharray="4 3" />
          </g>
          <g fill="#ffe7a8">
            <rect x="48" y="1" width="4" height="6" />
            <rect x="48" y="93" width="4" height="6" />
            <rect x="1" y="48" width="6" height="4" />
            <rect x="93" y="48" width="6" height="4" />
            <rect x="15" y="15" width="4" height="4" />
            <rect x="81" y="15" width="4" height="4" />
            <rect x="15" y="81" width="4" height="4" />
            <rect x="81" y="81" width="4" height="4" />
          </g>
        </svg>
        <svg className="gh-inner" viewBox="0 0 100 100" shapeRendering="crispEdges">
          <g fill="none" stroke="#9ab4ff" strokeWidth="2">
            <polygon points="50,18 78,66 22,66" />
            <polygon points="50,82 22,34 78,34" />
            <circle cx="50" cy="50" r="12" />
          </g>
        </svg>
      </span>
      {HALO_SPARKS.map(([x, y, d]) => (
        <i key={x} className="gh-spark" style={{ left: x, top: y, animationDelay: `${d}s` }} aria-hidden />
      ))}
    </>
  );
}
