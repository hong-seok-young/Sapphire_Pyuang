import { useState } from "react";
import type { FormEvent } from "react";
import { JOBS, JOB_NAME, MAX_LEVEL, ROLE_NAME, errorText, logout, saveMyProfile } from "../auth";
import type { Job, Me } from "../auth";
import { JobEmblem, JobIcon } from "../emblems";
import { HeroTitle, TopBar } from "../ui";
import { useBackToLogin } from "./Login";

/**
 * 직업과 레벨 고르기 (처음 정하는 창, 내 정보, 길드원 관리가 같이 쓴다).
 * 브라우저 고르기 창(<select>)은 게임 위 위키 창에서 안 열려서 단추로 고른다 (CLAUDE.md).
 */
export function ProfileForm({
  job: startJob,
  level: startLevel,
  submitLabel,
  onSave,
}: {
  job: Job | null;
  level: number | null;
  submitLabel: string;
  onSave: (job: Job, level: number) => Promise<void>;
}) {
  const [job, setJob] = useState<Job | null>(startJob);
  const [level, setLevel] = useState(startLevel ? String(startLevel) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Number(level);
  const ok = job !== null && Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await onSave(job, n);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const step = (d: number) => setLevel(String(Math.min(MAX_LEVEL, Math.max(1, (Number(level) || 0) + d))));
  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="job-pick">
        {JOBS.map((j) => (
          <button key={j} type="button" className={"job-btn job-" + j + (job === j ? " job-on" : "")} onClick={() => setJob(j)}>
            <JobIcon job={j} size={30} />
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
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "저장하는 중…" : submitLabel}
      </button>
    </form>
  );
}

/** 직업, 레벨을 아직 안 정한 길드원이 들어오면 이 창만 보인다 (길드 랭킹에 쓰려고 한 번 정한다) */
export function ProfileSetupPage({
  onDone,
  onBack,
}: {
  onDone: (p: { job: Job; level: number }) => void;
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
            <p className="hero-sub">직업과 레벨 정하기</p>
          </div>
        </header>
        <section className="panel profile-panel">
          <p className="form-note">길드 레벨 랭킹에 쓰여요. 레벨이 오르면 '내 정보'에서 바꾸면 돼요.</p>
          <ProfileForm
            job={null}
            level={null}
            submitLabel="정하고 들어가기"
            onSave={async (job, level) => {
              await saveMyProfile(job, level);
              onDone({ job, level });
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

/** 내 정보: 직업과 레벨 바꾸기 (레벨업하면 여기서), 비밀번호, 로그아웃 */
export function MePage({ me, onMe, onLogout }: { me: Me; onMe: (p: { job: Job; level: number }) => void; onLogout: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <TopBar title="내 정보" />
      <section className="panel me-card">
        {me.job && me.level && <JobEmblem job={me.job} level={me.level} size={64} />}
        <div>
          <div className="me-name">{me.id}</div>
          <div className="muted">
            {ROLE_NAME[me.role]}
            {me.job && ` · ${JOB_NAME[me.job]}`}
            {me.level && ` · Lv.${me.level}`}
          </div>
        </div>
      </section>
      <section className="panel profile-panel">
        <h2 className="panel-title">레벨업 했으면 바꿔 주세요</h2>
        <ProfileForm
          key={`${me.job}-${me.level}`}
          job={me.job}
          level={me.level}
          submitLabel="저장"
          onSave={async (job, level) => {
            await saveMyProfile(job, level);
            onMe({ job, level });
            setSaved(true);
          }}
        />
        {saved && <p className="form-note">저장했어요. 길드 랭킹에 바로 보여요.</p>}
      </section>
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
