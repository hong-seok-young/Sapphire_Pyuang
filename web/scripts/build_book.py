"""아이템 책 (제작자 요청 2026-11-12: 'DB 에는 정보가 있거나 최신인데 웹은 아직 활용하지 못하는 부분 싹 다', '검색이 챗봇 답변과 너무 상이해').

챗봇은 자료 저장소의 글을 모두 읽는데 검색·아이템 화면은 카페 드랍표에서 만든 위키 자료(items.json)만 써서, 게임 사전에 있는 아이템의 4분의 3
(코스튬·펫·라이딩·소모품)이 검색에 안 나오고 능력치·설명·거래소 값·도감·상점 구성도 안 보였다. 비공개 자료의 아래 것들을 아이템 이름으로 한데 묶는다:

- 게임 '도감 정보' 아이템 사전 `자료/도감/아이템/아이템.json` (등급·요구 레벨·직업·능력치·세트·설명·거래불가·캐쉬샵)
- 게임 거래소(암거래중개인) 녹화 `자료/시세/암거래중개인/<날짜>/시세.json` 의 물건 이름·정보창 글·그림 (값은 넣지 않는다: 제작자 2026-11-12
  '게임 거래소 최소가는 항상 업데이트를 할 수가 없어서 러프한 도감 계산기 정도에만', 실시간으로 정확해야 하는 곳에는 쓰지 않는다)
- 도감 퀘스트 (build_dex.py 가 만든 data/dex.json): 그 아이템이 들어가는 도감 항목
- 거래 톡방 시세 (build_trend.py 가 만든 data/trend.json): 팝니다 중간값
- 게임 상점 `자료/상점/상품.json`·`상자.json`·`가챠.json` (플래티넘 값, 구매 제한, 구성품)
- 줄임말 (build_trend.py 가 만든 data/chatmarket.json 의 slang): '고봉' -> 고대의봉

-> public/data/book.json (검색 `src/search.ts`, 아이템 화면 `src/pages/Detail.tsx` 가 필요할 때 받는다), 그림 public/data/icon/
(영상에서 아이템만 오린 아이콘 `자료/이미지/도감아이콘`. 위키 아이템·장비 표 아이콘도 이것으로 바꾼다: build_data.py 가 `wiki_icon` 을 부른다.
도감 계산기·시세 동향도 같은 폴더의 그림을 쓴다).
"""
import json
import os
import re
import shutil
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SAPPHIRE_DATA") or ROOT / "자료")
OUT = ROOT / "web" / "public" / "data"
CUT = DATA / "이미지" / "도감아이콘"
ICONS = OUT / "icon"

nk = lambda s: re.sub(r"\s+", "", s or "")
fs_name = lambda s: re.sub(r'[\/:*?"<>|]', "_", s)  # 자료 저장소의 파일 이름 규칙
url_name = lambda s: re.sub(r"[^0-9A-Za-z가-힣_\-]", "_", s)  # 주소에 그대로 쓸 수 있는 글자만

_cut: dict | None = None


def cut_index() -> dict:
    """오린 아이콘: stem(파일 이름) -> {f: 파일, url: 올라갈 이름, src: 도감정보/거래소}, 그리고 띄어쓰기 뺀 이름 -> stem"""
    global _cut
    if _cut is not None:
        return _cut
    by_stem, by_key, used = {}, {}, set()
    listing = CUT / "목록.json"
    if listing.exists():
        for nm, src in json.loads(listing.read_text(encoding="utf-8")).items():
            stem = fs_name(nm)
            f = CUT / (stem + ".png")
            if not f.exists():
                continue
            u = url_name(stem)
            while u in used:
                u += "_"
            used.add(u)
            by_stem[stem] = {"f": f, "url": u + ".png", "src": src}
            by_key.setdefault(nk(nm), stem)
    _cut = {"stem": by_stem, "key": by_key}
    return _cut


_sizes: dict[str, list] = {}


def icon_pic(stem: str | None) -> dict | None:
    """stem 의 오린 아이콘을 화면 Pic 모양으로 ({src, w, h}). 없으면 None"""
    c = cut_index()["stem"].get(stem or "")
    if not c:
        return None
    if stem not in _sizes:
        with Image.open(c["f"]) as im:
            _sizes[stem] = list(im.size)
    w, h = _sizes[stem]
    return {"src": "data/icon/" + c["url"], "w": w, "h": h}


def icon_url(name: str) -> str | None:
    """이름(띄어쓰기 무시)의 오린 아이콘 주소 '/data/icon/…png'. 도감 계산기·시세 동향이 쓴다"""
    c = cut_index()
    stem = fs_name(name) if fs_name(name) in c["stem"] else c["key"].get(nk(name))
    return "/data/icon/" + c["stem"][stem]["url"] if stem else None


_tab_stem: dict | None = None


def tab_icon_url(name: str, tab: str = "일반") -> str | None:
    """탭(일반·코스튬·펫·라이딩)의 그 이름 아이템 아이콘 주소. 이름이 같아도 탭이 다르면 다른 그림이다 (투구 '동그리모자' / 코스튬 '동그리모자',
    코스튬 '집토끼' / 펫 '집토끼'), 펫은 띄어쓰기만 다른 다른 펫이 있어 이름 그대로 먼저. 사전에 없으면 이름으로 찾는다"""
    global _tab_stem
    if _tab_stem is None:
        _tab_stem = {}
        for b in book_cells():
            if b.get("이름") and b.get("그림"):
                stem = Path(b["그림"]).stem
                _tab_stem.setdefault((b["큰탭"], b["이름"].strip()), stem)
                _tab_stem.setdefault((b["큰탭"], "~" + nk(b["이름"])), stem)
    c = cut_index()["stem"]
    name = (name or "").strip()
    for k in ((tab, name), (tab, "~" + nk(name))):
        stem = _tab_stem.get(k)
        if stem in c:
            return "/data/icon/" + c[stem]["url"]
    if tab == "일반":
        pic = wiki_icon(name)
        if pic:
            return "/" + pic["src"]
    return icon_url(name)


_book_cells: list | None = None


def book_cells() -> list:
    global _book_cells
    if _book_cells is None:
        p = DATA / "도감" / "아이템" / "아이템.json"
        _book_cells = json.loads(p.read_text(encoding="utf-8")).get("아이템", []) if p.exists() else []
    return _book_cells


_normal_stem: dict | None = None


def wiki_icon(name: str, aka: list | None = None) -> dict | None:
    """위키 아이템(일반 아이템)의 오린 아이콘. 사전의 일반 탭 칸 그림이 먼저('동그리모자' 는 투구이고 코스튬 '동그리모자' 그림은 따로 있다),
    그다음 거래소 녹화에서 오린 그림(코스튬·펫 탭 것은 빼고)"""
    global _normal_stem
    if _normal_stem is None:
        _normal_stem = {}
        for b in book_cells():
            if b.get("큰탭") == "일반" and b.get("이름") and b.get("그림"):
                _normal_stem.setdefault(nk(b["이름"]), Path(b["그림"]).stem)
        skip = set()
        for day in sorted((DATA / "시세" / "암거래중개인").glob("*/시세.json")):
            for o in json.loads(day.read_text(encoding="utf-8")).get("others", []):
                if str(o.get("tab") or "").startswith(("코스튬", "펫")):
                    skip.add(nk(o.get("base")))
        c = cut_index()
        for k, stem in c["key"].items():
            if c["stem"][stem]["src"] == "거래소" and k not in skip:
                _normal_stem.setdefault(k, stem)
    for n in [name, *(aka or [])]:
        pic = icon_pic(_normal_stem.get(nk(n)))
        if pic:
            return pic
    return None


def copy_icons() -> int:
    """오린 아이콘을 모두 data/icon/ 으로 (로그인한 길드원에게만 보인다, functions/data/_middleware.ts)"""
    if ICONS.exists():
        shutil.rmtree(ICONS)
    c = cut_index()["stem"]
    if not c:
        return 0
    ICONS.mkdir(parents=True)
    for v in c.values():
        shutil.copy2(v["f"], ICONS / v["url"])
    return len(c)


def _read(name: str):
    p = OUT / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def main() -> None:
    if not book_cells() and not (DATA / "시세" / "암거래중개인").exists():
        print("아이템 책: 자료/도감/아이템 과 자료/시세 가 없어서 건너뜀")
        return
    n_icons = copy_icons()
    wiki = _read("items.json") or {}
    wiki_key = {}
    for n, it in wiki.items():
        wiki_key.setdefault(nk(n), n)
        for a in it.get("aka", []):
            wiki_key.setdefault(nk(a), n)

    items: dict[str, list] = {}
    index: dict[tuple, tuple] = {}  # (탭, 띄어쓰기 뺀 이름) -> (이름, 변형)
    exact: dict[tuple, tuple] = {}  # (탭, 이름 그대로)

    def variant(t: str, name: str, sub: str | None = None, make: bool = True):
        """탭 t 의 아이템 변형을 찾거나 만든다. 펫은 띄어쓰기만 다른 다른 펫이 있어('견습마법사' / '견습 마법사') 이름 그대로 먼저"""
        name = name.strip()
        hit = exact.get((t, name)) or (None if t == "펫" and (t, name) not in exact and _pet_twins.get(nk(name), 0) > 1 else index.get((t, nk(name))))
        if hit:
            return hit[1]
        if not make:
            return None
        key = wiki_key.get(nk(name), name) if t == "일반" else name
        v = {"t": t}
        if sub:
            v["s"] = sub
        items.setdefault(key, []).append(v)
        index.setdefault((t, nk(name)), (key, v))
        exact.setdefault((t, name), (key, v))
        return v

    def variant_any(t: str, name: str):
        """도감·톡방처럼 탭을 모르는 자료: 그 탭에 없으면 다른 탭에 이미 있는 같은 이름에 붙인다 (일반 도감에 들어가는 코스튬 '해니아' 등)"""
        for tt in (t, "일반", "코스튬", "펫", "라이딩"):
            v = variant(tt, name, make=False)
            if v is not None:
                return v
        return variant(t, name)

    _pet_twins: dict[str, int] = {}
    for b in book_cells():
        if b.get("큰탭") == "펫" and b.get("이름"):
            _pet_twins[nk(b["이름"])] = _pet_twins.get(nk(b["이름"]), 0) + 1
    # 펫 이름이 같은 칸이 둘이면 같은 펫(전체 탭에 두 번)일 수 있다: 이름 가지 수로 다시 센다
    _pet_names: dict[str, set] = {}
    for b in book_cells():
        if b.get("큰탭") == "펫" and b.get("이름"):
            _pet_names.setdefault(nk(b["이름"]), set()).add(b["이름"].strip())
    _pet_twins = {k: len(v) for k, v in _pet_names.items()}

    # 1) 게임 도감 정보 사전
    seen_cell: dict[tuple, dict] = {}
    for b in book_cells():
        name = (b.get("이름") or "").strip()
        if not name:
            continue
        t = b["큰탭"]
        sub = re.sub(r"^코스튬", "", b.get("고르기") or "") or None
        if sub == "전체":
            sub = None
        st = [[s, str(x)] for s, x in (b.get("능력치") or [])]
        sig = (t, name if t == "펫" else nk(name), json.dumps(st, ensure_ascii=False), b.get("설명") or "", bool(b.get("거래불가")), b.get("요구레벨"))
        pic = icon_pic(Path(b["그림"]).stem) if b.get("그림") else None
        if sig in seen_cell:  # '전체' 탭과 고르기 탭에 두 번 나온 같은 칸, 또는 색만 다른 같은 아이템(가을머리띠)
            had = seen_cell[sig]
            if sub and not had.get("s"):
                had["s"] = sub
            if pic and pic["src"] != (had.get("pic") or {}).get("src") and pic not in had.get("more", []):
                if "pic" not in had:
                    had["pic"] = pic
                else:
                    had.setdefault("more", []).append(pic)
            continue
        key = wiki_key.get(nk(name), name) if t == "일반" else name
        v = {"t": t, "src": "도감 정보"}
        if sub:
            v["s"] = sub
        for k, val in (("g", b.get("등급")), ("lv", b.get("요구레벨")), ("jobs", b.get("직업") or None), ("sex", b.get("성별")),
                       ("st", st or None), ("set", [f"{x.get('세트')}세트 {x.get('효과')}" if isinstance(x, dict) else str(x) for x in (b.get("세트효과") or [])] or None), ("cd", b.get("쿨타임_초")), ("desc", b.get("설명")),
                       ("nt", 1 if b.get("거래불가") else None), ("cash", b.get("캐쉬샵"))):
            if val:
                v[k] = val
        if pic:
            v["pic"] = pic
        items.setdefault(key, []).append(v)
        seen_cell[sig] = v
        index.setdefault((t, nk(name)), (key, v))
        exact.setdefault((t, name), (key, v))

    def set_lines(v: dict, lines, src: str) -> None:
        lines = [str(x).strip() for x in (lines or []) if str(x or "").strip()]
        if lines and v.get("src") != "도감 정보" and not v.get("lines"):
            v["lines"], v["src"] = lines, src

    def set_pic(v: dict, name: str) -> None:
        if "pic" not in v:
            c = cut_index()
            stem = fs_name(name) if fs_name(name) in c["stem"] else c["key"].get(nk(name))
            pic = icon_pic(stem)
            if pic:
                v["pic"] = pic

    # 2) 게임 거래소 녹화: 사전에 없는 물건(재료·스킬북 등)의 이름·정보창 글·그림만. 최저가는 도감 계산기(build_dex.py)만 쓴다
    days = sorted((DATA / "시세" / "암거래중개인").glob("*/시세.json"))
    for day in days:
        s = json.loads(day.read_text(encoding="utf-8"))
        info_of: dict[str, list] = {}
        for it in s.get("items", []):
            if it.get("info") and it.get("plus") in (0, None):
                info_of.setdefault(nk(it.get("base")), it["info"])
        for e in s.get("equipment", []):
            p = {str(k): int(x) for k, x in (e.get("min_by_plus") or {}).items() if x is not None}
            if not e.get("base") or not p:
                continue
            v = variant("일반", e["base"], e.get("slot") or e.get("tab"))
            set_lines(v, info_of.get(nk(e["base"])), "게임 거래소 정보창")
            set_pic(v, e["base"])
        for o in s.get("others", []):
            base, tab = (o.get("base") or "").strip(), str(o.get("tab") or "")
            if not base or o.get("unit_min") is None:
                continue
            t = "코스튬" if tab.startswith("코스튬") else "펫" if tab == "펫" else "일반"
            v = variant(t, base, re.sub(r"^코스튬", "", tab) or None)
            set_lines(v, o.get("info"), "게임 거래소 정보창")
            set_pic(v, base)

    # 3) 도감 퀘스트: 그 아이템이 들어가는 항목 (이름, 강화, 개수)
    dex = _read("dex.json") or {}
    for e in dex.get("entries", []):
        if e.get("period"):
            continue  # 기간이 있는 이벤트 도감은 도감 계산기에서만 (기간이 끝나면 화면이 빼는데 책은 배포 때만 다시 만들어서)
        t = e.get("cat") or "일반"
        for it in e.get("items", []):
            if not it.get("name"):
                continue
            base = re.sub(r"^\+\d+\s*", "", it["name"]).strip()
            v = variant_any(t, base)
            row = [e["name"], it.get("plus") or 0, it.get("n") or 1]
            if row not in v.setdefault("dex", []):
                v["dex"].append(row)
            if it.get("info"):
                set_lines(v, re.split(r"\s*·\s*", it["info"]), "도감 툴팁")
            set_pic(v, base)

    # 4) 거래 톡방 시세 (팝니다 중간값, 만 원)
    trend = _read("trend.json") or {}
    for ti in trend.get("items", []):
        name = ti["name"]
        cos = name.endswith("(코스튬)")
        base = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
        v = variant("코스튬", base, make=False) if cos else next((x for x in (variant(tt, base, make=False) for tt in ("일반", "코스튬", "펫")) if x is not None), None)
        if v is not None and ti.get("med"):
            v["tk"] = {"med": ti["med"], "n": ti["n"], "to": ti.get("last")}

    # 5) 게임 상점: 상품(플래티넘 값·구매 제한·정보·구성품), 상자 구성, 가챠
    shop_pics = 0
    sp = DATA / "상점" / "상품.json"
    if sp.exists():
        for p in json.loads(sp.read_text(encoding="utf-8")).get("상품", []):
            name = (p.get("이름") or "").strip()
            if not name:
                continue
            v = variant("상점", name, re.sub(r"\(.*\)", "", (p.get("탭") or "").split(">")[0]).strip() or None)
            if p.get("플래티넘") is not None:
                v["plat"] = p["플래티넘"]
            if (p.get("개수") or 1) > 1:
                v["cnt"] = p["개수"]
            lim = (p.get("구매제한") or {}).get("화면")
            if lim:
                v["limit"] = lim
            v["lines"] = [str(x) for x in (p.get("정보") or [])]
            v["src"] = "게임 상점"
            parts = [[c["이름"], c.get("개수") or 1] for c in (p.get("구성품") or []) if c.get("이름")]
            if parts:
                v["parts"] = parts
            f = DATA / p["그림"] if p.get("그림") else None
            if f and f.exists() and "pic" not in v:
                out = "shop_" + url_name(name) + ".png"
                shutil.copy2(f, ICONS / out)
                with Image.open(f) as im:
                    v["pic"] = {"src": "data/icon/" + out, "w": im.size[0], "h": im.size[1]}
                shop_pics += 1
    bp = DATA / "상점" / "상자.json"
    if bp.exists():
        for b in json.loads(bp.read_text(encoding="utf-8")).get("상자", []):
            name = (b.get("상자") or "").strip()
            parts = [[c["이름"], c.get("개수") or 1] for c in (b.get("구성품") or []) if c.get("이름")]
            if not name or not parts:
                continue
            had = variant("상점", name, make=False)
            if had is not None:
                had.setdefault("parts", parts)
            else:
                v = variant("상자", name, b.get("어디"))
                v["parts"], v["src"] = parts, "게임 상점"
                set_pic(v, name)
            # 구성품 칸을 눌러 본 정보: 다른 자료에 없는 아이템이면 그 글을 정보로
            for c in b.get("구성품") or []:
                if c.get("이름") and c.get("정보"):
                    cv = variant_any("일반", c["이름"])
                    set_lines(cv, c["정보"], "게임 상점 구성품 정보")
                    set_pic(cv, c["이름"])
    gp = DATA / "상점" / "가챠.json"
    if gp.exists():
        for g in json.loads(gp.read_text(encoding="utf-8")).get("가챠", []):
            name = (g.get("이름") or "").strip()
            if not name:
                continue
            v = variant("가챠", name, g.get("상자") or g.get("부제"))
            price = g.get("값") or {}
            unit = price.get("단위") or "플래티넘"
            v["lines"] = [x for x in (
                f"판매 기간 {g['판매기간']}" if g.get("판매기간") else "",
                " · ".join(f"{k} {x:,} {unit}" for k, x in price.items() if isinstance(x, (int, float))),
                ("대표 " + ", ".join(g["대표"])) if g.get("대표") else "") if x]
            v["src"] = "게임 상점"

    # 6) 줄임말: 톡방 줄임말 표에서 아이템으로 풀리는 것 -> 아이템 이름들 (검색), 나머지 풀이는 글자 그대로
    chat = _read("chatmarket.json") or {}
    slang = dict(chat.get("slang") or {})
    names_by_key: dict[str, list] = {}
    for key in list(wiki) + list(items):
        if key not in names_by_key.setdefault(nk(key), []):
            names_by_key[nk(key)].append(key)
    abbr: dict[str, list] = {}
    for a, full in slang.items():
        target = re.sub(r"\s*\((코스튬|거래불가)\)\s*$", "", full).strip()
        hit = names_by_key.get(nk(target))
        if hit and nk(a) != nk(target):
            abbr[a] = hit
    for ti in trend.get("items", []) + trend.get("itemsBuy", []):
        hit = names_by_key.get(nk(re.sub(r"\s*\([^)]*\)\s*$", "", ti["name"])))
        for a in ti.get("abbr") or []:
            if hit and nk(a) != nk(hit[0]):
                abbr.setdefault(a, hit)

    # 빈 변형(이름만 있는 것)은 뺀다
    keep = {}
    for key, vs in items.items():
        vs = [v for v in vs if len(v) > (2 if "s" in v else 1)]
        if vs:
            keep[key] = vs
    out = {"built": date.today().isoformat(),
           "src": {"book": "게임 도감 정보 (2026-11-11 녹화)"},
           "items": keep, "abbr": abbr, "slang": slang}
    (OUT / "book.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    count = lambda f: sum(1 for vs in keep.values() if any(f(v) for v in vs))
    print("아이템 책", {"이름": len(keep), "위키에 없는 이름": sum(1 for k in keep if k not in wiki), "그림": count(lambda v: v.get("pic")),
                    "게임 정보": count(lambda v: v.get("g") or v.get("lv") or v.get("st") or v.get("desc") or v.get("lines")),
                    "도감": count(lambda v: v.get("dex")), "톡방 시세": count(lambda v: v.get("tk")), "상점": count(lambda v: v["t"] in ("상점", "상자", "가챠")),
                    "줄임말": len(abbr), "아이콘 파일": n_icons + shop_pics, "kb": (OUT / "book.json").stat().st_size // 1024})


if __name__ == "__main__":
    main()
