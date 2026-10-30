// 길드 랭킹에 쓰는 마크: 제작자가 찍어 준 게임 경험치 랭킹 화면 스샷에서 그대로 잘라 낸 그림이다
// (직업 엠블럼, 직업 문양, 1~3위 메달, '내순위' 말풍선. 자료/scripts/make_rank_marks.py).
// 그림은 비공개 자료 저장소에 두고 build_data.py 가 public/data/rank 로 복사한다 (로그인한 길드원에게만 보인다).
// 단추는 이 앱 디자인으로 그리고 게임 그림은 직업 문양만 쓴다 (제작자 요청).
import type { Job, Role } from "./auth";
import { JOB_NAME, ROLE_NAME } from "./auth";

const PIC = "/data/rank/";
export const MINE_TAG_PIC = PIC + "mine_tag.png";

/** 게임처럼 1~20위는 보라 엠블럼, 21위부터는 금색 */
export function emblemTier(rank: number | undefined): "purple" | "gold" {
  return rank !== undefined && rank > 20 ? "gold" : "purple";
}

/** 직업 엠블럼. 아래 검은 칸에 그 사람의 레벨을 적는다 (그림의 숫자는 지워 두었다) */
export function JobEmblem({ job, level, rank, size = 48 }: { job: Job; level: number; rank?: number; size?: number }) {
  return (
    <span className="emblem" style={{ width: size, height: size }} title={`${JOB_NAME[job]} Lv.${level}`}>
      <img src={`${PIC}emblem_${emblemTier(rank)}_${job}.png`} width={size} height={size} alt="" draggable={false} />
      <b className="emblem-lv" style={{ fontSize: Math.max(9, Math.round(size * 0.19)) }}>
        {level}
      </b>
    </span>
  );
}

/** 1~3위 메달. 4위부터는 숫자 */
export function RankMedal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="rank-num">{rank}</span>;
  return <img className="medal" src={`${PIC}medal${rank}.png`} alt={`${rank}위`} draggable={false} />;
}

/** 직업 문양 (게임 엠블럼의 흰 마크). 글자 색(currentColor)으로 칠해서 단추가 켜지고 꺼질 때 색이 따라간다 */
export function JobGlyph({ job, size = 20 }: { job: Job; size?: number }) {
  const mask = `url(${PIC}job_${job}.png)`;
  return (
    <span
      className="job-glyph"
      role="img"
      aria-label={JOB_NAME[job]}
      style={{ width: size, height: size, WebkitMaskImage: mask, maskImage: mask }}
    />
  );
}

/** 오른쪽 마름모 배지: 앱개발자, 길드마스터, 오피서 (길드원은 비워 둔다). 게임의 길드 마크 자리 */
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
