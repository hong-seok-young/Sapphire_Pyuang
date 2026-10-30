"""위키 자료 만들기: ../자료 (카페에서 저장한 글과 그림) -> public/data/*.json, public/img/*

준비: 자료/ 폴더가 있어야 한다 (git에 없다. CLAUDE.md '위키 자료' 참고).
실행: python scripts/build_data.py   (필요: pip install -r scripts/requirements.txt)

만드는 것
  posts.json      글마다 제목과 본문 블록(문단, 표). 그림과 다른 글 링크도 들어 있다
  menu.json       홈 화면 메뉴 (육성 공략, 스킬, 장비, 조합책, 기타)
  regions.json    지역 -> 사냥터 목록
  places.json     사냥터: 레벨, 배너 그림, 몬스터, 원글에서 그대로 그릴 칸 (지도, 이동, 퀘스트, 참고)
  monsters.json   몬스터: 레벨, HP, 특징, 드랍, 재부활, 스킬, 그림
  items.json      아이템: 아이콘, 떨구는 몬스터, 장비 정보
  equipment.json  부위별 장비 표
  meta.json       출처, 만든 날짜
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import html
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

from bs4 import BeautifulSoup, NavigableString, Tag
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료"
OUT = ROOT / "web" / "public"
POST_DIRS = [SRC / "드랍표_원본" / "글", SRC / "드랍표_원본" / "글2"]
INDEX_PAGE = SRC / "드랍표_원본" / "page.html"
INDEX_FILES = SRC / "드랍표_원본" / "files"
ORIG_DIR = SRC / "이미지" / "원본"
MANIFEST = json.loads((ORIG_DIR / "목록.json").read_text(encoding="utf-8"))
CAFE = "https://cafe.naver.com/iphoneimo/"
SOURCE = {"제목": "아이모 원클릭 드랍표", "작성자": "iOS", "글": CAFE + "333636", "패치": "2026.10.24"}
# naver.me short links in the posts all lead to cafe posts. Resolved once (2026-10-30, curl -I) so the wiki
# can open its own page for that post instead of sending people out to the cafe.
NAVER_ME = {
    "GSQvdJiK": "342972", "xpj8ckdY": "342707", "xdMZgsl8": "186770", "GzdnqaiT": "332500",
    "GJZsjaN9": "343049", "56Xp79Zn": "343051", "5ulXbdwE": "185599", "xdM52aZl": "343049",
    "x3cLq0yL": "342999", "5wrDuSeE": "343068", "FbVQJ6YG": "343069", "Gi0bL3bU": "230264",
    "xHEkfGp7": "246455", "GkIDBMzl": "332634", "551H1hJY": "335677", "xEXYoYRU": "336975",
    "FgEfwPck": "247242", "xLNaqi3w": "244701", "FUiQeq3R": "244690", "GIIGQIwH": "244749",
}

BIG_IMAGE = 300_000  # bytes; bigger still pictures are re-encoded as WebP
MAX_SIDE = 1600      # px; huge guide pictures are scaled down to this for phones

# ---------------------------------------------------------------- pictures

_exported: dict[str, dict] = {}


def export_picture(path: Path) -> dict | None:
    """Copy a picture into public/img under a short content-hash name. Returns {src, w, h}."""
    key = str(path)
    if key in _exported:
        return _exported[key]
    if not path.exists():
        return None
    data = path.read_bytes()
    try:
        im = Image.open(io.BytesIO(data))
        w, h = im.size
        animated = getattr(im, "is_animated", False)
    except Exception:
        return None
    ext = {"PNG": ".png", "GIF": ".gif", "JPEG": ".jpg", "WEBP": ".webp"}.get(im.format, ".png")
    if len(data) > BIG_IMAGE and not animated:
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if max(w, h) > MAX_SIDE:
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            w, h = im.size
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=85, method=6)
        data, ext = buf.getvalue(), ".webp"
    name = hashlib.sha1(data).hexdigest()[:12] + ext
    target = OUT / "img" / name
    if not target.exists():
        target.write_bytes(data)
    info = {"src": "img/" + name, "w": w, "h": h}
    _exported[key] = info
    return info


def linkdata(tag: Tag | None) -> dict:
    if tag is None or not tag.get("data-linkdata"):
        return {}
    try:
        return json.loads(html.unescape(tag["data-linkdata"]))
    except ValueError:
        return {}


def picture_of(img: Tag) -> dict | None:
    """The picture behind an <img>: original download if known, else the embedded bytes, else a local file."""
    a = img.find_parent("a")
    url = linkdata(a).get("src", "")
    if url in MANIFEST:
        return export_picture(ORIG_DIR / MANIFEST[url])
    src = img.get("src") or ""
    m = re.match(r"data:image/(png|gif|jpe?g|webp);base64,(.+)", src, re.S)
    if m:
        raw = base64.b64decode(m.group(2))
        cached = ORIG_DIR / ("emb_" + hashlib.sha1(raw).hexdigest()[:16] + "." + m.group(1).replace("jpeg", "jpg"))
        if not cached.exists():
            cached.write_bytes(raw)
        return export_picture(cached)
    if src and not src.startswith("data:"):
        local = INDEX_FILES / unquote(src.split("/")[-1])
        if local.exists():
            return export_picture(local)
    return None


# ---------------------------------------------------------------- post bodies -> blocks

def article_id(link: str) -> str | None:
    m = re.search(r"cafe\.naver\.com/(?:iphoneimo/|ca-fe/web/cafes/(?:iphoneimo|20603221)/articles/)(\d+)", link or "")
    if m:
        return m.group(1)
    m = re.search(r"naver\.me/(\w+)", link or "")
    return NAVER_ME.get(m.group(1)) if m else None


DEFAULT_COLORS = {"#000000", "#141414", "#333333", "#222222", "#111111"}


def runs_of(node: Tag) -> list:
    """Inline content -> runs: {t, b?, c?} text, {img, w, h, to?} picture, {t, to} link."""
    out: list = []

    def walk(el, bold=False, color=None, link=None):
        if isinstance(el, NavigableString):
            t = re.sub(r"\s+", " ", str(el).replace("​", ""))  # source line breaks are not real breaks
            if t.strip() or (t and out):
                run = {"t": t}
                if bold:
                    run["b"] = 1
                if color:
                    run["c"] = color
                if link:
                    run["to"] = link
                out.append(run)
            return
        if not isinstance(el, Tag) or el.name in ("script", "style", "noscript"):
            return
        if el.name == "img":
            pic = picture_of(el)
            if pic:
                run = dict(pic)
                if link:
                    run["to"] = link
                out.append(run)
            return
        if el.name == "br":
            out.append({"t": "\n"})
            return
        b = bold or el.name in ("b", "strong")
        c = color
        m = re.search(r"(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{6})", el.get("style") or "")
        if m and m.group(1).lower() not in DEFAULT_COLORS:
            c = m.group(1).lower()
        lk = link
        if el.name == "a":
            target = linkdata(el).get("link") or el.get("href") or ""
            aid = article_id(target)
            if aid:
                lk = "post:" + aid
            elif target.startswith("http") and "cafe.naver.com" not in target and "naver.me" not in target:
                lk = target
        for child in el.children:
            walk(child, b, c, lk)

    walk(node)
    # merge neighbouring text runs with the same style
    merged: list = []
    for r in out:
        if merged and "t" in r and "t" in merged[-1] and "src" not in merged[-1] and \
                {k: v for k, v in r.items() if k != "t"} == {k: v for k, v in merged[-1].items() if k != "t"}:
            merged[-1]["t"] += r["t"]
        else:
            merged.append(r)
    for r in merged:
        if "t" in r:
            r["t"] = re.sub(r"[ \t\xa0]+", " ", r["t"])
    while merged and "t" in merged[-1] and not merged[-1]["t"].strip() and "src" not in merged[-1]:
        merged.pop()
    return merged


def lines_of(container: Tag) -> list[list]:
    """A cell or text component -> list of lines (each a run list), one per paragraph."""
    paras = [p for p in container.find_all("p") if p.find_parent(["td", "th"]) is container.find_parent(["td", "th"])
             or container.name in ("td", "th") and p.find_parent(["td", "th"]) is container]
    if not paras:
        r = runs_of(container)
        return [r] if r else []
    lines = []
    for p in paras:
        if p.find_parent("table") is not container.find_parent("table") and container.name not in ("td", "th"):
            continue
        r = runs_of(p)
        lines.append(r)
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    return lines


def rows_of(table: Tag) -> list[Tag]:
    rows = []
    for child in table.children:
        if isinstance(child, Tag) and child.name in ("tbody", "thead", "tfoot"):
            rows += child.find_all("tr", recursive=False)
        elif isinstance(child, Tag) and child.name == "tr":
            rows.append(child)
    return rows


def table_block(table: Tag) -> dict:
    rows = []
    for tr in rows_of(table):
        cells = []
        for td in tr.find_all(["td", "th"], recursive=False):
            cell: dict = {"l": lines_of(td)}
            cs, rs = int(td.get("colspan") or 1), int(td.get("rowspan") or 1)
            if cs > 1:
                cell["cs"] = cs
            if rs > 1:
                cell["rs"] = rs
            m = re.search(r"background-color\s*:\s*(#[0-9a-fA-F]{6})", td.get("style") or "")
            if m and m.group(1).lower() not in ("#ffffff",):
                cell["bg"] = m.group(1).lower()
            cells.append(cell)
        if cells:
            rows.append(cells)
    return {"k": "table", "rows": rows}


def body_blocks(box: Tag) -> list[dict]:
    blocks: list[dict] = []
    seen_tables = set()
    for el in box.find_all(["table", "p", "img"]):
        if el.find_parent("table") is not None:
            continue
        if el.name == "table":
            if id(el) in seen_tables:
                continue
            seen_tables.add(id(el))
            b = table_block(el)
            if b["rows"]:
                blocks.append(b)
        elif el.name == "p":
            r = runs_of(el)
            if r:
                blocks.append({"k": "p", "r": r})
        elif el.name == "img" and el.find_parent("p") is None:
            pic = picture_of(el)
            if pic:
                blocks.append({"k": "p", "r": [pic]})
    # drop the cafe's trailing boilerplate
    while blocks and blocks[-1]["k"] == "p" and "투표는 표시되지 않습니다" in "".join(r.get("t", "") for r in blocks[-1]["r"]):
        blocks.pop()
    return blocks


def plain(lines: list[list]) -> str:
    return " / ".join("".join(r.get("t", "") for r in line).strip() for line in lines if line).strip(" /")


# ---------------------------------------------------------------- read every saved post

GROUPED = re.compile(r'--sf-img-(\d+)\s*:\s*url\("?(data:image/(?:png|gif|jpe?g|webp)[^")]*)"?\)')


def restore_grouped_images(soup: BeautifulSoup, raw: str) -> None:
    """SingleFile keeps a picture used many times once, as a style variable (--sf-img-N), and leaves an
    empty SVG in each <img> with background-image:var(--sf-img-N). Put the real picture back into src."""
    pictures = {m.group(1): m.group(2) for m in GROUPED.finditer(raw)}
    if not pictures:
        return
    for img in soup.find_all("img"):
        if not (img.get("src") or "").startswith("data:image/svg"):
            continue
        m = re.search(r"var\(--sf-img-(\d+)\)", img.get("style") or "")
        if m and m.group(1) in pictures:
            img["src"] = pictures[m.group(1)]


def load_posts() -> tuple[dict, dict]:
    posts, soups = {}, {}
    for d in POST_DIRS:
        titles = {}
        lst = d / "목록.tsv"
        if lst.exists():
            for line in lst.read_text(encoding="utf-8").splitlines():
                aid, title, _ = line.split("\t")
                titles[aid] = title
        for f in sorted(d.glob("*.html")):
            aid = f.stem
            raw = f.read_text(encoding="utf-8", errors="replace")
            soup = BeautifulSoup(raw, "lxml")
            restore_grouped_images(soup, raw)
            box = soup.select_one("div.post_cont")
            if box is None:
                continue
            title = titles.get(aid) or (soup.title.get_text().split(" : ")[0] if soup.title else aid)
            posts[aid] = {"id": aid, "title": title.strip(), "blocks": body_blocks(box)}
            soups[aid] = box
            print(f"  글 {aid} {title[:30]}")
    return posts, soups


# ---------------------------------------------------------------- hunting grounds, monsters, drops

def split_top(s: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "(（[":
            depth += 1
        elif ch in ")）]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [x.strip(" /") for x in out if x.strip(" /")]


def item_key(name: str) -> str:
    """'펫 크리스탈(*1)' / '거미줄(*1~7)' / '영광의팬던트 (처치 시 …)' -> '펫 크리스탈' / '거미줄' / '영광의팬던트'."""
    name = re.sub(r"\(\s*\*[\d~\-]+\s*\)$", "", name).strip()
    name = re.sub(r"\(\s*\)$", "", name).strip()
    name = re.sub(r"\s+\([^)]*\s[^)]*\)$", "", name).strip()  # a note in brackets, not part of the name
    return name


def drop_names(text: str) -> list[str]:
    """Drop cell text -> item names. Commas and line breaks (' / ') separate items; line breaks also split the
    two tiers of a 헌팅그라운드 monster. Where the author forgot a comma, the gap left by the icon (two spaces)
    does. A line that is only a note in brackets is not an item."""
    names = []
    for line in text.split(" / "):
        for part in split_top(line):
            for piece in re.split(r"\s{2,}", part):
                k = item_key(piece)
                if k and len(k) <= 25 and not k.startswith("(") and k != ")":
                    names.append(k)
    return list(dict.fromkeys(names))


def first_picture(td: Tag) -> dict | None:
    img = td.find("img")
    return picture_of(img) if img is not None else None


HP_CELL = re.compile(r"HP\s*[\d,\-?]+")  # match on get_text("") : some posts split H and P into two pieces


def parse_monsters(aid: str, box: Tag, place: dict) -> list[dict]:
    """A monster is an 'HP | drops' row, then the name row with (Lv.), then an optional respawn/skill row.
    One table can hold several monsters in a row (인던25's 다크임프 and 매직임프), so walk every row."""
    mons = []
    for table in box.find_all("table"):
        rows = rows_of(table)
        if len(rows) < 2 or "(Lv." not in table.get_text():
            continue
        for i, row in enumerate(rows[:-1]):
            r0 = row.find_all(["td", "th"], recursive=False)
            if len(r0) < 2 or not HP_CELL.search(r0[0].get_text("")) or "(Lv." not in rows[i + 1].get_text():
                continue
            mon = monster_from_rows(aid, r0, rows[i + 1], rows[i + 2] if i + 2 < len(rows) else None)
            if mon:
                mons.append(mon)
    return mons


def monster_from_rows(aid: str, r0: list[Tag], name_row: Tag, third: Tag | None) -> dict | None:
    name_lines = [plain([l]) for l in lines_of(name_row.find(["td", "th"]))]
    name_lines = [x for x in name_lines if x]
    if not name_lines:
        return None
    if name_lines[0].startswith("("):
        return None  # 길드던전 boss parts: '(Lv.35) / ① 오른팔 / HP …' rows, not a monster block
    # the name can run over two lines ('한에 서린 / 레버넌트'); it ends where the level starts
    name_parts = []
    for line in name_lines:
        if line.startswith("(Lv") or "｜" in line:
            break
        name_parts.append(line)
    name = re.sub(r"^[①-⑳]\s*", "", " ".join(name_parts) or name_lines[0])  # guild dungeon parts are numbered ①~⑤
    whole = " ".join(name_lines)
    lv = re.search(r"Lv\.?\s*(\d+)", whole)
    hp = re.search(r"HP\s*([\d,]+)", r0[0].get_text(""))
    drop_text = plain(lines_of(r0[1]))
    # 리에티 (boss skills) and 옛 앨프의 수정 (buffs ⑴~⑺): the drop cell describes effects, not items
    boss_skills = bool(re.search(r"[★❗⑴]", drop_text))
    drops = [] if boss_skills else drop_names(drop_text)
    mon = {
        "key": f"{name}@{aid}",
        "name": name,
        "level": int(lv.group(1)) if lv else None,
        "hp": int(hp.group(1).replace(",", "")) if hp else None,
        "traits": " · ".join(x.replace("｜", " · ") for x in name_lines[len(name_parts or [0]):] if "Lv." not in x),
        "drops": drops,
        "place": aid,
        "img": first_picture(r0[0]),
    }
    if boss_skills:
        mon["skill"] = drop_text
    # 헌팅그라운드 monsters come in two tiers: '(Lv.34) / (Lv.49)', 'HP 2,050 / HP 5,800'
    levels = re.findall(r"Lv\.?\s*(\d+|-)", whole)
    hps = re.findall(r"HP\s*([\d,]+|-)", r0[0].get_text(""))
    if len(levels) > 1:
        mon["levels"] = levels
    if len(hps) > 1:
        mon["hps"] = hps
    # the row after the name holds respawn time or boss skills, unless it already starts the next monster
    if third is not None and not HP_CELL.search(third.get_text("")[:20]):
        c = third.find_all(["td", "th"], recursive=False)
        first = plain(lines_of(c[0])).replace(" / ", " ") if c else ""
        rest = " / ".join(plain(lines_of(x)) for x in c[1:] if plain(lines_of(x)) not in ("", "-"))
        if first.startswith("재부활"):
            mon["respawn"] = first.split(":", 1)[-1].strip()
        elif first and first != "스킬 없음" and "skill" not in mon:
            mon["skill"] = first
        if rest:
            mon["note"] = rest
    return mon


def index_buttons() -> tuple[dict, dict]:
    """From the saved index post: article id -> banner picture, region name -> region picture."""
    soup = BeautifulSoup(INDEX_PAGE.read_text(encoding="utf-8"), "lxml")
    box = soup.select_one("div.se-main-container")
    banners = {}
    for a in box.find_all("a"):
        ld = linkdata(a)
        aid = article_id(ld.get("link", ""))
        img = a.find("img")
        if aid and img is not None:
            pic = picture_of(img)
            if pic:
                banners[aid] = pic
    region_pics = {}
    for name, file in [("윙프릴 섬", "윙프릴의섬.png"), ("이노티아 대륙", "이노티아.png"),
                       ("하늘성채", "하늘성채.png"), ("크라운락 주둔지", "크라운락.png")]:
        pic = export_picture(INDEX_FILES / file)
        if pic:
            region_pics[name] = pic
    return banners, region_pics



# ---------------------------------------------------------------- the rest of a hunting-ground post

def run_list(b: dict) -> list:
    """Every run (text or picture) of a posts.json block."""
    if b["k"] == "p":
        return b["r"]
    return [r for row in b["rows"] for cell in row for line in cell["l"] for r in line]


def block_text(b: dict) -> str:
    return "".join(r.get("t", "") for r in run_list(b)).strip()


def row_text(row: list[dict]) -> str:
    """A posts.json table row as text without separators, like Tag.get_text("")."""
    return "".join(r.get("t", "") for cell in row for line in cell["l"] for r in line)


def monster_rows(rows: list[list[dict]]) -> tuple[set[int], int]:
    """The monster blocks parse_monsters() finds, read again from a posts.json table:
    which rows they take up and how many monsters there are."""
    used, count = set(), 0
    for i in range(len(rows) - 1):
        r0, name_row = rows[i], rows[i + 1]
        if len(r0) < 2 or not HP_CELL.search(row_text(r0[:1])) or "(Lv." not in row_text(name_row):
            continue
        names = [x for x in (plain([line]) for line in name_row[0]["l"]) if x] if name_row else []
        if not names or names[0].startswith("("):
            continue  # not a monster block (see monster_from_rows)
        used |= {i, i + 1}
        count += 1
        if i + 2 < len(rows) and not HP_CELL.search(row_text(rows[i + 2])[:20]):
            used.add(i + 2)
    return used, count


def post_parts(aid: str, post: dict | None, monster_count: int) -> tuple[list[int], list[int]]:
    """Which blocks of a hunting-ground post the place page draws as they are, above and below the monster cards:
    maps, links to the next grounds, quests, NPCs, notes, rewards. Left out: the monster tables (shown as cards),
    the title box at the top (the page shows the place banner) and the cafe's '◀ 메뉴이동' links."""
    if not post:
        return [], []
    kinds, found = [], 0
    for i, b in enumerate(post["blocks"]):
        if b["k"] == "table":
            used, n = monster_rows(b["rows"])
            if n and len(used) == len(b["rows"]):
                kinds.append("monster")
                found += n
                continue
        pics = [r for r in run_list(b) if "src" in r]
        title_box = i < 2 and pics and all(r["w"] >= 2.4 * r["h"] for r in pics) and len(block_text(b)) <= 80
        if title_box or block_text(b) in ("◀ 메뉴이동", "◀️이전으로 돌아가기") or not (pics or block_text(b)):
            kinds.append("skip")
        else:
            kinds.append("show")
    if found != monster_count:
        # the cards and the tables disagree: draw the monster tables as well so nothing goes missing
        print(f"  사냥터 글 {aid}: 몬스터 표 {found}, 카드 {monster_count} -> 표도 그대로 보여 줌")
        kinds = ["show" if k == "monster" else k for k in kinds]
    first = kinds.index("monster") if "monster" in kinds else len(kinds)
    shown = [i for i, k in enumerate(kinds) if k == "show"]
    return [i for i in shown if i < first], [i for i in shown if i > first]

# ---------------------------------------------------------------- equipment tables

def parse_equipment(aid: str, title: str, box: Tag) -> dict | None:
    slot = re.sub(r"\(.*$", "", title).strip()
    headers, rows = None, []
    for table in box.find_all("table"):
        trs = rows_of(table)
        if not trs or "템명" not in trs[0].get_text():  # one post spells it 아아템명
            continue
        h = [plain(lines_of(td)) for td in trs[0].find_all(["td", "th"], recursive=False)]
        h = ["아이템명" if "템명" in x else x for x in h]
        headers = headers or h
        name_col = h.index("아이템명")
        for tr in trs[1:]:
            tds = tr.find_all(["td", "th"], recursive=False)
            if len(tds) <= name_col:
                continue
            cells = [plain(lines_of(td)) for td in tds]
            name = cells[name_col]
            if not name:
                continue
            row = {"name": name, "icon": first_picture(tds[0]), "cells": cells}
            if h != headers:  # one post can hold tables with different columns (보조 장비: 방패 / 마법 / 정밀)
                row["h"] = h
            # the 직업 column is a job emblem picture, not text; name_jobs() turns it into a job name
            if "직업" in h and h.index("직업") < len(tds) and not cells[h.index("직업")]:
                row["jobIcon"] = first_picture(tds[h.index("직업")])
            rows.append(row)
    if not rows:
        return None
    return {"slot": slot, "post": aid, "headers": headers, "rows": rows}


def name_jobs(equipment: list[dict]) -> None:
    """Learn which emblem means which job from the weapon tables ('전사 무기' rows carry the 전사 emblem),
    then write the job name into every row's 직업 cell. An emblem seen across all weapon tables is 공용."""
    seen: dict[str, dict[str, int]] = {}
    for eq in equipment:
        job = eq["slot"].replace(" 무기", "") if eq["slot"].endswith(" 무기") else None
        for row in eq["rows"]:
            if job and row.get("jobIcon"):
                counts = seen.setdefault(row["jobIcon"]["src"], {})
                counts[job] = counts.get(job, 0) + 1
    names = {}
    for src, counts in seen.items():
        best = max(counts, key=counts.get)
        names[src] = "공용" if len(counts) >= 3 else best
    for eq in equipment:
        for row in eq["rows"]:
            h = row.get("h") or eq["headers"]
            col = h.index("직업") if "직업" in h else -1
            icon = row.get("jobIcon")
            if col >= 0 and icon and icon["src"] in names and col < len(row["cells"]):
                row["cells"][col] = names[icon["src"]]


# ---------------------------------------------------------------- menu

JOBS = ["전사", "레인저", "마법사", "무도가"]
MENU = [
    ("육성 공략", "343711", ["343732", "343699", "343720", "343710"]),
    ("직업별 스킬", "345532", ["345735", "344229", "344246", "342010"]),
    ("조합책", "206149", ["206306", "206152", "206312", "213714", "214770"]),
    ("강화 · 보석 · 성장", None, ["331665", "343765", "345584", "343078"]),
    ("인던 · 길드던전", None, ["342349", "343758", "332071", "343692", "338047", "338050",
                          "282820", "282821", "282822", "282823", "282824"]),
    ("전장 · 헌팅그라운드", None, ["345990", "346203", "345516", "345514", "345526"]),
    ("퀘스트 · 지도", None, ["342566", "1064", "343200", "343201", "343203", "343205", "342858",
                         "342865", "343019", "331777", "344012", "345738"]),
]
# 목차 글에는 없고 헌팅그라운드 글(테멘 거점)에서만 이어지는 사냥터
EXTRA_PLACES = {"월드 서버 컨텐츠": [{"이름": "시나르 평야", "글": 345514}, {"이름": "비툼 습지", "글": 345526}]}


def first_banner(post: dict | None) -> dict | None:
    """The map label picture at the top of a hunting-ground post (about 159x60)."""
    for b in (post or {}).get("blocks", [])[:3]:
        cells = [c for row in b.get("rows", []) for c in row] if b["k"] == "table" else [{"l": [b["r"]]}]
        for c in cells:
            for line in c["l"]:
                for r in line:
                    if "src" in r and r["w"] >= 120:
                        return {k: r[k] for k in ("src", "w", "h")}
    return None


EQUIP_ORDER = ["전사 무기", "레인저 무기", "마법사 무기", "무도가 무기", "보조 장비", "투구", "갑옷", "장갑",
               "신발", "망토", "벨트", "목걸이", "반지"]


def main():
    (OUT / "data").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "data").glob("*.json"):
        old.unlink()
    (OUT / "img").mkdir(parents=True, exist_ok=True)  # kept between runs; unused files are removed at the end

    print("글 읽는 중")
    posts, boxes = load_posts()
    index = json.loads((SRC / "정리" / "지도_목록.json").read_text(encoding="utf-8"))
    banners, region_pics = index_buttons()

    print("사냥터, 몬스터")
    regions, places, monsters = [], {}, {}
    for region in index["지역"]:
        ids = []
        for p in region["장소"] + EXTRA_PLACES.get(region["이름"], []):
            aid = str(p["글"])
            ids.append(aid)
            mons = parse_monsters(aid, boxes[aid], p) if aid in boxes else []
            for m in mons:
                monsters[m["key"]] = m
            above, below = post_parts(aid, posts.get(aid), len(mons))
            levels = [m["level"] for m in mons if m["level"]]
            places[aid] = {
                "id": aid, "name": p["이름"], "title": posts.get(aid, {}).get("title", p["이름"]),
                "region": region["이름"],
                "level": p.get("레벨") or ([min(levels), max(levels)] if levels else None),
                "desc": p.get("설명"),
                "banner": banners.get(aid) or first_banner(posts.get(aid)),
                "monsters": [m["key"] for m in mons], "above": above, "below": below,
            }
        regions.append({"name": region["이름"], "pic": region_pics.get(region["이름"]), "places": ids})

    print("장비")
    equipment = []
    for aid, post in posts.items():
        if re.search(r"\(20\d\d\.\d\d\.\d\d\)$", post["title"]) and "스킬" not in post["title"]:
            eq = parse_equipment(aid, post["title"], boxes[aid])
            if eq:
                equipment.append(eq)
    equipment.sort(key=lambda e: EQUIP_ORDER.index(e["slot"]) if e["slot"] in EQUIP_ORDER else 99)
    name_jobs(equipment)

    print("아이템")
    icon_index = json.loads((SRC / "이미지" / "이미지_목록.json").read_text(encoding="utf-8"))
    items: dict[str, dict] = {}

    def item(name):
        if name not in items:
            items[name] = {"name": name, "icon": None, "from": [], "equip": []}
        return items[name]

    for m in monsters.values():
        for d in m["drops"]:
            item(d)["from"].append(m["key"])
    for eq in equipment:
        for row in eq["rows"]:
            it = item(row["name"])
            it["equip"].append({"slot": eq["slot"], "post": eq["post"],
                                "info": dict(zip(row.get("h") or eq["headers"], row["cells"]))})
            if row["icon"] and not it["icon"]:
                it["icon"] = row["icon"]
    for name, it in items.items():
        if not it["icon"]:
            named = icon_index.get("아이템", {})
            rel = named.get(name) or named.get(name.replace(" ", "")) or named.get(name.split(":")[0])
            if rel:
                it["icon"] = export_picture(SRC / "이미지" / rel)

    menu = []
    for title, index_post, ids in MENU:
        menu.append({"title": title, "index": index_post,
                     "posts": [{"id": i, "title": posts[i]["title"]} for i in ids if i in posts]})
    menu.insert(2, {"title": "장비", "equip": True,
                    "posts": [{"id": e["post"], "title": e["slot"]} for e in equipment]})

    used = {info["src"].split("/")[-1] for info in _exported.values()}
    for f in (OUT / "img").iterdir():
        if f.name not in used:
            f.unlink()

    meta = {"source": SOURCE, "built": datetime.date.today().isoformat(),
            "counts": {"posts": len(posts), "places": len(places), "monsters": len(monsters),
                       "items": len(items), "images": len(list((OUT / "img").iterdir()))}}
    data = {"posts": posts, "menu": menu, "regions": regions, "places": places, "monsters": monsters,
            "items": items, "equipment": equipment, "meta": meta}
    for name, value in data.items():
        (OUT / "data" / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                                                   encoding="utf-8")
    size = sum(f.stat().st_size for f in (OUT / "img").iterdir())
    print("완료", meta["counts"], f"그림 {size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
