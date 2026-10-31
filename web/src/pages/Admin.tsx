import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ROLE_NAME, RANK, canManage, createAccount, decideSignup, deleteAccount, errorText, listAccounts, listSignups, positionOf, renameAccount,
  resetPassword, setRole,
} from "../auth";
import type { SignupRequest } from "../auth";
import type { Account, Me, Role } from "../auth";
import { GUILD_NAME, GUILD_TIER, JOB_NAME, clearLevelBadge, deleteAvatarOf, deleteLevelLog, expText, fetchLevelLog, saveProfileOf, setHighSpec } from "../auth";
import type { LevelLogEntry } from "../auth";
import { JobEmblem } from "../emblems";
import { ProfileForm } from "./Profile";
import { Loading, Panel, TopBar } from "../ui";

/** 새 계정과 비밀번호 초기화의 처음 비밀번호 (제작자 요청: 칸 없이 늘 123123). 다음 로그인 때 바꾸게 한다 */
const FIRST_PASSWORD = "123123";

/** 길드원이 몇백 명이어도 처음엔 이만큼만 그리고 '더 보기' */
const PAGE_SIZE = 50;

type FilterKey = "all" | "main" | "second" | "staff" | "pw" | "noprofile" | "pushon" | "pushoff";
/** 목록 거르기 칩 (제작자 요청: 길드원이 많아지면 찾기) */
const FILTERS: { key: FilterKey; label: string; test: (a: Account) => boolean }[] = [
  { key: "all", label: "전체", test: () => true },
  { key: "main", label: "1군", test: (a) => a.guild === "main" },
  { key: "second", label: "2군", test: (a) => a.guild === "second" },
  { key: "staff", label: "오피서 이상", test: (a) => a.role === "master" || a.role === "officer" },
  { key: "pw", label: "비밀번호 바꾸기 전", test: (a) => a.mustChange },
  { key: "noprofile", label: "직업·레벨 안 정함", test: (a) => !a.job || !a.level || !a.guild },
  // 폰(갤럭시, 아이폰) 설정의 이 웹 알림 (제작자 요청: 누가 켰는지 껐는지)
  { key: "pushon", label: "🔔 폰 알림 켬", test: (a) => a.push === "on" },
  // 아직 새 버전을 열지 않아 모르는 사람은 빼고
  { key: "pushoff", label: "🔕 폰 알림 꺼짐", test: (a) => a.push !== null && a.push !== "on" },
];

/** 폰 알림 상태: 줄에는 그림만, 펼치면 글로 */
const PUSH_MARK: Record<NonNullable<Account["push"]>, { icon: string; text: string }> = {
  on: { icon: "🔔", text: "폰 알림 켬" },
  app_off: { icon: "🔕", text: "폰은 허용, 앱 알림함에서 폰 알림을 끔" },
  denied: { icon: "🔕", text: "폰 설정에서 이 웹 알림을 차단함" },
  ask: { icon: "❔", text: "아직 알림 허용을 묻지 않음" },
  none: { icon: "📵", text: "이 폰(브라우저)은 폰 알림이 안 됨 (아이폰은 홈 화면에 추가해야 됨)" },
};

/** 이 역할로 만들거나 바꿀 수 있는 역할 (높은 것부터) */
const ASSIGNABLE: Role[] = ["master", "officer", "member"];


/**
 * 길드원 관리 (오피서 이상).
 * 오피서: 길드원 계정 만들기/지우기/비밀번호 초기화. 길드마스터: 거기에 오피서 임명/해제.
 * 앱개발자: 길드마스터까지 모두. 처음 비밀번호는 만들 때 한 번만 보여 준다.
 * '처음 비밀번호'를 정하면(예: 123123) 새 계정과 비밀번호 초기화에 그걸 쓰고, 비우면 임시 비밀번호를 만든다.
 * 어느 쪽이든 그 사람은 처음 로그인할 때 비밀번호를 바꾼다.
 * 비밀번호 초기화는 '처음 비밀번호'를 비워 두면 123123 으로 한다 (제작자 요청). 그 사람은 다음 로그인 때 바꾼다.
 * 오피서 이상은 누구든 잘못 고른 직업과 레벨을 고치고, 캐릭터가 아닌 사진이 올라왔으면 내릴 수 있다 (길드 랭킹).
 * 경험치 %는 랭킹에서 모두에게 보인다 (제작자 요청).
 */
export function AdminPage({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ title: string; id: string; password: string } | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);

  const creatable = ASSIGNABLE.filter((r) => canManage(me.role, r));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const q = query.replace(/\s+/g, "").toLowerCase();
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const shown = (accounts ?? []).filter((a) => test(a) && (!q || a.id.replace(/\s+/g, "").toLowerCase().includes(q)));

  const [signups, setSignups] = useState<SignupRequest[]>([]);
  const reload = useCallback(() => {
    listAccounts().then(setAccounts, (e) => setError(errorText(e)));
    listSignups().then(setSignups, () => setSignups([]));
  }, []);
  useEffect(reload, [reload]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    const id = newId.trim();
    run(async () => {
      const made = await createAccount(id, newRole, FIRST_PASSWORD);
      setNotice({ title: `${ROLE_NAME[made.role]} 계정을 만들었어요`, id: made.id, password: made.tempPassword });
      setNewId("");
    });
  }

  return (
    <>
      <TopBar title="길드원 관리" />
      {notice && (
        <Panel title={notice.title} className="notice">
          <p className="app-note">
            아이디 <b>{notice.id}</b>
            <br />
            처음 비밀번호 <b className="temp-pw">{notice.password}</b>
          </p>
          <p className="form-note">
            이 비밀번호를 본인에게 따로 알려 주세요. 처음 로그인하면 자기 비밀번호로 바꾸게 돼요.
          </p>
          <div className="links">
            <button className="btn btn-ghost" onClick={() => setNotice(null)}>확인</button>
          </div>
        </Panel>
      )}

      {/* 로그인 화면에서 본인이 보낸 아이디 생성 요청 (제작자 요청 2026-11-01). 승낙하면 그 비밀번호로 길드원 계정이 생긴다 */}
      {signups.length > 0 && (
        <section className="panel signup-requests">
          <h2 className="panel-title">아이디 생성 요청 {signups.length}</h2>
          {signups.map((s) => (
            <div key={s.id} className="signup-row">
              <b>{s.id}</b>
              <small>{new Date(s.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              <button className="pill pill-on" disabled={busy} onClick={() => run(() => decideSignup(s.id, "approve").then(() => undefined))}>
                승낙
              </button>
              <button className="pill" disabled={busy} onClick={() => run(() => decideSignup(s.id, "reject").then(() => undefined))}>
                거절
              </button>
            </div>
          ))}
        </section>
      )}

      <form className="panel form" onSubmit={create}>
        <h2 className="panel-title">계정 생성</h2>
        <label>
          아이디 (게임 닉네임)
          <input value={newId} onChange={(e) => setNewId(e.target.value)} autoCapitalize="off" />
        </label>
        {creatable.length > 1 && (
          <div className="role-pick">
            {creatable.map((r) => (
              <button key={r} type="button" className={"pill" + (newRole === r ? " pill-on" : "")} onClick={() => setNewRole(r)}>
                {ROLE_NAME[r]}
              </button>
            ))}
          </div>
        )}
        <button className="btn" disabled={busy || !newId.trim()}>
          {ROLE_NAME[creatable.includes(newRole) ? newRole : "member"]} 계정 만들기
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}

      {!accounts ? (
        <Loading />
      ) : (
        <>
          <h2 className="panel-title admin-count">
            길드원 {accounts.length}명{shown.length !== accounts.length && ` 중 ${shown.length}명`}
          </h2>
          <input className="mk-input admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 닉네임 찾기" aria-label="닉네임 찾기" />
          <div className="filter">
            {FILTERS.map((f) => (
              <button key={f.key} className={"pill" + (filter === f.key ? " pill-on" : "")} onClick={() => setFilter(f.key)}>
                {f.label} <small>{accounts.filter(f.test).length}</small>
              </button>
            ))}
          </div>
          <ul className="list account-list">
            {shown.slice(0, limit).map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                me={me}
                busy={busy}
                open={open === a.id}
                onOpen={() => setOpen(open === a.id ? null : a.id)}
                onReset={() =>
                  run(async () => {
                    const r = await resetPassword(a.id, FIRST_PASSWORD);
                    setNotice({ title: "비밀번호를 초기화했어요", id: r.id, password: r.tempPassword });
                  })
                }
                onRole={(role) => run(async () => void (await setRole(a.id, role)))}
                onDelete={() => run(async () => void (await deleteAccount(a.id)))}
                onChanged={reload}
              />
            ))}
          </ul>
          {shown.length > limit && (
            <div className="links">
              <button className="btn btn-ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                더 보기 ({shown.length - limit}명 더)
              </button>
            </div>
          )}
          {shown.length === 0 && <div className="empty">찾는 길드원이 없어요.</div>}
        </>
      )}
    </>
  );
}

/**
 * 계정 한 줄: 엠블럼, 닉네임, 길드와 레벨, 표시. 누르면 그 줄 아래로만 관리 칸이 펼쳐진다 (제작자 요청: 한 행으로).
 * 역할은 드롭다운 대신 세 칸 단추 (게임 위 위키 창 WebView 에서는 <select> 가 안 열려서)
 */
function AccountRow({
  account, me, busy, open, onOpen, onReset, onRole, onDelete, onChanged,
}: {
  account: Account;
  me: Me;
  busy: boolean;
  open: boolean;
  onOpen: () => void;
  onReset: () => void;
  onRole: (role: Role) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [growthLog, setGrowthLog] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newId, setNewId] = useState("");
  const manageable = account.id !== me.id && canManage(me.role, account.role);
  // 역할 바꾸기는 길드마스터 이상만 (오피서 임명/해제)
  const canRole = manageable && RANK[me.role] >= 2;

  return (
    <li className={"account" + (open ? " account-open" : "")}>
      <button className="account-row" onClick={onOpen} aria-expanded={open}>
        {account.job && account.level ? <JobEmblem job={account.job} level={account.level} size={30} /> : <span className="account-noemblem" />}
        <span className="account-main">
          <b className={account.highSpec ? "hs-text" : undefined}>{account.id}</b>
          <small>
            {account.guild ? `${GUILD_TIER[account.guild]} ${GUILD_NAME[account.guild]}` : "길드 안 정함"}
            {account.job && account.level ? ` · Lv.${account.level} ${JOB_NAME[account.job]}` : " · 직업·레벨 안 정함"}
          </small>
        </span>
        <span className="account-tags">
          {account.mustChange && <span className="role-badge muted">비밀번호 바꾸기 전</span>}
          {/* 앱개발자는 길드 직책이 아니라서 그냥 길드원으로 보인다 (제작자 요청: 앱 관리 표시도 빼고 순서도 길드원 자리) */}
          <span className="role-badge">{ROLE_NAME[positionOf(account.role)]}</span>
          {account.push && (
            <span className="push-mark" title={PUSH_MARK[account.push].text} aria-label={PUSH_MARK[account.push].text}>
              {PUSH_MARK[account.push].icon}
            </span>
          )}
        </span>
        <span className="account-more" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="account-panel">
          <div className="account-push">
            {account.push
              ? `${PUSH_MARK[account.push].icon} ${PUSH_MARK[account.push].text}` + (account.pushAt ? ` · ${new Date(account.pushAt).toLocaleDateString("ko-KR")} 확인` : "")
              : "폰 알림: 아직 모름 (새 버전을 연 적이 없음)"}
          </div>
          {canRole && (
            <div className="account-field">
              <span>역할</span>
              <div className="account-roles">
                {ASSIGNABLE.map((r) => (
                  <button
                    key={r}
                    className={"pill" + (account.role === r ? " pill-on" : "")}
                    disabled={busy || account.role === r || !canManage(me.role, r)}
                    onClick={() => onRole(r)}
                  >
                    {ROLE_NAME[r]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="account-actions">
            <button className="pill" disabled={busy} onClick={() => setEditing((e) => !e)}>
              {editing ? "닫기" : "정보 수정"}
            </button>
            {account.level && (
              <button className={"pill" + (growthLog ? " pill-on" : "")} disabled={busy} onClick={() => setGrowthLog((g) => !g)}>
                성장 기록
              </button>
            )}
            {/* 고스펙 표시: 랭킹에 '고스펙', 플래티넘 상점에서 고스펙 할인가 (제작자 요청) */}
            <button
              className={"pill" + (account.highSpec ? " pill-on" : "")}
              disabled={busy}
              onClick={async () => {
                setPhotoError("");
                try {
                  await setHighSpec(account.id, !account.highSpec);
                  onChanged();
                } catch (x) {
                  setPhotoError(errorText(x));
                }
              }}
            >
              고스펙
            </button>
            {account.avatar && (
              <button
                className="pill"
                disabled={busy}
                onClick={async () => {
                  setPhotoError("");
                  try {
                    await deleteAvatarOf(account.id);
                    onChanged();
                  } catch (x) {
                    setPhotoError(errorText(x));
                  }
                }}
              >
                사진 삭제
              </button>
            )}
            {manageable && (
              <>
                <button className="pill" disabled={busy} onClick={() => setRenaming((v) => !v)}>
                  닉네임 변경
                </button>
                <button className="pill" disabled={busy} onClick={onReset}>
                  비밀번호 초기화
                </button>
                {confirmDelete ? (
                  <>
                    <button className="pill pill-danger" disabled={busy} onClick={onDelete}>
                      삭제 확인
                    </button>
                    <button className="pill" onClick={() => setConfirmDelete(false)}>
                      취소
                    </button>
                  </>
                ) : (
                  <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                    계정 삭제
                  </button>
                )}
              </>
            )}
          </div>
          {renaming && (
            <div className="mk-actions">
              <input
                className="mk-input"
                value={newId}
                onChange={(e) => setNewId(e.target.value.slice(0, 20))}
                placeholder="새 닉네임"
                aria-label="새 닉네임"
                autoCapitalize="off"
              />
              <button
                className="pill"
                disabled={busy || !newId.trim()}
                onClick={async () => {
                  setPhotoError("");
                  try {
                    await renameAccount(account.id, newId.trim());
                    setRenaming(false);
                    onChanged();
                  } catch (x) {
                    setPhotoError(errorText(x));
                  }
                }}
              >
                변경
              </button>
            </div>
          )}
          {photoError && <p className="form-error">{photoError}</p>}
          {growthLog && <GrowthLog id={account.id} onChanged={onChanged} />}
          {editing && (
            <ProfileForm
              guild={account.guild}
              job={account.job}
              level={account.level}
              askChange
              submitLabel={`${account.id} 저장`}
              onSave={async (job, level, _exp, guild, change) => {
                await saveProfileOf(account.id, job, level, guild, change);
                setEditing(false);
                onChanged();
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`;
};

/**
 * 성장 기록 바로잡기 (제작자 요청: 잘못 쓴 것을 고쳤는데 레벨업·경험치 오름으로 잡힌 기록).
 * 레벨·경험치를 저장한 기록을 최근 것부터 보이고, 잘못 들어간 기록을 지우면 성장 랭킹이 다시 계산된다. 레벨업 ▲ 표시도 지울 수 있다
 */
function GrowthLog({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [log, setLog] = useState<LevelLogEntry[] | null>(null);
  const [badge, setBadge] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetchLevelLog(id).then(
      (r) => {
        setLog(r.log);
        setBadge(r.profile && r.profile.prevLevel !== null && r.profile.prevLevel < r.profile.level ? r.profile.level - r.profile.prevLevel : null);
      },
      (x) => setError(errorText(x)),
    );
  }, [id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      load();
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (!log) return <Loading error={error} />;
  return (
    <div className="growth-log">
      {badge !== null && (
        <button className="pill" disabled={busy} onClick={() => run(() => clearLevelBadge(id))}>
          ▲{badge} 표시 삭제
        </button>
      )}
      <ul className="lv-log">
        {log.map((e, i) => (
          <li key={e.at}>
            <span>
              {stamp(e.at)} · Lv.{e.level} {e.exp !== null ? expText(e.exp) : ""}
              {i === 0 && " (지금)"}
            </span>
            {i > 0 && (
              <button disabled={busy} onClick={() => run(() => deleteLevelLog(id, e.at))} aria-label="이 기록 삭제">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

