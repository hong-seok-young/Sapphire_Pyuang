import { useState } from "react";
import type { FormEvent } from "react";
import {
  EXP_MAX, GUILDS, GUILD_NAME, GUILD_TIER, JOBS, JOB_NAME, MAX_LEVEL, ROLE_NAME, avatarUrl, deleteMyAvatar, errorText, expText,
  logout, saveMyProfile,
} from "../auth";
import type { Guild, Job, Me } from "../auth";
import { JobEmblem, JobGlyph } from "../emblems";
import { HeroTitle, TopBar } from "../ui";
import { AvatarMaker } from "./AvatarMaker";
import { useBackToLogin } from "./Login";

/** "12.345" -> 12345, 비었으면 null, 틀렸으면 undefined */
function parseExp(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  if (!/^\d{1,2}(\.\d{0,3})?$/.test(text.trim())) return undefined;
  const n = Math.round(Number(text) * 1000);
  return n >= 0 && n <= EXP_MAX ? n : undefined;
}

/**
 * 길드(1군 Sapphire / 2군 FairyTale), 직업, 레벨 고르기 (처음 정하는 창, 내 정보, 길드원 관리가 같이 쓴다).
 * 직업 단추에는 게임의 직업 문양을 넣는다.
 * withExp 이면 경험치 %도 적는다 (본인만: 처음 정하는 창과 내 정보. 오피서가 남의 것을 고칠 때는 없다).
 * 브라우저 고르기 창(<select>)은 게임 위 위키 창에서 안 열려서 단추로 고른다 (CLAUDE.md).
 */
export function ProfileForm({
  guild: startGuild,
  job: startJob,
  level: startLevel,
  exp: startExp = null,
  withExp = false,
  submitLabel,
  onSave,
}: {
  guild: Guild | null;
  job: Job | null;
  level: number | null;
  exp?: number | null;
  withExp?: boolean;
  submitLabel: string;
  onSave: (job: Job, level: number, exp: number | null, guild: Guild) => Promise<void>;
}) {
  const [guild, setGuild] = useState<Guild | null>(startGuild);
  const [job, setJob] = useState<Job | null>(startJob);
  const [level, setLevel] = useState(startLevel ? String(startLevel) : "");
  const [exp, setExp] = useState(startExp !== null ? (startExp / 1000).toFixed(3) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Number(level);
  const expValue = withExp ? parseExp(exp) : null;
  const ok = guild !== null && job !== null && Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL && expValue !== undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || expValue === undefined || guild === null) return;
    setBusy(true);
    setError("");
    try {
      await onSave(job, n, expValue, guild);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const step = (d: number) => setLevel(String(Math.min(MAX_LEVEL, Math.max(1, (Number(level) || 0) + d))));
  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="guild-pick">
        {GUILDS.map((g) => (
          <button key={g} type="button" className={"job-btn guild-btn" + (guild === g ? " job-on" : "")} onClick={() => setGuild(g)}>
            <b>{GUILD_TIER[g]}</b>
            <span>{GUILD_NAME[g]}</span>
          </button>
        ))}
      </div>
      <div className="job-pick">
        {JOBS.map((j) => (
          <button key={j} type="button" className={"job-btn" + (job === j ? " job-on" : "")} onClick={() => setJob(j)}>
            <JobGlyph job={j} size={30} />
            <span>{JOB_NAME[j]}</span>
          </button>
        ))}
      </div>
      <div className="level-row">
        <span className="level-label">레벨</span>
        <button type="button" className="pill level-step" onClick={() => step(-1)} aria-label="레벨 내리기">
          −
        </button>
        <input
          className="level-input"
          inputMode="numeric"
          value={level}
          onChange={(e) => setLevel(e.target.value.replace(/\D/g, "").slice(0, 2))}
          placeholder="34"
          aria-label="레벨"
        />
        <button type="button" className="pill level-step" onClick={() => step(1)} aria-label="레벨 올리기">
          +
        </button>
      </div>
      {withExp && (
        <>
          <div className="level-row">
            <span className="level-label">경험치</span>
            <input
              className="level-input exp-input"
              inputMode="decimal"
              value={exp}
              onChange={(e) => setExp(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
              placeholder="12.345"
              aria-label="경험치 퍼센트"
            />
            <span className="exp-unit">%</span>
          </div>
          <p className={"form-note" + (expValue === undefined ? " form-error" : "")}>
            {expValue === undefined
              ? "경험치는 0 ~ 99.999 사이로, 소수점 3자리까지 적어 주세요."
              : "게임 화면의 경험치 %를 소수점 3자리까지 (안 적어도 돼요). 숫자는 나만 보고, 같은 레벨이면 높은 사람이 위예요. 레벨이 오르면 같이 바꿔 주세요."}
          </p>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "저장하는 중…" : submitLabel}
      </button>
    </form>
  );
}

/**
 * 길드(1군/2군), 직업, 레벨을 아직 안 정한 길드원이 들어오면 이 창만 보인다 (길드 랭킹에 쓰려고 한 번 정한다).
 * 이미 정한 직업, 레벨은 채워 두어서 1군/2군만 고르면 된다.
 */
export function ProfileSetupPage({
  me,
  onDone,
  onBack,
}: {
  me: Me;
  onDone: (p: Partial<Me>) => void;
  onBack: () => void;
}) {
  useBackToLogin(true, onBack);
  return (
    <div className="app">
      <main className="page">
        <header className="hero">
          <img className="hero-mark" src="icon-192.png" alt="" width={72} height={72} />
          <div>
            <HeroTitle />
            <p className="hero-sub">길드와 직업, 레벨 정하기</p>
          </div>
        </header>
        <section className="panel profile-panel">
          <p className="form-note">1군(Sapphire)인지 2군(FairyTale)인지와 직업, 레벨을 골라요. 길드 랭킹에 쓰여요.</p>
          <ProfileForm
            guild={me.guild}
            job={me.job}
            level={me.level}
            exp={me.exp}
            withExp
            submitLabel="정하고 들어가기"
            onSave={async (job, level, exp, guild) => {
              await saveMyProfile(job, level, exp, guild);
              onDone({ job, level, exp, guild });
            }}
          />
        </section>
        <div className="links">
          <button type="button" className="btn btn-ghost" onClick={() => history.back()}>
            ◀ 다른 아이디로 로그인
          </button>
        </div>
      </main>
    </div>
  );
}

/** 내 캐릭터 사진: 성장 랭킹에 나온다 (1등이면 크게). 스샷에서 직접 잘라 올린다 (AvatarMaker) */
function AvatarPanel({ me, onMe }: { me: Me; onMe: (p: Partial<Me>) => void }) {
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel profile-panel">
      <h2 className="panel-title">내 캐릭터 사진</h2>
      {making ? (
        <AvatarMaker
          onSaved={(avatar) => {
            onMe({ avatar });
            setMaking(false);
          }}
          onCancel={() => setMaking(false)}
        />
      ) : (
        <>
          <p className="form-note">길드 랭킹의 성장 랭킹에 내 캐릭터가 나와요 (1등이면 크게). 게임 스샷에서 내 캐릭터만 잘라 올려요.</p>
          {me.avatar && (
            <div className="avatar-current">
              <img className="growth-face" src={avatarUrl(me.id, me.avatar)} alt="내 캐릭터" />
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="avatar-actions">
            <button type="button" className="btn" onClick={() => setMaking(true)}>
              {me.avatar ? "다른 사진으로 바꾸기" : "📷 스샷에서 캐릭터 따기"}
            </button>
            {me.avatar && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await deleteMyAvatar();
                    onMe({ avatar: null });
                  } catch (x) {
                    setError(errorText(x));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                사진 지우기
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** 내 정보: 직업, 레벨, 경험치 바꾸기 (레벨업하면 여기서), 캐릭터 사진, 비밀번호, 로그아웃 */
export function MePage({ me, onMe, onLogout }: { me: Me; onMe: (p: Partial<Me>) => void; onLogout: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <TopBar title="내 정보" />
      <section className="panel me-card">
        {me.job && me.level && <JobEmblem job={me.job} level={me.level} size={64} />}
        <div>
          <div className="me-name">{me.id}</div>
          <div className="muted">
            {me.guild && `${GUILD_TIER[me.guild]} ${GUILD_NAME[me.guild]} · `}
            {ROLE_NAME[me.role]}
            {me.job && ` · ${JOB_NAME[me.job]}`}
            {me.level && ` · Lv.${me.level}`}
            {me.exp !== null && ` · ${expText(me.exp)}`}
          </div>
        </div>
      </section>
      <section className="panel profile-panel">
        <h2 className="panel-title">레벨업 했으면 바꿔 주세요</h2>
        <ProfileForm
          key={`${me.guild}-${me.job}-${me.level}-${me.exp}`}
          guild={me.guild}
          job={me.job}
          level={me.level}
          exp={me.exp}
          withExp
          submitLabel="저장"
          onSave={async (job, level, exp, guild) => {
            await saveMyProfile(job, level, exp, guild);
            onMe({ job, level, exp, guild });
            setSaved(true);
          }}
        />
        {saved && <p className="form-note">저장했어요. 길드 랭킹에 바로 보여요.</p>}
      </section>
      <AvatarPanel me={me} onMe={onMe} />
      <div className="links">
        <a className="btn btn-ghost" href="#/ranking">🏆 길드 랭킹</a>
        <a className="btn btn-ghost" href="#/password">비밀번호 바꾸기</a>
      </div>
      <div className="links">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            await logout().catch(() => undefined);
            onLogout();
          }}
        >
          로그아웃
        </button>
      </div>
    </>
  );
}
