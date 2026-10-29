import { useCallback } from "react";
import { loadWiki, useAsync } from "./data";
import { useRoute } from "./router";
import { Loading } from "./ui";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Places, PlacePage } from "./pages/Places";
import { ItemPage, MonsterPage } from "./pages/Detail";
import { EquipSlot, EquipSlots } from "./pages/Equip";
import { MenuPage, PostPage, Soon } from "./pages/Posts";

const TABS = [
  { to: "#/", label: "홈", icon: "🏠", match: "" },
  { to: "#/places", label: "사냥터", icon: "🗺️", match: "places" },
  { to: "#/search", label: "검색", icon: "🔍", match: "search" },
  { to: "#/equip", label: "장비", icon: "🛡️", match: "equip" },
  { to: "#/chat", label: "챗봇", icon: "💬", match: "chat" },
];

export function App() {
  const route = useRoute();
  const { data: wiki, error } = useAsync(useCallback(() => loadWiki(), []));
  const [page = "", arg = ""] = route.parts;

  let body;
  if (!wiki) body = <Loading error={error} />;
  else if (page === "") body = <Home wiki={wiki} />;
  else if (page === "search") body = <Search wiki={wiki} q={route.query.get("q") ?? ""} />;
  else if (page === "places") body = <Places wiki={wiki} region={route.query.get("r") ?? ""} />;
  else if (page === "place") body = <PlacePage wiki={wiki} id={arg} />;
  else if (page === "monster") body = <MonsterPage wiki={wiki} name={arg} />;
  else if (page === "item") body = <ItemPage wiki={wiki} name={arg} />;
  else if (page === "equip") body = arg ? <EquipSlot wiki={wiki} slot={arg} /> : <EquipSlots wiki={wiki} />;
  else if (page === "menu") body = <MenuPage wiki={wiki} title={arg} />;
  else if (page === "post") body = <PostPage id={arg} />;
  else if (page === "chat" || page === "timer") body = <Soon what={page} />;
  else body = <Home wiki={wiki} />;

  return (
    <div className="app">
      <main className="page">{body}</main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <a key={t.to} href={t.to} className={"tab" + (page === t.match ? " tab-on" : "")}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
