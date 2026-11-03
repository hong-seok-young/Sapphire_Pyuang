import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KakaoButton, KakaoField, useKakao } from "../kakao";
import type { FormEvent, ReactNode } from "react";
import {
  EXP_MAX, GUILDS, GUILD_NAME, GUILD_TIER, JOBS, JOB_NAME, MAX_LEVEL, ROLE_NAME, avatarUrl, deleteMyAvatar, errorText, expText,
  TEST_IDS, cancelDelete, fetchMe, logout, myDeleteRequest, positionOf, renameAccount, requestCharacter, requestDelete, saveMyProfile,
  setMainCharacter, switchAccount,
} from "../auth";
import type { ChangeKind, Guild, Job, Me } from "../auth";
import { JobEmblem, JobGlyph } from "../emblems";
import { ChangeAsk, HeroTitle, TopBar } from "../ui";
import { AvatarMaker } from "./AvatarMaker";
import { useBackToLogin } from "./Login";
import { WeatherFx, canUseWeather } from "./Weather";
import { PREVIEW, SKY_NAME, WxError, disableWeather, enableWeather, isDenied, loadWeather, permission, weatherOn } from "../weather";
import type { Sky } from "../weather";
import type { Weather } from "../weather";
import { goCharacter, refreshMe } from "../characters";

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
  askChange = false,
  submitLabel,
  onSave,
}: {
  guild: Guild | null;
  job: Job | null;
  level: number | null;
  exp?: number | null;
  withExp?: boolean;
  /** 레벨·경험치가 바뀌면 실제 성장인지 오타 수정인지 묻는다 (이미 정해 둔 값을 고칠 때) */
  askChange?: boolean;
  submitLabel: string;
  onSave: (job: Job, level: number, exp: number | null, guild: Guild, change?: ChangeKind) => Promise<void>;
}) {
  const [guild, setGuild] = useState<Guild | null>(startGuild);
  const [job, setJob] = useState<Job | null>(startJob);
  const [level, setLevel] = useState(startLevel ? String(startLevel) : "");
  const [exp, setExp] = useState(startExp !== null ? (startExp / 1000).toFixed(3) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const n = Number(level);
  const expValue = withExp ? parseExp(exp) : null;
  const ok = guild !== null && job !== null && Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL && expValue !== undefined;

  async function save(change?: ChangeKind) {
    if (!ok || expValue === undefined || guild === null) return;
    setBusy(true);
    setError("");
    try {
      await onSave(job, n, expValue, guild, change);
      setAsking(false);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    // 이미 있던 레벨·경험치를 바꾸면 먼저 묻는다 (제작자 요청: 잘못 쓴 것을 고친 게 레벨업으로 잡히지 않게)
    // 경험치를 처음 적는 것만이면 묻지 않는다 (성장이 아니라서 서버가 고침처럼 저장한다)
    const changed = startLevel !== null && (n !== startLevel || (withExp && startExp !== null && expValue !== startExp));
    if (askChange && changed) setAsking(true);
    else save();
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
            <JobGlyph job={j} size={22} />
            <span>{JOB_NAME[j]}</span>
          </button>
        ))}
      </div>
      {/* 레벨과 경험치는 늘 한 줄 (제작자 요청 2026-11-02) */}
      <div className="level-line">
      <div className="level-row">
        <span className="level-label">Lv</span>
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
          <div className="level-row level-row-exp">
            <span className="level-label">EXP</span>
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
      )}
      </div>
      {withExp && expValue === undefined && <p className="form-error">경험치는 0 ~ 99.999 사이로, 소수점 3자리까지 적어 주세요.</p>}
      {error && <p className="form-error">{error}</p>}
      {asking ? (
        <ChangeAsk busy={busy} onPick={(c) => save(c)} onCancel={() => setAsking(false)} />
      ) : (
        <button className="btn" disabled={busy || !ok}>
          {busy ? "저장하는 중…" : submitLabel}
        </button>
      )}
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
          <img className="hero-mark" src="guild-mark.png" alt="" width={72} height={72} />
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

type MenuKey = "info" | "photo" | "chars" | "rename" | "kakao" | "weather" | "test";

/** 펼치는 줄의 오른쪽 꺾쇠 (이모지·글자 대신 선으로 그린다, 펼치면 아래로) */
const Chevron = () => <span className="me-chev" aria-hidden />;

/** 설정 목록의 한 줄: 누르면 그 아래로 펼친다 (한 번에 하나) */
function MeRow({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={"me-item" + (open ? " me-item-open" : "")}>
      <button type="button" className="me-row" aria-expanded={open} onClick={onToggle}>
        <span className="me-row-label">{label}</span>
        {value && <span className="me-row-value">{value}</span>}
        <Chevron />
      </button>
      {open && <div className="me-row-body">{children}</div>}
    </div>
  );
}

/** 묶음: 작은 제목과 그 아래 줄들 */
function MeGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="me-group">
      <h2 className="me-group-title">{title}</h2>
      <div className="panel me-menu">{children}</div>
    </section>
  );
}

/**
 * 내 정보 (제작자 요청 2026-11-02 '고도화, 길드 랭킹은 왜 여기 있어 빼, 버튼 정돈' -> '카테고리화하고 누르면 열리게, 이모지 다 빼고'):
 * 맨 위 내 카드(사진이나 직업 엠블럼, 길드·직책 표, 직업·레벨, 경험치 막대)는 늘 보이고, 나머지는 묶음마다 한 줄씩 접혀 있다가 누르면 그 아래로 펼친다 (한 번에 하나).
 * 캐릭터: 캐릭터 정보(길드·직업·레벨·경험치) · 캐릭터 사진 · 내 캐릭터(묶은 캐릭터와 추가 요청)
 * 계정: 닉네임 변경 · 비밀번호 변경 · 카톡 오픈프로필 / 개발자(앱개발자만): 테스트 계정 / 맨 아래 로그아웃
 */
export function MePage({ me, onMe, onLogout }: { me: Me; onMe: (p: Partial<Me>) => void; onLogout: () => void }) {
  const [saved, setSaved] = useState(false);
  // '#/me?open=kakao' 처럼 줄을 펼친 채로 연다 (내 글의 흐린 '카톡'을 누르면 카톡 오픈프로필로)
  const [open, setOpen] = useState<MenuKey | null>(() => {
    const k = new URLSearchParams(location.hash.split("?")[1] ?? "").get("open");
    return k === "kakao" || k === "photo" || k === "info" || k === "weather" ? k : null;
  });
  const { links } = useKakao();
  const [wxOn, setWxOn] = useState(weatherOn);
  const row = (k: MenuKey) => ({ open: open === k, onToggle: () => setOpen((o) => (o === k ? null : k)) });
  // 직책은 지금 캐릭터의 것 (me.role 은 묶은 캐릭터 중 가장 높은 권한)
  const myRole = me.characters?.find((c) => c.id === me.id)?.role ?? me.role;
  const chars = me.characters?.length ?? 0;
  const pending = me.pendingCharacters?.length ?? 0;
  return (
    <>
      <TopBar title="내 정보" />
      <section className="panel me-hero">
        <div className="me-hero-top">
          <div className="me-face">
            {me.avatar ? (
              <img className="growth-face" src={avatarUrl(me.id, me.avatar)} alt="내 캐릭터" />
            ) : (
              me.job && me.level && <JobEmblem job={me.job} level={me.level} size={64} />
            )}
          </div>
          <div className="me-main">
            <div className="me-name">{me.id}</div>
            <div className="me-tags">
              {me.guild && (
                <span className={"me-tag me-tag-" + me.guild}>
                  {GUILD_TIER[me.guild]} {GUILD_NAME[me.guild]}
                </span>
              )}
              <span className="me-tag">{ROLE_NAME[positionOf(myRole)]}</span>
            </div>
            {me.job && (
              <div className="me-job">
                <JobGlyph job={me.job} size={14} />
                {JOB_NAME[me.job]}
                {me.level && <b>Lv.{me.level}</b>}
              </div>
            )}
          </div>
        </div>
        <div className="me-exp">
          <span className="me-exp-label">EXP</span>
          <span className="me-exp-track">
            <i style={{ width: `${Math.min(100, (me.exp ?? 0) / 1000)}%` }} />
          </span>
          <small>{me.exp !== null ? expText(me.exp) : "미입력"}</small>
        </div>
      </section>

      <MeGroup title="캐릭터">
        <MeRow label="캐릭터 정보" value={me.level ? `Lv.${me.level}` : "미정"} {...row("info")}>
          <ProfileForm
            key={`${me.guild}-${me.job}-${me.level}-${me.exp}`}
            guild={me.guild}
            job={me.job}
            level={me.level}
            exp={me.exp}
            withExp
            askChange
            submitLabel="저장"
            onSave={async (job, level, exp, guild, change) => {
              await saveMyProfile(job, level, exp, guild, change);
              onMe({ job, level, exp, guild });
              setSaved(true);
            }}
          />
          {saved && <p className="form-note">저장했어요.</p>}
        </MeRow>
        <MeRow label="캐릭터 사진" value={me.avatar ? "등록됨" : "없음"} {...row("photo")}>
          <AvatarBody me={me} onMe={onMe} />
        </MeRow>
        <MeRow label="내 캐릭터" value={pending ? `승낙 대기 ${pending}` : chars > 1 ? `${chars}개` : undefined} {...row("chars")}>
          <CharactersBody me={me} />
        </MeRow>
      </MeGroup>

      <MeGroup title="계정">
        <MeRow label="닉네임 변경" {...row("rename")}>
          <RenameBody me={me} onMe={onMe} />
        </MeRow>
        <a className="me-item me-row" href="#/password">
          <span className="me-row-label">비밀번호 변경</span>
          <Chevron />
        </a>
        {/* 카톡 오픈프로필 링크 (제작자 요청 2026-11-02): 장비대여·중개인·의뢰소에서 이름 옆 '카톡' 단추로 열린다 */}
        <MeRow label="카톡 오픈프로필" value={links[me.id] ? "등록됨" : "없음"} {...row("kakao")}>
          <KakaoField name={me.id} />
          <KakaoWhere me={me} link={!!links[me.id]} />
        </MeRow>
      </MeGroup>

      {/* 날씨 반영 (제작자 요청 2026-11-02 '내 정보에서 위치 허용하게, 날씨 반영된다고'). 쓰는 사람에게만 (canUseWeather, 지금은 모두) */}
      {canUseWeather(me) && (
        <MeGroup title="앱 설정">
          <MeRow label="날씨 반영" value={wxOn ? "켜짐" : "꺼짐"} {...row("weather")}>
            <WeatherBody on={wxOn} onChange={setWxOn} />
          </MeRow>
        </MeGroup>
      )}

      {/* 앱개발자만: 테스트 계정으로 바꿔서 상대방 쪽 화면과 알림을 혼자 시험한다 (제작자 요청) */}
      {me.role === "developer" && (
        <MeGroup title="개발자">
          <MeRow label="테스트 계정" {...row("test")}>
            <div className="pill-row me-pills">
              {TEST_IDS.map((id) => (
                <button
                  key={id}
                  className="pill"
                  onClick={async () => {
                    await switchAccount(id);
                    location.hash = "#/";
                    location.reload();
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
          </MeRow>
        </MeGroup>
      )}

      <button
        type="button"
        className="btn btn-ghost me-logout"
        onClick={async () => {
          await logout().catch(() => undefined);
          onLogout();
        }}
      >
        로그아웃
      </button>
      {me.role !== "developer" && <DeleteAccountText me={me} />}
    </>
  );
}

/**
 * 로그아웃 아래 회색 작은 글씨 '계정 삭제' (제작자 요청 2026-11-02: 단추 말고 글씨만, 오피서가 승낙하면 지워지게).
 * 누르면 한 번 더 묻고(글씨로) 요청, 요청한 뒤에는 '계정 삭제 요청함 · 승낙 대기 · 요청 취소'. 지금 캐릭터만 지운다
 */
function DeleteAccountText({ me }: { me: Me }) {
  const [at, setAt] = useState<number | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    myDeleteRequest().then((r) => setAt(r.at), () => setAt(null));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  if (at === undefined) return null;
  return (
    <div className="me-delete">
      {at ? (
        <>
          <span>계정 삭제 요청함 · 운영진 승낙 대기</span>
          <button type="button" className="me-delete-link" disabled={busy} onClick={() => run(async () => (await cancelDelete(), setAt(null)))}>
            요청 취소
          </button>
        </>
      ) : asking ? (
        <>
          <span>{me.id} 계정을 지울까요? 운영진이 승낙하면 기록과 함께 지워져요.</span>
          <button
            type="button"
            className="me-delete-link me-delete-go"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await requestDelete();
                setAt(Date.now());
                setAsking(false);
              })
            }
          >
            삭제 요청
          </button>
          <button type="button" className="me-delete-link" disabled={busy} onClick={() => setAsking(false)}>
            취소
          </button>
        </>
      ) : (
        <button type="button" className="me-delete-link" onClick={() => setAsking(true)}>
          계정 삭제
        </button>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/**
 * 카톡 오픈프로필 단추가 다른 길드원 화면에서 실제로 어떻게 보이는지 (제작자 요청 2026-11-02: '그게 보이는 메뉴에서 실제로 그 화면에서 어케 보이는지').
 * 그 화면들의 줄을 같은 모양(.mk-meta, .rent-app-head)으로 작게 그린다. 저장해 두었으면 단추를 눌러 열어 본다
 */
function KakaoWhere({ me, link }: { me: Me; link: boolean }) {
  const btn = link ? <KakaoButton name={me.id} /> : <span className="kakao-btn kakao-btn-off">카톡</span>;
  return (
    <div className="me-kw">
      <p className="me-kw-head">{link ? "다른 길드원 화면에서 이렇게 보여요" : "링크를 저장하면 이렇게 보여요"}</p>
      <div className="me-kw-card">
        <small className="me-kw-where">게시판 · 내 글과 댓글</small>
        <div className="bd-meta">
          <b>{me.id}</b>
          {btn}
          <span>3분 전 · 👁 12</span>
        </div>
      </div>
      <div className="me-kw-card">
        <small className="me-kw-where">중개인 · 골드 · 의뢰소 · 내 줄</small>
        <p className="mk-meta">
          {me.id} {btn}
        </p>
      </div>
      <div className="me-kw-card">
        <small className="me-kw-where">장비대여 · 운영진이 보는 내 신청서와 반납</small>
        <div className="rent-app-head">
          <b>{me.id}</b>
          {btn}
          <small>11/2 21:40</small>
        </div>
      </div>
    </div>
  );
}

/** 날씨 반영 켜기·끄기: 켜면 폰이 위치 허락을 묻고, 우리 동네 날씨가 홈 화면에 반영된다 (pages/Weather.tsx, src/weather.ts) */
function WeatherBody({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const [preview, setPreview] = useState<Sky | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<Weather | null>(null);
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    void permission().then((p) => setBlocked(p === "denied"));
    if (on) loadWeather().then(setNow, () => undefined);
  }, [on]);
  async function enable() {
    setBusy(true);
    setNote("");
    try {
      setNow(await enableWeather());
      onChange(true);
    } catch (e) {
      if (isDenied(e)) {
        setBlocked(true);
        onChange(false);
      } else {
        // 위치나 날씨 서버가 잠깐 안 되는 것: 켜 둔 채로 두면 홈이 다시 받는다
        onChange(true);
        setNote(e instanceof WxError && e.kind === "net" ? "날씨 연결이 안 돼요. 홈에서 다시 받아요." : "위치를 못 받았어요. 홈에서 다시 받아요.");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/* 천둥번개 효과는 없앴다 (비로 그린다). 눈은 쌓이고 비는 빗물이 점점 차오른다 (제작자 요청 2026-11-02) */}
      <p className="me-hint me-hint-top">위치를 허용하면 우리 동네 날씨가 홈 화면에 반영돼요. 눈이 오면 아래에 눈이 쌓이고, 비가 오면 빗물이 점점 차올라요. 홈 화면의 빈 곳을 누르면 그 자리에서 눈이나 비가 터져 나와요.</p>
      {/* 미리 보기: 이 화면 위에 바로 (다시 누르면 멈춤, 화면을 나가면 멈춤) */}
      <div className="pill-row me-wx-preview">
        {PREVIEW.map((sky) => (
          <button key={sky} className={"pill" + (preview === sky ? " pill-on" : "")} onClick={() => setPreview(preview === sky ? null : sky)}>
            {SKY_NAME[sky]}
          </button>
        ))}
      </div>
      {/* 화면이 떠오르는 효과(.page 의 transform) 안에서는 화면에 고정되지 않아서 body 에 그린다 */}
      {preview && createPortal(<WeatherFx key={preview} sky={preview} />, document.body)}
      {on && now && (
        <p className="me-wx-now">
          지금 <b>{SKY_NAME[now.sky]}</b>
          {now.temp !== null && ` ${now.temp}°`}
        </p>
      )}
      {blocked && !on && <p className="form-error">위치가 막혀 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.</p>}
      {note && <p className="form-note">{note}</p>}
      {on ? (
        <button
          className="btn btn-ghost me-wide"
          onClick={() => {
            disableWeather();
            onChange(false);
            setNow(null);
          }}
        >
          끄기
        </button>
      ) : (
        <button className="btn me-wide" disabled={busy} onClick={() => void enable()}>
          {busy ? "위치 받는 중…" : "위치 허용"}
        </button>
      )}
      <p className="me-hint">위치는 날씨를 묻는 데만 쓰고 서버에 저장하지 않아요.</p>
    </>
  );
}

/** 내 캐릭터 사진: 성장 랭킹에 나온다 (1등이면 크게). 스샷에서 직접 잘라 올린다 (AvatarMaker) */
function AvatarBody({ me, onMe }: { me: Me; onMe: (p: Partial<Me>) => void }) {
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (making)
    return (
      <AvatarMaker
        onSaved={(avatar) => {
          onMe({ avatar });
          setMaking(false);
        }}
        onCancel={() => setMaking(false)}
      />
    );
  return (
    <>
      {me.avatar && (
        <div className="avatar-current">
          <img className="growth-face" src={avatarUrl(me.id, me.avatar)} alt="내 캐릭터" />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="me-acts">
        <button type="button" className="btn" onClick={() => setMaking(true)}>
          {me.avatar ? "사진 변경" : "사진 등록"}
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
            사진 삭제
          </button>
        )}
      </div>
    </>
  );
}

/**
 * 내 캐릭터 (부캐 묶기, 제작자 요청 2026-11-01): 묶은 캐릭터 목록(눌러서 바꾸기, 부캐 옆 '본캐 지정')과 '캐릭터 추가' 요청.
 * 추가한 캐릭터는 길드마스터·오피서가 '길드원 관리'에서 승낙해야 생긴다. 로그인은 본캐 아이디와 비밀번호로
 */
function CharactersBody({ me }: { me: Me }) {
  const list = me.characters ?? [];
  const [pending, setPending] = useState(me.pendingCharacters ?? []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {list.length > 0 && (
        <div className="char-list">
          {list.map((c) => (
            <div key={c.id} className="char-row">
              <button
                className={"char-item" + (c.id === me.id ? " char-on" : "")}
                disabled={busy}
                onClick={() => c.id !== me.id && run(() => goCharacter(c.id).catch((x) => (refreshMe(), Promise.reject(x))))}
              >
                <span className="char-name">
                  <b>{c.id}</b>
                  <small>
                    {c.main ? "본캐 (로그인 아이디)" : "부캐"}
                    {c.level ? ` · Lv.${c.level}` : ""}
                    {c.job ? ` ${JOB_NAME[c.job]}` : ""}
                  </small>
                </span>
                {c.id === me.id && <span className="char-now">지금</span>}
              </button>
              {/* 주력 캐릭터가 바뀌면 본캐를 바꾼다 (제작자 요청): 비밀번호는 그대로, 로그인 아이디만 이 캐릭터로 */}
              {!c.main && (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await setMainCharacter(c.id).catch((x) => (refreshMe(), Promise.reject(x)));
                      await goCharacter(me.id); // 지금 캐릭터 그대로 새로 연다 (캐릭터를 바꾼 것처럼 오픈 축하는 다시 안 띄운다)
                    })
                  }
                >
                  본캐 지정
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {pending.length > 0 && <p className="form-note">승낙 대기: {pending.join(", ")}</p>}
      {adding ? (
        <div className="me-add">
          <input
            className="mk-input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            placeholder="추가할 캐릭터 닉네임"
            aria-label="캐릭터 닉네임"
            autoCapitalize="off"
            autoFocus
          />
          <div className="me-acts">
            <button
              className="btn"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  const r = await requestCharacter(name.trim());
                  setPending((p) => [...p, r.id]);
                  setName("");
                  setAdding(false);
                })
              }
            >
              추가 요청
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setAdding(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost me-wide" onClick={() => setAdding(true)}>
          캐릭터 추가
        </button>
      )}
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

/**
 * 닉네임 바꾸기 (제작자 요청: 키우는 캐릭터를 바꾸거나 캐릭터를 사는 일이 있어서). 다음 로그인부터 새 닉네임으로 들어온다.
 * '캐릭터 변경'을 고르면 새 캐릭터의 직업, 레벨도 같이 적고 성장 랭킹을 그 레벨부터 새로 센다
 */
function RenameBody({ me, onMe }: { me: Me; onMe: (p: Partial<Me>) => void }) {
  const [newId, setNewId] = useState("");
  const [switched, setSwitched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const name = newId.trim();

  async function rename(character?: { job: Job; level: number; exp: number | null; guild: Guild }) {
    setBusy(true);
    setError("");
    try {
      const r = await renameAccount(me.id, name, character);
      onMe({ id: r.id, ...(character ?? {}) });
      // 묶은 캐릭터 목록(👤, 내 캐릭터)도 새 닉네임으로: 서버의 내 정보를 다시 받는다
      void fetchMe().then(onMe, () => undefined);
      setDone(`'${r.id}'(으)로 바꿨어요. 다음 로그인부터 새 닉네임으로 들어와요.`);
      setNewId("");
      setSwitched(false);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        className="mk-input me-input"
        value={newId}
        onChange={(e) => setNewId(e.target.value.slice(0, 20))}
        autoCapitalize="off"
        placeholder="새 닉네임"
        aria-label="새 닉네임"
      />
      <div className="pill-row me-pills">
        <button type="button" className={"pill" + (!switched ? " pill-on" : "")} onClick={() => setSwitched(false)}>
          닉네임만
        </button>
        <button type="button" className={"pill" + (switched ? " pill-on" : "")} onClick={() => setSwitched(true)}>
          캐릭터 변경
        </button>
      </div>
      {switched ? (
        <ProfileForm
          guild={me.guild}
          job={me.job}
          level={null}
          withExp
          submitLabel={busy ? "바꾸는 중…" : "변경"}
          onSave={async (job, level, exp, guild) => {
            if (!name) throw new Error("새 닉네임을 적어 주세요");
            await rename({ job, level, exp, guild });
          }}
        />
      ) : (
        <button className="btn me-wide" disabled={busy || !name} onClick={() => rename()}>
          {busy ? "바꾸는 중…" : "닉네임 변경"}
        </button>
      )}
      {error && <p className="form-error">{error}</p>}
      {done && <p className="form-note">{done}</p>}
    </>
  );
}
