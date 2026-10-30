// 길드 랭킹에 쓰는 마크: 직업 아이콘, 레벨에 따라 테두리가 바뀌는 직업 엠블럼, 1~3위 메달, 역할 배지.
// 게임 랭킹 화면 느낌을 따랐지만 그림은 여기서 새로 그린 것이다 (게임 그림 파일을 쓰지 않는다).
import type { Job, Role } from "./auth";
import { JOB_NAME, ROLE_NAME } from "./auth";

/** 직업 그림 (24x24 좌표, currentColor). 전사 칼, 레인저 활, 마법사 지팡이, 무도가 주먹 */
function glyph(job: Job) {
  switch (job) {
    case "warrior":
      return (
        <g fill="currentColor">
          <polygon points="21.5,2.5 20.2,7.4 11.6,16 8,12.4 16.6,3.8" />
          <polygon points="5.6,11.4 7,10 14,17 12.6,18.4" />
          <polygon points="9.2,15.2 10.8,16.8 6.2,21.4 4.6,19.8" />
          <circle cx="4.3" cy="20.7" r="1.7" />
        </g>
      );
    case "ranger":
      return (
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3.5 C 13.5 3.5 20.5 10.5 20.5 19" strokeWidth="2.6" />
          <path d="M5 3.5 L 20.5 19" strokeWidth="1.1" />
          <path d="M3.5 20.5 L 17 7" strokeWidth="1.9" />
          <path d="M17 7 L 13.2 7.6 M17 7 L 16.4 10.8" strokeWidth="1.9" />
          <path d="M3.5 20.5 L 3.5 17.3 M3.5 20.5 L 6.7 20.5" strokeWidth="1.7" />
        </g>
      );
    case "mage":
      return (
        <g stroke="currentColor" strokeLinecap="round" fill="none">
          <path d="M3.5 20.5 L 12.6 11.4" strokeWidth="2.8" />
          <circle cx="15.8" cy="8.2" r="4.3" strokeWidth="2.2" />
          <circle cx="15.8" cy="8.2" r="1.7" fill="currentColor" stroke="none" />
          <path d="M21.3 2.2 L 21.3 4.6 M20.1 3.4 L 22.5 3.4" strokeWidth="1.3" />
        </g>
      );
    case "monk":
      return (
        <g fill="currentColor">
          <rect x="6.2" y="5.2" width="3.3" height="7" rx="1.6" />
          <rect x="9.9" y="4" width="3.3" height="8.2" rx="1.6" />
          <rect x="13.6" y="4.6" width="3.3" height="7.6" rx="1.6" />
          <rect x="17.3" y="6.2" width="3" height="6.6" rx="1.5" />
          <path d="M5.2 11 H20.4 V14.6 A6 6 0 0 1 14.4 20.6 H10.6 A5.4 5.4 0 0 1 5.2 15.2 Z" />
          <path d="M2.6 9.8 A2.1 2.1 0 0 1 6.2 8.6 L8.9 12.6 L6.8 14.2 Z" />
        </g>
      );
  }
}

/** 직업 아이콘 (단추, 필터 등) */
export function JobIcon({ job, size = 24 }: { job: Job; size?: number }) {
  return (
    <svg className="job-icon" width={size} height={size} viewBox="0 0 24 24" aria-label={JOB_NAME[job]} role="img">
      {glyph(job)}
    </svg>
  );
}

/** 레벨에 따른 엠블럼 테두리: 50 이상 전설(보석과 날개), 40 이상 날개, 30 이상 금테, 그 아래 기본 */
export function levelTier(level: number): "legend" | "wing" | "gold" | "base" {
  return level >= 50 ? "legend" : level >= 40 ? "wing" : level >= 30 ? "gold" : "base";
}

/** 직업 엠블럼과 아래 레벨 숫자 (게임 랭킹의 동그란 직업 마크처럼) */
export function JobEmblem({ job, level, size = 48 }: { job: Job; level: number; size?: number }) {
  const tier = levelTier(level);
  return (
    <span className={"emblem emblem-" + tier} style={{ width: size, height: size + 6 }} title={`${JOB_NAME[job]} Lv.${level}`}>
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        {(tier === "legend" || tier === "wing") && (
          <g className="emblem-wings">
            <path d="M9 30 C 1 26 0 15 4 9 C 6 15 9 17 13 18 C 9 21 8 25 9 30 Z" />
            <path d="M39 30 C 47 26 48 15 44 9 C 42 15 39 17 35 18 C 39 21 40 25 39 30 Z" />
          </g>
        )}
        <circle className="emblem-ring" cx="24" cy="24" r="16.5" />
        <circle className="emblem-core" cx="24" cy="24" r="13.5" />
        {tier === "legend" && <polygon className="emblem-gem" points="24,1.5 28,6.5 24,11.5 20,6.5" />}
        <g className="emblem-glyph" transform="translate(14 14) scale(0.8333)">
          {glyph(job)}
        </g>
      </svg>
      <b className="emblem-lv">{level}</b>
    </span>
  );
}

/** 1~3위 메달 (리본 + 번호). 4위부터는 숫자만 */
export function RankMedal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="rank-num">{rank}</span>;
  return (
    <svg className={"medal medal-" + rank} width="40" height="46" viewBox="0 0 40 46" aria-label={`${rank}위`} role="img">
      <polygon className="medal-ribbon-l" points="8,0 17,0 23,18 15,20" />
      <polygon className="medal-ribbon-r" points="23,0 32,0 25,20 17,18" />
      <polygon
        className="medal-body"
        points="20,15 24,18 29,17.5 30,22.5 34,26 31,30 31.5,35 26.5,35.5 23.5,40 20,37 16.5,40 13.5,35.5 8.5,35 9,30 6,26 10,22.5 11,17.5 16,18"
      />
      <circle className="medal-face" cx="20" cy="28" r="7.6" />
      <text x="20" y="32.2" textAnchor="middle" className="medal-text">
        {rank}
      </text>
    </svg>
  );
}

/** 오른쪽 마름모 배지: 앱개발자, 길드마스터, 오피서 (길드원은 비워 둔다) */
export function RoleBadge({ role }: { role: Role }) {
  if (role === "member") return <span className="role-diamond role-diamond-none" />;
  return (
    <span className={"role-diamond role-diamond-" + role} title={ROLE_NAME[role]}>
      <svg width="34" height="34" viewBox="0 0 34 34" aria-label={ROLE_NAME[role]} role="img">
        <rect className="diamond-bg" x="7" y="7" width="20" height="20" rx="3" transform="rotate(45 17 17)" />
        {role === "master" && <path className="diamond-glyph" d="M10 21 L11.5 12.5 L14.8 16 L17 11 L19.2 16 L22.5 12.5 L24 21 Z" />}
        {role === "officer" && <path className="diamond-glyph" d="M17 10.5 L23 12.8 C 23 18 20.5 21.6 17 23.5 C 13.5 21.6 11 18 11 12.8 Z" />}
        {role === "developer" && (
          <g className="diamond-glyph diamond-gear">
            <circle cx="17" cy="17" r="3.2" />
            <path d="M17 10 V12.2 M17 21.8 V24 M10 17 H12.2 M21.8 17 H24 M12 12 L13.6 13.6 M20.4 20.4 L22 22 M22 12 L20.4 13.6 M13.6 20.4 L12 22" />
          </g>
        )}
      </svg>
    </span>
  );
}
