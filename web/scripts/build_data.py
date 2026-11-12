"""위키 자료 만들기: ../자료 (카페에서 저장한 글과 그림) -> public/data/*.json, public/img/*

준비: 자료/ 폴더가 있어야 한다 (git에 없다. CLAUDE.md '위키 자료' 참고).
실행: python scripts/build_data.py   (필요: pip install -r scripts/requirements.txt)

만드는 것
  posts.json      글마다 제목과 본문 블록(문단, 표). 그림과 다른 글 링크도 들어 있다
  menu.json       홈 화면 메뉴 (육성 공략, 스킬, 장비, 조합책, 기타)
  regions.json    지역 -> 사냥터 목록
  places.json     사냥터: 레벨, 배너 그림, 몬스터, 원글에서 그대로 그릴 칸 (지도, 이동, 퀘스트, 참고)
  place/<글>.json 사냥터 화면이 그리는 원글 칸 그대로 (above, below 블록, 그 칸에서 링크하는 글 번호 posts): 사냥터 화면이 posts.json 을 받지 않게
  monsters.json   몬스터: 레벨, HP, 특징, 드랍, 재부활, 스킬, 그림
  items.json      아이템: 아이콘, 떨구는 몬스터, 장비 정보
  rank/*.png      길드 랭킹 화면 그림 (자료/이미지/랭킹 을 그대로 복사)
  market/*.png    사파이어 중개인 화면 그림 (자료/이미지/중개인)
  equipment.json  부위별 장비 표
  meta.json       출처, 만든 날짜
  odds.json       컴투스 공식 확률 정보 (자료/공식/확률, scripts/fetch_official_odds.mjs 가 받은 것)
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import html
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote

from bs4 import BeautifulSoup, NavigableString, Tag
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
SRC = Path(os.environ.get("SAPPHIRE_DATA") or ROOT / "자료")  # 시험할 때 SAPPHIRE_DATA 로 다른 자료 사본
OUT = ROOT / "web" / "public"
POST_DIRS = [SRC / "드랍표_원본" / "글", SRC / "드랍표_원본" / "글2", SRC / "드랍표_원본" / "글3"]
INDEX_PAGE = SRC / "드랍표_원본" / "page.html"
INDEX_FILES = SRC / "드랍표_원본" / "files"
ORIG_DIR = SRC / "이미지" / "원본"
MANIFEST = json.loads((ORIG_DIR / "목록.json").read_text(encoding="utf-8"))
# 드랍표 저장본보다 새 판이 따로 받아져 있는 글 (자료/링크/카페, 공개 API 로 받은 글 본문과 그림. 제작자 2026-11-12 'DB 는 최신인데 웹은 아직 활용 못 하는 부분'):
# 조합책 메뉴가 2018년 판(206149 …)이라 재료 수·값이 지금과 달랐다 (가공한가죽 거친가죽 x5 -> x3, 의지의 망토, 세트 장화 재료 …). 옛 글 번호 -> 새 글 번호
LINK_DIR = SRC / "링크" / "카페"
POST_REPLACED = {"206149": "346281", "206306": "346279", "206152": "346280", "206312": "346291", "213714": "346299", "214770": "346310"}
# 드랍표 저장본에는 없고 따로 받아 둔 같은 작성자(iOS)의 카페 글: 정보 메뉴의 기존 묶음에 글 단추로 넣는다
# (제작자 2026-11-12 '카페 글 두 개(수수료, 명예 등급)만 넣기'. 블로그 글 둘은 다른 사람 글이라 챗봇 자료로만 둔다). 글 번호 -> 메뉴 묶음
# 둘 다 '강화 · 보석 · 성장' 에: '전장 · 헌팅그라운드' 묶음의 글은 원글에서만 보는 글(cafe.ts GUIDE_SECTIONS)이라 거기 넣으면 앱 안에서 표가 안 보인다
LINK_POSTS = {"346139": "강화 · 보석 · 성장", "346201": "강화 · 보석 · 성장"}
LINK_PICS: dict[str, Path] = {}
for _aid in [*POST_REPLACED.values(), *LINK_POSTS]:
    _tsv = LINK_DIR / f"{_aid}_그림" / "목록.tsv"
    if _tsv.exists():
        for _line in _tsv.read_text(encoding="utf-8").splitlines():
            _cols = _line.split("\t")
            if len(_cols) >= 3:
                LINK_PICS[_cols[2].strip().split("?")[0]] = _tsv.parent / _cols[1]
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

ICON_SIDE = 64  # px; item icons in the cafe posts are small pictures on a white square


def cut_white_background(im: Image.Image) -> Image.Image | None:
    """Item icons sit on a white square in the cafe posts; on the app's dark pages that looks like a sticker
    (제작자 요청: 누끼). Make the white that touches the edges transparent. White inside the item stays.
    Returns None when the picture has no white background (corners are not white)."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    def white(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a > 0 and min(r, g, b) >= 232 and max(r, g, b) - min(r, g, b) <= 14

    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    if sum(white(x, y) for x, y in corners) < 3:
        return None
    seen = set()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or not white(x, y):
            continue
        seen.add((x, y))
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for x, y in seen:
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
    # trim the now-empty margin so every icon fills its box the same way
    box = rgba.getbbox()
    return rgba.crop(box) if box else None


def export_picture(path: Path, drop_animation: bool = False) -> dict | None:
    """Copy a picture into public/img under a short content-hash name. Returns {src, w, h}.
    drop_animation: a moving picture bigger than an icon is not copied and comes back as {"dropped": True}
    (글 본문의 움짤, 제작자 요청 2026-10-31: 원글 작성자가 찍은 것이라 원글에서 본다)."""
    key = str(path)
    if key in _exported and not drop_animation:
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
    if drop_animation and animated and max(w, h) > ICON_SIDE:
        return {"dropped": True}
    if key in _exported:
        return _exported[key]
    ext = {"PNG": ".png", "GIF": ".gif", "JPEG": ".jpg", "WEBP": ".webp"}.get(im.format, ".png")
    if max(w, h) <= ICON_SIDE and not animated:
        cut = cut_white_background(im)
        if cut is not None:
            buf = io.BytesIO()
            cut.save(buf, "PNG", optimize=True)
            data, ext = buf.getvalue(), ".png"
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
    if ext == ".png" and max(w, h) <= ICON_SIDE:
        w, h = Image.open(io.BytesIO(data)).size  # cut icons are trimmed
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


def picture_of(img: Tag, drop_animation: bool = False) -> dict | None:
    """The picture behind an <img>: original download if known, else the embedded bytes, else a local file."""
    a = img.find_parent("a")
    url = linkdata(a).get("src", "")
    if url in MANIFEST:
        return export_picture(ORIG_DIR / MANIFEST[url], drop_animation)
    if url.split("?")[0] in LINK_PICS:
        return export_picture(LINK_PICS[url.split("?")[0]], drop_animation)
    src = img.get("src") or ""
    m = re.match(r"data:image/(png|gif|jpe?g|webp);base64,(.+)", src, re.S)
    if m:
        raw = base64.b64decode(m.group(2))
        cached = ORIG_DIR / ("emb_" + hashlib.sha1(raw).hexdigest()[:16] + "." + m.group(1).replace("jpeg", "jpg"))
        if not cached.exists():
            cached.write_bytes(raw)
        return export_picture(cached, drop_animation)
    if src and not src.startswith("data:"):
        local = INDEX_FILES / unquote(src.split("/")[-1])
        if local.exists():
            return export_picture(local, drop_animation)
    return None


# ---------------------------------------------------------------- post bodies -> blocks

def article_id(link: str) -> str | None:
    m = re.search(r"cafe\.naver\.com/(?:iphoneimo/|ca-fe/web/cafes/(?:iphoneimo|20603221)/articles/)(\d+)", link or "")
    if m:
        return m.group(1)
    m = re.search(r"naver\.me/(\w+)", link or "")
    return NAVER_ME.get(m.group(1)) if m else None


DEFAULT_COLORS = {"#000000", "#141414", "#333333", "#222222", "#111111"}

# 지금 읽는 글에서 뺀 움짤 수 (load_posts 가 글마다 0 으로 돌리고 post["gifs"] 로 남긴다)
GIFS_DROPPED = [0]


def body_picture(img: Tag) -> dict | None:
    """글 본문의 그림. 움짤(아이콘보다 큰 움직이는 그림)은 빼고 센다 (제작자 요청 2026-10-31, 원글은 화면 맨 위 '원글 보기' 하나로)"""
    pic = picture_of(img, drop_animation=True)
    if pic and pic.get("dropped"):
        GIFS_DROPPED[0] += 1
        return None
    return pic


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
            pic = body_picture(el)
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
    # 링크 미리보기 상자(카페·공식 공지 링크의 제목, 잘린 요약, 주소)는 뺀다 (제작자 요청 2026-10-31:
    # '대한민국 모임의 시작, 네이버 카페', 'naver.me', 'hive-fn.qpyou.cn' 같은 줄)
    for card in box.select(".se-section-oglink, .se-module-oglink"):
        card.decompose()
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
            pic = body_picture(el)
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


def block_text(b: dict) -> str:
    if b["k"] == "p":
        return "".join(r.get("t", "") for r in b["r"]).strip()
    return " ".join(plain(c["l"]) for row in b["rows"] for c in row).strip()


HASHTAGS = re.compile(r"(\s*#[^\s#]+)+\s*")
PS_LINE = re.compile(r"p\.?\s?s\b", re.I)


def drop_chatter(blocks: list[dict]) -> list[dict]:
    """모든 글에서 게임 정보가 아닌 칸을 뺀다 (제작자 요청 2026-11-01: '이딴 거 뭔 쓸모가 있냐'):
    카페 해시태그만 있는 칸('#오숲 #죽늪 #미궁 …'), 작성자의 'P.S.' 와 그 뒤에 이어지는 글자뿐인 문단(그림, 표가 나오면 멈춘다)."""
    out: list[dict] = []
    in_ps = False
    for b in blocks:
        t = block_text(b)
        pictured = any("src" in r for r in (b["r"] if b["k"] == "p" else []))
        if in_ps and (b["k"] != "p" or pictured):
            in_ps = False
        if b["k"] == "p" and not pictured and PS_LINE.match(t):
            in_ps = True
        if in_ps or (t and HASHTAGS.fullmatch(t)):
            continue
        out.append(b)
    return out


def shows_something(post: dict) -> bool:
    """앱 화면에 보일 것이 있는 글인지. 큰 그림(지도, 스샷)은 앱에 띄우지 않으므로 그것뿐인 글(지도 글 등)은 메뉴에서 누르면
    바로 카페 원글이 열린다 (menu 의 "orig", 제작자 요청 2026-11-01: '아무 내용 없이 카페로 갈 거면 한 번 눌러 바로 원글로')."""
    for b in post["blocks"]:
        runs = run_list(b)
        if any("src" in r and r["w"] < 300 and r["h"] < 300 for r in runs):
            return True
        t = re.sub(r"\(?\s*지도\s*클릭[^)]*\)?", "", block_text(b))
        if re.sub(r"[◀▶️\s]|메뉴이동|이전으로 돌아가기", "", t):
            return True
    return False


def game_info_only(blocks: list[dict]) -> list[dict]:
    """강화·보석·성장 글은 게임 정보만 (제작자 요청 2026-10-31): 작성자의 수정 기록('❗[26.09.04→26.09.05] …'),
    앱에서 못 쓰는 '엑셀 파일 다운로드' 칸부터 끝까지, 뒤에 홀로 남은 '[참조]' 줄을 뺀다. 원글은 화면의 '원글 보기'로."""
    out: list[dict] = []
    for b in blocks:
        t = block_text(b)
        if b["k"] == "p" and re.search(r"엑셀\s*파일", t):
            break
        if b["k"] == "p" and re.match(r"^❗\s*\[\d", t):
            continue
        out.append(b)
    while out and out[-1]["k"] == "p" and re.fullmatch(r"\[?\s*참조\s*\]?", block_text(out[-1])):
        out.pop()
    return out


def load_posts() -> tuple[dict, dict]:
    posts, soups = {}, {}
    # 새 판이 있는 글은 옛 저장본을 읽지 않고 새 글을 읽는다 (새 글 파일이 없으면 옛 글 그대로)
    newer = {new: LINK_DIR / f"{new}.html" for new in POST_REPLACED.values()}
    replaced = {old for old, new in POST_REPLACED.items() if newer[new].exists()}
    extra = [LINK_DIR / f"{aid}.html" for aid in LINK_POSTS]
    sources = [(d, sorted(d.glob("*.html"))) for d in POST_DIRS] + [(LINK_DIR, [f for f in [*newer.values(), *extra] if f.exists()])]
    for d, files in sources:
        titles = {}
        lst = d / "목록.tsv"
        if lst.exists():
            for line in lst.read_text(encoding="utf-8").splitlines():
                aid, title, _ = line.split("\t")
                titles[aid] = title
        for f in files:
            aid = f.stem
            if aid in replaced:
                continue
            raw = f.read_text(encoding="utf-8", errors="replace")
            soup = BeautifulSoup(raw, "lxml")
            restore_grouped_images(soup, raw)
            box = soup.select_one("div.post_cont") or (soup.select_one("div.se-main-container") if d == LINK_DIR else None)
            if box is None:
                continue
            title = titles.get(aid) or (soup.title.get_text().split(" : ")[0] if soup.title else aid)
            GIFS_DROPPED[0] = 0
            blocks = drop_chatter(body_blocks(box))
            if aid in GAME_INFO_ONLY:
                blocks = game_info_only(blocks)
            blocks = fix_post_text(blocks)
            if aid in LINK_POSTS:  # 그림을 못 받은 칸뿐인 열은 뺀다 (명예 등급 표의 (구)·(신)이미지: 해외 위키 그림이라 받지 못했다)
                blocks = drop_empty_columns(blocks)
            if replaced:  # 다른 글에서 옛 조합책 글로 가던 링크는 새 글로
                blocks = relink(blocks, {"post:" + old: "post:" + new for old, new in POST_REPLACED.items() if old in replaced})
            posts[aid] = {"id": aid, "title": title.strip(), "blocks": blocks}
            if GIFS_DROPPED[0]:
                posts[aid]["gifs"] = GIFS_DROPPED[0]
            soups[aid] = box
            print(f"  글 {aid} {title[:30]}")
    return posts, soups


def drop_empty_columns(blocks: list[dict]) -> list[dict]:
    """표에서 머리줄만 있고 아래 칸이 모두 빈 열을 뺀다 (칸을 합친 표는 그대로 둔다)"""
    def empty(cell: dict) -> bool:
        return not any((r.get("t") or "").strip() or r.get("src") for line in cell.get("l", []) for r in line)
    for b in blocks:
        rows = b.get("rows") if b.get("k") == "table" else None
        if not rows or len(rows) < 3 or len({len(r) for r in rows}) != 1 or any(c.get("cs") or c.get("rs") for r in rows for c in r):
            continue
        keep = [i for i in range(len(rows[0])) if not all(empty(r[i]) for r in rows[1:])]
        if 0 < len(keep) < len(rows[0]):
            b["rows"] = [[r[i] for i in keep] for r in rows]
    return blocks


def relink(node, table: dict):
    """글 조각 안의 링크(to)를 table 대로 바꾼다"""
    if isinstance(node, list):
        return [relink(x, table) for x in node]
    if isinstance(node, dict):
        out = {k: relink(v, table) for k, v in node.items()}
        if isinstance(out.get("to"), str) and out["to"] in table:
            out["to"] = table[out["to"]]
        return out
    return node


# ---------------------------------------------------------------- hunting grounds, monsters, drops

def clean_title(title: str) -> str:
    """화면에 보이는 제목: 카페 글의 '_ReMAKE' 꼬리표를 빼고, 밑줄로 이은 말은 ' · ' 로 잇는다 (제작자 요청, 보기 좋게 통일).
    예: '테멘 거점(Temen Base)_헌팅그라운드' -> '테멘 거점(Temen Base) · 헌팅그라운드'"""
    t = re.sub(r"\s*_?ReMAKE\s*$", "", title, flags=re.I)
    t = re.sub(r"\s*_+\s*", " · ", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ·")


def tidy_links(x) -> None:
    """링크 글자의 '_____클릭_____' 같은 밑줄 장식을 뺀다."""
    if isinstance(x, dict):
        if "to" in x and isinstance(x.get("t"), str):
            x["t"] = re.sub(r"_{2,}", " ", x["t"])
        for v in x.values():
            tidy_links(v)
    elif isinstance(x, list):
        for v in x:
            tidy_links(v)


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
    # '강화가죽장갑(<직업 문양>, …)' 처럼 괄호 안이 그림과 쉼표라 '강화가죽장갑(' 로 잘린 것 (2026-11-12: 아이템 화면이 둘로 갈려 있었다)
    name = re.sub(r"\($", "", name).strip()
    return ITEM_ALIAS.get(name, name)


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
            fixed = row_name(name, dict(zip(h, cells)))  # 원글 표의 이름 오타·줄바꿈 (게임 사전·공식 확률표·거래소 녹화 이름으로)
            if fixed != name:
                name = fixed
                cells[name_col] = name
            cells = fix_cells(name, cells, h)
            row = {"name": name, "icon": first_picture(tds[0]), "cells": cells}
            if h != headers:  # one post can hold tables with different columns (보조 장비: 방패 / 마법 / 정밀)
                row["h"] = h
            # the 직업 column is a job emblem picture, not text; name_jobs() turns it into a job name.
            # 문양이 둘·셋인 칸(전사·레인저가 같이 쓰는 검·가죽 장갑 등 83줄)은 모두 읽는다 (2026-11-12: 첫 문양만 읽어 '전사'로만 보였고,
            # 챗봇의 레인저 장비 추천에서도 빠졌다. 게임 사전의 직업 아이콘과 대조)
            if "직업" in h and h.index("직업") < len(tds) and not cells[h.index("직업")]:
                pics = [p for p in (picture_of(img) for img in tds[h.index("직업")].find_all("img")) if p]
                if pics:
                    row["jobIcon"] = pics[0]
                    row["jobIcons"] = pics
            rows.append(row)
    if not rows:
        return None
    return {"slot": slot, "post": aid, "headers": headers, "rows": rows}


# 원글 장비 표의 잘못: (아이템명, 칸에 든 글) -> 바꿀 글. 카페 원글(Made by iOS)의 표를 그대로 옮기지만 게임에 없는 값은 뺀다
# (제작자 2026-11-03: 고대의봉의 '마법 데미지 +100' 은 인게임에 없는 옵션. 원글 346124 마법사 무기 표의 옵션 칸에 그대로 적혀 있던 것)
ERRATA = {
    # 원글 346124 마법사 무기 표의 '마법 데미지 +100' 은 인게임 정보창에 없는 숨은 옵션이고 실제로는 최종 데미지 +10% (제작자 2026-11-12 '고봉숨옵 100이 아니고 10퍼 같은데',
    # 해외 위키 테스트도 같음: 이론 데미지와 실제 데미지가 10% 차이, 자료 fandom/ko/기타_01.md·제공/고대의봉_숨옵.md). 짐작이 섞인 값이라 '숨은 옵션'으로 적는다
    ("고대의봉", " / 마법 데미지 +100"): " / 숨은 옵션 최종 데미지 +10%",
    # 원글 표에 마나재생이 빠졌다 (제작자 2026-11-10 '236설신 = 지능2 마재3 이속6', 공식 확률 130102 '설원의저주장화 - 마나재생 0~4', 도감 영상 툴팁에도 마나재생)
    ("설원의저주장화", "지능 0~4 / 이동속도 2~10%"): "지능 0~4 / 마나재생 0~4 / 이동속도 2~10%",
    # 게임 정보창에 없는 숨은 옵션 (제작자 2026-11-12 '값 맞음, 숨옵 같은데'. 게임 도감 정보 사전에도 이 줄이 없다, 자료 제공/숨은_옵션.md)
    ("파워글러브", "데미지 증가 +10%"): "숨은 옵션 데미지 증가 +10%",
    ("조마의손아귀", "데미지 증가 +20%"): "숨은 옵션 데미지 증가 +20%",
}


# 글 화면(#/post)과 챗봇이 읽는 원글 칸에도 같은 고침을 넣는다 (장비 표만 고쳐서 글과 챗봇은 '+100' 으로 보였다, 2026-11-12)
POST_ERRATA = {"마법 데미지 +100": "숨은 옵션 최종 데미지 +10%"}


def fix_post_text(node):
    if isinstance(node, list):
        return [fix_post_text(x) for x in node]
    if isinstance(node, dict):
        out = {k: fix_post_text(v) for k, v in node.items()}
        if isinstance(out.get("t"), str) and out["t"].strip() in POST_ERRATA:
            out["t"] = out["t"].replace(out["t"].strip(), POST_ERRATA[out["t"].strip()])
        return out
    return node


def row_name(name: str, info: dict) -> str:
    """장비 표 줄 이름 고침: 칸 안 줄바꿈(' / '), 오타, 같은 이름으로 잘못 적힌 줄 (2026-11-12 제작자 확인: 아뮬렛, 모험가벨트, 환상의지팡이)"""
    name = re.sub(r"\s*/\s*", " ", name).replace("[40-~49LV]", "[40~49LV]").replace("환상의자팡이", "환상의지팡이").strip()
    lv = re.search(r"\d+", info.get("레벨제한") or "")
    # 환상의너클 네 줄이 모두 '[1~20LV]' 로 적혀 있다 (검·활·지팡이는 1~20, 21~30, 31~40, 41~50): 레벨제한으로 맞춘다
    if name.startswith("환상의너클[") and lv:
        name = "환상의너클" + {1: "[1~20LV]", 21: "[21~30LV]", 31: "[31~40LV]", 41: "[41~50LV]"}.get(int(lv.group()), name[5:])
    # 불타는신발 방어력 10 짜리는 게임 이름이 '불타는신발 X' (원글은 V. VI 는 방어력 6)
    if name == "불타는신발V" and (info.get("방어력") or "").strip() == "10":
        name = "불타는신발 X"
    return ROW_NAME.get(name, name)


_official: dict | None = None


def official_options() -> dict:
    """컴투스 공식 옵션 재설정 확률표(자료/공식/확률/130101·130102, lim.com2us.com): 아이템(띄어쓰기 뺌) -> 옵션 -> 범위 글 ('0~6', '0 & 4~12' = 0 이거나 4~12).
    제작자 2026-11-12 '각각 출처가 어떻게 돼? 공홈이 맞다고 본다': 카페 원글 표의 옵션 범위가 이 표와 다르면 공식 값으로 쓴다"""
    global _official
    if _official is not None:
        return _official
    _official = {}
    alias = {"최대체력": "체력", "최대마나": "마나", "크리": "크리티컬"}
    g = lambda x: f"{x:g}"
    for key in ("130101", "130102"):
        p = SRC / "공식" / "확률" / f"{key}.json"
        if not p.exists():
            continue
        for it in json.loads(p.read_text(encoding="utf-8")).get("items", []):
            title = (it.get("title") or {}).get("ko") or ""
            if " - " not in title:
                continue
            item, opt = title.rsplit(" - ", 1)
            opt = re.sub(r"\s", "", opt.replace("\xa0", ""))
            vals = set()
            for row in (it.get("item") or {}).get("rows", []):
                try:
                    vals.add(float(str(row.get("OptionValue")).replace("%", "")))
                except ValueError:
                    pass
            if not vals:
                continue
            nz = sorted(v for v in vals if v != 0)
            if 0 in vals and nz and nz[0] > 1:
                text = f"0 & {g(nz[0])}~{g(nz[-1])}" if nz[0] != nz[-1] else f"0 & {g(nz[0])}"
            else:
                lo, hi = min(vals), max(vals)
                text = f"{g(lo)}~{g(hi)}" if lo != hi else g(lo)
            _official.setdefault(re.sub(r"\s", "", item.replace("\xa0", "")), {})[alias.get(opt, opt)] = text
    return _official


OFFICIAL_FIXED: list = []


def official_cell(name: str, cell: str) -> str:
    """옵션 칸의 범위를 공식 표 값으로. 표에 있는 옵션만 바꾸고(없는 옵션을 더하지 않는다), 고정 옵션·'거래불가' 같은 글은 그대로"""
    off = official_options().get(re.sub(r"\s", "", name))
    if not off:
        return cell
    parts = cell.split(" / ")
    for i, part in enumerate(parts):
        m = re.match(r"^(\s*)([가-힣 ]+?)(\s*)(\d[\d~&\s.]*)(%?)(\s*)$", part)
        if not m:
            continue
        stat = re.sub(r"\s", "", m.group(2))
        want = off.get("크리티컬" if stat == "크리" else stat)
        if want and re.sub(r"\s", "", m.group(4)) != want.replace(" ", ""):
            OFFICIAL_FIXED.append(f"{name} {m.group(2)} {m.group(4).strip()}{m.group(5)} -> {want}{m.group(5)}")
            parts[i] = f"{m.group(1)}{m.group(2)}{m.group(3) or ' '}{want}{m.group(5)}{m.group(6)}"
    return " / ".join(parts)


def fix_cells(name, cells, headers=None):
    for (item, bad), good in ERRATA.items():
        if name == item:
            cells = [c.replace(bad, good) for c in cells]
    # 칸 이름을 아는 고침: 그 칸의 값이 원글 값 그대로일 때만 바꾼다 (원글이 고쳐지면 저절로 안 쓰인다)
    for (item, col), (bad, good) in FIELD_ERRATA.items():
        if name == item and headers and col in headers and headers.index(col) < len(cells):
            i = headers.index(col)
            if cells[i].strip() == bad:
                cells[i] = good
            elif bad in cells[i] and col == "옵션":
                cells[i] = cells[i].replace(bad, good)
    if headers and "옵션" in headers and headers.index("옵션") < len(cells):
        i = headers.index("옵션")
        cells[i] = official_cell(name, cells[i])
        # 게임 정보창에는 있는데 원글 옵션 칸에 빠진 옵션·세트 효과를 더한다 (이미 그 옵션이 적혀 있으면 두지 않는다)
        add = OPTION_ADD.get(name)
        if add and add.split(" ")[0] not in cells[i]:
            cells[i] = add if cells[i].strip() in ("", "-") else f"{cells[i]} / {add}"
    return cells


# 게임 화면(제작자 2026-11-11 '도감 정보' 녹화, 자료/도감/아이템/아이템.json)과 다른 원글 장비 표 값. (아이템명, 칸) -> (원글 값, 게임 값)
# 방어력: 신발 표 12줄과 망토 1줄이 게임보다 1~2 높게 적혀 있었다. 영상 장면을 직접 본 것: 수도사·설원의저주·극한의 발걸음·엘프의 덧신·빛새김·푸른숲·혹한·파란폭포·맹독.
# 나머지 넷(바다·설원추적자·노란유채·숙련모험가의망토)은 사전의 판독 값(여러 번 읽어 맞춘 것)
FIELD_ERRATA = {
    ("설원의저주장화", "방어력"): ("6", "5"), ("맹독의장화", "방어력"): ("6", "5"), ("혹한의장화", "방어력"): ("6", "5"),
    ("푸른숲의장화", "방어력"): ("6", "5"), ("파란폭포의장화", "방어력"): ("6", "4"), ("노란유채의장화", "방어력"): ("6", "5"),
    ("수도사의장화", "방어력"): ("5", "4"), ("설원추적자장화", "방어력"): ("8", "7"), ("빛새김의신발", "방어력"): ("8", "7"),
    ("바다의장화", "방어력"): ("8", "7"), ("엘프의 덧신", "방어력"): ("8", "7"), ("극한의 발걸음", "방어력"): ("8", "7"),
    ("숙련모험가의망토", "방어력"): ("2", "1"),
    # 공식 옵션 재설정 확률표(자료/공식/확률/130101 '세계수가지갑옷 - 불저항': 0 또는 10~14)와 제작자 '불저13'. 원글은 체력 범위(26~34)가 불저항 칸에도 적혀 있었다
    ("세계수가지갑옷", "옵션"): ("불저항 26~34", "불저항 0 & 10~14"),
    # 능력치 이름 없이 숫자만 적힌 칸 (게임 사전: 체력), 옵션이 '-' 인 쿠이모자 (게임 사전: 힘 1 · 민첩 1 · 체력 1)
    ("까막이반지", "옵션"): ("10 to 25", "체력 10~25"), ("뼈반지", "옵션"): ("10", "체력 10"), ("신념의벨트", "옵션"): ("10 to 14", "체력 10~14"),
    ("쿠이모자", "옵션"): ("-", "힘 1 / 민첩 1 / 체력 1"),
    # 세트 효과 (영상 장면으로 확인: 파란폭포의장화 '세트: 체력 30', 노란유채도복 '세트: 힘 3 이동속도 5%'. 회색바위 40 · 푸른숲 35 · 노란유채 35 는 원글과 같다)
    ("파란폭포의두건", "옵션"): ("[2세트] 체력 35", "[2세트] 체력 30"), ("파란폭포의로브", "옵션"): ("[2세트] 체력 35", "[2세트] 체력 30"),
    ("파란폭포의장화", "옵션"): ("[2세트] 체력 35", "[2세트] 체력 30"), ("노란유채의장화", "옵션"): ("[3세트] 지능3", "[3세트] 힘3"),
}
# 게임 정보창(도감 정보 사전)에는 있는데 원글 옵션 칸에 빠진 옵션 (제작자 2026-11-12 '추가해야지'). '??' = 게임이 값을 가린 옵션이라 범위를 모른다.
# 세계수 갑옷의 2세트 효과는 영상 장면으로 확인 (세계수잎로브 '세트: 체력 5 지능 2')
OPTION_ADD = {"거미줄뼈갑옷": "크리티컬 ??", "참나무지팡이": "마나 ??", "티타늄벨트": "체력재생 ??", "스컬쉴드": "힘 ??", "강화가죽갑옷": "마나 ??", "숙련마법사옷": "체력 ??",
              "세계수껍질갑옷": "[2세트] 체력 5, 명중 2", "세계수가지갑옷": "[2세트] 체력 5, 명중 2", "세계수도복": "[2세트] 체력 5, 명중 2", "세계수잎로브": "[2세트] 체력 5, 지능 2"}
# 원글 장비 표의 이름 오타 -> 게임 이름 (게임 사전 + 공식 확률표 또는 거래소 녹화로 확인. 아뮬렛·모험가벨트는 제작자 2026-11-12 확인)
ROW_NAME = {"다크스컬쉴드": "다크스틸쉴드", "현자의로브": "현인의로브", "마나재생벨트": "마력재생벨트", "노란유채의장화신발": "노란유채의장화",
            "모험가의벨트": "모험가벨트", "전문 모험가의 아물렛": "전문 모험가의 아뮬렛"}
# 게임 사전에는 있는데 원글 장비 표에 없는 장비 (제작자 2026-11-12 '추가해야지'): 이름만 여기 두고 레벨·능력치·직업은 만들 때 비공개 자료의 사전에서 읽는다.
# 사전의 '산호검'·'정찰대검' 등은 표의 '+3산호검'·'+5정찰대검' 과 같은 것이라 넣지 않는다
BOOK_ROWS = ["견습모험가옷", "로크의도복", "산타모자", "가면[..]", "가면[꺄아]", "가면[흑흑]", "가면[번쩍]", "가면[헉]", "낙엽머리띠", "로크의 두건", "견습용장갑"]
BOOK_SLOT = {"갑옷": "갑옷", "투구": "투구", "장갑": "장갑", "신발": "신발", "벨트": "벨트", "목걸이": "목걸이", "망토": "망토", "반지": "반지", "보조장비": "보조 장비"}


def add_book_rows(equipment: list[dict]) -> None:
    """BOOK_ROWS 의 장비를 게임 사전 값으로 장비 표에 더한다 (같은 부위 표, 레벨 순서 자리에). 획득처는 사전에 없어 비워 둔다"""
    import build_book
    nk = lambda s: re.sub(r"\s+", "", s or "")
    have = {nk(r["name"]) for eq in equipment for r in eq["rows"]}
    added = []
    for want in BOOK_ROWS:
        b = next((c for c in build_book.book_cells() if c.get("큰탭") == "일반" and nk(c.get("이름")) == nk(want) and c.get("고르기") in BOOK_SLOT), None)
        if not b or nk(want) in have:
            continue
        eq = next((e for e in equipment if e["slot"] == BOOK_SLOT[b["고르기"]]), None)
        if not eq:
            continue
        stats = dict((s, str(v)) for s, v in (b.get("능력치") or []))
        jobs = b.get("직업") or []
        opts = [f"{s} {v}" for s, v in (b.get("능력치") or []) if s not in ("방어력", "공격", "속도")] + (["거래불가"] if b.get("거래불가") else [])
        vals = {"이미지": "", "아이템명": b["이름"], "레벨제한": str(b.get("요구레벨") or ""), "방어력": stats.get("방어력", ""), "공격": stats.get("공격", ""),
                "속도": stats.get("속도", ""), "직업": "공용" if len(jobs) >= 4 else "·".join(jobs), "옵션": " / ".join(opts) or "-", "획득처": ""}
        row = {"name": b["이름"], "icon": None, "cells": [vals.get(h, "") for h in eq["headers"]]}
        lv = int(b.get("요구레벨") or 0)
        def level_of(r):
            hh = r.get("h") or eq["headers"]
            m = re.search(r"\d+", r["cells"][hh.index("레벨제한")] if "레벨제한" in hh and hh.index("레벨제한") < len(r["cells"]) else "")
            return int(m.group()) if m else 0
        at = max((i + 1 for i, r in enumerate(eq["rows"]) if level_of(r) <= lv), default=0)
        eq["rows"].insert(at, row)
        have.add(nk(want))
        added.append(b["이름"])
    print("게임 사전에서 더한 장비 줄", len(added), added)
# 드랍표와 장비 표가 같은 아이템을 다르게 적은 것 -> 게임 사전 이름 하나로 (아이템 화면이 '떨구는 몬스터 없음' / '장비 정보 없음' 둘로 갈려 있었다).
# 고요의장화 = 고요의신발: 사전에는 고요의신발만 있고, 드랍표의 고요의장화는 장비 표 고요의신발의 획득처(돌무더기 요새)에서 나온다
ITEM_ALIAS = {"버닝블레이": "버닝블레이드", "회색바위투구": "회색바위의투구", "회색바위갑옷": "회색바위의갑옷", "주술사의모자": "주술사모자",
              "야만의부츠": "야만 부츠", "사막용병의장갑": "사막용병장갑", "숲요정장갑": "숲요정의장갑", "마법사의지팡이": "마법사지팡이",
              "고요의장화": "고요의신발", **ROW_NAME}
# 원글 드랍표에 아직 없는 드랍: 몬스터 key -> 아이템. 급소가격 2단(2026-10-29 패치로 생긴 책)은 등대던전 3층 스팩터 (초보자 톡방 iOS '확인 완료' 2026-11-02, 자료/제공/초보자톡방_정리.md)
DROP_EXTRA = {"스팩터@342705": ["급소가격2"]}


JOBS = ["전사", "레인저", "마법사", "무도가"]


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
            icons = row.pop("jobIcons", None) or ([row["jobIcon"]] if row.get("jobIcon") else [])
            jobs = list(dict.fromkeys(names[i["src"]] for i in icons if i["src"] in names))
            if col >= 0 and jobs and col < len(row["cells"]):
                row["cells"][col] = "공용" if "공용" in jobs or len(jobs) >= 4 else "·".join(sorted(jobs, key=JOBS.index))
    # 신발 표의 '엘프의 덧신' 마법사 줄은 '끈질긴 기억의 단화' (게임 사전: Lv.46 마법사 신발, 공식 확률 130102, 금서고 신발 넷 = 금서고의 발자국·엘프의 덧신·끈질긴 기억의 단화·극한의 발걸음)
    for eq in equipment:
        if eq["slot"] != "신발":
            continue
        for row in eq["rows"]:
            h = row.get("h") or eq["headers"]
            if row["name"] == "엘프의 덧신" and "직업" in h and row["cells"][h.index("직업")] == "마법사":
                row["name"] = "끈질긴 기억의 단화"
                row["cells"][h.index("아이템명")] = row["name"]
    # 문양 하나만 읽던 때 직업만 달랐던 줄이 똑같아졌으면 한 줄만 남긴다
    for eq in equipment:
        seen_rows, kept = set(), []
        for row in eq["rows"]:
            sig = (row["name"], tuple(row["cells"]), tuple(row.get("h") or ()))
            if sig not in seen_rows:
                seen_rows.add(sig)
                kept.append(row)
        eq["rows"] = kept


# ---------------------------------------------------------------- menu

MENU = [
    # 초급, 중급, 고급 순 (직업은 전사, 레인저, 마법사, 무도가). 중급과 고급은 2026-10-31 제작자 요청으로 더했다 (글3)
    ("육성 공략", "343711", ["343732", "343699", "343720", "343710", "346046", "343767", "346049", "346067", "343788", "346050"]),
    ("직업별 스킬", "345532", ["345735", "344229", "344246", "342010"]),
    # 조합책은 새 판(2026-10-31 리메이크, 자료/링크/카페)이 있으면 그 글 번호로 (POST_REPLACED)
    ("조합책", "206149", ["206306", "206152", "206312", "213714", "214770"]),
    ("강화 · 보석 · 성장", None, ["331665", "343765", "345584", "343078"]),
    ("인던 · 길드던전", None, ["342349", "343758", "332071", "343692", "338047", "338050",
                          "282820", "282821", "282822", "282823", "282824"]),
    ("전장 · 헌팅그라운드", None, ["345990", "346203", "345516", "345514", "345526"]),
    ("퀘스트 · 지도", None, ["342566", "1064", "343200", "343201", "343203", "343205", "342858",
                         "342865", "343019", "331777", "344012", "345738"]),
]
# 게임 정보만 남기는 메뉴의 글 (game_info_only)
GAME_INFO_ONLY = {aid for name, _, ids in MENU if name == "강화 · 보석 · 성장" for aid in ids}
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
    place_guides(places)
    # 체력이 빈 몬스터는 해외 팬 위키 값으로 (제작자 2026-11-12 '없으면 일단 해외 걸로 채워', 자료 fandom/몬스터_체력.json: 이름·레벨이 같은 문서만).
    # 해외판 값이라 한국 서버와 다를 수 있어 화면에 '해외 위키' 라고 적는다 (hpNote)
    abroad = SRC / "fandom" / "몬스터_체력.json"
    if abroad.exists():
        table = json.loads(abroad.read_text(encoding="utf-8")).get("몬스터", {})
        filled = 0
        for m in monsters.values():
            f = table.get(m["name"])
            if m.get("hp") is None and not m.get("hps") and f and f.get("레벨") == m.get("level"):
                m["hp"] = f["hp"]
                m["hpNote"] = "해외 위키" + (", 약" if f.get("약") else "")
                filled += 1
        print("해외 위키 값으로 채운 몬스터 체력", filled)

    print("장비")
    equipment = []
    for aid, post in posts.items():
        if re.search(r"\(20\d\d\.\d\d\.\d\d\)$", post["title"]) and "스킬" not in post["title"] and aid not in POST_REPLACED.values():
            eq = parse_equipment(aid, post["title"], boxes[aid])
            if eq:
                equipment.append(eq)
    equipment.sort(key=lambda e: EQUIP_ORDER.index(e["slot"]) if e["slot"] in EQUIP_ORDER else 99)
    name_jobs(equipment)
    add_book_rows(equipment)
    print("공식 재설정 확률표로 바꾼 옵션 범위", len(OFFICIAL_FIXED), OFFICIAL_FIXED[:60])

    print("아이템")
    icon_index = json.loads((SRC / "이미지" / "이미지_목록.json").read_text(encoding="utf-8"))
    items: dict[str, dict] = {}
    # 띄어쓰기만 다른 같은 아이템은 하나로 ('스카우트띠' 드랍표 / '스카우트 띠' 장비표, 제작자 2026-11-12 '검색에 둘 다 나와, 통합해 줘').
    # 보이는 이름은 장비표 이름이 먼저, 다른 표기는 aka 로 남겨 찾기에 쓴다. 몬스터 드랍 이름도 합친 이름으로 바꾼다.
    nospace = lambda s: re.sub(r"\s+", "", s)
    canon: dict[str, str] = {}
    for eq in equipment:
        for row in eq["rows"]:
            canon.setdefault(nospace(row["name"]), row["name"])
    for m in monsters.values():
        for d in m["drops"]:
            canon.setdefault(nospace(d), d)

    def item(name):
        cname = canon.get(nospace(name), name)
        if cname not in items:
            items[cname] = {"name": cname, "icon": None, "from": [], "equip": []}
        if name != cname and name not in items[cname].setdefault("aka", []):
            items[cname]["aka"].append(name)
        return items[cname]

    for mkey, extra in DROP_EXTRA.items():
        if mkey in monsters:
            monsters[mkey]["drops"] += [d for d in extra if d not in monsters[mkey]["drops"]]
            for d in extra:
                canon.setdefault(nospace(d), d)
    for m in monsters.values():
        for d in m["drops"]:
            if m["key"] not in item(d)["from"]:
                item(d)["from"].append(m["key"])
        m["drops"] = list(dict.fromkeys(canon.get(nospace(d), d) for d in m["drops"]))
    for eq in equipment:
        for row in eq["rows"]:
            it = item(row["name"])
            it["equip"].append({"slot": eq["slot"], "post": eq["post"],
                                "info": dict(zip(row.get("h") or eq["headers"], row["cells"]))})
            if row["icon"] and not it["icon"]:
                it["icon"] = row["icon"]
    # 하나로 합친 옛 표기(드랍표·원글 표의 다른 이름)도 찾기에 쓰이게 aka 로 남긴다 ('고요의장화' 를 쳐도 고요의신발이 나오게)
    for old, new in ITEM_ALIAS.items():
        if new in items and old not in items and old not in items[new].setdefault("aka", []):
            items[new]["aka"].append(old)
    for it in items.values():
        if not it.get("aka"):
            it.pop("aka", None)
    merged = {k: v["aka"] for k, v in items.items() if v.get("aka")}
    print("띄어쓰기만 다른 아이템 합침", len(merged), dict(list(merged.items())[:30]))
    for name, it in items.items():
        if not it["icon"]:
            named = icon_index.get("아이템", {})
            rel = named.get(name) or named.get(name.replace(" ", "")) or named.get(name.split(":")[0])
            if rel:
                it["icon"] = export_picture(SRC / "이미지" / rel)

    # 영상에서 아이템만 오린 고화질 아이콘이 있으면 그것으로 (제작자 2026-11-12 'DB 에는 있는데 웹이 못 쓰는 것 전부', '화질 구린 거 이번 영상 화질로 싹 교체'):
    # 카페 글의 아이콘은 25x30 쯤이라 아이템 화면(80px)에서 흐리다. 아이템·장비 표를 쓰는 모든 화면(검색, 장비, 중개인, 장비대여, 기부함, 강화 비교 …)이 같이 바뀐다
    import build_book
    hq = 0
    for name, it in items.items():
        pic = build_book.wiki_icon(name, it.get("aka"))
        if pic:
            it["icon"] = pic
            hq += 1
    for eq in equipment:
        for row in eq["rows"]:
            pic = build_book.wiki_icon(row["name"])
            if pic:
                row["icon"] = pic
    print("오린 아이콘으로 바꾼 위키 아이템", hq, "/", len(items))

    # 보이는 제목과 링크 글자를 다듬는다 (장비 표 찾기는 원래 제목으로 끝난 뒤)
    for post in posts.values():
        post["title"] = clean_title(post["title"])
        tidy_links(post["blocks"])
    for place in places.values():
        place["title"] = clean_title(place["title"])

    menu = []
    for title, index_post, ids in MENU:
        index_post = POST_REPLACED.get(index_post, index_post) if POST_REPLACED.get(index_post) in posts else index_post
        ids = [POST_REPLACED[i] if POST_REPLACED.get(i) in posts else i for i in ids] + [a for a, sec in LINK_POSTS.items() if sec == title]
        menu.append({"title": title, "index": index_post,
                     "posts": [{"id": i, "title": posts[i]["title"], **({} if shows_something(posts[i]) else {"orig": 1})}
                               for i in ids if i in posts]})
    menu.insert(2, {"title": "장비", "equip": True,
                    "posts": [{"id": e["post"], "title": e["slot"]} for e in equipment]})

    used = {info["src"].split("/")[-1] for info in _exported.values()}
    for f in (OUT / "img").iterdir():
        if f.name not in used:
            f.unlink()

    meta = {"source": SOURCE, "built": datetime.date.today().isoformat(),
            "counts": {"posts": len(posts), "places": len(places), "monsters": len(monsters),
                       "items": len(items), "images": len(list((OUT / "img").iterdir()))}}
    control = control_list(places, monsters)
    if control:
        meta["control"] = control
    data = {"posts": posts, "menu": menu, "regions": regions, "places": places, "monsters": monsters,
            "items": items, "equipment": equipment, "meta": meta}
    for name, value in data.items():
        (OUT / "data" / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                                                   encoding="utf-8")
    write_place_parts(posts, places)
    size = sum(f.stat().st_size for f in (OUT / "img").iterdir())
    print("완료", meta["counts"], f"그림 {size / 1e6:.1f}MB")
    copy_rank_pictures()
    build_odds()
    # 시세 동향 (개발중): 자료/카톡 의 거래 톡방 대화 -> data/trend.json (없으면 건너뛴다)
    import build_trend
    build_trend.main()
    # 강화 비교 (개발중): 자료/장비_강화·재설정 (카페 글 331665 첨부) + 위키 장비 표 -> data/enhance.json (없으면 건너뛴다)
    import build_enhance
    build_enhance.main()
    # 도감 계산기 (개발중): 자료/도감/일반.json (제작자 도감 영상을 옮긴 것) -> data/dex.json (없으면 건너뛴다)
    import build_dex
    build_dex.main()
    # 아이템 책: 게임 사전·거래소 값·도감·상점·줄임말을 아이템 이름으로 묶은 것 -> data/book.json, 오린 아이콘 -> data/icon/ (검색·아이템 화면)
    build_book.main()


def write_place_parts(posts: dict, places: dict) -> None:
    """사냥터마다 화면이 그리는 원글 칸(지도, 옆 사냥터, 이동, 퀘스트, NPC ...)을 따로 둔다 (2026-11-01 오픈 전 검토: 사냥터를 처음 열 때
    글 전체(posts.json 1.4MB)를 받아서 느린 폰에서 늦게 떴다). posts 는 그 칸이 링크하는 글 중 위키에 있는 글 번호 (앱 안에서 연다)"""
    out = OUT / "data" / "place"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.json"):
        f.unlink()
    for aid, pl in places.items():
        post = posts.get(aid)
        if not post:
            continue
        above = [post["blocks"][i] for i in pl["above"]]
        below = [post["blocks"][i] for i in pl["below"]]
        linked = set(re.findall(r'"post:([^"]+)"', json.dumps(above + below, ensure_ascii=False)))
        part = {"above": above, "below": below, "posts": sorted(linked & set(posts))}
        (out / f"{aid}.json").write_text(json.dumps(part, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


ODDS_GAME = "5960bb5afe064cdfbc9063dedc97f646ccf5346cdb4a9636c19810330d95ce1a"


def ko(value) -> str:
    """공식 확률 자료의 글자: '{"en":"HP","ko":"체력",...}' 처럼 여러 나라 말이 든 글은 한국어(없으면 영어)만"""
    if isinstance(value, dict):
        return (value.get("ko") or value.get("en") or "").strip()
    text = str(value if value is not None else "")
    if text.startswith("{") and '"ko"' in text:
        try:
            return ko(json.loads(text))
        except ValueError:
            pass
    return text.strip()


def build_odds():
    """컴투스 공식 확률 정보 -> data/odds.json (제작자 요청 2026-10-31: 공식 정보도 위키와 챗봇에).
    표마다 메뉴 길(가챠샵 > 별똥별의 조각들 > 개별 획득 확률), 섹션마다 제목, 설명, 열, 행 (한국어만)."""
    src = SRC / "공식" / "확률"
    if not src.exists():
        print("공식 확률 없음 (자료/scripts/fetch_official_odds.mjs)")
        return
    tables, note = [], ""
    for f in sorted(src.glob("*.json"), key=lambda f: int(f.stem) if f.stem.isdigit() else 0):
        if not f.stem.isdigit():
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        note = note or ko(d.get("description"))
        sections = []
        for it in d.get("items", []):
            # 행의 칸은 열의 key 로 찾는다 (표마다 'ItemName', 'GemCombineRate', 'col_0' 처럼 다르다)
            columns = it["item"]["columns"]
            cols = [ko(c.get("value")) for c in columns]
            rows = [[ko(r.get(c["key"])) for c in columns] for r in it["item"]["rows"]]
            sections.append({"t": ko(it.get("title")), "d": ko(it.get("description")), "c": cols, "r": rows})
        tables.append({"key": d["key"], "path": d["path"], "sections": sections})
    fetched = (src / "받은때.txt").read_text(encoding="utf-8").strip() if (src / "받은때.txt").exists() else ""
    odds = {"fetched": fetched, "page": f"https://lim.com2us.com/{ODDS_GAME}/{{key}}?lang=ko", "note": note, "tables": tables}
    (OUT / "data" / "odds.json").write_text(json.dumps(odds, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("공식 확률 표", len(tables), "행", sum(len(s["r"]) for t in tables for s in t["sections"]))


def control_list(places: dict, monsters: dict):
    """길드 통제 리스트 (제작자 2026-11-10 '우리 길드는 중립길드야, 이 몹들을 잡으면 안 되는 통제 리스트', '다 DB 화 해서 챗봇이 읽을 수 있게'):
    비공개 자료 길드/통제_리스트.json 을 meta.json 의 control 로. 몹마다 위키 몬스터(key)와 사냥터(placeId)를 잇는다.
    쓰는 곳: 공지사항 글의 통제 리스트 칸(Board.tsx '[[통제 리스트]]', pages/Control.tsx), 사냥터·몬스터 화면의 통제 표시,
    챗봇 자료(src/chat.ts wikiContext). 공지사항 글은 배포가 한 번 올렸다 (scripts/controlNotice.mjs)"""
    src = SRC / "길드" / "통제_리스트.json"
    if not src.exists():
        return None
    d = json.loads(src.read_text(encoding="utf-8"))
    norm = lambda s: re.sub(r"\s", "", s or "")
    alias = d.get("위키이름", {})  # 리스트의 이름 -> 위키 몬스터 이름 (같은 사냥터의 비슷한 이름, 자료에 '짐작'으로 적음)
    by_name: dict[str, list[str]] = {}
    for k, m in monsters.items():
        by_name.setdefault(norm(m["name"]), []).append(k)

    def find_place(name: str) -> str:
        n = norm(name)
        hits = [pid for pid, p in places.items() if norm(p["title"]).startswith(n) or norm(p["name"]) == n]
        return hits[0] if len(hits) == 1 else ""

    def find_mob(name: str, pid: str) -> str:
        n = norm(alias.get(name, name))
        if pid:
            own = [k for k in places[pid]["monsters"] if k in monsters]
            for k in own:
                if norm(monsters[k]["name"]) == n:
                    return k
            pre = [k for k in own if norm(monsters[k]["name"]).startswith(n)]
            if len(pre) == 1:
                return pre[0]
        keys = by_name.get(n, [])
        return keys[0] if len(keys) == 1 else ""

    groups = []
    for g in d.get("목록", []):
        pid = find_place(g["곳"])
        mobs = []
        for raw in g.get("몹", []):
            parts = [x.strip() for x in re.split(r"\s[/·]\s", raw) if x.strip()]
            name, note = parts[0], " · ".join(parts[1:])
            key = "" if "통제" in name else find_mob(name, pid)
            mobs.append({"name": name, "note": note, "key": key})
        if not pid:  # 제목이 달라도 (등대던전 2F, 이슬롯의 신전) 찾은 몬스터의 사냥터로
            pid = next((monsters[m["key"]]["place"] for m in mobs if m["key"]), "")
        groups.append({"place": g["곳"], "mark": g.get("표시", ""), "placeId": pid, "mobs": mobs})
    miss = [m["name"] for g in groups for m in g["mobs"] if not m["key"] and "통제" not in m["name"]]
    print("통제 리스트", sum(len(g["mobs"]) for g in groups), "· 위키에 없는 이름", miss)
    return {"title": d.get("제목", "통제 리스트"), "server": d.get("서버", ""), "by": d.get("제작", ""), "date": d.get("수정", ""),
            "rule": d.get("규칙", ""), "groups": groups}


def place_guides(places: dict) -> None:
    """사냥터 자리 안내 (제작자 2026-11-10 '데이터에 넣어 챗봇 등등이 활용하게', 길드 잡담방에서 마을모금함이 공유한 신전·루나프 자리 나누기).
    비공개 자료 길드/사냥터_자리.json 을 사냥터마다 guide 로 붙이고 그림(이미지/사냥터자리/)을 data/guide/ 로 복사한다 (로그인한 길드원에게만).
    사냥터 화면 맨 위 '자리 안내'(Places.tsx GuideBox)와 챗봇 자료(src/chat.ts wikiContext)가 쓴다. 기록은 자료 제공/사냥터_자리.md"""
    src = SRC / "길드" / "사냥터_자리.json"
    out = OUT / "data" / "guide"
    if out.exists():
        shutil.rmtree(out)
    if not src.exists():
        return
    out.mkdir(parents=True)
    data = json.loads(src.read_text(encoding="utf-8"))
    count = 0
    for aid, g in (data.get("사냥터") or {}).items():
        if aid not in places:
            print("  자리 안내: 위키에 없는 사냥터", aid)
            continue
        pics = []
        for pic in g.get("그림", []):
            f = SRC / "이미지" / "사냥터자리" / pic["파일"]
            if not f.exists():
                print("  자리 안내: 그림 없음", pic["파일"])
                continue
            shutil.copy2(f, out / f.name)
            with Image.open(f) as im:
                w, h = im.size
            pics.append({"src": f"data/guide/{f.name}", "w": w, "h": h, "caption": pic.get("설명", "")})
        places[aid]["guide"] = {
            "title": g.get("제목", "자리 안내"), "by": g.get("알린사람", ""), "notes": g.get("글", []),
            "words": g.get("찾는말", []), "pics": pics,
        }
        count += 1
    print("사냥터 자리 안내", count)


def copy_rank_pictures():
    """게임 화면 스샷에서 자른 그림: 길드 랭킹(자료/scripts/make_rank_marks.py), 사파이어 중개인(make_market_marks.py).
    data/ 아래에 두어 위키 자료처럼 로그인한 길드원에게만 보인다 (functions/data/_middleware.ts)."""
    # 시세동향: 위키에 없는 물건(코스튬 등)의 그림, 제작자가 보낸 도감 스샷에서 자른 것 (자료/scripts/make_trend_icons.py)
    # 생일: 생일 스티커 (src/birthday.tsx, 자료/scripts/make_birthday_sticker.py)
    # 성장코인샵: 2군 성장코인샵 물건 칸 그림, 제작자가 보낸 거래소 스샷에서 자른 것 (src/gcoin.ts itemPic, 자료/scripts/make_gcoin_icons.py)
    # 때리기: 운영진 때리기의 데미지 숫자와 CRITICAL! · DEADLY!, 제작자가 보낸 인게임 영상에서 오린 것 (src/smackFx.ts, 자료/scripts/make_smack_marks.py)
    for src, dst in (("랭킹", "rank"), ("중개인", "market"), ("상점", "shop"), ("시세동향", "trend"), ("생일", "birthday"), ("성장코인샵", "gcoin"), ("때리기", "smack")):
        out = OUT / "data" / dst
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        pics = sorted((SRC / "이미지" / src).glob("*.png"))
        for f in pics:
            shutil.copy2(f, out / f.name)
        # 플래티넘 상점 물건 목록 (이름, 플래티넘, 개수, 칸 그림)
        items = SRC / "이미지" / src / "items.json"
        if items.exists():
            shutil.copy2(items, out / "items.json")
        # 시세동향 그림 목록 (이름 -> [가로, 세로]): 확률 시뮬레이터가 위키에 없는 물건(코스튬 등) 그림을 찾는다
        if dst == "trend":
            sizes = {}
            for f in pics:
                with Image.open(f) as im:
                    sizes[f.stem] = list(im.size)
            (out / "index.json").write_text(json.dumps(sizes, ensure_ascii=False), encoding="utf-8")
        print(f"{src} 그림", len(pics))


if __name__ == "__main__":
    main()
