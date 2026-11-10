"""도감 계산기 자료 (개발중, 제작자 요청 2026-11-10):
비공개 자료 `자료/도감/일반.json` (제작자가 찍은 게임 도감 퀘스트 영상 '일반 > 전체 > 미완료'를 장면마다 보고 옮긴 것, 자료/도감/README.md)
-> public/data/dex.json, 영상에서 자른 아이템 그림 `자료/이미지/도감/*.png` -> public/data/dex/ (위키에 그림이 없는 물건에 쓴다).

효과 '체력 +2.0' -> ["체력", 2.0, False], 'PVE 데미지 +0.50%' -> ["PVE 데미지", 0.5, True].
능력치 순서는 게임 '획득 옵션' 창 순서 (시세 동향 캐릭터의 도감 표와 같은 build_trend.DEX_ORDER).
"""
import json
import re
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료" / "도감" / "일반.json"
PICS = ROOT / "자료" / "이미지" / "도감"
OUT = ROOT / "web" / "public" / "data"
# 시세 비교 (제작자 요청 2026-11-11: '골드로 직접 장비를 구매하는 게 싼가 vs 스탬프로 등록하는 게 싼가', '아바돈 이벤트 기준 vs 이벤트 아닐 때'):
# 장비 최저가 = 거래소(암거래중개인) 녹화를 읽은 날짜별 시세, 스탬프·마법서 값 = 자료/시세/스탬프.json, 규칙은 자료/제공/도감_시세.md
MARKET = ROOT / "자료" / "시세" / "암거래중개인"
STAMP = ROOT / "자료" / "시세" / "스탬프.json"
NEWS = ROOT / "자료" / "공식" / "소식.json"
ARMOR_TABS = {"투구", "보조 장비", "장갑", "신발"}  # 거래소 탭이 이것이면 위키 장비표에 없는 이름(코스튬 모자 등)도 갑옷류


def abaddon_sale() -> dict | None:
    """가장 최근 공식 패치노트의 '아바돈 장비 스탬프 패키지 판매' 기간 ('판매 기간: 10/29(목) 점검 후 ~ 11/12(목) 점검 전까지')"""
    if not NEWS.exists():
        return None
    best = None
    for p in json.loads(NEWS.read_text(encoding="utf-8")).get("rows", []):
        body = p.get("body") or ""
        i = body.find("아바돈 장비 스탬프 패키지 판매")
        if i < 0:
            continue
        m = re.search(r"판매 기간:\s*(\d+)/(\d+)[^~\n]*~\s*(\d+)/(\d+)([^\n]*)", body[i:i + 400])
        y = re.match(r"(\d{4})-", str(p.get("start_date") or ""))
        if not m or not y:
            continue
        year = int(y.group(1))
        sm, sd, em, ed = (int(x) for x in m.groups()[:4])
        start = date(year, sm, sd)
        end = date(year + (1 if em < sm else 0), em, ed)
        cand = {"start": start.isoformat(), "end": end.isoformat(), "text": m.group(0).replace("판매 기간:", "").strip(), "id": p.get("id")}
        if not best or cand["start"] > best["start"]:
            best = cand
    return best


def price_data(key, wanted: set, infos: dict) -> dict | None:
    """도감에 나오는 장비만: 이름 key -> {k: 무기/갑옷류/기타, lv: 요구 레벨, p: {강화: 최저가}}"""
    days = sorted(MARKET.glob("*/시세.json")) if MARKET.exists() else []
    if not days:
        return None
    latest = days[-1]
    s = json.loads(latest.read_text(encoding="utf-8"))
    tabs: dict[str, set] = {}
    m_path = latest.parent / "매물.json"
    if m_path.exists():
        for r in json.loads(m_path.read_text(encoding="utf-8"))["listings"]:
            tabs.setdefault(key(r["base"]), set()).add(r["tab"])
    # 요구 레벨: 위키 장비표 '레벨제한' -> 거래소 정보창 '요구 레벨' -> 도감 영상 툴팁 '요구 레벨 N'
    wiki_lv = {}
    eq = OUT / "equipment.json"
    if eq.exists():
        for t in json.loads(eq.read_text(encoding="utf-8")):
            h = t["headers"]
            if "레벨제한" in h:
                for r in t["rows"]:
                    mm = re.search(r"\d+", r["cells"][h.index("레벨제한")] or "")
                    if mm:
                        wiki_lv.setdefault(key(r["name"]), int(mm.group(0)))
    seen_lv = {}
    for it in s.get("items", []):
        lv = (it.get("options_seen") or {}).get("요구레벨")
        if lv:
            seen_lv.setdefault(key(it["base"]), lv[0])
    gear = {}
    for e in s.get("equipment", []):
        k = key(e["base"])
        if k not in wanted:
            continue
        kind = e.get("kind") or ("갑옷류" if tabs.get(k, set()) & ARMOR_TABS else None)
        mm = re.search(r"요구\s*레벨\s*(\d+)", infos.get(k, ""))
        lv = wiki_lv.get(k) or seen_lv.get(k) or (int(mm.group(1)) if mm else None)
        gear[k] = {"k": kind, "lv": lv, "p": {str(pl): v for pl, v in e["min_by_plus"].items()}}
    out = {"date": s.get("날짜"), "src": "암거래중개인(게임 거래소) 녹화", "gear": gear}
    if STAMP.exists():
        st = json.loads(STAMP.read_text(encoding="utf-8"))
        out["stamp"] = {"normal": st["평소"], "event": st["이벤트"], "abaddon": st.get("아바돈_일반", 50),
                        "platGold": st["플래티넘_100당_골드"] / 100, "date": st.get("날짜"),
                        "noteNormal": st.get("평소_메모"), "noteEvent": st.get("이벤트_메모")}
        out["scroll"] = st.get("마법서_값") or {}
    sale = abaddon_sale()
    if sale:
        out["sale"] = sale
    return out

# 화면 글자와 획득 옵션 이름이 다를 때 (띄어쓰기 등)
STAT_ALIAS = {"불 저항": "불저항", "냉기 저항": "냉기저항", "번개 저항": "번개저항", "속성 저항": "속성저항",
              "체력 재생": "체력재생", "마나 재생": "마나재생", "이동 속도": "이동속도",
              "아이템 드랍": "아이템 드랍", "골드 드랍": "골드 드랍"}


def effect(stat: str, value: str) -> list:
    stat = re.sub(r"\s+", " ", stat.strip())
    stat = STAT_ALIAS.get(stat, stat)
    m = re.fullmatch(r"\+?\s*(-?\d+(?:\.\d+)?)\s*(%?)", value.strip())
    if not m:
        raise ValueError(f"효과 값을 못 읽음: {stat} {value}")
    return [stat, float(m.group(1)), m.group(2) == "%"]


def main() -> None:
    if not SRC.exists():
        print("도감 계산기: 자료/도감/일반.json 이 없어서 건너뜀")
        return
    import build_trend
    order = [name for name, _ in build_trend.DEX_ORDER]
    raw = json.loads(SRC.read_text(encoding="utf-8"))
    # 위키 아이템 표(items.json · equipment.json)에 그림이 없는 아이템의 그림 (제작자 2026-11-10 '이미지 왜 없어? 다 영상에 있는데'):
    # 영상의 도감 등록 창에서 자른 것(자료/이미지/도감) -> 자료/이미지/아이템/<이름>.png (카페 글 그림, 위키 표에는 안 올라간 것)
    key = lambda s: re.sub(r"\[[^\]]*\]|\([^)]*\)|\s", "", s or "")
    wiki = set()
    for name, fn in (("items.json", lambda d: d.values()), ("equipment.json", lambda d: (r for t in d for r in t["rows"]))):
        p = OUT / name
        if p.exists():
            wiki |= {key(r["name"]) for r in fn(json.loads(p.read_text(encoding="utf-8"))) if r.get("icon")}
    crops = {key(f.stem): f for f in PICS.glob("*.png")} if PICS.exists() else {}
    item_dir = ROOT / "자료" / "이미지" / "아이템"
    cafe = {}
    if item_dir.exists():
        for f in item_dir.glob("*.png"):
            cafe.setdefault(key(f.stem.rstrip("(")), f)
    names = {key(re.sub(r"^\+\d+\s*", "", it["name"])) for e in raw["entries"] for it in e["items"] if it.get("name")}
    pics = {n: crops.get(n) or cafe.get(n) for n in names if n not in wiki and (crops.get(n) or cafe.get(n))}
    out_pics = OUT / "dex"
    if out_pics.exists():
        shutil.rmtree(out_pics)
    if pics:
        out_pics.mkdir(parents=True)
        for n, f in pics.items():
            shutil.copy2(f, out_pics / f"{n}.png")
    no_pic = sorted(n for n in names if n not in wiki and n not in pics)
    # 영상 툴팁에서 받아 적은 아이템 정보(요구 레벨·방어력·옵션, 재료면 설명). 같은 이름의 다른 칸에만 적힌 것도 쓴다 (제작자 2026-11-10 '이미지랑 내용 장비옵션 다 db화')
    def clean_info(t: str) -> str:
        return re.sub(r"\s*\([^)]*(파란|글씨|색)[^)]*\)", "", t or "").strip()
    infos: dict[str, str] = {}
    for e in raw["entries"]:
        for it in e["items"]:
            n, t = it.get("name"), clean_info(it.get("info"))
            if n and t:
                k = key(re.sub(r"^\+\d+\s*", "", n))
                if len(t) > len(infos.get(k, "")):
                    infos[k] = t
    entries = []
    # 기간이 있는 이벤트성 도감(특정 기간만 효과)은 계산기에서 다루지 않는다 (제작자 2026-11-10 '이벤트성 도감은 취급하지 않음').
    # 자료 파일에는 기록으로 남겨 둔다
    events = [e["name"] for e in raw["entries"] if e.get("period")]
    for e in raw["entries"]:
        if e.get("period"):
            continue
        items = []
        for it in e["items"]:
            name = it.get("name")
            base = re.sub(r"^\+\d+\s*", "", name) if name else None
            d = {"name": name, "n": int(it.get("count") or 1), "plus": it.get("plus")}
            if not name and it.get("icon"):
                d["icon"] = it["icon"]
            if str(it.get("src", "")).startswith("그림으로"):
                d["est"] = True  # 툴팁은 못 보고 다른 항목에서 이름이 확인된 같은 그림으로 정한 칸
            # 도감 등록 창: '…는 장비스탬프B 11개로 대체 등록이 가능합니다' -> sg 'B', sn 11 / '대체 등록이 불가능한 수집 품목' -> sg '불가'
            st = it.get("stamp") or ""
            # '아바돈장비스탬프A 7개' 는 일반 장비스탬프와 다른 스탬프라 등급 앞에 '아바돈' 을 붙인다 (제작자 2026-11-10 'B A 아바돈 등등')
            m = re.search(r"(아바돈)?\s*장비스탬프\s*([A-Za-z]+)\s*(\d+)", st)
            if m:
                d["sg"], d["sn"] = (m.group(1) or "") + m.group(2).upper(), int(m.group(3))
            elif "불가" in st:
                d["sg"] = "불가"
            if base and key(base) in pics:
                d["pic"] = f"/data/dex/{key(base)}.png"
            info = clean_info(it.get("info")) or (infos.get(key(base)) if base else None)
            if info:
                d["info"] = info
            items.append(d)
        entries.append({"name": e["name"], "effects": [effect(s, v) for s, v in e["effects"]],
                        "period": e.get("period"), "items": items, **({"cat": e["category"]} if e.get("category") else {})})
    unknown = sorted({s for e in entries for s, _, _ in e["effects"]} - set(order))
    data = {"source": raw.get("source", "게임 도감 퀘스트 (제작자 영상)"), "built": date.today().isoformat(), "order": order, "entries": entries}
    wanted = {key(re.sub(r"^\+\d+\s*", "", it["name"])) for e in entries for it in e["items"] if it.get("name")}
    price = price_data(key, wanted, infos)
    if price:
        data["price"] = price
        print("도감 시세", {"날짜": price["date"], "시세 있는 장비": len(price["gear"]), "레벨 모름": sorted(k for k, g in price["gear"].items() if not g["lv"]),
                         "종류 모름": sorted(k for k, g in price["gear"].items() if not g["k"]), "아바돈 판매": price.get("sale")})
    (OUT / "dex.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("도감 계산기", {"항목": len(entries), "뺀 이벤트 도감": len(events), "아이템 칸": sum(len(e["items"]) for e in entries),
                     "이름 모름": sum(1 for e in entries for i in e["items"] if not i["name"]), "그림": len(pics),
                     "정보 없는 칸": sum(1 for e in entries for i in e["items"] if i["name"] and not i.get("info")), "그림 없음": no_pic,
                     "순서표에 없는 능력치": unknown})


if __name__ == "__main__":
    main()
