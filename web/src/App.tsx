import { useCallback, useEffect, useState } from "react";
import { NEED_LOGIN, loadWiki, useAsync } from "./data";
import { useRoute } from "./router";
import { Loading, NotFound } from "./ui";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Places, PlacePage } from "./pages/Places";
import { ItemPage, MonsterPage } from "./pages/Detail";
import { EquipSlot, EquipSlots } from "./pages/Equip";
import { MenuPage, PostPage, Soon } from "./pages/Posts";
import { AppPage } from "./pages/AppPage";
import { LoginPage, PasswordPage } from "./pages/Login";
import { AdminPage } from "./pages/Admin";
import { RANK, fetchMe } from "./auth";
import { appMenu } from "./platform";
import type { Me } from "./auth";

const TABS = [
  { to: "#/", label: "홈", icon: "🏠", match: "" },
  { to: "#/places", label: "사냥터", icon: "🗺️", match: "places" },
  { to: "#/search", label: "검색", icon: "🔍", match: "search" },
  { to: "#/equip", label: "장비", icon: "🛡️", match: "equip" },
  { to: "#/chat", label: "챗봇", icon: "💬", match: "chat" },
];

/** 안드로이드 앱 안에서만 보이는 탭: 시계 설정, 게임 위에 띄우기 같은 앱 기능 (게임 위 위키 창 안에서는 숨김) */
const APP_TAB = { to: "#/app", label: "앱", icon: "⏰", match: "app" };
const SHOWN_TABS = appMenu ? [...TABS, APP_TAB] : TABS;

/**
 * 위키는 길드원만 본다. 로그인 전에는 로그인 화면, 임시 비밀번호로 들어오면 비밀번호 바꾸기 화면만 보인다.
 * (위키 자료 data/*.json 은 서버에서도 로그인한 사람에게만 준다: functions/data/_middleware.ts)
 */
export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = 확인 중
  useEffect(() => {
    fetchMe().then(setMe, () => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page">
          <Loading />
        </main>
      </div>
    );
  }
  if (me === null) return <LoginPage onLogin={setMe} />;
  if (me.mustChange) return <PasswordPage forced onDone={() => setMe({ ...me, mustChange: false })} />;
  return <Wiki me={me} onLogout={() => setMe(null)} />;
}

function Wiki({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const route = useRoute();
  const { data: wiki, error } = useAsync(useCallback(() => loadWiki(), []));
  const [page = "", arg = ""] = route.parts;

  // 다른 기기에서 비밀번호가 초기화되는 등으로 로그인이 풀리면 로그인 화면으로
  const loggedOut = error?.includes(NEED_LOGIN) ?? false;
  useEffect(() => {
    if (loggedOut) onLogout();
  }, [loggedOut, onLogout]);

  let body;
  if (page === "password") body = <PasswordPage onDone={() => (location.hash = "#/")} />;
  else if (page === "admin") body = RANK[me.role] >= 1 ? <AdminPage me={me} /> : <NotFound what="페이지" />;
  else if (!wiki) body = <Loading error={loggedOut ? undefined : error} />;
  else if (page === "") body = <Home me={me} onLogout={onLogout} />;
  else if (page === "search") body = <Search wiki={wiki} q={route.query.get("q") ?? ""} />;
  else if (page === "places") body = <Places wiki={wiki} region={route.query.get("r") ?? ""} />;
  else if (page === "place") body = <PlacePage wiki={wiki} id={arg} />;
  else if (page === "monster") body = <MonsterPage wiki={wiki} name={arg} />;
  else if (page === "item") body = <ItemPage wiki={wiki} name={arg} />;
  else if (page === "equip") body = arg ? <EquipSlot wiki={wiki} slot={arg} /> : <EquipSlots wiki={wiki} />;
  else if (page === "menu") body = <MenuPage wiki={wiki} title={arg} />;
  else if (page === "post") body = <PostPage id={arg} />;
  else if (page === "chat") body = <Soon what="chat" />;
  // 타이머는 안드로이드 앱에만 있다. 예전 주소(#/timer)로 와도 앱 안내를 보여 준다
  else if (page === "app" || page === "timer") body = <AppPage />;
  else body = <Home me={me} onLogout={onLogout} />;

  return (
    <div className="app">
      <main className="page">{body}</main>
      <nav className="tabbar">
        {SHOWN_TABS.map((t) => (
          <a key={t.to} href={t.to} className={"tab" + (page === t.match ? " tab-on" : "")}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
