"""도감 계산기 자료 (개발중, 제작자 요청 2026-11-10):
비공개 자료 `자료/도감/일반.json` (제작자가 찍은 게임 도감 퀘스트 영상 '일반 > 전체 > 미완료'를 장면마다 보고 옮긴 것, 자료/도감/README.md)
-> public/data/dex.json, 영상에서 자른 아이템 그림 `자료/이미지/도감/*.png` -> public/data/dex/ (위키에 그림이 없는 물건에 쓴다).

효과 '체력 +2.0' -> ["체력", 2.0, False], 'PVE 데미지 +0.50%' -> ["PVE 데미지", 0.5, True].
능력치 순서는 게임 '획득 옵션' 창 순서 (시세 동향 캐릭터의 도감 표와 같은 build_trend.DEX_ORDER).
"""
import json
import os
import re
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# 자료 저장소 자리 (보통 앱 저장소의 자료/, 시험할 때 SAPPHIRE_DATA 로 다른 사본)
DATA = Path(os.environ.get("SAPPHIRE_DATA") or ROOT / "자료")
SRC = DATA / "도감" / "일반.json"
PICS = DATA / "이미지" / "도감"
OUT = ROOT / "web" / "public" / "data"
# 시세 비교 (제작자 요청 2026-11-11: '골드로 직접 장비를 구매하는 게 싼가 vs 스탬프로 등록하는 게 싼가', '아바돈 이벤트 기준 vs 이벤트 아닐 때'):
# 장비 최저가 = 거래소(암거래중개인) 녹화를 읽은 날짜별 시세, 스탬프·마법서 값 = 자료/시세/스탬프.json, 규칙은 자료/제공/도감_시세.md
MARKET = DATA / "시세" / "암거래중개인"
STAMP = DATA / "시세" / "스탬프.json"
NEWS = DATA / "공식" / "소식.json"
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
    """도감에 나오는 물건만: 이름 key -> {k: 무기/갑옷류/기타/None, lv: 요구 레벨, p: {강화: 최저가}, d: 시세 날짜}.
    녹화 날짜마다 거래소 탭이 다르다 (2026-11-11 갑옷·무기·투구·보조·장갑, 2026-11-12 신발부터 나머지 전부): 날짜 순으로 읽고 같은 물건은 새 날짜 값을 쓴다.
    장비가 아닌 물건(재료·코스튬·펫 등)도 넣는다: 강화 없이 그 매물 최저가 (도감 재료를 골드로 사는 값)."""
    days = sorted(MARKET.glob("*/시세.json")) if MARKET.exists() else []
    if not days:
        return None
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
    gear: dict = {}
    for day in days:
        s = json.loads(day.read_text(encoding="utf-8"))
        date_ = s.get("날짜") or day.parent.name
        tabs: dict[str, set] = {}
        m_path = day.parent / "매물.json"
        if m_path.exists():
            for r in json.loads(m_path.read_text(encoding="utf-8"))["listings"]:
                if r.get("base"):
                    tabs.setdefault(key(r["base"]), set()).add(r.get("tab"))
        seen_lv, kinds, byp = {}, {}, {}
        for e in s.get("equipment", []):
            kinds[key(e["base"])] = e.get("kind")
        def ck(e, k):
            tab = str(e.get("tab") or "")
            if tab.startswith("코스튬"):  # 코스튬 탭 매물은 일반 장비와 이름이 같아도 따로 ('동그리모자')
                return "C:" + k
            if tab == "펫":  # 펫은 띄어쓰기만 다른 다른 펫이 있다 ('견습마법사' / '견습 마법사'): 이름 그대로
                return "P:" + (e.get("base") or e.get("name") or "").strip()
            return k
        for it in s.get("items", []):
            k = ck(it, key(it.get("base") or it.get("name") or ""))
            if not k:
                continue
            lv = (it.get("options_seen") or {}).get("요구레벨")
            if lv:
                seen_lv.setdefault(k, lv[0] if isinstance(lv, list) else lv)
            if it.get("min") is not None:
                pl = str(it.get("plus") or 0)
                byp.setdefault(k, {})
                byp[k][pl] = min(it["min"], byp[k].get(pl, it["min"]))
        for e in s.get("equipment", []):
            k = ck(e, key(e["base"]))
            byp.setdefault(k, {}).update({str(pl): v for pl, v in (e.get("min_by_plus") or {}).items()})
        # 장비가 아닌 물건(소모품·재료·인챈트·코스튬·펫 등, 2026-11-12 부터): 화면 가격은 묶음 전체 값이라 개당 최저가(unit_min)를 쓴다
        for o in s.get("others", []):
            k = ck(o, key(o.get("base") or ""))
            if k and o.get("unit_min") is not None and k not in byp:
                byp[k] = {"0": o["unit_min"]}
        # 거래소 매물이 없던 재료는 제작자가 준 값 (자료 시세/수동_값.json, 개당 골드, 0 = 값어치 없음. 거래소 값이 먼저)
        manual = DATA / "시세" / "수동_값.json"
        for n, v in (json.loads(manual.read_text(encoding="utf-8")).get("값", {}) if manual.exists() else {}).items():
            byp.setdefault(key(n), {"0": v, "m": True})
        for k, p in byp.items():
            if k.removeprefix("C:") not in wanted and not (k.startswith("P:") and key(k[2:]) in wanted) or not p:
                continue
            kind = None if k[:2] in ("C:", "P:") else (kinds.get(k) or ("갑옷류" if tabs.get(k, set()) & ARMOR_TABS else None))
            mm = re.search(r"요구\s*레벨\s*(\d+)", infos.get(k, ""))
            lv = wiki_lv.get(k) or seen_lv.get(k) or (int(mm.group(1)) if mm else None)
            if p.pop("m", None):
                gear[k] = {"k": kind, "lv": lv, "p": p, "m": True}
                continue
            gear[k] = {"k": kind, "lv": lv, "p": p, "d": date_}
    s = {"날짜": max(g["d"] for g in gear.values() if g.get("d")) if gear else days[-1].parent.name}
    out = {"date": s.get("날짜"), "dates": sorted({g["d"] for g in gear.values() if g.get("d")}), "src": "암거래중개인(게임 거래소) 녹화", "gear": gear}
    if STAMP.exists():
        st = json.loads(STAMP.read_text(encoding="utf-8"))
        out["stamp"] = {"normal": st["평소"], "event": st["이벤트"], "abaddon": st.get("아바돈_일반", 50),
                        "platGold": st["플래티넘_100당_골드"] / 100, "date": st.get("날짜"),
                        "noteNormal": st.get("평소_메모"), "noteEvent": st.get("이벤트_메모")}
        out["scroll"] = st.get("마법서_값") or {}
    # 거래소 인챈트 탭에서 읽은 마법서 최저가 (가장 최근 날짜), 스탬프.json 의 마법서_값이 있으면 그게 먼저
    sc = sorted((DATA / "시세").glob("마법서_값_*.json"))
    if sc:
        m = json.loads(sc[-1].read_text(encoding="utf-8"))
        base_sc = {kind: {g: v for g, v in (m.get(kind) or {}).items() if isinstance(v, (int, float))} for kind in ("무기", "갑옷")}
        for kind, d in (out.get("scroll") or {}).items():
            base_sc.setdefault(kind, {}).update(d)
        out["scroll"] = base_sc
        out["scrollDate"] = sc[-1].stem.replace("마법서_값_", "")
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
    # 코스튬·펫 도감 (제작자 2026-11-12 영상): 자료/도감/코스튬.json, 펫.json (일반.json 과 같은 형식)
    # 라이딩 2개 (도감 랭킹 '라이딩 0/2', 퀘스트 창에는 없고 달성도에만, 효과 모름): 자료/도감/라이딩.json (2026-11-12)
    for extra, cat in (("코스튬.json", "코스튬"), ("펫.json", "펫"), ("라이딩.json", "라이딩")):
        ep = SRC.parent / extra
        if ep.exists():
            more = json.loads(ep.read_text(encoding="utf-8"))
            for e in more.get("entries", []):
                e.setdefault("category", cat)
                raw["entries"].append(e)
    # 위키 아이템 표(items.json · equipment.json)에 그림이 없는 아이템의 그림 (제작자 2026-11-10 '이미지 왜 없어? 다 영상에 있는데'):
    # 영상의 도감 등록 창에서 자른 것(자료/이미지/도감) -> 자료/이미지/아이템/<이름>.png (카페 글 그림, 위키 표에는 안 올라간 것)
    key = lambda s: re.sub(r"\[[^\]]*\]|\([^)]*\)|\s", "", s or "")
    wiki = set()
    for name, fn in (("items.json", lambda d: d.values()), ("equipment.json", lambda d: (r for t in d for r in t["rows"]))):
        p = OUT / name
        if p.exists():
            wiki |= {key(r["name"]) for r in fn(json.loads(p.read_text(encoding="utf-8"))) if r.get("icon")}
    crops = {key(f.stem): f for f in PICS.glob("*.png")} if PICS.exists() else {}
    # 도감 정보 영상(제작자 2026-11-12)에서 옮긴 아이템 사전: 자료/도감/아이템/아이템.json. 칸 정보가 없을 때 쓰고, 그림은 자료/이미지/도감정보
    book: dict[str, dict] = {}
    bp = DATA / "도감" / "아이템" / "아이템.json"
    if bp.exists():
        for b in json.loads(bp.read_text(encoding="utf-8")).get("아이템", []):
            if b.get("이름"):
                book.setdefault(key(b["이름"]), b)
    def book_info(b: dict) -> str:
        parts = [b.get("등급") or "", f"요구 레벨 {b['요구레벨']}" if b.get("요구레벨") else "", "·".join(b.get("직업") or [])]
        parts += [f"{s} {v}" for s, v in (b.get("능력치") or [])]
        parts += [b.get("세트효과") or "", f"쿨타임 {b['쿨타임_초']}초" if b.get("쿨타임_초") else "", b.get("설명") or "",
                  "거래불가" if b.get("거래불가") else "", f"캐쉬샵 {b['캐쉬샵']}" if b.get("캐쉬샵") else ""]
        flat = [" ".join(map(str, x)) if isinstance(x, list) else str(x) for x in parts if x]
        return " ".join(flat).strip()
    item_dir = DATA / "이미지" / "아이템"
    cafe = {}
    if item_dir.exists():
        for f in item_dir.glob("*.png"):
            cafe.setdefault(key(f.stem.rstrip("(")), f)
    names = {key(re.sub(r"^\+\d+\s*", "", it["name"])) for e in raw["entries"] for it in e["items"] if it.get("name")}
    book_pics = {}
    bpd = DATA / "이미지" / "도감정보"
    if bpd.exists():
        for f in bpd.glob("*.png"):
            book_pics.setdefault(key(f.stem), f)
    # 파일 이름에 못 쓰는 글자(':' 등)는 '_' 로 저장돼 있다: 사전의 '그림' 경로로 이름과 잇는다 ('명예:희생의갑옷' -> 명예_희생의갑옷.png)
    for b in book.values():
        if b.get("그림"):
            f = DATA / b["그림"]
            if f.exists():
                book_pics.setdefault(key(b["이름"]), f)
    for f in (PICS.glob("*.png") if PICS.exists() else []):
        crops.setdefault(key(f.stem.replace("_", ":")), f)
    # 그다음 거래소 녹화에서 오린 그림 (자료/이미지/암거래중개인, 코스튬·재료 등)
    exd = DATA / "이미지" / "암거래중개인"
    for f in (exd.glob("*.png") if exd.exists() else []):
        book_pics.setdefault(key(f.stem), f)
    pics = {n: crops.get(n) or cafe.get(n) or book_pics.get(n) for n in names if n not in wiki and (crops.get(n) or cafe.get(n) or book_pics.get(n))}
    # 영상에서 아이템만 오린 아이콘 (자료/이미지/도감아이콘, 육각형·칸 바탕 없이, 고화질): 위키 그림이 있어도 이것을 먼저 쓴다
    # (제작자 2026-11-12 '아이콘은 해당 아이템 그 자체를 누끼', '화질 구린 거 이번 영상 화질로 싹 교체')
    # 이 아이콘은 data/icon/ 에 한 벌만 올라가고(build_book.py, 위키·시세 동향과 같이 쓴다) 여기서는 주소만 적는다.
    # 이름이 같아도 탭이 다르면 다른 그림 (코스튬 '동그리모자', 펫 '집토끼', 띄어쓰기만 다른 펫): 도감 항목의 종류(일반·코스튬·펫)로 고른다
    import build_book
    hq_url: dict[tuple, str | None] = {}
    def hq(base: str, cat: str | None) -> str | None:
        k = (cat or "일반", base)
        if k not in hq_url:
            hq_url[k] = build_book.tab_icon_url(base, cat or "일반")
        return hq_url[k]
    has_hq = {key(re.sub(r"^\+\d+\s*", "", it["name"])) for e in raw["entries"] for it in e["items"]
              if it.get("name") and hq(re.sub(r"^\+\d+\s*", "", it["name"]), e.get("category"))}
    pics = {n: f for n, f in pics.items() if n not in has_hq}
    out_pics = OUT / "dex"
    if out_pics.exists():
        shutil.rmtree(out_pics)
    if pics:
        out_pics.mkdir(parents=True)
        for n, f in pics.items():
            shutil.copy2(f, out_pics / f"{n}.png")
    no_pic = sorted(n for n in names if n not in wiki and n not in pics and n not in has_hq)
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
    # 도감 퀘스트 영상에 툴팁이 없던 아이템은 도감 정보 영상의 아이템 사전으로 (요구 레벨도 여기서 시세 계산에 쓴다)
    for k, b in book.items():
        if k not in infos:
            bi = book_info(b)
            if bi:
                infos[k] = bi
    # 그래도 없는 재료는 거래소 녹화 정보창 글 (시세.json 의 others[].info, 2026-11-12 부터)
    for day in sorted(MARKET.glob("*/시세.json"), reverse=True) if MARKET.exists() else []:
        for o in json.loads(day.read_text(encoding="utf-8")).get("others", []):
            k = key(o.get("base") or "")
            if k and k not in infos and o.get("info"):
                infos[k] = " · ".join(map(str, o["info"]))
    entries = []
    # 기간이 있는 이벤트성 도감(특정 기간만 효과)은 '이벤트' 칸으로 따로 넣고 화면이 기간 안의 것만 보인다
    # (제작자 2026-11-10 '이벤트성 도감은 취급하지 않음' -> 2026-11-12 '이벤트로 따로 넣고 기간 끝나면 자동으로 사라지게').
    # period '2026/9/10 ~ 2026/11/12' -> from '2026-09-10', to '2026-11-12'. 공식 패치노트는 모두 '~11/12 점검 전까지'라
    # 화면(Dex.tsx isLive)이 끝 날 정기 점검 시작(10:30, 한국 시간)에 뺀다
    events = [e["name"] for e in raw["entries"] if e.get("period")]
    def period_of(t: str | None) -> dict:
        ds = re.findall(r"(\d{4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})", t or "")
        if len(ds) != 2:
            if t:
                print("  도감 기간을 못 읽음:", t)
            return {}
        return {"from": "%s-%02d-%02d" % (ds[0][0], int(ds[0][1]), int(ds[0][2])), "to": "%s-%02d-%02d" % (ds[1][0], int(ds[1][1]), int(ds[1][2]))}
    for e in raw["entries"]:
        items = []
        for it in e["items"]:
            name = it.get("name")
            base = re.sub(r"^\+\d+\s*", "", name) if name else None
            d = {"name": name, "n": int(it.get("count") or 1), "plus": it.get("plus")}
            if (it.get("tooltip") or {}).get("이름색"):
                d["color"] = it["tooltip"]["이름색"]
            if not name and it.get("icon"):
                d["icon"] = it["icon"]
            if str(it.get("src", "")).startswith("그림으로") or it.get("est"):
                d["est"] = True  # 툴팁은 못 보고 다른 항목에서 이름이 확인된 같은 그림으로 정한 칸 (est: 툴팁 능력치로 정한 칸)
            # 도감 등록 창: '…는 장비스탬프B 11개로 대체 등록이 가능합니다' -> sg 'B', sn 11 / '대체 등록이 불가능한 수집 품목' -> sg '불가'
            st = it.get("stamp") or ""
            # '아바돈장비스탬프A 7개' 는 일반 장비스탬프와 다른 스탬프라 등급 앞에 '아바돈' 을 붙인다 (제작자 2026-11-10 'B A 아바돈 등등')
            m = re.search(r"(아바돈)?\s*장비스탬프\s*([A-Za-z]+)\s*(\d+)", st)
            if m:
                d["sg"], d["sn"] = (m.group(1) or "") + m.group(2).upper(), int(m.group(3))
            elif "불가" in st:
                d["sg"] = "불가"
            if base and hq(base, e.get("category")):
                d["pic"] = hq(base, e.get("category"))
            elif base and key(base) in pics:
                d["pic"] = f"/data/dex/{key(base)}.png"
            info = clean_info(it.get("info")) or (infos.get(key(base)) if base else None)
            if info:
                d["info"] = info
            items.append(d)
        cat = "이벤트" if e.get("period") else e.get("category")
        entries.append({"name": e["name"], "effects": [effect(s, v) for s, v in e["effects"]],
                        "period": e.get("period"), **period_of(e.get("period")), "items": items, **({"cat": cat} if cat else {})})
    # 게임 화면에 같은 제목이 두 번 있는 항목 (코스튬 '크라운락의 작은 눈덩이 I'): 완료 표시가 섞이지 않게 두 번째부터 '(2번째)'
    seen_names: dict[str, int] = {}
    for e in entries:
        k = (e.get("cat") or "일반") + "|" + e["name"]
        seen_names[k] = seen_names.get(k, 0) + 1
        if seen_names[k] > 1:
            e["name"] += f" ({seen_names[k]}번째)"
    unknown = sorted({s for e in entries for s, _, _ in e["effects"]} - set(order))
    data = {"source": raw.get("source", "게임 도감 퀘스트 (제작자 영상)"), "built": date.today().isoformat(), "order": order, "entries": entries}
    # 펫 도감 달성 보상 (퓨앙 스샷 2026-11-12): 펫 항목을 10개 채울 때마다 [달성 수, 능력치, 값, %인지]
    pr = SRC.parent / "펫_달성보상.json"
    if pr.exists():
        data["petRewards"] = [[r["달성"], *effect(*r["보상"])] for r in json.loads(pr.read_text(encoding="utf-8"))["보상"]]
    wanted = {key(re.sub(r"^\+\d+\s*", "", it["name"])) for e in entries for it in e["items"] if it.get("name")}
    price = price_data(key, wanted, infos)
    if price:
        data["price"] = price
        for e in entries:
            for it in e["items"]:
                if not it.get("name"):
                    continue
                k = key(re.sub(r"^\+\d+\s*", "", it["name"]))
                if e.get("cat") == "코스튬":
                    it["pk"] = ("C:" + k) if ("C:" + k) in price["gear"] else ("" if k in price["gear"] else None)
                elif e.get("cat") == "펫":
                    pk = "P:" + it["name"].strip()
                    it["pk"] = pk if pk in price["gear"] else ""
                if it.get("pk") is None:
                    it.pop("pk", None)
        # 레어도(등급)별 어림 시세 (제작자 2026-11-12 '코스튬도 펫도 레어도에 따라 가격이 정해짐, 같은 레어도면 대충 범위'):
        # 거래소 녹화에 값이 있는 코스튬·펫의 최저가를 도감 정보 사전의 등급으로 묶어 가운데값(med)과 사분위(lo~hi). 다섯 개 이상 있는 등급만.
        # 값이 없는 코스튬·펫 칸은 거래 가능하고 등급이 하나면 gr 로 이 표를 가리킨다 (화면 dexPrice.ts 가 '등급 어림'으로 셈). 거래불가면 nt.
        import statistics
        by_tab: dict[tuple, list] = {}
        for b in json.loads(bp.read_text(encoding="utf-8")).get("아이템", []) if bp.exists() else []:
            if b.get("이름") and b.get("큰탭") in ("코스튬", "펫"):
                by_tab.setdefault((b["큰탭"], key(b["이름"])), []).append(b)
        def grade_of(tab: str, k: str) -> str | None:
            gs = {b.get("등급") for b in by_tab.get((tab, k), []) if b.get("등급")}
            return gs.pop() if len(gs) == 1 else None
        # 펫은 속성부여(힘·민첩·지능·마나) 때문에 비싸다 (제작자 2026-11-12 '노작 펫 기준으로 봐야'): 거래소 정보창에 속성부여 줄이 있던 펫은 등급 표에서 빼고(노작만),
        # 그 펫 자신의 값도 같은 등급 노작 가운데값보다 비싸면 노작 값으로 친다. 노작 매물이 10개 안 되는 등급은 인기 펫이 섞여 치우쳐서 전체로 센다. 코스튬은 가운데값 그대로 ('대충 중앙값').
        enchanted: set[str] = set()
        for day in sorted(MARKET.glob("*/시세.json")) if MARKET.exists() else []:
            for o in json.loads(day.read_text(encoding="utf-8")).get("others", []):
                if o.get("tab") == "펫":
                    k0 = key(o.get("base") or "")
                    if any(re.match(r"^(힘|민첩|지능|마나)\s", x) for x in (o.get("info") or [])):
                        enchanted.add(k0)
                    else:
                        enchanted.discard(k0)
        samples: dict[str, list] = {}
        plain: dict[str, list] = {}
        for pk, g in price["gear"].items():
            if pk[:2] not in ("C:", "P:") or not g["p"]:
                continue
            tab = "코스튬" if pk.startswith("C:") else "펫"
            k0 = pk[2:] if tab == "코스튬" else key(pk[2:])
            gr = grade_of(tab, k0)
            if gr:
                v = g["p"].get("0") or min(g["p"].values())
                samples.setdefault(f"{tab}|{gr}", []).append(v)
                if tab == "펫" and k0 not in enchanted:
                    plain.setdefault(f"{tab}|{gr}", []).append(v)
        grade_price = {}
        for gk, xs in samples.items():
            use = plain[gk] if gk in plain and len(plain[gk]) >= 10 else xs
            if len(use) < 5:
                continue
            q = statistics.quantiles(sorted(use), n=4)
            grade_price[gk] = {"med": round(statistics.median(use)), "lo": round(q[0]), "hi": round(q[2]), "n": len(use), **({"plain": True} if use is not xs else {})}
        price["grade"] = grade_price
        capped = 0
        for pk, g in price["gear"].items():
            if pk.startswith("P:") and key(pk[2:]) in enchanted:
                gr = grade_of("펫", key(pk[2:]))
                cap = grade_price.get(f"펫|{gr}", {}).get("med") if gr else None
                if cap and grade_price[f"펫|{gr}"].get("plain") and g["p"] and min(g["p"].values()) > cap:
                    g["p"] = {k: min(v, cap) for k, v in g["p"].items()}
                    g["noench"] = True
                    capped += 1
        print("속성부여 펫", {"정보창에 속성": len(enchanted), "노작 값으로 낮춤": capped})
        n_gr = n_nt = 0
        for e in entries:
            if e.get("cat") not in ("코스튬", "펫"):
                continue
            for it in e["items"]:
                if not it.get("name") or it.get("pk"):
                    continue
                k = key(re.sub(r"^\+\d+\s*", "", it["name"]))
                bs = by_tab.get((e["cat"], k), [])
                if bs and all(b.get("거래불가") for b in bs):
                    it["nt"] = True
                    n_nt += 1
                    continue
                gr = grade_of(e["cat"], k)
                if not gr and not bs:
                    # 사전에 없는 칸(새로 나온 펫 등)은 툴팁 이름 색으로 등급: 흰 일반 · 초록 고급 · 파랑 희귀 · 보라 영웅 (사전과 견줘 1,319칸 중 1칸만 다름)
                    gr = {"흰": "일반", "초록": "고급", "파랑": "희귀", "보라": "영웅"}.get(it.get("color") or "")
                    # 같은 항목의 다른 칸이 모두 거래불가면 이 칸도 거래불가로 본다 (블랙보리 묶음)
                    others = [x for x in e["items"] if x is not it]
                    if others and all(x.get("nt") or all(b.get("거래불가") for b in by_tab.get((e["cat"], key(x.get("name") or "")), [{"거래불가": False}])) for x in others):
                        it["nt"] = True
                        n_nt += 1
                        continue
                if gr and f"{e['cat']}|{gr}" in grade_price:
                    it["gr"] = f"{e['cat']}|{gr}"
                    n_gr += 1
        print("등급 어림 시세", {k: (v["med"], v["n"]) for k, v in sorted(grade_price.items())}, {"등급으로 셈 칸": n_gr, "거래불가 칸": n_nt})
        print("도감 시세", {"날짜": price["date"], "시세 있는 물건": len(price["gear"]), "레벨 모름": sum(1 for g in price["gear"].values() if not g["lv"]),
                         "종류 모름": sum(1 for g in price["gear"].values() if not g["k"]), "아바돈 판매": price.get("sale")})
    (OUT / "dex.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("도감 계산기", {"항목": len(entries), "이벤트 도감": len(events), "아이템 칸": sum(len(e["items"]) for e in entries),
                     "이름 모름": sum(1 for e in entries for i in e["items"] if not i["name"]), "오린 아이콘": len(has_hq), "그 밖의 그림": len(pics),
                     "정보 없는 칸": sum(1 for e in entries for i in e["items"] if i["name"] and not i.get("info")), "그림 없음": no_pic,
                     "순서표에 없는 능력치": unknown})


if __name__ == "__main__":
    main()
