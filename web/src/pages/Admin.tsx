import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ROLE_NAME, RANK, canManage, createAccount, deleteAccount, errorText, listAccounts, positionOf, renameAccount, resetPassword,
  setRole,
} from "../auth";
import type { Account, Me, Role } from "../auth";
import { GUILD_NAME, GUILD_TIER, JOB_NAME, deleteAvatarOf, saveProfileOf } from "../auth";
import { JobEmblem } from "../emblems";
import { ProfileForm } from "./Profile";
import { Loading, Panel, TopBar } from "../ui";

/** '처음 비밀번호'를 비워 두고 초기화하면 쓰는 비밀번호 (제작자 요청). 다음 로그인 때 바꾸게 한다 */
const RESET_PASSWORD = "123123";

/** 길드원이 몇백 명이어도 처음엔 이만큼만 그리고 '더 보기' */
const PAGE_SIZE = 50;

type FilterKey = "all" | "main" | "second" | "staff" | "pw" | "noprofile";
/** 목록 거르기 칩 (제작자 요청: 길드원이 많아지면 찾기) */
const FILTERS: { key: FilterKey; label: string; test: (a: Account) => boolean }[] = [
  { key: "all", label: "전체", test: () => true },
  { key: "main", label: "1군", test: (a) => a.guild === "main" },
  { key: "second", label: "2군", test: (a) => a.guild === "second" },
  { key: "staff", label: "오피서 이상", test: (a) => a.role === "master" || a.role === "officer" },
  { key: "pw", label: "비밀번호 바꾸기 전", test: (a) => a.mustChange },
  { key: "noprofile", label: "직업·레벨 안 정함", test: (a) => !a.job || !a.level || !a.guild },
];

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
 * 경험치 %는 본인만 아는 값이라 여기에 보이지 않는다.
 */
export function AdminPage({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ title: string; id: string; password: string } | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [firstPw, setFirstPw] = useState("");
  const [busy, setBusy] = useState(false);

  const creatable = ASSIGNABLE.filter((r) => canManage(me.role, r));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const q = query.replace(/\s+/g, "").toLowerCase();
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const shown = (accounts ?? []).filter((a) => test(a) && (!q || a.id.replace(/\s+/g, "").toLowerCase().includes(q)));

  const reload = useCallback(() => {
    listAccounts().then(setAccounts, (e) => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);

  /** 정한 처음 비밀번호 (비웠으면 undefined: 서버가 임시 비밀번호를 만든다) */
  function chosenPassword(): string | undefined {
    if (firstPw && firstPw.length < 6) throw new Error("처음 비밀번호는 6자 이상으로 해 주세요");
    return firstPw || undefined;
  }

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
      const made = await createAccount(id, newRole, chosenPassword());
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
            <button className="btn btn-ghost" onClick={() => setNotice(null)}>확인했어요</button>
          </div>
        </Panel>
      )}

      <form className="panel form" onSubmit={create}>
        <h2 className="panel-title">계정 만들기</h2>
        <label>
          아이디 (게임 닉네임)
          <input value={newId} onChange={(e) => setNewId(e.target.value)} autoCapitalize="off" />
        </label>
        <label>
          처음 비밀번호 (비워 두면 자동으로 만들어요)
          <input value={firstPw} onChange={(e) => setFirstPw(e.target.value)} autoCapitalize="off" autoComplete="off" />
        </label>
        <p className="form-note">
          정하면 새 계정과 비밀번호 초기화에 이 비밀번호를 써요 (6자 이상). 비워 두면 새 계정은 임시 비밀번호, 초기화는 123123 이에요. 받은 사람은 처음 로그인할 때 자기 비밀번호로 바꿔요.
        </p>
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
                    const r = await resetPassword(a.id, chosenPassword() ?? RESET_PASSWORD);
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
          <b>{account.id}</b>
          <small>
            {account.guild ? `${GUILD_TIER[account.guild]} ${GUILD_NAME[account.guild]}` : "길드 안 정함"}
            {account.job && account.level ? ` · Lv.${account.level} ${JOB_NAME[account.job]}` : " · 직업·레벨 안 정함"}
          </small>
        </span>
        <span className="account-tags">
          {account.mustChange && <span className="role-badge muted">비밀번호 바꾸기 전</span>}
          {/* 앱개발자는 길드 직책이 아니라서 길드원으로 보이고, 앱 관리 권한은 따로 적는다 */}
          <span className="role-badge">{ROLE_NAME[positionOf(account.role)]}</span>
          {account.role === "developer" && <span className="role-badge muted">앱 관리</span>}
        </span>
        <span className="account-more" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="account-panel">
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
              {editing ? "정보 수정 닫기" : "정보 수정"}
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
                사진 내리기
              </button>
            )}
            {manageable && (
              <>
                <button className="pill" disabled={busy} onClick={() => setRenaming((v) => !v)}>
                  닉네임 바꾸기
                </button>
                <button className="pill" disabled={busy} onClick={onReset}>
                  비밀번호 초기화
                </button>
                {confirmDelete ? (
                  <>
                    <button className="pill pill-danger" disabled={busy} onClick={onDelete}>
                      정말 삭제
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
                바꾸기
              </button>
            </div>
          )}
          {photoError && <p className="form-error">{photoError}</p>}
          {editing && (
            <ProfileForm
              guild={account.guild}
              job={account.job}
              level={account.level}
              submitLabel={`${account.id} 저장`}
              onSave={async (job, level, _exp, guild) => {
                await saveProfileOf(account.id, job, level, guild);
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
