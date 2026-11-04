import { Component, Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { NEED_LOGIN, loadWiki, useAsync } from "./data";
import { go, useRoute } from "./router";
import {
  goCharacter,
  justSwitched,
  onRefreshMe,
  personOf,
  setMyCharacters,
} from "./characters";
import { resetFavorites } from "./favorites";
import { DevSoon, FitLine, PixelIcon, Loading, NotFound } from "./ui";
import { Home, HomeCorner, InfoPage, TileIcon } from "./pages/Home";
import { HomeWeather } from "./pages/Weather";
import {
  canPreview,
  canSee,
  clickItem,
  isLocked,
  isUpdated,
  itemOf,
  loadLayout,
  pressItem,
  setEditing,
  useLauncher,
} from "./launcher";
import type { LaunchItem } from "./launcher";
import { markNewsSeen, newsFor, refreshNews, startNews, useNews } from "./news";
import { Search } from "./pages/Search";
import { Places, PlacePage } from "./pages/Places";
import { ItemPage, MonsterPage } from "./pages/Detail";
import { EquipSlot, EquipSlots } from "./pages/Equip";
import { PostPage } from "./pages/Posts";
import { MenuPage } from "./pages/Menus";
import { AppPage } from "./pages/AppPage";
import {
  AppClosedPage,
  IconChangedPage,
  InstallGuide,
  iconNoticeNeeded,
} from "./pages/InstallGuide";
import {
  APP_OPEN,
  ICON_CHANGED_AT,
  inApp,
  isAndroid,
  isIOS,
  standalone,
} from "./platform";
import { LoginPage, PasswordPage } from "./pages/Login";
import { GuideHost } from "./tutorial";
import { Opening, shouldCelebrate } from "./pages/Opening";
import { reportOpen, reportView } from "./activity";
import { markMenuVisit } from "./updates";
import { ensurePush, reportPush } from "./push";
import {
  ApiError,
  JOB_NAME,
  RANK,
  TEST_IDS,
  errorText,
  fetchMe,
  switchAccount,
} from "./auth";
import { appMenu } from "./platform";
import type { Me } from "./auth";

// 자주 안 쓰는 화면은 따로 떼어 처음엔 받지 않는다 (2026-11-03 렉 검토: 코드 한 덩어리 558KB 를 폰이 다 읽고서야 홈이 떴다).
// 홈·정보·위키 화면·로그인·오픈 축하·튜토리얼은 그대로 한 덩어리. 떼어 둔 화면은 처음 들어갈 때 한 번 받고(잠깐 '불러오는 중'), 배포 뒤 옛 조각을 못 찾으면
// index.html 의 vite:preloadError 가 새로 불러온다
// 화면 조각을 받는 곳 (lazy 와 미리 받기가 같은 것을 쓴다: 한 번 받으면 다시 받지 않는다)
const CHUNKS = {
  Chat: () => import("./pages/Chat"),
  Admin: () => import("./pages/Admin"),
  Profile: () => import("./pages/Profile"),
  Ranking: () => import("./pages/Ranking"),
  Market: () => import("./pages/Market"),
  Requests: () => import("./pages/Requests"),
  Enhance: () => import("./pages/Enhance"),
  Simulator: () => import("./pages/Simulator"),
  Trend: () => import("./pages/Trend"),
  ActivityLog: () => import("./pages/ActivityLog"),
  Alerts: () => import("./pages/Alerts"),
  ChatGaps: () => import("./pages/ChatGaps"),
  PlatShop: () => import("./pages/PlatShop"),
  Board: () => import("./pages/Board"),
  Official: () => import("./pages/Official"),
  PatchNotes: () => import("./pages/PatchNotes"),
  Odds: () => import("./pages/Odds"),
  Todo: () => import("./pages/Todo"),
  Rental: () => import("./pages/Rental"),
  GuildDungeon: () => import("./pages/GuildDungeon"),
};
const ChatPage = lazy(() => CHUNKS.Chat().then((m) => ({ default: m.ChatPage })));
const AdminPage = lazy(() => CHUNKS.Admin().then((m) => ({ default: m.AdminPage })));
const MePage = lazy(() => CHUNKS.Profile().then((m) => ({ default: m.MePage })));
const ProfileSetupPage = lazy(() => CHUNKS.Profile().then((m) => ({ default: m.ProfileSetupPage })));
const RankingPage = lazy(() => CHUNKS.Ranking().then((m) => ({ default: m.RankingPage })));
const MarketPage = lazy(() => CHUNKS.Market().then((m) => ({ default: m.MarketPage })));
const RequestsPage = lazy(() => CHUNKS.Requests().then((m) => ({ default: m.RequestsPage })));
const EnhancePage = lazy(() => CHUNKS.Enhance().then((m) => ({ default: m.EnhancePage })));
const SimulatorPage = lazy(() => CHUNKS.Simulator().then((m) => ({ default: m.SimulatorPage })));
const TrendPage = lazy(() => CHUNKS.Trend().then((m) => ({ default: m.TrendPage })));
const ActivityLogPage = lazy(() => CHUNKS.ActivityLog().then((m) => ({ default: m.ActivityLogPage })));
const AlertsPage = lazy(() => CHUNKS.Alerts().then((m) => ({ default: m.AlertsPage })));
const ChatGapsPage = lazy(() => CHUNKS.ChatGaps().then((m) => ({ default: m.ChatGapsPage })));
const PlatShopPage = lazy(() => CHUNKS.PlatShop().then((m) => ({ default: m.PlatShopPage })));
const BoardPage = lazy(() => CHUNKS.Board().then((m) => ({ default: m.BoardPage })));
const OfficialPostPage = lazy(() => CHUNKS.Official().then((m) => ({ default: m.OfficialPostPage })));
const PatchNotesPage = lazy(() => CHUNKS.PatchNotes().then((m) => ({ default: m.PatchNotesPage })));
const OddsPage = lazy(() => CHUNKS.Odds().then((m) => ({ default: m.OddsPage })));
const OddsTablePage = lazy(() => CHUNKS.Odds().then((m) => ({ default: m.OddsTablePage })));
const TodoPage = lazy(() => CHUNKS.Todo().then((m) => ({ default: m.TodoPage })));
const RentalPage = lazy(() => CHUNKS.Rental().then((m) => ({ default: m.RentalPage })));
const GuildDungeonPage = lazy(() => CHUNKS.GuildDungeon().then((m) => ({ default: m.GuildDungeonPage })));

/**
 * 홈이 뜬 뒤 쉬는 때에 자주 여는 화면의 조각을 하나씩 미리 받아 둔다 (제작자 2026-11-04 '화면 전환이나 버튼 동작별로 반응이 늦거나 렉').
 * 처음 들어갈 때 '불러오는 중' 없이 바로 열린다. 데이터 아끼기(saveData)나 2G 면 받지 않는다. 운영진 화면은 운영진만
 */
function prefetchPages(staff: boolean, master: boolean) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "")) return () => undefined;
  const list: (keyof typeof CHUNKS)[] = ["Board", "Ranking", "Market", "Todo", "GuildDungeon", "Requests", "Rental", "Chat", "Profile", "Alerts", "PlatShop", "Official"];
  if (staff) list.push("Admin");
  if (master) list.push("ActivityLog", "ChatGaps");
  let stop = false;
  let timer = 0;
  const idle = (fn: () => void) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 3000 });
    else window.setTimeout(fn, 300);
  };
  const next = () => {
    const k = list.shift();
    if (stop || !k) return;
    void CHUNKS[k]()
      .catch(() => undefined)
      .then(() => {
        timer = window.setTimeout(() => idle(next), 150);
      });
  };
  timer = window.setTimeout(() => idle(next), 1500);
  return () => {
    stop = true;
    window.clearTimeout(timer);
  };
}

/**
 * 아래 탭은 사람마다 배치가 다르다 (src/launcher.ts, 제작자 요청 2026-11-01: 폰 홈 화면처럼 홈 칸과 아래 탭을 오가며 옮기기).
 * 처음에는 홈 · 게시판 · 검색 · 정보 · 챗봇. 아이콘은 아이모 그림과 어울리는 픽셀 그림 (public/icons), 없으면 칸 그림.
 * 안드로이드 앱 안에서만 보이는 '앱' 탭(시계 설정, 게임 위에 띄우기)은 배치와 상관없이 맨 끝 (게임 위 위키 창 안에서는 숨김).
 */
const APP_TAB: LaunchItem = {
  key: "apptab",
  title: "앱",
  to: "#/app",
  icon: "⏰",
  match: ["app"],
};

/**
 * 위키는 길드원만 본다. 로그인 전에는 로그인 화면, 임시 비밀번호로 들어오면 비밀번호 바꾸기 화면만 보인다.
 * 직업과 레벨을 아직 안 정했으면 (새 계정, 길드 랭킹 전부터 있던 계정) 그걸 정하는 화면이 먼저 뜬다.
 * (위키 자료 data/*.json 은 서버에서도 로그인한 사람에게만 준다: functions/data/_middleware.ts)
 */
export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = 확인 중
  // 폰 브라우저로 열면 처음에 홈 화면 설치 안내 ('나중에'를 누르면 이번에 연 동안은 다시 안 보인다)
  const [guide, setGuide] = useState(() => {
    try {
      if (sessionStorage.getItem("sapphire-install-later")) return false;
    } catch {
      // 못 읽으면 안내를 보인다
    }
    return !inApp && (isAndroid || isIOS) && !standalone();
  });
  const later = useCallback(() => {
    try {
      sessionStorage.setItem("sapphire-install-later", "1");
    } catch {
      // 못 적어도 이번 화면에서는 닫힌다
    }
    setGuide(false);
  }, []);
  // 홈 화면 아이콘이 바뀌었으면 홈 화면 웹앱으로 연 사람에게 지우고 다시 설치하라고 한 번 안내 (제작자 요청)
  const [iconNotice, setIconNotice] = useState(iconNoticeNeeded);
  // 앱 안 '검토 후 오픈' 화면에서 '개발자 로그인'을 눌렀는지
  const [appLogin, setAppLogin] = useState(false);
  // 로그인 확인이 인터넷이나 서버 문제로 안 됐을 때 (로그아웃이 아니다)
  const [bootError, setBootError] = useState("");
  const [bootTry, setBootTry] = useState(0);
  useEffect(() => {
    // 위키 자료도 같이 받기 시작한다 (로그인 확인이 끝나기를 기다리지 않게)
    void loadWiki().catch(() => undefined);
    fetchMe().then(setMe, (e) => {
      // 로그인이 풀린 것(401)만 로그인 화면으로. 인터넷이 잠깐 끊기거나 서버 오류면 다시 시도한다
      // (제작자 요청: 로그인은 직접 로그아웃하기 전까지 유지. 2026-11-01 검토)
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setBootError(errorText(e));
    });
  }, [bootTry]);
  // 내 정보를 다시 받는다: 부탁받았을 때(길드원 관리에서 내 캐릭터를 묶거나 뗀 뒤 등)와 앱으로 돌아올 때(1분에 한 번까지).
  // 다른 사람이 내 캐릭터를 묶거나 떼도 앱을 껐다 켜지 않아도 맞춰진다
  useEffect(() => {
    let last = Date.now();
    const refresh = (force: boolean) => {
      if (!force && Date.now() - last < 60_000) return;
      last = Date.now();
      fetchMe().then(
        (fresh) => setMe((cur) => (cur ? fresh : cur)),
        (e) => e instanceof ApiError && e.status === 401 && setMe(null),
      );
    };
    const onVisible = () => !document.hidden && refresh(false);
    document.addEventListener("visibilitychange", onVisible);
    const stop = onRefreshMe(() => refresh(true));
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, []);
  // 로그인한 뒤 쉬는 때에 자주 여는 화면 조각을 미리 받아 둔다
  const loggedRole = me ? me.role : null;
  useEffect(() => {
    if (!loggedRole) return;
    return prefetchPages(RANK[loggedRole] >= 1, RANK[loggedRole] >= 2);
  }, [loggedRole]);
  // 다시 연결되거나 앱으로 돌아오면 저절로 다시
  useEffect(() => {
    if (!bootError) return;
    const retry = () => {
      setBootError("");
      setBootTry((n) => n + 1);
    };
    const onVisible = () => !document.hidden && retry();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bootError]);

  if (guide) return <InstallGuide onLater={later} />;

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page">
          <Loading
            error={bootError || undefined}
            onRetry={() => {
              setBootError("");
              setBootTry((n) => n + 1);
            }}
          />
        </main>
      </div>
    );
  }
  // 아이콘 다시 설치 안내 (제작자 요청 2026-11-01: 새 아이콘인 사람에게는 절대 안 뜨게, 로그인한 뒤 판을 보고).
  // 홈 화면 웹앱이 시작 주소에 지금 아이콘 판(?icon=) 없이 열렸고(iconNoticeNeeded: 재설치 완료나 새 판으로 연 적이 있으면 빠짐),
  // 아이콘을 바꾸기 전부터 있던 계정일 때만. 그 뒤 만든 계정은 새 아이콘으로 깔았다. 앱개발자는 이미 새 아이콘이라 뺀다
  if (
    iconNotice &&
    me &&
    me.role !== "developer" &&
    (me.createdAt ?? 0) < ICON_CHANGED_AT
  ) {
    return <IconChangedPage onDone={() => setIconNotice(false)} />;
  }
  // 안드로이드 앱은 검토 후 오픈: 이미 깐 앱 안에서는 웹으로 안내만 한다. 앱개발자(퓨앙)는 그대로 쓴다 (제작자 요청)
  if (inApp && !APP_OPEN && me?.role !== "developer") {
    if (me === null && appLogin) return <LoginPage onLogin={setMe} />;
    return (
      <AppClosedPage
        onLogin={me === null ? () => setAppLogin(true) : undefined}
      />
    );
  }
  if (me === null) return <LoginPage onLogin={setMe} />;
  if (me.mustChange) {
    return (
      <PasswordPage
        forced
        onDone={() => setMe({ ...me, mustChange: false })}
        onBack={() => setMe(null)}
      />
    );
  }
  if (!me.job || !me.level || !me.guild) {
    return (
      <ProfileSetupPage
        me={me}
        onDone={(p) => setMe({ ...me, ...p })}
        onBack={() => setMe(null)}
      />
    );
  }
  return (
    <Wiki
      me={me}
      onMe={(p) => setMe({ ...me, ...p })}
      onLogout={() => setMe(null)}
    />
  );
}

function Wiki({
  me,
  onMe,
  onLogout,
}: {
  me: Me;
  onMe: (p: Partial<Me>) => void;
  onLogout: () => void;
}) {
  const route = useRoute();
  // 위키 자료 (못 받으면 '다시 시도', 다시 연결되거나 앱으로 돌아올 때도 다시 받는다: 한 번 실패하면 앱을 껐다 켜야 했다)
  const [wikiTry, setWikiTry] = useState(0);
  const { data: wiki, error } = useAsync(
    useCallback(() => loadWiki(), [wikiTry]),
  );
  useEffect(() => {
    if (!error || error.includes(NEED_LOGIN)) return;
    const retry = () => setWikiTry((n) => n + 1);
    const onVisible = () => !document.hidden && retry();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [error]);
  const [page = "", arg = ""] = route.parts;

  // 부캐 묶기: 👤 단추가 어느 화면에서든 내 캐릭터 목록을 보도록
  useEffect(() => setMyCharacters(me), [me]);
  // 즐겨찾기는 사람마다 (다른 계정으로 들어오면 앞 사람 것을 버린다)
  useEffect(() => resetFavorites(me.id), [me.id]);
  // 사용 기록: 웹이나 앱을 새로 열었으면 접속 하나, 그리고 지금 보는 화면
  useEffect(() => reportOpen(me.id), [me.id]);
  useEffect(() => reportView(location.hash), [route]);
  // 폰이 이미 알림을 허락했으면 폰 알림을 저절로 켠다 (제작자 요청: 기본은 허용)
  // 그 뒤 이 폰의 알림 허용 상태를 알린다 ('길드원 관리'에 보인다)
  useEffect(
    () => void ensurePush(me.id).then(() => reportPush(me.id)),
    [me.id],
  );
  // 업데이트된 메뉴에 처음 들어간 때 (홈 칸의 'UPDATE' 가 그때 사라진다)
  useEffect(() => markMenuVisit(me.id, location.hash), [route, me.id]);
  // 홈 칸과 아래 탭 배치 (계정마다). 홈을 떠나면 배치 편집은 끝낸다
  useEffect(() => {
    loadLayout(me);
  }, [me]);
  const launcher = useLauncher();
  // 정식 오픈 축하 (폭죽과 길드마스터의 오픈 글, 오픈 뒤 2주 동안 이 기기에서 한 번. pages/Opening.tsx)
  // '더 이상 보지 않기'는 사람마다 (부캐로 바꿔도 같다), 캐릭터를 바꿔 새로 연 것은 들어온 것으로 치지 않는다
  const [celebrate, setCelebrate] = useState(
    () => !justSwitched() && shouldCelebrate(personOf(me)),
  );
  // 새 글·새 물건 숫자 배지 (news.ts): 그 메뉴를 열면 지우고, 홈으로 올 때 다시 묻는다
  useEffect(() => startNews(me.id), [me.id]);
  useEffect(() => {
    // 의뢰소는 칸이 하나라 열면 본 것. 게시판, 중개인, 장비대여는 그 화면 안의 단추마다 (useNewsSeen)
    if (page === "requests") markNewsSeen("requests");
    if (page === "") void refreshNews();
  }, [page]);
  const news = useNews();
  useEffect(() => {
    if (page !== "" && launcher.editing) setEditing(false);
  }, [page, launcher.editing]);
  const layout = launcher.preview ?? launcher.layout;
  const dock = layout.dock
    .map(itemOf)
    .filter((t): t is LaunchItem => !!t && canSee(t, me));
  const tabs = appMenu ? [...dock, APP_TAB] : dock;
  const chatAt = tabs.findIndex((t) => t.key === "chat");
  const editable = page === "";
  const dragKey = launcher.drag?.moved ? launcher.drag.key : undefined;
  const dragItem = dragKey ? itemOf(dragKey) : undefined;

  // 다른 기기에서 비밀번호가 초기화되는 등으로 로그인이 풀리면 로그인 화면으로
  const loggedOut = error?.includes(NEED_LOGIN) ?? false;
  useEffect(() => {
    if (loggedOut) onLogout();
  }, [loggedOut, onLogout]);

  let body;
  if (page === "password")
    body = <PasswordPage onDone={() => (location.hash = "#/")} />;
  else if (page === "admin")
    body =
      RANK[me.role] >= 1 ? <AdminPage me={me} /> : <NotFound what="페이지" />;
  else if (page === "me")
    body = <MePage me={me} onMe={onMe} onLogout={onLogout} />;
  else if (page === "as")
    body = <SwitchTo me={me} who={arg} to={route.query.get("to") ?? ""} />;
  else if (page === "ranking") body = <RankingPage me={me} onMe={onMe} />;
  else if (page === "requests") body = <RequestsPage me={me} />;
  else if (page === "alerts")
    body = (
      <AlertsPage
        developer={me.role === "developer"}
        preview={canPreview(me)}
      />
    );
  else if (page === "shop") body = <PlatShopPage />;
  else if (page === "patch") body = <PatchNotesPage />;
  // 아이모 소식 글 읽기 (#/official/번호). 예전 목록 주소(#/official)는 게시판 '아이모 소식'으로
  else if (page === "official")
    body = Number(arg) ? (
      <OfficialPostPage
        id={Number(arg)}
        job={me.job ? JOB_NAME[me.job] : null}
      />
    ) : (
      <GoTo to="#/board?cat=imo" />
    );
  else if (page === "odds")
    body = arg ? (
      <OddsTablePage id={arg} q={route.query.get("q") ?? ""} />
    ) : (
      <OddsPage
        q={route.query.get("q") ?? ""}
        cat={route.query.get("c") ?? ""}
      />
    );
  else if (page === "board")
    body = (
      <BoardPage
        me={me}
        arg={arg}
        sub={route.parts[2] ?? ""}
        query={route.query}
      />
    );
  else if (page === "") body = <Home me={me} />;
  else if (page === "info") body = <InfoPage me={me} />;
  // 타이머는 안드로이드 앱에만 있다. 예전 주소(#/timer)로 와도 앱 안내를 보여 준다
  else if (page === "app" || page === "timer") body = <AppPage />;
  // 사용 기록, 챗봇 개선: 길드마스터와 앱개발자 (제작자 요청 2026-11-02)
  else if (page === "gaps")
    body =
      RANK[me.role] >= 2 ? (
        <ChatGapsPage role={me.role} />
      ) : (
        <NotFound what="페이지" />
      );
  // 길드 던전은 1군 전용 (제작자 요청 2026-11-02): 2군은 들어와도 안내만 (앱개발자는 길드와 상관없이 본다)
  else if (page === "match")
    body =
      me.guild !== "main" && me.role !== "developer" ? (
        <DevSoon title="길드 던전" text="1군 전용이에요" />
      ) : (
        <GuildDungeonPage me={me} />
      );
  else if (!wiki)
    body = (
      <Loading
        error={loggedOut ? undefined : error}
        onRetry={() => setWikiTry((n) => n + 1)}
      />
    );
  else if (page === "search")
    body = <Search wiki={wiki} q={route.query.get("q") ?? ""} />;
  else if (page === "places")
    body = <Places wiki={wiki} region={route.query.get("r") ?? ""} />;
  else if (page === "place") body = <PlacePage wiki={wiki} id={arg} />;
  else if (page === "monster") body = <MonsterPage wiki={wiki} name={arg} />;
  else if (page === "item") body = <ItemPage wiki={wiki} name={arg} />;
  else if (page === "equip")
    body = arg ? (
      <EquipSlot wiki={wiki} slot={arg} />
    ) : (
      <EquipSlots wiki={wiki} />
    );
  else if (page === "menu") body = <MenuPage wiki={wiki} title={arg} me={me} />;
  else if (page === "post") body = <PostPage wiki={wiki} id={arg} />;
  else if (page === "chat")
    body = <ChatPage wiki={wiki} arg={arg} query={route.query} me={me} />;
  else if (page === "market") body = <MarketPage wiki={wiki} me={me} />;
  // To do: 오늘·이번 주·이벤트 할 일 (제작자 요청 2026-11-01). 인던 목록이 위키 자료라서 위키를 기다린다
  else if (page === "todo") body = <TodoPage wiki={wiki} me={me} />;
  // 장비대여: 대여 무기 목록, 신청, 마일리지 (제작자 요청 2026-11-01, 개발 중이라 앱개발자만). 무기 그림과 레벨이 위키 자료라서 위키를 기다린다
  else if (page === "rent")
    body = <RentalPage wiki={wiki} me={me} view={route.query.get("v") ?? ""} />;
  // 시세 동향 (개발중, 제작자 요청 2026-11-03): 거래 톡방 대화에서 모은 골드·물건·캐릭터 시세
  // 개발 중 칸은 미리 보는 사람(길드마스터, 오피서, 앱개발자, 테스트 계정)만. 길드원은 주소로 들어와도 개발 중 안내 (제작자 요청 2026-11-04)
  else if (page === "trend") body = canPreview(me) ? <TrendPage wiki={wiki} /> : <DevSoon title="시세 동향" />;
  // 강화 비교 (개발중, 제작자 요청 2026-11-04): 두 무기(+강)의 데미지와 몇 % 강해지는지
  else if (page === "enhance") body = canPreview(me) ? <EnhancePage wiki={wiki} query={route.query} me={me} /> : <DevSoon title="강화 비교" />;
  // 확률 시뮬레이터 개발 중판은 미리 보는 사람(길드마스터·오피서·달팽이·간다이, launcher.ts canPreview), 테스트판은 앱개발자(와 테스트 계정)만 (제작자 2026-11-04 '도플갱어로')
  else if (page === "sim") body = canPreview(me) ? <SimulatorPage key="live" wiki={wiki} me={me} space="live" /> : <DevSoon title="확률 시뮬레이터" />;
  else if (page === "simtest") body = me.role === "developer" || TEST_IDS.includes(me.id) ? <SimulatorPage key="test" wiki={wiki} me={me} space="test" /> : <DevSoon title="확률 시뮬레이터" />;
  else if (page === "log")
    body =
      RANK[me.role] >= 2 ? (
        <ActivityLogPage wiki={wiki} role={me.role} />
      ) : (
        <NotFound what="페이지" />
      );
  else body = <Home me={me} />;

  return (
    <div
      className="app"
      // 홈의 버전 글씨를 챗봇 탭(없으면 마지막 탭) 바로 위에 두려고 탭 수와 그 자리를 알린다 (styles.css .home-version)
      style={
        {
          "--tabs": tabs.length,
          "--chat-at": chatAt >= 0 ? chatAt : tabs.length - 1,
        } as CSSProperties
      }
    >
      {/* 테스트 계정으로 보는 중이면 맨 위에 '내 계정' (앱개발자로 돌아가기) */}
      {TEST_IDS.includes(me.id) && (
        <div className="test-banner">
          🧪 {me.id}
          <button
            className="pill"
            onClick={async () => {
              await switchAccount("back").catch(() => undefined);
              location.reload();
            }}
          >
            내 계정
          </button>
        </div>
      )}
      {/* 화면이 바뀔 때 0.16초 안에 살짝 떠오른다 (주소의 ? 뒤만 바뀌면 그대로) */}
      {/* 챗봇은 새 대화가 #/chat -> #/chat/번호 로 바뀌어도, 목록을 다녀와도 받던 답이 이어지게 한 화면으로 둔다 */}
      <main
        className="page"
        key={page === "chat" ? "chat" : route.parts.join("/")}
      >
        <PageBoundary route={route.parts.join("/")}>
          <Suspense fallback={<Loading />}>{body}</Suspense>
        </PageBoundary>
      </main>
      {body.type === Home && <HomeCorner />}
      {/* 내 지역 날씨로 비·눈 (초안, 앱개발자만. pages/Weather.tsx) */}
      {body.type === Home && <HomeWeather me={me} />}
      {/* 메뉴 설명 칸과 튜토리얼 (제목을 누르면, src/tutorial.tsx) */}
      <GuideHost me={me} />
      <nav
        className={
          "tabbar" + (launcher.editing && editable ? " launch-editing" : "")
        }
        data-zone="dock"
      >
        {tabs.map((t) => {
          // 아래 탭도 고친 메뉴면 'UPDATE' (제작자 요청 2026-11-01, 홈 칸과 같은 updates.ts)
          const updated = t !== APP_TAB && isUpdated(me.id, t);
          const className =
            "tab" +
            (t.match.includes(page) ? " tab-on" : "") +
            (isLocked(t, me) ? " tab-locked" : "") +
            (dragKey === t.key ? " launch-drag-src" : "");
          const fresh = newsFor(news, t.key);
          const inside = (
            <>
              {updated && <span className="tab-up">UPDATE</span>}
              {fresh > 0 && (
                <span className="news-badge tab-news">
                  {fresh > 99 ? "99+" : fresh}
                </span>
              )}
              <span className="tab-icon">
                {t.pic ? (
                  <PixelIcon name={t.pic} size={32} />
                ) : (
                  <TileIcon t={t} />
                )}
              </span>
              <FitLine
                className="tab-label"
                text={t.short ?? t.title}
                wrap={false}
              />
            </>
          );
          const handlers =
            t === APP_TAB
              ? {}
              : {
                  "data-slot": t.key,
                  "data-zone": "dock",
                  onPointerDown: (e: ReactPointerEvent<HTMLElement>) =>
                    pressItem(e, t.key, editable),
                  onClick: clickItem,
                  onContextMenu: (e: ReactMouseEvent) =>
                    editable && e.preventDefault(),
                };
          return isLocked(t, me) ? (
            <span
              key={t.key}
              className={className}
              aria-disabled="true"
              {...handlers}
            >
              {inside}
            </span>
          ) : (
            <a
              key={t.key}
              href={t.to}
              className={className}
              draggable={false}
              {...handlers}
            >
              {inside}
            </a>
          );
        })}
      </nav>
      {celebrate && (
        <Opening user={personOf(me)} onClose={() => setCelebrate(false)} />
      )}
      {/* 끌고 있는 칸 (손가락을 따라온다) */}
      {dragItem && launcher.drag && (
        <div
          className="launch-ghost"
          style={{ left: launcher.drag.x, top: launcher.drag.y }}
          aria-hidden
        >
          <span className="tile-icon">
            <TileIcon t={dragItem} />
          </span>
          <span>{dragItem.short ?? dragItem.title}</span>
        </div>
      )}
    </div>
  );
}

/** 묶은 부캐의 알림을 누르면 (#/as/캐릭터?to=그 알림의 주소): 그 캐릭터로 바꾸고 그 화면을 연다 (부캐 묶기, 폰 알림도 같다) */
function SwitchTo({ me, who, to }: { me: Me; who: string; to: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const next =
      to.startsWith("#/") && !to.startsWith("#/as/") ? to : "#/alerts";
    if (who === me.id) go(next, true);
    else goCharacter(who, next).catch((x) => setError(errorText(x)));
  }, [me.id, who, to]);
  return <Loading error={error} />;
}

/** 예전 주소를 새 주소로 바꾼다 (기록을 남기지 않게 replace) */
function GoTo({ to }: { to: string }) {
  useEffect(() => go(to, true), [to]);
  return <Loading />;
}

/**
 * 화면 조각을 못 받거나(배포 직후 폰에 남은 옛 조각, index.html 의 vite:preloadError 가 30초 안에 두 번은 새로 불러오지 않는다)
 * 화면이 그리다 깨졌을 때 빈 화면 대신 '다시 불러오기' (2026-11-03 제작자 폰이 '불러오는 중'에서 먹통). 다른 화면으로 가면 다시 그려 본다
 */
class PageBoundary extends Component<{ children: ReactNode; route: string }, { failed: string }> {
  state = { failed: "" };
  static getDerivedStateFromError(e: unknown) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.error("화면을 그리지 못했어요", e, info.componentStack);
  }
  componentDidUpdate(prev: { route: string }) {
    if (prev.route !== this.props.route && this.state.failed) this.setState({ failed: "" });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loading">
        화면을 여는 데 문제가 생겼어요.
        <small className="loading-err">{this.state.failed}</small>
        <div className="links">
          <button className="btn btn-ghost" onClick={() => location.reload()}>
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }
}
