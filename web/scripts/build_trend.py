"""시세 동향 자료 만들기 (개발중, 제작자 요청 2026-11-03): 자료/카톡/*.txt (거래 톡방 카카오톡 대화 내보내기) -> public/data/trend.json

제작자가 폰에서 내보낸 시리온 거래 톡방 대화를 읽어, 골드 시세(N:1)와 물건 가격을 날짜별로 모은다.
게임을 읽지 않고 사람들이 톡방에 쓴 글만 세므로 게임 안전 규칙에 맞는다.
닉네임은 JSON 에 넣지 않는다 (집계와 글 본문 한 줄만). 로그인한 길드원에게만 보인다 (functions/data/_middleware.ts).

단위 (톡방 관습): '75:1' = 1만 원에 75만 골드. '1장' = '1콩' = 1만 원 ('치격2단 200만골드 혹은 2.7콩', '붉자껍 2개 - 1장 or 75만골').
물건 가격은 만 원으로 통일하고, 만 골드로 적은 값은 75:1 로 바꾼다.

실행: python scripts/build_trend.py   (build_data.py 가 끝에 같이 부른다). 자료/카톡 이 없으면 아무것도 안 만든다.
"""
from __future__ import annotations

import datetime
import json
import math
import re
import shutil
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료" / "카톡"
OUT = ROOT / "web" / "public" / "data" / "trend.json"
# 챗봇이 쓰는 작은 시세·줄임말 자료 (챗봇 개선 2026-11-09: '시세', '돈벌이', '충격샷4 가격', '월거', '광부 신발'을 못 답했다)
CHAT_OUT = ROOT / "web" / "public" / "data" / "chatmarket.json"
ICON_DIR = ROOT / "자료" / "이미지" / "시세동향"
# 세트·묶음 이름이면 그 코스튬의 몸통 부위 그림 (플랑 세트 -> 플랑의드레스)
BODY = re.compile(r"갑옷|옷|로브|드레스|비늘|흉골|협의|화복|풍운의|경갑|경기의상|나들이복")


# 시세동향 그림이 없을 때 찾아보는 다른 그림 (2026-11-10 제작자 '다른 쪽에 이미지 다 있을 텐데'): 성장코인샵 물건 칸(이미 /data/gcoin/ 으로 나감),
# 도감 영상에서 자른 것, 카페 글의 아이템 그림 (둘은 /data/trend/ 로 복사)
GCOIN_DIR = ROOT / "자료" / "이미지" / "성장코인샵"
MORE_DIRS = [ROOT / "자료" / "이미지" / "도감", ROOT / "자료" / "이미지" / "아이템"]
TREND_OUT = ROOT / "web" / "public" / "data" / "trend"
_more: dict[str, Path] | None = None


def _pic_key(s: str) -> str:
    return re.sub(r"\s", "", s.rstrip("("))


def other_icon(base: str) -> str | None:
    """이름이 똑같은(띄어쓰기 무시) 다른 그림"""
    global _more
    # 'S등급 무기마법서' -> 카페 그림 이름 '무기마법서(S등급)'
    m = re.fullmatch(r"(SS|S|A|B|C|D)등급\s*(무기|갑옷)마법서", base)
    if m:
        base = f"{m.group(2)}마법서({m.group(1)}등급)"
    k = _pic_key(base)
    if GCOIN_DIR.exists():
        for f in GCOIN_DIR.glob("*.png"):
            if _pic_key(f.stem) == k:
                return f"/data/gcoin/{f.name}"
    if _more is None:
        _more = {}
        for d in MORE_DIRS:
            if d.exists():
                for f in sorted(d.glob("*.png")):
                    _more.setdefault(_pic_key(f.stem), f)
    f = _more.get(k)
    if not f:
        return None
    TREND_OUT.mkdir(parents=True, exist_ok=True)
    dst = TREND_OUT / f"{k}.png"
    if not dst.exists():
        shutil.copy2(f, dst)
    return f"/data/trend/{k}.png"


def icon_for(name: str) -> str | None:
    """시세 동향 물건 이름 -> data/trend/<그림>.png. 괄호 설명을 떼고 같은 이름, 없으면 '플랑 세트'처럼 앞말로 시작하는 부위 중 몸통,
    그것도 없으면 다른 메뉴의 같은 이름 그림 (other_icon)"""
    base = re.sub(r"\s*\(.*\)\s*$", "", name).strip()
    if not ICON_DIR.exists():
        return other_icon(base)
    if (ICON_DIR / f"{base}.png").exists():
        return f"/data/trend/{base}.png"
    head = re.split(r"[ ·]", re.sub(r"\s*(세트|셋)$", "", base))[0]
    if len(head) < 2:
        return other_icon(base)
    cands = sorted(p.stem for p in ICON_DIR.glob(f"{head}*.png"))
    if not cands:
        return other_icon(base)
    body = [c for c in cands if BODY.search(c[len(head):])]
    return f"/data/trend/{(body or cands)[0]}.png"

POSTS_JSON = ROOT / "web" / "public" / "data" / "posts.json"
MENU_JSON = ROOT / "web" / "public" / "data" / "menu.json"


def load_skills() -> dict[str, dict]:
    """위키 '직업별 스킬' 글의 스킬 표 -> {띄어쓰기 없는 이름: {name, max, icon}}. 표 첫 칸 = 아이콘(gif)과 굵은 이름, 둘째 칸 = 'N단 - …' 줄"""
    if not POSTS_JSON.exists() or not MENU_JSON.exists():
        return {}
    posts = json.loads(POSTS_JSON.read_text(encoding="utf-8"))
    menu = json.loads(MENU_JSON.read_text(encoding="utf-8"))
    ids = [p["id"] for sec in menu if sec.get("title") == "직업별 스킬" for p in sec.get("posts", [])]
    out: dict[str, dict] = {}
    for pid in ids:
        for b in posts.get(pid, {}).get("blocks", []):
            if b.get("k") != "table" or not b.get("rows") or len(b["rows"][0]) < 2:
                continue
            head, desc = b["rows"][0][0].get("l", []), b["rows"][0][1].get("l", [])
            icon = next((r["src"] for line in head for r in line if "src" in r), None)
            name = next((r["t"].strip() for line in head for r in line if r.get("b") and r.get("t", "").strip() and not r["t"].strip().startswith("(")), None)
            stages = [r["t"] for line in desc for r in line if re.match(r"\s*\d단", r.get("t", ""))]
            if icon and name and stages:
                out[name.replace(" ", "")] = {"name": name, "max": len(stages), "icon": "/" + icon}
    return out


SKILLS = load_skills()
SKILL_ICONS: dict[str, str] = {}  # 스킬북 물건 이름 -> 위키 스킬 아이콘 (화면은 위키 그림이 없으면 이것)
# 스킬북 (제작자 2026-11-04): 거래되는 스킬북은 거의 마지막 단계라, 단이 없거나 '마스터·마북'(수기마북, 포아마)이면 마지막 단계 ('수호의기원 3단').
# 줄임말(SKILL_BOOK)과 위키 스킬 이름 뒤에 숫자(단)나 단·북·마북·마스터. 한 글자 줄임말(덥, 와 …)은 숫자나 '북'이 있어야 하고 '마'만 붙은 것은 캐릭터 말(덥마렌)이라 뺀다.
# 스킬 이름만 적은 것은 네 글자 이상이거나 아는 줄임말(수기, 아프, 화폭, 치격, 포아)만: 공포·집중은 코스튬 이름이기도 하다 ('공포 체8 9장')
SB_SUFFIX = r"(단|마스터스킬북|마스터북|마북|마스터|스킬북|스북|북|마)?"
SB_ALONE = {"수기", "아프", "화폭", "치격", "포아"}


def skill_book(w: str, rs) -> tuple[str, bool] | None:
    """낱말 -> (스킬북 이름, 위키 아이템인지). '수기마북' -> '수호의기원 3단', '화폭2단' -> '화염폭풍 2단'"""
    c = re.sub(r"[^가-힣0-9]", "", w)
    keys = sorted(set(SKILL_BOOK) | {k for k in SKILLS if len(k) >= 2}, key=len, reverse=True)
    m = re.fullmatch("(" + "|".join(keys) + r")(\d)?" + SB_SUFFIX, c) if keys else None
    if not m:
        return None
    key, n, suf = m.group(1), m.group(2), m.group(3)
    if not n and not suf and not (key in SB_ALONE or (key in SKILLS and len(key) >= 4)):
        return None
    if len(key) == 1 and not n and suf in (None, "마"):
        return None
    full = SKILL_BOOK.get(key, key).replace(" ", "")
    sk = SKILLS.get(full)
    stage = int(n) if n else (sk["max"] if sk else None)
    disp = sk["name"] if sk else full
    name = f"{disp} {stage}단" if stage else f"{disp} 스킬북"
    if sk:
        SKILL_ICONS[name] = sk["icon"]
    return name, bool(stage and rs.names.get(f"{full}{stage}"))


USUAL_RATE = 75  # 만 골드로 적은 가격을 만 원으로 바꿀 때 (web/src/gold.ts 의 USUAL_RATE 와 같다)
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")
NOT_ITEM = re.compile(r"^(골드|구매시|통 구매시|일괄구매시|통|개당|통당|장당)$|구매시$")
NUMBERING = re.compile(r"^\d+\.\s*")

HEAD = re.compile(r"^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), (.+?) : (.*)$")
# PC 카카오톡 내보내기 (2026-11-10 받은 파일): 날짜 줄 '--------------- 2026년 10월 12일 월요일 ---------------' 아래 '[닉네임] [오전 2:24] 글'
DAY = re.compile(r"^-+ (\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+요일 -+$")
HEAD_PC = re.compile(r"^\[(.+?)\] \[(오전|오후) (\d{1,2}):(\d{2})\] ?(.*)$")
JOINED = re.compile(r"님이 (들어왔습니다|나갔습니다)|님을 내보냈습니다|^불법촬영물 식별|^이미지, 동영상 또는 압축파일")
SYSTEM = re.compile(r"님이 (들어왔습니다|나갔습니다)\.?$|^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}$")
ROOM = re.compile(r"^﻿?(.+?) \d* ?님과 카카오톡 대화")

RATE = re.compile(r"(?<![\d.])(\d{2,3})\s*[:：대]\s*1(?![\d])")
AMOUNT = re.compile(r"(\d+(?:\.\d+)?)\s*(장|콩)")
SELL = re.compile(r"팝니다|팔아요|팔아유|팔|판매|ㅍ(?![a-z가-힣])|떨이|텁니다|털어요")
BUY = re.compile(r"삽니다|삽니당|구매|구합|산다|사요|매입|ㅅ(?![a-z가-힣])")
PRICE = re.compile(r"(?<![\d.])(\d+(?:[.,]\d+)?)\s*(장|콩|만\s?골드|만\s?골|만원|만)(?![가-힣\d])")


# 닉네임 (제작자 설명 2026-11-03): 띄어쓰기가 없다. 앞의 '시리온', '헤이블' 같은 서버 이름(시제 = 시리온 제국, 시왕 = 시리온 왕국)과
# 제국/왕국은 뺀다. 뒤의 네 자리 숫자는 휴대폰 뒷자리라 닉네임에 넣지 않고 따로 둔다: 있으면 인증된 사용자, 없으면 미인증.
SERVER_WORDS = re.compile(r"^(?:\s*(?:시리온|헤이블|시제|시왕|헤제|헤왕|제국|왕국|중립)\s*[/|\-]?\s*)+")
TEL_RE = re.compile(r"[\s(\[\-/]*(\d{4})\s*[)\]]*\s*$")


def norm_who(raw: str) -> tuple[str, str]:
    """'시리온 앨럿(5121)' -> ('앨럿', '5121'), '리카르도마르티네스 2865' -> ('리카르도마르티네스', '2865'), '회검' -> ('회검', '')"""
    s = raw.strip()
    tel = ""
    m = TEL_RE.search(s)
    if m and len(s) > 4:
        tel = m.group(1)
        s = s[:m.start()]
    s = re.sub(r"\((?:제국|왕국|중립)\)", "", s)
    s2 = SERVER_WORDS.sub("", s)
    if len(re.sub(r"\s", "", s2)) >= 1:
        s = s2
    for w in ("시리온", "헤이블", "시제", "시왕"):  # 붙여 쓴 것 ('시제로드')
        if s.startswith(w) and len(s) - len(w) >= 2:
            s = s[len(w):]
            break
    s = re.sub(r"[\s()\[\]]+", "", s).strip("/|-·")
    return (s or raw.strip()), tel


def parse(path: Path) -> tuple[str, list[dict]]:
    """카카오톡 내보내기 글 -> [{date, who, text}] (여러 줄 글은 한 덩어리로). 방 이름도 돌려준다"""
    room = path.stem
    msgs: list[dict] = []
    cur: dict | None = None
    day: str | None = None  # PC 내보내기의 지금 날짜
    with path.open(encoding="utf-8-sig") as f:
        for i, raw in enumerate(f):
            line = raw.rstrip("\r\n")
            if i == 0:
                m = ROOM.match(line)
                if m:
                    room = m.group(1).strip()
            d = DAY.match(line)
            if d:
                day = f"{d.group(1)}-{int(d.group(2)):02d}-{int(d.group(3)):02d}"
                cur = None
                continue
            pc = HEAD_PC.match(line) if day else None
            if pc:
                who, text = pc.group(1), pc.group(5)
                if who == "오픈채팅봇":
                    cur = None
                    continue
                name, tel = norm_who(who)
                cur = {"date": day, "who": name, "tel": tel, "text": text}
                msgs.append(cur)
                continue
            if JOINED.search(line):
                cur = None
                continue
            m = HEAD.match(line)
            if m:
                y, mo, d, _ap, _h, _mi, who, text = m.groups()
                if who == "오픈채팅봇":
                    cur = None
                    continue
                name, tel = norm_who(who)
                cur = {"date": f"{y}-{int(mo):02d}-{int(d):02d}", "who": name, "tel": tel, "text": text}
                msgs.append(cur)
            elif SYSTEM.search(line):
                cur = None
            elif cur is not None:
                cur["text"] += "\n" + line
    return room, msgs


def dedupe(msgs: list[dict]) -> list[dict]:
    """같은 사람이 같은 날 같은 글을 여러 번 올린 것은 하나로 (거래 톡방은 같은 글을 되풀이 올린다)"""
    seen: set[tuple] = set()
    out = []
    for m in msgs:
        key = (m["date"], m["who"], re.sub(r"\s+", " ", m["text"]).strip())
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def side_of(text: str) -> str:
    if BUY.search(text) and not SELL.search(text):
        return "buy"
    if SELL.search(text):
        return "sell"
    return ""


def stats(values: list[float]) -> dict | None:
    """수, 최소, 중간, 최대와 가운데 절반(q1~q3: 한 건짜리 튀는 값에 띠가 끌리지 않게)"""
    if not values:
        return None
    s = sorted(values)
    q1 = s[len(s) // 4]
    q3 = s[(len(s) * 3) // 4]
    return {"n": len(s), "min": s[0], "q1": q1, "med": round(statistics.median(s), 1), "q3": q3, "max": s[-1]}


def gold_people(msgs: list[dict]) -> dict:
    """골드 글 올린 사람마다 N:1 중간값과 글 수 (팝니다 / 삽니다). 팝니다는 N 이 클수록 싼 골드라 큰 쪽부터"""
    xs: dict[str, list[dict]] = {"sell": [], "buy": []}
    for m in msgs:
        t = m["text"]
        for r in RATE.finditer(t):
            rate = int(r.group(1))
            if not 50 <= rate <= 120:
                continue
            ctx = t[max(0, r.start() - 40): r.end() + 40]
            side = side_of(ctx) or side_of(t)
            if side:
                xs[side].append({"who": m["who"], "tel": m["tel"], "rate": rate, "date": m["date"]})
    out = {k: people(v, "rate") for k, v in xs.items()}
    out["sell"].reverse()
    return out


def gold_days(msgs: list[dict]) -> list[dict]:
    """날짜별 골드 시세: 팝니다/삽니다 쪽의 N:1 값 (수, 최소, 중간, 최대)과 골드 글 수"""
    by_day: dict[str, dict] = defaultdict(lambda: {"sell": [], "buy": [], "posts": {"sell": 0, "buy": 0}})
    for m in msgs:
        t = m["text"]
        day = by_day[m["date"]]
        for r in RATE.finditer(t):
            rate = int(r.group(1))
            if not 50 <= rate <= 120:
                continue
            ctx = t[max(0, r.start() - 40): r.end() + 40]
            side = side_of(ctx) or side_of(t)
            if side:
                day[side].append(rate)
        if "골드" in t and len(t) < 80 and side_of(t):
            day["posts"][side_of(t)] += 1
    return [
        {"date": d, "sell": stats(v["sell"]), "buy": stats(v["buy"]), "posts": v["posts"]}
        for d, v in sorted(by_day.items())
    ]


# ---- 톡방 줄임말 풀기 (제작자 설명 2026-11-03) -------------------------------------------------------------
# 한 줄 = [옵션들] [강화][물건 줄임말] 가격.  '지3 대자연 30' = 지능3 대자연, 30만 원.  '명9 힘7 팔닼소 38' = 명중9 힘7 +8 다크스틸소드, 38만 원.
# 줄임말은 위키 아이템 이름의 글자를 차례로 뽑은 것 (의망 = 의지의 망토, 반죽망 = 반죽음의망토, 8헌보 = +8 헌터보우).
# 옵션마다 값이 다르므로 (지3 대자연 30, 힘3 대자연 35) 물건 + 강화 + 옵션 묶음(variants)으로 따로 센다.
# 뒤에 단위 없이 붙은 숫자는 현금 만 원 ('1콩' = 1만 원). 300 이상이면 만 골드로 본다 ('지3 대자연 2500' = 2500만 골드 ≈ 33만 원).
ITEMS_JSON = ROOT / "web" / "public" / "data" / "items.json"
# 단위 없는 숫자 (제작자: '8페일 750' = 750만 원, '지3 대자연 2500' = 2500만 골드): 같은 물건·묶음에서 단위를 적은 글의 중간값에 가까운 쪽으로
# 읽는다 (만 원 그대로 vs 만 골드 ÷ 75). 비교할 글이 없으면 이 값까지는 만 원, 넘으면 만 골드
BARE_GOLD_FROM = 1000

KNUM = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10}
# 옵션 줄임말 -> 옵션 이름. 체/마나 1~3 은 속성부여 10, 20, 30 (제작자: '체력 30 = 체3')
OPTS = {"힘": "힘", "민": "민첩", "민첩": "민첩", "지": "지능", "지능": "지능", "체": "체력", "체력": "체력", "마나": "마나", "마": "마나",
        "명": "명중", "명중": "명중", "크": "크리", "크리": "크리", "치격": "치격", "이속": "이속", "불저": "불저", "속저": "속저",
        "냉저": "냉저", "번저": "번저", "크저": "크저", "독저": "독저", "마재": "마재", "체재": "체재", "체잰": "체재", "뎀감": "뎀감",
        "아머": "아머", "회피": "회피", "속": "속저", "냉": "냉저", "번": "번저", "독": "독저", "경험": "경험치", "경치": "경험치", "죽격": "죽격", "데미지": "데미지", "뎀": "데미지"}
OPT_KEYS = "|".join(sorted(OPTS, key=len, reverse=True))
OPT_RE = re.compile(r"^(" + OPT_KEYS + r")\s?(\d+(?:\.\d+)?|[일이삼사오육칠팔구십])%?(퍼|프로)?$")
# 이름에 붙은 옵션 ('지3대자' = 지능3 대자연, '민3서약벨')
OPT_GLUED = re.compile(r"^(" + OPT_KEYS + r")(\d+(?:\.\d+)?|[일이삼사오육칠팔구십])%?(?=[가-힣\d]|$)")
# 캐릭터 스펙 줄 ('아머 3', 'pve뎀감 5.7', '힘/민/지 4/6/3'): 옵션 말만 남는 줄은 물건이 아니다
STAT_RE = re.compile("|".join(sorted(set(OPTS) | set(OPTS.values()) | {"pve", "pvp", "PVE", "PVP", "데미지", "감소", "저항", "재생", "드랍", "아이템",
                                        "크리티컬", "이동속도", "체젠", "마젠", "경험치", "젠", "퍼"}, key=len, reverse=True)))
ENHANCE_RE = re.compile(r"^\+?(\d{1,2}|[오육칠팔구십])(?=[가-힣])")
# 줄에서 물건이 아닌 말
SKIP_WORDS = {"제국", "왕국", "중립", "팝니다", "삽니다", "팔아요", "판매", "구매", "구합니다", "급처", "흥정", "일괄", "가능", "플톡", "주세요", "문의", "떨이",
              "개당", "통당", "장당", "통", "노작", "노강", "싸게", "급매", "빠르게", "각개", "통매입", "매입", "노옵", "투옵", "쓰리옵", "이상", "이하", "판완", "완료", "예약", "골드", "현금", "보유", "각", "개"}
NOT_ITEM_WORDS = {"아여", "땡구", "기본전", "플티", "제이상",  # 플티 = 플래티넘, '40제이상' = 40제 이상  # 제작자 2026-11-10: 오타·무시
                  "보석", "코튬", "코스튬", "아이템", "장비", "무기", "방어구", "캐릭터", "계정", "통판매", "대리판매", "도감", "도감용",
                  "전사", "렌저", "레인저", "법사", "마법사", "무도가", "신발", "투구", "갑옷", "장갑", "모자", "반지", "벨트", "망토", "목걸이", "이상", "이하",
                  "아드", "아드골드", "아골", "싸게", "급매", "빠르게", "각개", "일괄", "통매입", "매입", "판완", "예약",
                  # 캐릭터 이름(제작자 2026-11-04: 꼬물·닉넴 대장은 캐릭 이름)과 글의 군더더기
                  "꼬물", "꼬물이", "닉넴대장", "대장", "해요", "가격", "보유중입니다", "각물품", "일반", "염된", "완료", "죄송합니다", "급처합니다", "통시", "마리당",
                  "플티포함", "일괄시", "일광시", "적정가", "보스데미지", "대량", "각각", "세트로", "맥스80", "파글합니다", "애정이듬뿍담긴계정", "대량시할인수율",
                  "첫번째보석", "맥주도핑다수", "패키지코튬하나만", "장갑신발코튬각각", "전사무기코튬아무거나", "스무스갑합쳐서", "열매3개합", "각개x", "계정구해요", "코튬각각", "통판", "급처", "구해요", "팝니당", "삽니당"}  # 아드골드 = 도감의 아이템·골드 드랍율 (제작자)
# 캐릭터 글의 말(올마, 도감, 46전사)과 닉네임 표시(닉넴 …)는 물건이 아니다
CHAR_TOKEN = re.compile(r"올마|노도감|도감|^닉넴|^\d{2}(전사|렌저|레인저|법사|마법사|무도가|전|렌|법|무)$|^(투쉴|덥마|와마|프마|쉴마)")
# 줄임말 한 글자가 두 글자를 줄인 것
SQUEEZE = {"닼": "다크", "롭": "로브", "렌": "레인"}
# 자동으로 풀기 어려운 줄임말 (제작자 확인). 값이 None 이면 위키에 없는 물건이라 줄임말 그대로 둔다
ALIASES: dict[str, str | None] = {
    "의망": "의지의 망토", "반죽망": "반죽음의망토", "죽망": "죽음의망토", "헌보": "헌터보우",
    # 닼 혼자(8닼, 팔닼)는 다크스틸소드 (제작자 2026-11-04)
    "닼": "다크스틸소드", "닼스": "다크스컬", "닼소": "다크스틸소드", "닼쉴": "다크스틸쉴드", "닼아": "다크스틸아머", "닼투": "다크스틸투구",
    "뿌벨": "거친뿌리의벨트", "뿌리벨": "거친뿌리의벨트", "건마벨": "건조한마력의벨트", "마재벨": "마나재생벨트", "서약벨": "서약자의벨트",
    "가지갑": "세계수가지갑옷", "껍갑": "세계수껍질갑옷", "세계롭": "세계수잎로브", "세계수롭": "세계수잎로브",
    "광전사": "광전사의부츠", "정반": "정화된힘의반지", "약반": "약속의반지", "현인장": "현인의장갑", "정화장": "정화의장갑",
    "카소": "카이저소드", "파홀": "파괴의홀", "임페": "임페리얼보우", "스카장": "스카우트장갑", "학모": "학자의모자", "방모": "방랑자의모자",
    "백레": "백색레이피어", "고봉": "고대의봉", "승건": "승리의건틀릿", "윙부": "윙깃부츠", "스파쉴": "스파르탄쉴드", "샤쿤": "샤쿤그리브",
    "강골장": "강철골렘장갑", "용투": "용맹의투구", "무투": "무쇠투구", "오순": "오염된순수", "완망": "의지의 망토", "완성의망토": "의지의 망토",  # 완망 = 의지의 망토 업그레이드 최종 단계(죽음의일격 1.0). 처음엔 따로 셌다가 합침 (제작자 2026-11-04 '합쳐도 될 거 같아')
    "엘프": "엘프의 덧신", "버닝": "버닝블레이드", "레목": "레이븐목걸이", "건마밸": "건조한마력의벨트", "닥쉴": "다크스틸쉴드",
    "대자": "대자연", "반죽": "반죽음의망토", "고지": "고요의지팡이", "광부": "광전사의부츠", "대천": "대천사",  # 제작자 확인 2026-11-03
    "재벨": "재생의벨트", "글라": "글라디우스",
    "가반": "가디언의반지", "신봉": "신비술사의봉", "페일": "페일노트", "인퀴": "인퀴지션", "룬블": "룬블레이드", "데조튜": "데조르바의튜닉",  # 제작자 확인
    "스톰": "스톰브레이커", "맹모": "맹신의모자", "망목": "망가진목걸이", "어둠신": "어둠의신발", "기록가": "기록가수의",  # 제작자 확인
    "로저투구": None, "로저갑옷": None, "로저뚝": None, "로저갑": None, "로저셋": None, "로저장": None, "로저신": None,  # 로저 코스튬 4종 (제작자 스샷 2026-11-04, 뚝 = 투구). 로크의 레인저 투구가 아니다
    "광기": None, "심연": None, "분노": None,  # 코스튬 (유어 2026-11-04): 광기의송곳니·심연의 파편으로 짐작하지 않는다
    # 유어 설명 (2026-11-04, 제작자 1:1 카톡)과 제작자 확인
    # 연격장 = 연속공격의장갑 (무도가 Lv.46, 제작자 도감 스샷 2026-11-04. 레인저 연격의장갑이 아니다), 골장 = 강철골렘장갑 Lv.35, 설원가죽옷은 설인가죽옷 오타
    "연격장": "연속공격의장갑", "골장": "강철골렘장갑", "설원가죽옷": "설인가죽옷", "세계롶잎": "세계수잎로브",
    "회바갑": "회색바위의갑옷", "회바투": "회색바위의투구", "회바뚝": "회색바위의투구", "회바신": "회색바위의장화", "샤쿤신발": "샤쿤그리브", "티타눔부츠": "티타늄부츠",
    "설원장": "설원의저주장화", "설원신": "설원의저주장화", "샤보": "샤도우보우", "하갑": "하이가드갑옷", "티벨": "티타늄벨트",  # 제작자 확인
    # 2026-11-10 정리 때 더함 (톡방 글로 짐작: '지2 레이븐 3', '5맹독신 민3 이속7', '크2 육오트윌갑 9', '6철실(속저x) 2.5장' 의 실 = 쉴드)
    "레이븐": "레이븐목걸이", "맹독신": "맹독의장화", "오트윌갑": "오트윌의경갑", "철실": "철갑쉴드", "닼실": "다크스틸쉴드",
    # 제작자 2026-11-10 확인: 닥소 = 닼소, 오트갑 = 오트윌갑, 데조 = 데조르바의보우 (칠데조 = +7 데조)
    "닥소": "다크스틸소드", "오트갑": "오트윌의경갑", "데조": "데조르바의보우",
    "황솟": "황혼의송곳니", "신벨": "신념의벨트", "파글": "파워글러브",  # 제작자 2026-11-10
    "오트윌": "오트윌의경갑", "약반": "약속의반지", "방랑자의화실집": "방랑자의 화살집", "써지": "써지싸이클", "써지사이클": "써지싸이클",  # 위키 이름 (화실집은 오타)
    "워투": "워로드투구",  # 문맥으로 정함 (제작자 2026-11-10 '앞뒤 문맥 필요'): 닥갑·닥쉴·백레와 같이 파는 전사 장비, '힘8 속8 6워투' = 워로드투구의 속성저항·힘
    "레인저껍갑": "세계수가지갑옷",  # 제작자 2026-11-10 '세계수 가지갑일걸' (껍갑은 전사 것인데 레인저라고 적음)
    # 뿌벨 = 모르포시즈 뿌리 Lv.40 벨트 (제작자 2026-11-10 '전사뿌벨 = 전사용 뿌리 벨트'. 다른 직업 말은 위키 같은 표의 벨트로, 짐작, 확인 전)
    "전사뿌벨": "거친뿌리의벨트", "렌저뿌벨": "서약자의벨트", "레인저뿌벨": "서약자의벨트", "법사뿌벨": "건조한마력의벨트", "무도가뿌벨": "청록의파편벨트", "무도뿌벨": "청록의파편벨트",
    "설신": "설원의저주장화",  # 제작자 2026-11-10
    "윙": "윙의날개",  # 팔윙 = +8 윙의날개 (제작자 2026-11-10 확인)
    "거뼈": "거미줄뼈갑옷", "황목": "황금목걸이", "닥스": "다크스컬", "글라": "글라디우스", "숲요장": "숲요정의장갑", "속모": "속전속결의모자", "속전모": "속전속결의모자", "사용장": "사막용병의장갑", "재벨": "재생의벨트", "데조모": "데조르바의모자", "강장": "강화가죽장갑",  # 제작자 2026-11-10 확인 (초보자도움방 "강장은 명중 1당 가격 3배")
}


# 위키에 없는 물건의 보이는 이름 (제작자 설명 2026-11-03). 아드셋: 보석 3개가 한 세트이고 232, 333 같은 숫자는 1, 2, 3번 보석의 등급(1~4).
# '지2 아드셋' = 2번 보석이 아드레날린 보석이고 셋 다 2등급, 등급만큼 속성(지능2)이 붙는다. 캐릭터 글의 '보석 333' 도 같은 등급 표시.
# '12번보석셋' = 1, 2번 보석이 있는 세트
GEMSET = re.compile(r"^(\d{1,3})번?보석셋$")
# 펫 (제작자 2026-11-03): 레어펫, 수룡펫, 베스페라, 모스가디는 펫. 값은 속성강화와 펫 종류로 정해지는데 매물이 적어 '펫' 하나로 묶고
# 묶음·원글에 무슨 펫인지 적는다
PET_WORDS = {"베루아": "베루아", "레어펫": "레어펫", "수룡펫": "수룡펫", "수룡": "수룡펫", "베스페라": "베스페라", "모스가디": "모스가디", "젤피": "젤피", "나이녹스": "나이녹스", "펫": "펫"}
PET_RE = re.compile(r"^(?:펫)?(베루아|레어펫|수룡펫|수룡|베스페라|모스가디|젤피|나이녹스|[가-힣]{1,4}펫)$")  # 젤피 = 펫 (유어 2026-11-04), 나이녹스 = 펫 (제작자 2026-11-04)  # 베루아 = 펫 (제작자 2026-11-10)
SKILL_BOOK = {"포아": "포레스트아이", "화폭": "화염폭풍", "치격": "치명적일격", "소드": "소울드레인샷", "쉴드": "쉴드", "휩": "휩쓸기", "덥": "더블샷", "충": "충격샷",
              "아프": "아이스프리즌", "수기": "수호의기원", "강인함": "강인함",  # 유어 2026-11-04: 아프 = 법사 스킬 아이스프리즌, 수기 = 수호의기원
              "와": "와일드스윙", "프": "프레임쇼크"}
NON_WIKI = {"아드셋": "아드레날린 보석 세트", "활발한강아지": "활발한 강아지 (코스튬)",
            # 계정 글의 '레어 코스튬 도감: 천사의날개, 아이요셋, 스나이퍼, 보석의기사' (톡방 원글)
            "천날": "천사의날개 (코스튬)", "천사의날개": "천사의날개 (코스튬)", "스나이퍼": "스나이퍼 (코스튬)", "아드보석셋": "아드레날린 보석 세트", "아드보석세트": "아드레날린 보석 세트",
            # 알려 준 이름의 다른 표기 (제작자 2026-11-04: 알려 준 건데 왜 아직 모르는 줄임말이냐)
            "해냐장": "해니아의손덮개 (코스튬)", "해니아장갑신발": "해니아 장갑·신발 (코스튬)", "헤니아장갑신발": "해니아 장갑·신발 (코스튬)",
            "게올뚝": "게올의모자 (코스튬)", "게올모자": "게올의모자 (코스튬)", "게올뚝갑": "게올 모자·갑옷 (코스튬)", "게올롭": "게올 갑옷 (코스튬)", "게올장갑": "게올 장갑 (코스튬)", "게올신발": "게올 신발 (코스튬)",
            "드롤뚝": "드롤의모자 (코스튬)", "드롤모자": "드롤의모자 (코스튬)", "드롤뚝갑": "드롤 모자·갑옷 (코스튬)", "드롤롭": "드롤 갑옷 (코스튬)", "드롤장갑": "드롤 장갑 (코스튬)", "드롤신발": "드롤 신발 (코스튬)",
            "에트나모자": "에트나의서클릿 (코스튬)", "로저의장화": "로저의장화 (코스튬)", "로저의장갑": "로저의장갑 (코스튬)", "로저의철투구": "로저의철투구 (코스튬)",
            "웨딩드레스": "웨딩드레스 (코스튬)", "웨딩드레스코튬": "웨딩드레스 (코스튬)",
            "혈운의수호": "혈운의 수호 (코스튬)", "혈운의주관": "혈운의 주관 (코스튬)", "혈운의화복": "혈운의 화복 (코스튬)", "혈운의심운화": "혈운의 심운화 (코스튬)",
            "거불에이무": "A등급 무기마법서 (거래불가)", "거불에갑": "A등급 갑옷마법서 (거래불가)", "거가에이무": "A등급 무기마법서 (거래가능)", "거가에갑": "A등급 갑옷마법서 (거래가능)",
            "회바셋칠백": "회색바위 세트", "목청높여": "목청높여 (코스튬)", "목청": "목청높여 (코스튬)",
            # 유어 설명 (2026-11-04, 제작자 1:1 카톡): 코스튬과 위키에 없는 장비
            "기억단화": "끈질긴 기억의 단화", "끈질긴기억의단화": "끈질긴 기억의 단화",
            "기억의단화": "끈질긴 기억의 단화", "끈질긴단화": "끈질긴 기억의 단화",
            "회바셋": "회색바위 세트",
            # 코튬 N셋 = 체력 옵션이 붙은 코스튬을 부위별로 N개 사는 것 (제작자 2026-11-04: 보통 체10 코튬셋을 구한다. '체10 코튬6셋 12')
            "코튬셋": "체력 코스튬 세트", "코스튬셋": "체력 코스튬 세트",
            **{f"{a}{n}셋": f"체력 코스튬 {n}부위" for a in ("코튬", "코스튬") for n in range(2, 9)},
            # 에트나 영웅 코스튬 5종 (서클릿·로브·면장갑·마법신발·날개, 제작자 도감 스샷 2026-11-04)
            "에트나": "에트나 (코스튬)", "에트나셋": "에트나 세트 (코스튬)", "에트나롭": "에트나의로브 (코스튬)", "에트나로브": "에트나의로브 (코스튬)",
            "에트나서클릿": "에트나의서클릿 (코스튬)", "에트나모": "에트나의서클릿 (코스튬)", "에트나장": "에트나의면장갑 (코스튬)", "에트나장갑": "에트나의면장갑 (코스튬)",
            "에트나면장갑": "에트나의면장갑 (코스튬)", "에트나신": "에트나의마법신발 (코스튬)", "에트나신발": "에트나의마법신발 (코스튬)", "에트나마법신발": "에트나의마법신발 (코스튬)",
            "에트나날개": "에트나의날개 (코스튬)",
            # 이네스 영웅 코스튬 5종 (후드·경갑·손보호대·장화·활걸이, 제작자 도감 스샷 2026-11-04)
            "이네스": "이네스 (코스튬)", "이네스셋": "이네스 세트 (코스튬)", "이네스경갑": "이네스의경갑 (코스튬)", "이네스갑": "이네스의경갑 (코스튬)",
            "이네스후드": "이네스의후드 (코스튬)", "이네스모": "이네스의후드 (코스튬)", "이네스손보호대": "이네스의손보호대 (코스튬)", "이네스장": "이네스의손보호대 (코스튬)",
            "이네스장갑": "이네스의손보호대 (코스튬)", "이네스장화": "이네스의장화 (코스튬)", "이네스신": "이네스의장화 (코스튬)", "이네스신발": "이네스의장화 (코스튬)",
            "이네스활걸이": "이네스의활걸이 (코스튬)", 
            # 스텔라 영웅 코스튬 3종 (투구·갑옷·스틸 부츠, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "스텔라": "스텔라 (코스튬)", "스텔라셋": "스텔라 세트 (코스튬)", "스텔라투구": "스텔라의 투구 (코스튬)", "스텔라뚝": "스텔라의 투구 (코스튬)",
            "스텔라갑옷": "스텔라의 갑옷 (코스튬)", "스텔라갑": "스텔라의 갑옷 (코스튬)", "스텔라부츠": "스텔라의 스틸 부츠 (코스튬)", "스텔라스틸부츠": "스텔라의 스틸 부츠 (코스튬)",
            "스텔라신": "스텔라의 스틸 부츠 (코스튬)", "스텔라신발": "스텔라의 스틸 부츠 (코스튬)",
            # 광기·심연·분노는 영웅 코스튬 (광기 전사 무기, 심연 레인저 무기, 분노 전사 날개. 제작자 도감 스샷 2026-11-04)
            "광기": "광기 (코스튬)", "심연": "심연 (코스튬)", "분노": "분노 (코스튬)",
            # 하라 영웅 코스튬 4종 (베레모·나들이복·손토시·장화, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "하라": "하라 (코스튬)", "하라셋": "하라 세트 (코스튬)", "하라뚜갑": "하라의베레모·나들이복 (코스튬)", "하라뚝": "하라의베레모 (코스튬)",
            "하라베레모": "하라의베레모 (코스튬)", "하라모": "하라의베레모 (코스튬)", "하라갑": "하라의나들이복 (코스튬)", "하라나들이복": "하라의나들이복 (코스튬)", "하라옷": "하라의나들이복 (코스튬)",
            "하라손토시": "하라의손토시 (코스튬)", "하라장": "하라의손토시 (코스튬)", "하라장갑": "하라의손토시 (코스튬)", "하라장화": "하라의장화 (코스튬)", "하라신": "하라의장화 (코스튬)",
            "하라신발": "하라의장화 (코스튬)",
            "프리바티": "프리바티 (코스튬)",
            # 플랑 = 영웅 코스튬 4부위 (왕관·드레스·장갑·단화, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "플랑셋": "플랑 세트 (코스튬)", "플랑": "플랑 (코스튬)", "플랑왕관": "플랑의왕관 (코스튬)", "플랑드레스": "플랑의드레스 (코스튬)",
            "플랑장갑": "플랑의장갑 (코스튬)", "플랑장": "플랑의장갑 (코스튬)", "플랑단화": "플랑의단화 (코스튬)", "플랑신": "플랑의단화 (코스튬)", "아요셋": "아이요 세트 (코스튬)", "아이요셋": "아이요 세트 (코스튬)",
            # 아이요 영웅 코스튬 4부위 (모자·옷·장갑·신발, 제작자 도감 스샷 2026-11-04). 장갑은 Lv.46 장비 아요장과 이름이 겹쳐 try_group 에서 가른다
            "아이요모자": "아이요의모자 (코스튬)", "아요모": "아이요의모자 (코스튬)", "아이요옷": "아이요의옷 (코스튬)", "아요옷": "아이요의옷 (코스튬)",
            "아이요신발": "아이요의신발 (코스튬)", "아요신": "아이요의신발 (코스튬)",
            # 해니아 영웅 코스튬 6종 (모자·로브·손덮개·천신발·해니아II·무기 해니아, 제작자 도감 스샷 2026-11-04). 헤니아는 오타
            **{f"{h}{k}": v for h in ("해니아", "헤니아") for k, v in {"모": "해니아의모자 (코스튬)", "모자": "해니아의모자 (코스튬)", "롭": "해니아의로브 (코스튬)", "로브": "해니아의로브 (코스튬)",
                                                            "장": "해니아의손덮개 (코스튬)", "장갑": "해니아의손덮개 (코스튬)", "손덮개": "해니아의손덮개 (코스튬)",
                                                            "신": "해니아의천신발 (코스튬)", "신발": "해니아의천신발 (코스튬)", "천신발": "해니아의천신발 (코스튬)",
                                                            "셋": "해니아 세트 (코스튬)", "": "해니아 (코스튬)", "II": "해니아II (코스튬)", "2": "해니아II (코스튬)"}.items()},
            # 로저 영웅 코스튬 4종 (철투구·경기의상·장갑·장화, 제작자 도감 스샷 2026-11-04)
            "로저": "로저 (코스튬)", "로저셋": "로저 세트 (코스튬)", "로저뚝": "로저의철투구 (코스튬)", "로저투구": "로저의철투구 (코스튬)",
            "로저철투구": "로저의철투구 (코스튬)", "로저갑옷": "로저의경기의상 (코스튬)", "로저갑": "로저의경기의상 (코스튬)", "로저경기의상": "로저의경기의상 (코스튬)",
            "로저옷": "로저의경기의상 (코스튬)", "로저장갑": "로저의장갑 (코스튬)", "로저장": "로저의장갑 (코스튬)", "로저장화": "로저의장화 (코스튬)", "로저신": "로저의장화 (코스튬)",
            "로저신발": "로저의장화 (코스튬)",
            "웨딩베일": "웨딩 베일 (코스튬)", "웨딩셋": "웨딩 세트 (코스튬)", "밀크폼고양이": "밀크폼 고양이 (코스튬)", "밀크폼": "밀크폼 고양이 (코스튬)",
            # 풍림 영웅 코스튬 4종 (정관·풍운의·운갑·운화, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04). 풍림혈운백하는 세 코스튬 이름을 붙여 쓴 것
            "풍림": "풍림 (코스튬)", "풍림셋": "풍림 세트 (코스튬)", "풍림정관": "풍림의 정관 (코스튬)", "풍림모": "풍림의 정관 (코스튬)",
            "풍림풍운의": "풍림의 풍운의 (코스튬)", "풍림옷": "풍림의 풍운의 (코스튬)", "풍림갑": "풍림의 풍운의 (코스튬)", "풍림운갑": "풍림의 운갑 (코스튬)",
            "풍림장": "풍림의 운갑 (코스튬)", "풍림장갑": "풍림의 운갑 (코스튬)", "풍림신": "풍림의 운화 (코스튬)", "풍림신발": "풍림의 운화 (코스튬)",
            "풍림운화": "풍림의 운화 (코스튬)",
            # 혈운 영웅 코스튬 4종 (주관·화복·수호·심운화, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "혈운": "혈운 (코스튬)", "혈운셋": "혈운 세트 (코스튬)", "혈운주관": "혈운의 주관 (코스튬)", "혈운모": "혈운의 주관 (코스튬)",
            "혈운화복": "혈운의 화복 (코스튬)", "혈운옷": "혈운의 화복 (코스튬)", "혈운갑": "혈운의 화복 (코스튬)", "혈운수호": "혈운의 수호 (코스튬)", "혈운장": "혈운의 수호 (코스튬)",
            "혈운장갑": "혈운의 수호 (코스튬)", "혈운심운화": "혈운의 심운화 (코스튬)", "혈운신": "혈운의 심운화 (코스튬)", "혈운신발": "혈운의 심운화 (코스튬)",
            # 백하 영웅 코스튬 4종 (진관·협의·천운수·협운화, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "백하": "백하 (코스튬)", "백하셋": "백하 세트 (코스튬)", "백하진관": "백하의 진관 (코스튬)", "백하모": "백하의 진관 (코스튬)",
            "백하협의": "백하의 협의 (코스튬)", "백하옷": "백하의 협의 (코스튬)", "백하갑": "백하의 협의 (코스튬)", "백하천운수": "백하의 천운수 (코스튬)", "백하장": "백하의 천운수 (코스튬)",
            "백하장갑": "백하의 천운수 (코스튬)", "백하협운화": "백하의 협운화 (코스튬)", "백하신": "백하의 협운화 (코스튬)", "백하신발": "백하의 협운화 (코스튬)",
            "풍림혈운백하": "풍림·혈운·백하 (코스튬)", "백하코스튬무기방어구세트": "백하 세트 (코스튬)",
            # 아비서스 영웅 코스튬 4종 (앤틀러·비늘·건틀릿·스케일파지, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "아비서스": "아비서스 (코스튬)", "아비서스셋": "아비서스 세트 (코스튬)", "아비서스앤틀러": "아비서스의 앤틀러 (코스튬)",
            "아비서스모": "아비서스의 앤틀러 (코스튬)", "아비서스비늘": "아비서스의 비늘 (코스튬)", "아비서스옷": "아비서스의 비늘 (코스튬)", "아비서스갑": "아비서스의 비늘 (코스튬)",
            "아비서스건틀릿": "아비서스의 건틀릿 (코스튬)", "아비서스장": "아비서스의 건틀릿 (코스튬)", "아비서스장갑": "아비서스의 건틀릿 (코스튬)",
            "아비서스스케일파지": "아비서스의 스케일파지 (코스튬)", "아비서스신": "아비서스의 스케일파지 (코스튬)", "아비서스신발": "아비서스의 스케일파지 (코스튬)",
            # 세라픽 영웅 코스튬 4종 (크레스트·흉골·건틀릿·윙본그리브, 캐쉬샵 기간 한정. 제작자 도감 스샷 2026-11-04)
            "세라픽": "세라픽 (코스튬)", "세라픽셋": "세라픽 세트 (코스튬)", "세라픽크레스트": "세라픽의 크레스트 (코스튬)",
            "세라픽모": "세라픽의 크레스트 (코스튬)", "세라픽흉골": "세라픽의 흉골 (코스튬)", "세라픽옷": "세라픽의 흉골 (코스튬)", "세라픽갑": "세라픽의 흉골 (코스튬)",
            "세라픽건틀릿": "세라픽의 건틀릿 (코스튬)", "세라픽장": "세라픽의 건틀릿 (코스튬)", "세라픽장갑": "세라픽의 건틀릿 (코스튬)",
            "세라픽윙본그리브": "세라픽의 윙본그리브 (코스튬)", "세라픽신": "세라픽의 윙본그리브 (코스튬)", "세라픽신발": "세라픽의 윙본그리브 (코스튬)",
            "펌프퀸": "펌프퀸 (코스튬)",  # 영웅 코스튬 (제작자 도감 스샷 2026-11-04)
            "포우버스터": "포우 버스터 (코스튬)", "포우": "포우 버스터 (코스튬)", "보석의기사": "보석의기사 (코스튬)",  # 영웅 코스튬 (제작자 도감 스샷 2026-11-04)
            # 드롤·게올 = 영웅 코스튬 4부위 세트, 회바 = 회색바위 Lv.24 전사 3종 세트 (제작자 도감 스샷 2026-11-04)
            "드롤모": "드롤의모자 (코스튬)", "드롤갑": "드롤 갑옷 (코스튬)", "드롤장": "드롤 장갑 (코스튬)", "드롤신": "드롤 신발 (코스튬)", "드롤셋": "드롤 세트 (코스튬)",
            "게올모": "게올의모자 (코스튬)", "게올갑": "게올 갑옷 (코스튬)", "게올장": "게올 장갑 (코스튬)", "게올신": "게올 신발 (코스튬)", "게올셋": "게올 세트 (코스튬)",
            "에이무": "A등급 무기마법서", "에이갑": "A등급 갑옷마법서",
            # 마법서: 스 = S등급, 에 = A등급, 갑 = 갑옷마법서, 무 = 무기마법서 (제작자 설명). 거불 = 거래불가, 거가 = 거래가능
            "스갑": "S등급 갑옷마법서", "스무": "S등급 무기마법서", "에갑": "A등급 갑옷마법서", "에무": "A등급 무기마법서",
            "SS무": "SS등급 무기마법서", "SS갑": "SS등급 갑옷마법서", "거불스무": "S등급 무기마법서 (거래불가)", "거불스갑": "S등급 갑옷마법서 (거래불가)",
            "거가스무": "S등급 무기마법서 (거래가능)", "거가스갑": "S등급 갑옷마법서 (거래가능)",
            "고주": "고대의 주화", "고대의주화": "고대의 주화",
            # 제작자 2026-11-10 (11/10 PC 내보내기에서 처음 나온 말)
            "S갑": "S등급 갑옷마법서", "S무": "S등급 무기마법서", "A갑": "A등급 갑옷마법서", "A무": "A등급 무기마법서",
            "스무S무": "S등급 무기마법서", "에이무A무": "A등급 무기마법서", "스갑S갑": "S등급 갑옷마법서",
            "명팬": "명예의 팬던트", "명예의팬던트": "명예의 팬던트", "수주": "수인의 주화", "수인의주화": "수인의 주화",
            "자라한통": "자라의노래 (20개)", "쿠라다": "쿠라다 (가방)", "제피르4셋": "제피르 세트", "제피르4세트": "제피르 세트", "제피르셋": "제피르 세트",
            # 톡방의 코스튬 목록 '천날(15), 요정날개(8), 분노(8), 신속(8), 공포(6), 해적왕(8), 스나이퍼(8), 강탈(8), 집중(7), 화염마법사(5), 꿈의형태(3.5)'와
            # '흑마법사 요정의날개 등 레어코튬 다수', '펌프킹(3.5장)' (펌프퀸과 짝). 악마소환사는 흑마법사·화염마법사와 같은 이름 꼴이라 코스튬으로 본다
            **{k: f"{k} (코스튬)" for k in ("공포", "신속", "강탈", "해적왕", "집중", "흑마법사", "화염마법사", "악마소환사", "꿈의형태", "펌프킹", "악마날개")},
            "요정날개": "요정의날개 (코스튬)", "요정의날개": "요정의날개 (코스튬)"}


def _norm_name(name: str) -> str:
    s = re.sub(r"\[.*?\]|\(.*?\)|/", "", name)
    s = re.sub(r"^\+\d+", "", s)
    return re.sub(r"\s+", "", s)


def load_wiki_names() -> dict[str, str]:
    """위키 아이템 이름: 띄어쓰기와 꼬리표를 뺀 모양 -> 원래 이름 (화면이 wiki.items[이름] 으로 그림을 찾는다)"""
    if not ITEMS_JSON.exists():
        return {}
    names = json.loads(ITEMS_JSON.read_text(encoding="utf-8")).keys()
    out: dict[str, str] = {}
    for n in sorted(names, key=lambda n: (n.startswith("+"), len(n))):
        out.setdefault(_norm_name(n), n)
    return out


def _word_starts(norm: str) -> set[int]:
    starts = {0}
    for m in re.finditer(r"[의한된는린진]", norm):
        if m.end() < len(norm):
            starts.add(m.end())
    return starts


def _subseq(parts: list[str], norm: str, anchored: bool) -> float | None:
    """줄임말 글자들이 이름에 차례로 나오면 점수(높을수록 좋음), 아니면 None"""
    pos = 0
    hit = 0
    starts = _word_starts(norm)
    for k, part in enumerate(parts):
        i = norm.find(part, pos)
        if i < 0 or (anchored and k == 0 and i != 0):
            return None
        if i in starts:
            hit += 1
        pos = i + len(part)
    exact = sum(len(p) for p in parts) == len(norm)
    prefix = norm.startswith("".join(parts))
    if len(parts) == 2 and not (prefix or hit == len(parts)):
        return None  # 두 글자 줄임말은 앞글자이거나(대천 = 대천사) 낱말 첫 글자만 뽑은 것(의망 = 의지의 망토)만
    return (3 if exact else 0) + (1 if prefix else 0) + hit / len(parts) + (1 if anchored else 0) - len(norm) / 100


class Resolver:
    def __init__(self) -> None:
        self.names = load_wiki_names()
        self.cache: dict[str, str | None] = {}
        self.unknown: dict[str, int] = defaultdict(int)

    def resolve(self, abbr: str) -> str | None:
        """줄임말 -> 위키 아이템 이름. 못 찾으면 None"""
        if abbr in ALIASES:
            return ALIASES[abbr]
        if abbr in self.cache:
            return self.cache[abbr]
        parts = [SQUEEZE.get(ch, ch) for ch in abbr]
        best: list[tuple[float, str]] = []
        for norm, orig in self.names.items():
            if abbr == norm:
                best = [(99, orig)]
                break
            sc = _subseq(parts, norm, True)
            if sc is None and len(parts) >= 3:
                sc = _subseq(parts, norm, False)
            if sc is not None:
                best.append((sc, orig))
        best.sort(reverse=True)
        found = None
        if best and (len(best) == 1 or best[0][0] - best[1][0] > 0.05):
            found = best[0][1]
        self.cache[abbr] = found
        return found


def to_manwon(num: str, unit: str) -> float | None:
    v = float(num.replace(",", "."))
    if unit in ("장", "콩", "만원"):
        return v
    if unit.startswith("만"):  # 만 골드
        return v / USUAL_RATE
    if unit == "":  # 단위 없음: 현금 만 원, 크면 만 골드
        return v if v < BARE_GOLD_FROM else v / USUAL_RATE
    return None


def norm_opt(word: str) -> str | None:
    m = OPT_RE.match(word)
    if not m:
        return None
    name = OPTS[m.group(1)]
    raw = m.group(2)
    v = float(KNUM[raw]) if raw in KNUM else float(raw)
    if name in ("체력", "마나") and 1 <= v <= 3:
        v *= 10
    return f"{name}{v:g}"


def _enh_value(m: re.Match) -> int:
    g = m.group(1)
    return KNUM[g] if g in KNUM else int(g)


def parse_line(line: str, rs: Resolver) -> dict | None:
    """'명9 힘7 팔닼소 38' -> {name, wiki, enh, opts, price, abbr}. 가격이나 물건이 없으면 None"""
    if re.match(r"\s*아드\s?\d", line):
        return None  # '아드24.6/23.95' = 계정 글의 아이템 드랍율 / 골드 드랍율 (제작자 2026-11-04). 물건이 아니다
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", line)
    s = NUMBERING.sub("", s.strip())
    s = re.sub(r"[•■□▶\-–—ㅡ·*~♡❤️🤍,/:]", " ", s)
    s = re.sub(r"(?<=\S)(or|OR|혹은)(?=\S)", " or ", s)
    s = re.sub(r"(?<![가-힣])(" + OPT_KEYS + r") (?=\d)", r"", s)  # '체 446' -> '체446'
    words = s.split()
    if not words:
        return None
    # 가격: 단위 붙은 것 중 현금(장, 콩) 우선, 없으면 만 골드, 없으면 맨 뒤 단위 없는 숫자
    bare: float | None = None
    priced = [(i, PRICE.fullmatch(w)) for i, w in enumerate(words)]
    priced = [(i, m) for i, m in priced if m]
    if priced:
        cash = [(i, m) for i, m in priced if m.group(2) in ("장", "콩", "만원")]
        _i, m = (cash or priced)[-1]
        price = to_manwon(m.group(1), m.group(2))
        drop = {i for i, _ in priced}
        rest = [w for j, w in enumerate(words) if j not in drop]
    elif re.fullmatch(r"\d+(?:\.\d+)?", words[-1]) and len(words) >= 2:
        price = to_manwon(words[-1], "")
        bare = float(words[-1])
        rest = words[:-1]
    else:
        return None
    if price is None or price < 0.01 or price > 3000:
        return None
    rest = [w for w in rest if w not in ("or", "OR", "혹은", "ㅍ", "ㅍㅍ", "ㅅ", "ㅅㅅ")]
    opts: list[str] = []
    names: list[str] = []
    enh_word = 0
    num_words: list[str] = []  # 따로 떨어진 숫자들
    lead_digits = ""  # 이름 앞에 붙은 옵션 숫자 ('35칠데조', '434팔윙', '236설신')
    costume = False
    for w in rest:
        if w in SKIP_WORDS or SELL.fullmatch(w) or BUY.fullmatch(w):
            continue
        if re.search(r"(플톡|풀톡|프로필톡)$", w):
            continue  # '표표플톡' = 프로필톡 (카카오톡 오픈채팅의 프로필로 연락, 제작자 2026-11-04). 물건 이름이 아니다
        om = re.fullmatch(r"옵(?:션)?(\d{2,4})", w)
        if om:  # '팔윙 옵333' = 옵션을 위키 순서대로 한 자리씩 (num_opts)
            lead_digits = om.group(1)
            continue
        if w in ("코튬", "코스튬"):
            costume = True  # '활발한 강아지 코튬' = 활발한 강아지라는 코스튬
            continue
        o = norm_opt(w)
        if o:
            opts.append(o)
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?%?", w):
            if re.fullmatch(r"\d{1,4}", w):
                num_words.append(w)  # 옵션을 숫자만으로 적은 것 ('3 1 10 엘프의덧신', '35 칠데조'): 물건을 찾은 뒤 위키 옵션 순서로 (num_opts)
            continue
        em = re.fullmatch(r"\+?(\d{1,2}|[오육칠팔구십])강", w) or re.fullmatch(r"\+(\d{1,2})", w)
        if em:  # '6강', '육강' (제작자 지적), 따로 떨어진 '+6'
            enh_word = KNUM.get(em.group(1)) or int(em.group(1))
            continue
        if re.search(r"[가-힣a-zA-Z]", w):
            w = re.sub(r"팝니다|삽니다|판매|구매|노강|노작", "", w)
            w = re.sub(r"(?<=[가-힣A-Za-z])\d+(개|천골|만골)$", "", w)  # '명팬500개', '수주4천골': 개수·값 꼬리
            w = re.sub(r"^(\+?(?:\d{1,2}|[오육칠팔구십]))강(?=[가-힣])", r"\1", w)  # '6강바슬신' -> '6바슬신'
            # 이름 앞의 옵션 숫자 한 자리씩 (제작자 2026-11-10 '35칠데조 이런 식으로 3 5 있는 건 옵션이야, 순서대로'): 뒤에 한글 강화(칠, 팔)가 오거나,
            # 세 자리 이상이거나, 두 자리인데 20 넘으면(강화가 아니다) 옵션. '8헌보', '10헌보', '12번보석셋' 은 그대로
            lm = re.match(r"^(\d{2,4})(?=[오육칠팔구십][가-힣]|[가-힣])", w)
            if lm and "번" not in w[lm.end():lm.end() + 1] and (
                re.match(r"[오육칠팔구십][가-힣]", w[lm.end():]) or len(lm.group(1)) >= 3 or int(lm.group(1)) > 20
            ):
                lead_digits = lm.group(1)
                w = w[lm.end():]
            while True:  # 이름 앞에 붙은 옵션 ('지3대자')
                g = OPT_GLUED.match(w)
                if not g:
                    break
                o = norm_opt(g.group(0))
                if not o:
                    break
                opts.append(o)
                w = w[g.end():]
            if re.fullmatch(r"\+?(?:\d{1,2}|[오육칠팔구십])?닼", w):  # '8닼', '팔닼' = +8 다크스틸소드 (제작자 2026-11-04)
                names.append(w)
                continue
            if w not in NON_WIKI and w not in ALIASES and len(re.sub(r"[^가-힣a-zA-Z]", "", STAT_RE.sub("", w))) < 2:
                continue  # 스펙 말만 남음
            if w:
                names.append(w)
    if not names:
        return None

    def job_hint(group: str) -> str | None:
        """줄에서 직업: 묶음의 옵션 표(GROUP_STAT_JOB)로 하나만 남으면 그 직업, 아니면 줄의 직업 말"""
        job = pick_job(group, opts)
        if job:
            return job
        jm = JOB_IN_LINE.search(line)
        return GROUP_JOB[jm.group(0)] if jm else None

    def try_group(w: str) -> tuple[str, str, int, bool] | None:
        """직업마다 이름이 다른 장비 묶음 (JOB_GROUPS) -> (이름, 줄임말, 강화, 위키에 있는지)"""
        c = re.sub(r"[^가-힣a-zA-Z0-9+]", "", w)
        m = GROUP_RE.fullmatch(c)
        if not m:
            return None
        enh = 0
        for e in (m.group(1), m.group(3)):
            if e:
                e = e.lstrip("+")
                enh = KNUM.get(e) or int(e)
        label, by_job = JOB_GROUPS[m.group(4)]
        key = next(k for k in ("세계수갑", "바슬신", "아요장", "금서고신") if JOB_GROUPS[k] is JOB_GROUPS[m.group(4)])
        job = GROUP_JOB.get(m.group(2) or "") or job_hint(key)
        if job is None and key == "세계수갑":
            job = "레인저"  # 옵션으로 못 가르면(크리만, 옵션 없음) 보통 레인저 것 (유어 2026-11-04 '보통 그런 건 렌이에요')
        if m.group(4) in ("아요장", "아이요장", "아이요장갑") and not enh and not enh_word and job is None and all(o.startswith("체력") for o in opts):
            # 강화·직업·장비 옵션이 하나도 없으면 아이요 코스튬 장갑 (유어 2026-11-04: '아요셋 사요'는 코스튬, '육아요장'은 +6 장비)
            return "아이요의장갑 (코스튬)", m.group(4), 0, False
        name = by_job.get(job or "")
        if name:
            return (rs.names.get(_norm_name(name)) or NON_WIKI.get(name, name)), m.group(4), enh, _norm_name(name) in rs.names
        return label, m.group(4), enh, False

    def try_word(w: str) -> tuple[str, str, int] | None:
        """낱말 하나 -> (위키 이름, 줄임말, 강화). 통째로 먼저, 안 되면 앞의 강화 숫자(8헌보, 팔닼소)를 떼고"""
        if re.fullmatch(r"\+?(6|육)강?장", w):  # '명8 육강장' = 명중 8 의 +6 강화가죽장갑 (제작자 2026-11-04: 명중에 따라 값이 천차만별)
            return "강화가죽장갑", w, 6
        m = ENHANCE_RE.match(w)
        tries = [(w, None)] + ([(w[m.end():], m)] if m else [])
        if m:  # '35칠데조' (옵션 숫자 뒤에 '칠' 강화): 한 번 더 뗀다
            m2 = ENHANCE_RE.match(w[m.end():])
            if m2:
                tries.append((w[m.end():][m2.end():], m2))
        for c, em in tries:
            c = re.sub(r"[^가-힣a-zA-Z0-9]", "", c)
            if (len(c) < 2 and c not in ("닼", "윙")) or c in NOT_ITEM_WORDS:
                continue
            found = rs.resolve(c)
            if found:
                return found, c, (_enh_value(em) if em else 0)
        return None

    joined = "".join(names)
    pm = PET_RE.match(re.sub(r"[^가-힣]", "", joined))
    if pm:
        pet = PET_WORDS.get(pm.group(1), pm.group(1))
        return {"name": "펫", "wiki": False, "enh": 0, "opts": opts, "price": round(price, 2), "bare": bare, "abbr": joined, "pet": pet}
    gs = GEMSET.match(joined)
    if gs:  # '12번보석셋' = 1, 2번 보석이 있는 세트 (제작자 설명). 앞 숫자는 강화가 아니다
        name = "·".join(gs.group(1)) + "번 보석 세트"
        return {"name": name, "wiki": False, "enh": 0, "opts": opts, "price": round(price, 2), "abbr": joined}
    for w in [joined] + (names if len(names) > 1 else []):
        sb = skill_book(w, rs)
        if sb:
            return {"name": sb[0], "wiki": sb[1], "enh": 0, "opts": opts, "price": round(price, 2), "bare": bare, "abbr": w}
    for w in [joined] + (names if len(names) > 1 else []):
        g = try_group(w)
        if g:
            name, abbr, enh, wiki = g
            enh = enh or enh_word
            return {"name": name, "wiki": wiki, "enh": enh if enh <= 20 else 0, "opts": opts, "price": round(price, 2), "bare": bare, "abbr": abbr}
    hit = try_word(joined)
    if not hit and len(names) > 1:
        for w in names:  # 물건이 둘이거나 설명 말이 섞였을 때: 낱말 하나씩
            hit = try_word(w)
            if hit:
                break
    unknown = False
    if hit:
        name, abbr, enh = hit
        wiki = True
        sm = re.fullmatch(r"(.+?)(\d)", name)
        if sm and sm.group(1) in SKILLS:  # 위키 아이템 '텔레포트2' = 스킬북 -> '텔레포트 2단' (스킬 아이콘)
            sk = SKILLS[sm.group(1)]
            name = f"{sk['name']} {sm.group(2)}단"
            SKILL_ICONS[name] = sk["icon"]
    else:
        # 위키에 없는 물건: 줄임말 그대로 (강화 숫자는 떼어 둔다)
        m = ENHANCE_RE.match(joined)
        c = joined[m.end():] if m and len(joined) - m.end() >= 2 else joined
        c = re.sub(r"[^가-힣a-zA-Z0-9]", "", c)
        if len(c) < 2 or len(c) > 12 or not re.search(r"[가-힣a-zA-Z]{2}", c) or NOT_ITEM.search(c) or c in NOT_ITEM_WORDS or CHAR_TOKEN.search(c):
            return None
        enh = _enh_value(m) if m and c != joined else 0
        abbr = c
        name = NON_WIKI.get(c, c)
        wiki = False
        if c not in NON_WIKI and costume:
            if re.search(r"\d|각각|하나만|아무거나|제외|패키지|합쳐", c):
                return None  # '장갑신발 코튬 각각', '패키지 코튬 하나만': 이름이 아닌 설명
            name = c + " (코스튬)"  # 이름을 그대로 적은 코스튬: 줄임말이 아니다
        elif c not in NON_WIKI:
            rs.unknown[c] += 1
            unknown = True
    enh = enh or enh_word
    if wiki and not opts:
        opts = num_opts(name, lead_digits, num_words)
    # unknown: 아무도 풀지 못한 것만 화면의 '정보 없음' (예전 이름 '모르는 줄임말') (제작자 2026-11-04: 알려 준 펫·완망·아드셋·코스튬이 아직 거기 있었다)
    return {"name": name, "wiki": wiki, "unknown": unknown, "enh": enh if enh <= 20 else 0, "opts": opts, "price": round(price, 2), "bare": bare, "abbr": abbr}


EQUIP_JSON = ROOT / "web" / "public" / "data" / "equipment.json"
# 위키 옵션 이름 -> 시세 동향 옵션 이름 (OPTS 의 값)
WIKI_STAT = {"크리티컬": "크리", "속성저항": "속저", "마나재생": "마재", "체력재생": "체재", "이동속도": "이속", "불저항": "불저", "냉기저항": "냉저", "번개저항": "번저"}
_RANGE_OPTS: dict[str, tuple[list[str], str]] | None = None
NUM_MISMATCH: dict[str, list[str]] = {}
_RANGE_MAX: dict[tuple[str, str], int] = {}
# 숫자만 적을 때 그 물건에 쓸모 있는 옵션(유효옵)만 적은 것: 물건마다 다르다 (제작자 2026-11-10 '유효옵만 적은 거라 레인저는 마재 빼고 크리 3 민 5',
# '템마다 다를 듯 해서 그때그때 물어봐'). 확인받은 물건만 적고, 없는 물건은 숫자 수가 위키 옵션 수와 맞을 때만 읽는다
EFFECTIVE_OPTS = {
    "데조르바의보우": ["크리", "민첩"],  # 35칠데조 = 크리3 민첩5 (마재는 안 적음)
}


def range_opts(name: str) -> tuple[list[str], str]:
    """위키 장비의 범위 옵션 이름들(위키 순서대로, '명중 0~12 / 힘 0~9' -> ['명중', '힘'])과 직업"""
    global _RANGE_OPTS
    if _RANGE_OPTS is None:
        _RANGE_OPTS = {}
        if EQUIP_JSON.exists():
            for table in json.loads(EQUIP_JSON.read_text(encoding="utf-8")):
                hs = table.get("headers", [])
                if "옵션" not in hs:
                    continue
                k = hs.index("옵션")
                for row in table.get("rows", []):
                    cells = row.get("cells", [])
                    if k >= len(cells):
                        continue
                    stats = []
                    for part in cells[k].split("/"):
                        m = re.match(r"\s*([가-힣]+)\s*[\d\s&~]*~\s*(\d+)", part)
                        if m:
                            st = WIKI_STAT.get(m.group(1), m.group(1))
                            stats.append(st)
                            _RANGE_MAX[(re.sub(r"\s", "", row.get("name", "")), st)] = int(m.group(2))
                    job = cells[hs.index("직업")] if "직업" in hs and hs.index("직업") < len(cells) else ""
                    _RANGE_OPTS.setdefault(re.sub(r"\s", "", row.get("name", "")), (stats, job))
    return _RANGE_OPTS.get(re.sub(r"\s", "", name), ([], ""))


def num_opts(name: str, lead: str, words: list[str]) -> list[str]:
    """숫자만 적은 옵션을 위키 옵션 순서로 (제작자 2026-11-10 '35칠데조' = 첫 옵션 3, 둘째 옵션 5). 수가 옵션 수와 맞을 때만, 아니면 짐작하지 않고 뺀다"""
    stats, job = range_opts(name)
    if not stats:
        return []
    if not lead and len(words) == 1 and len(words[0]) >= 2:
        lead, words = words[0], []  # '4311 5광부', '35 칠데조': 따로 떨어진 숫자 하나도 한 자리씩
    n = len(lead) if lead else (len(words[0]) if len(words) == 1 and len(words[0]) >= 2 else len(words))
    eff = EFFECTIVE_OPTS.get(re.sub(r"\s", "", name))
    if n != len(stats) and eff and len(eff) == n:
        stats = eff  # 그 물건에 쓸모 있는 옵션만 적은 것 ('35칠데조' = 크리3 민첩5, 마재는 안 적음)
    elif n != len(stats) and n and not (lead and len(lead) > len(stats)):
        NUM_MISMATCH.setdefault(name, []).append(lead or " ".join(words))  # 물어볼 것 (--unknown 에 찍는다)
    if lead and len(lead) > len(stats):
        # '4311 5광부' = 불저4 힘3 이속11: 두 자리 값이 섞이면 위키 옵션 범위에 맞게 나뉘는 길이 하나뿐일 때만
        key = re.sub(r"\s", "", name)
        def splits(rest: str, k: int) -> list[list[str]]:
            if k == 0:
                return [[]] if not rest else []
            out = []
            for n in (1, 2):
                if len(rest) >= n and not (n == 2 and rest[0] == "0"):
                    out += [[rest[:n]] + t for t in splits(rest[n:], k - 1)]
            return out
        ok = [sp for sp in splits(lead, len(stats)) if all(int(v) <= _RANGE_MAX.get((key, st), 99) for v, st in zip(sp, stats))]
        if len(ok) != 1:
            NUM_MISMATCH.setdefault(name, []).append(lead)
            return []
        vals = ok[0]
    elif lead:
        vals = list(lead)
    elif len(words) == 1 and len(words[0]) == len(stats) and len(stats) >= 2:
        vals = list(words[0])  # '35 칠데조'
    elif len(words) == len(stats):
        vals = words  # '3 1 10 엘프의덧신'
    else:
        return []
    if len(vals) != len(stats):
        return []
    out = []
    for st, v in zip(stats, vals):
        o = norm_opt(f"{st}{v}")
        out.append(o or f"{st}{int(v)}")
    return out
# 직업마다 이름이 다른 장비를 하나로 부르는 말 (유어 설명 2026-11-04, 제작자 1:1 카톡): 바슬신 = 바슬라프 상자에서 나오는 Lv.44 신발,
# 세계갑·세계수갑·뿌리갑·뿌갑 = 모르포시즈 정원(뿌리)의 베로에게서 교환하는 Lv.44 갑옷이라 뿌리갑 (제작자 2026-11-04. 법사는 보통 세계수롭, 껍갑은 전사), 금서고신 = 금서고 Lv.46 신발 (법사 것은 기억단화),
# 아요장 = 모르포시즈 뿌리의 아이요의수호병이 떨구는 Lv.46 장갑 (아요셋·아이요의장갑은 코스튬, 육아요장은 +6 장비). 이름은 위키 장비 표의 직업·레벨로 맞췄다.
# 직업은 줄의 직업 말(전사아요장, 5렌저아요장, 법사 바슬신)이나 옵션으로 고른다 (유어 '힘2 세계갑이면 껍갑', 제작자 도감 스샷 2026-11-04 의 옵션 이름:
# 세계갑 껍질 힘 · 가지 크리 · 잎로브 지능·마나 · 도복 크리, 바슬신 광전사 힘 · 설원추적 민첩 · 빛새김 지능 · 바다 지능, 아요장 수호병 명중·크리·힘 · 연격 명중·크리·민첩 ·
# 환영술사 마나·마재·지능 · 연속공격 명중·힘·지능). 어느 쪽인지 가를 수 없는 옵션(크리만, 바슬신·아요장의 지능만)은 두지 않고, 모르면 묶음 이름 그대로 센다 (위키 그림 없음).
JOB_GROUPS: dict[str, tuple[str, dict[str, str]]] = {
    "바슬신": ("바슬신 (Lv.44 신발)", {"전사": "광전사의부츠", "레인저": "설원추적자장화", "마법사": "빛새김의신발", "무도가": "바다의장화"}),
    "세계수갑": ("세계수갑 (Lv.44 갑옷)", {"전사": "세계수껍질갑옷", "레인저": "세계수가지갑옷", "마법사": "세계수잎로브", "무도가": "세계수도복"}),
    # 금서고신 = 모르포시즈 금서고의 연구자 아이데아 교환 Lv.46 신발 (제작자 도감 스샷 2026-11-04: 발자국 힘 · 덧신 민첩 · 끈질긴 기억의 단화 지능 · 극한의 발걸음 지능)
    "금서고신": ("금서고신 (Lv.46 신발)", {"전사": "금서고의 발자국", "레인저": "엘프의 덧신", "마법사": "끈질긴 기억의 단화", "무도가": "극한의 발걸음"}),
    "아요장": ("아요장 (아이요 Lv.46 장갑)", {"전사": "수호병의손껍질", "레인저": "연격의장갑", "마법사": "환영술사의장갑", "무도가": "연속공격의장갑"}),
}
for _a, _k in [("세계갑", "세계수갑"), ("뿌리갑", "세계수갑"), ("뿌갑", "세계수갑"), ("금서고신발", "금서고신"), ("서고신", "금서고신"), ("아이요장", "아요장"), ("아이요장갑", "아요장")]:
    JOB_GROUPS[_a] = JOB_GROUPS[_k]
GROUP_JOB = {"전사": "전사", "전": "전사", "렌저": "레인저", "레인저": "레인저", "렌": "레인저", "법사": "마법사", "마법사": "마법사", "법": "마법사",
             "무도가": "무도가", "무도": "무도가", "무": "무도가"}
GROUP_RE = re.compile(r"^(\+?(?:\d{1,2}|[오육칠팔구십]))?(전사|렌저|레인저|법사|마법사|무도가|무도|[전렌법무])?(\+?(?:\d{1,2}|[오육칠팔구십]))?("
                      + "|".join(sorted(JOB_GROUPS, key=len, reverse=True)) + r")$")
JOB_IN_LINE = re.compile(r"전사|렌저|레인저|법사|마법사|무도가")
# 묶음마다 직업을 가르는 옵션 (옵션 하나로 한 직업만 남을 때만)
GROUP_STAT_JOB = {
    "세계수갑": {"힘": "전사", "민첩": "레인저", "지능": "마법사", "마나": "마법사"},
    # 지능은 마법사(빛새김)·무도가(바다) 둘 다 붙지만 톡방에서 지능 바슬신은 법사 장화로 읽는다 (제작자 2026-11-04 '문맥을 봐, 지능 붙었잖아')
    "바슬신": {"힘": "전사", "민첩": "레인저", "지능": "마법사", "마나": "마법사"},
    "아요장": {"민첩": "레인저", "지능": "마법사", "마나": "마법사"},  # 힘은 전사·무도가: 힘+지능 = 무도가, 힘+크리 = 전사 (pick_job)
    "금서고신": {"힘": "전사", "민첩": "레인저", "지능": "마법사", "마나": "마법사"},  # 지능은 바슬신처럼 법사 것으로 (제작자 2026-11-04)
}


def pick_job(group: str, opts: list[str]) -> str | None:
    """옵션 이름으로 묶음 안의 직업을 고른다. 못 가르면 None"""
    stats = {re.sub(r"[\d.]+%?$", "", o) for o in opts}
    if "힘" in stats and "지능" in stats:
        return "무도가" if group == "아요장" else None  # 연속공격의장갑만 힘과 지능이 같이
    if group == "아요장" and "힘" in stats and "크리" in stats:
        return "전사"  # 수호병의손껍질
    table = GROUP_STAT_JOB[group]
    jobs = {table[k] for k in stats if k in table}
    return jobs.pop() if len(jobs) == 1 else None
# 게임 규칙 (CLAUDE.md 중개인): 강화는 갑옷, 주장비(무기), 투구, 보조장비, 장갑, 신발만, 속성부여는 벨트, 망토, 목걸이, 반지만
ENCHANT_SLOTS = ("망토", "벨트", "목걸이", "반지")
ENHANCE_SLOTS = ("무기", "보조 장비", "투구", "갑옷", "장갑", "신발")
MAIN_STATS = ("힘", "민첩", "지능")  # 제작자: 힘, 민, 지가 주요 스탯. '지능2 체력30' 은 지능2 로 묶는다
ENCHANT_RE = re.compile(r"^(힘|민첩|지능)([123])$|^(체력|마나)(10|20|30)$")


def load_kinds() -> dict[str, str]:
    """위키 장비 이름 -> 'enchant' (속성부여 되는 부위) / 'enhance' (강화 되는 부위)"""
    if not EQUIP_JSON.exists():
        return {}
    out: dict[str, str] = {}
    for table in json.loads(EQUIP_JSON.read_text(encoding="utf-8")):
        slot = table["slot"]
        kind = "enchant" if any(k in slot for k in ENCHANT_SLOTS) else "enhance" if any(k in slot for k in ENHANCE_SLOTS) else ""
        if kind:
            for row in table["rows"]:
                out.setdefault(row["name"], kind)
    return out


def item_kind(name: str, xs: list[dict], kinds: dict[str, str]) -> str:
    """위키 장비는 부위로, 아니면 글에서 짐작: 강화 숫자가 있으면 enhance, 속성부여 옵션만 있으면 enchant, 둘 다 없으면 none"""
    if name in kinds:
        return kinds[name]
    if name == "펫":
        return "enchant"  # 펫 값은 속성강화로 정해진다 (제작자)
    if any(x["enh"] for x in xs):
        return "enhance"
    if any(ENCHANT_RE.match(o) for x in xs for o in x["opts"]):
        return "enchant"
    return "none"


EQUIP_WORD = re.compile(r"신발|장화|부츠|단화|덧신|발걸음|갑옷|경갑|장갑|손껍질|투구|모자|무기|검|소드|보우|활|지팡이|스태프|완드|방패|쉴드|회색바위 세트")
ACC_WORD = re.compile(r"벨트|망토|목걸이|반지|귀걸이|팔찌")


def item_cat(name: str, xs: list[dict], kind: str, kinds: dict[str, str]) -> str:
    """화면의 칸 (제작자 2026-11-04 '전체 장비 장신구 스킬북 코스튬 기타 이렇게 나누자'): 위키 장비는 부위로(강화 부위 = 장비, 속성부여 부위 = 장신구),
    스킬북, 코스튬은 이름으로, 위키에 없는 것은 강화 숫자나 이름의 부위 말로 짐작하고 나머지(보석, 재료, 마법서, 펫, 주화 …)는 기타"""
    if name in SKILL_ICONS or name.endswith("스킬북"):
        return "스킬북"
    if ("코스튬" in name or "코튬" in name) and "코인" not in name:
        return "코스튬"
    if name in kinds:
        return "장신구" if kinds[name] == "enchant" else "장비"
    if name == "펫" or "보석" in name or "마법서" in name:
        return "기타"
    if ACC_WORD.search(name):
        return "장신구"
    if EQUIP_WORD.search(name) or any(x["enh"] for x in xs):
        return "장비"
    return "기타"


def group_label(kind: str, x: dict) -> str:
    """속성부여 템은 주 스탯(힘·민첩·지능, 없으면 체력·마나)으로, 강화 템은 강화 단계로, 나머지는 하나로"""
    if kind == "enchant":
        ench = [o for o in x["opts"] if ENCHANT_RE.match(o)]
        main = [o for o in ench if o.startswith(MAIN_STATS)]
        return (main or ench or ["노작"])[0]
    if kind == "enhance":
        return f"+{x['enh']}" if x["enh"] else "노강"
    return "전체"


def resolve_bare(kind: str, xs: list[dict]) -> None:
    """단위 없는 숫자: 같은 묶음(없으면 같은 물건)에서 단위를 적은 글의 중간값에 가까운 쪽(만 원 / 만 골드)으로 다시 읽는다"""
    # 기준: 같은 묶음의 모든 값 (단위 없는 값은 일단 BARE_GOLD_FROM 규칙으로 읽은 것). 단위 적은 글 하나가 잘못돼도 다수를 따른다
    ref_group: dict[str, list[float]] = defaultdict(list)
    for x in xs:
        ref_group[group_label(kind, x)].append(x["price"])
    for x in xs:
        v = x.get("bare")
        if v is None:
            continue
        ref = ref_group[group_label(kind, x)]
        if len(ref) < 2:
            continue
        mid = statistics.median(ref)
        as_won, as_gold = v, v / USUAL_RATE
        pick = as_won if abs(math.log(as_won / mid)) <= abs(math.log(as_gold / mid)) else as_gold
        x["price"] = round(max(pick, 0.01), 2)


def group_sort_key(kind: str, g: dict) -> tuple:
    if kind == "enhance":  # 강화 센 것부터 (제작자 요청)
        return (0, -int(g["label"][1:])) if g["label"].startswith("+") else (1, 0)
    if kind == "enchant":  # 주 스탯 높은 것부터, 힘 민첩 지능 체력 마나 순
        m = ENCHANT_RE.match(g["label"])
        if m:
            stat = m.group(1) or m.group(3)
            val = int(m.group(2) or m.group(4))
            return (0 if stat in MAIN_STATS else 1, -val, ("힘", "민첩", "지능", "체력", "마나").index(stat))
        return (2, 0, 0)
    return (0, -g["n"])


def variant_label(enh: int, opts: list[str]) -> str:
    return " ".join(([f"+{enh}"] if enh else []) + opts)


def people(xs: list[dict], key: str = "price") -> list[dict]:
    """올린 사람마다 값의 중간값, 범위, 글 수, 마지막 날짜 (제작자 요청 2026-11-03: 누가 싸게 팔고 누가 비싸게 파는지). 싼 쪽부터"""
    by: dict[tuple, list[dict]] = defaultdict(list)
    for x in xs:
        by[(x["who"], x.get("tel", ""))].append(x)
    out = []
    for (who, tel), ys in by.items():
        vs = [y[key] for y in ys]
        out.append({"who": who, "tel": tel, "n": len(ys), "med": round(statistics.median(vs), 2), "min": min(vs), "max": max(vs),
                    "last": max(y["date"] for y in ys)})
    out.sort(key=lambda r: (r["med"], -r["n"]))
    return out


def item_prices(msgs: list[dict], last_week: str, rs: Resolver, side: str = "sell") -> list[dict]:
    """물건마다 묶음(groups: 속성부여 템은 주 스탯별, 강화 템은 강화 단계별)과 그 안의 강화·옵션 묶음(variants)별 (날짜, 만 원 가격) 모음.
    글 2개 이상인 물건만. 글 본문 한 줄과 닉네임을 보기로 남긴다"""
    kinds = load_kinds()
    items: dict[str, list[dict]] = defaultdict(list)
    for m in msgs:
        t = m["text"]
        msg_side = side_of(t.split("\n")[0]) or side_of(t)
        for line in t.split("\n"):
            if RATE.search(line) or ("골드" in line and side_of(line) and len(line) < 20):
                continue  # 골드 시세 글은 위에서 셌다
            p = parse_line(line, rs)
            if not p:
                continue
            p.update({"date": m["date"], "side": side_of(line) or msg_side or "sell", "who": m["who"], "tel": m["tel"],
                      "raw": re.sub(r"\s+", " ", line).strip()[:60]})
            if p["side"] != side:
                continue  # 파는 사람이 부른 값과 사는 사람이 부른 값은 따로 센다 (제작자 지적 2026-11-03)
            items[p["name"]].append(p)

    def summary(xs: list[dict]) -> dict:
        prices = [x["price"] for x in xs]
        recent = [x["price"] for x in xs if x["date"] >= last_week]
        before = [x["price"] for x in xs if x["date"] < last_week]
        by_day: dict[str, list[float]] = defaultdict(list)
        for x in xs:
            by_day[x["date"]].append(x["price"])
        samples, seen = [], set()
        for x in sorted(xs, key=lambda x: x["date"], reverse=True):
            if x["raw"] in seen:
                continue
            seen.add(x["raw"])
            samples.append({"date": x["date"], "price": x["price"], "who": x["who"], "tel": x["tel"], "raw": x["raw"]})
            if len(samples) >= 6:
                break
        return {
            "n": len(xs), "sellers": len({(x["who"], x["tel"]) for x in xs}), "people": people(xs),
            "sell": sum(1 for x in xs if x["side"] == "sell"), "buy": sum(1 for x in xs if x["side"] == "buy"),
            "med": round(statistics.median(prices), 2), "min": min(prices), "max": max(prices),
            "recent": round(statistics.median(recent), 2) if recent else None,
            "before": round(statistics.median(before), 2) if before else None,
            "first": min(x["date"] for x in xs), "last": max(x["date"] for x in xs),
            "days": [[d, round(statistics.median(v), 2)] for d, v in sorted(by_day.items())],
            "samples": samples,
        }

    out = []
    for name, xs in items.items():
        if len(xs) < (2 if side == "sell" else 1):
            continue
        kind = item_kind(name, xs, kinds)
        resolve_bare(kind, xs)
        by_group: dict[str, list[dict]] = defaultdict(list)
        for x in xs:
            by_group[group_label(kind, x)].append(x)
        groups = []
        for label, gx in by_group.items():
            by_var: dict[str, list[dict]] = defaultdict(list)
            for x in gx:
                vl = variant_label(x["enh"], x["opts"])
                if x.get("pet"):
                    vl = (vl + " · " if vl else "") + x["pet"]
                by_var[vl].append(x)
            variants = [{"label": vl, **summary(v)} for vl, v in by_var.items()]
            variants.sort(key=lambda v: (-v["n"], v["label"]))
            groups.append({"label": label, **summary(gx), "variants": variants})
        groups.sort(key=lambda g: group_sort_key(kind, g))
        variants = [v for g in groups for v in g["variants"]]
        variants.sort(key=lambda v: (-v["n"], v["label"]))
        abbrs: dict[str, int] = defaultdict(int)
        for x in xs:
            if x.get("pet"):
                abbrs[x["pet"]] += 1
            elif x["abbr"] != name.replace(" ", ""):
                abbrs[x["abbr"]] += 1
        out.append({"name": name, "wiki": xs[0]["wiki"], "unknown": all(x.get("unknown") for x in xs), "kind": kind,
                    "cat": item_cat(name, xs, kind, kinds),
                    "abbr": [a for a, _ in sorted(abbrs.items(), key=lambda kv: -kv[1])[:4]],
                    **summary(xs), "groups": groups, "variants": variants})
    out.sort(key=lambda it: (-it["sellers"], -it["n"], it["name"]))
    return out




# ---- 캐릭터 시세 (제작자 요청 2026-11-03) -------------------------------------------------------------------
# '캘' = 캐릭터만, '템통' = 템까지 통으로. '구올마' = 신규 스킬 패치 전 올 마스터, '신올마' = 신규 스킬까지 올 마스터 (제작자 설명).
# 한 줄짜리: '왕국 45 노도감 치격뺀 구올마전 12' (서버 레벨 설명 직업 가격). 긴 글: 서버, 레벨과 직업('53법', '49구올마전', '렙33 무도가'),
# 올마, 도감, 보석(333), 쟁캐, 캘/템통, 가격('캘 300장', '[ 왕국 쟁캐 200장 ]', '230장', '600 팝니다'). 장 = 만 원.
CHAR_HINT = re.compile(r"캘|캐릭|쟁캐|계정|몸\s?팝|몸\s?판|몸만|템통|도감|올마")
JOBS = {"전사": "전사", "전": "전사", "렌저": "레인저", "레인저": "레인저", "렌": "레인저", "법사": "법사", "마법사": "법사", "법": "법사",
        "무도가": "무도가", "무도": "무도가", "무": "무도가"}
JOB_WORD = r"(전사|렌저|레인저|법사|마법사|무도가|무도|전|렌|법|무)(?![가-힣])"
SERVER_WORD = r"(제국|왕국|시왕|시제)"
SERVERS = {"제국": "제국", "왕국": "왕국", "시왕": "왕국", "시제": "제국"}
# 한 줄에 다 적은 캐릭터: 서버? 레벨 (설명) 직업 가격
CHAR_LINE = re.compile(r"^(?:" + SERVER_WORD + r")?\s*(?:중립\s*)?(?<![\d.])([2-6]\d)\s?(?:랩|렙)?\s*([^\d\n]{0,18}?)" + JOB_WORD + r"\s+(\d{1,4}(?:\.\d)?)\s?(장|콩|만원)?\s*$")
LEVEL_JOB = re.compile(r"(?<![\d.%+])([2-6]\d)\s?(?:랩|렙|레벨)?\s?(?:[가-힣 ]{0,14}?)?" + JOB_WORD)
LEVEL_FIRST = re.compile(r"(?:랩|렙|레벨|Lv\.?|lv\.?)\s?([2-6]\d)(?![\d.])")
NOT_PRICE_AFTER = r"(?![\d:%.^]|\s?(?:렙|랩|레벨|렌|전|법|무|가방|개|보석|강|셋|퍼|단|이하|이상|%|,|/))"
CHAR_PRICE = re.compile(r"(?:(?<!쟁)캘|캐릭터?|쟁캐|쟁캘|계정|몸|통)\s?[^\n\d]{0,6}?(\d{1,4}(?:\.\d)?)\s?(장|콩|만원|만)?" + NOT_PRICE_AFTER)
UNIT_PRICE = re.compile(r"(?<![\d.])(\d{2,4})\s?(장|콩|만원)(?![가-힣])")
LINE_PRICE = re.compile(r"^\W*(\d{2,4})\s?(장|콩|만원)?\W*$")
PRICE_SELL = re.compile(r"(\d{2,4})\s?(?:장|콩|만원)?\)?\s?(?:에\s?)?(?:팝니다|판매|팔아요|선|안으로|이하|이내|까지)")
# 스킬 줄임말 (제작자 설명): 덥마렌 = 더블샷 4까지 배운 레인저, 와마 = 와일드스윙 마스터, 프마 = 프레임쇼크 마스터,
# 투쉴마 = 수호의기원 마스터 + 쉴드 마스터. 구올마 = 신규 스킬 패치 전 올 마스터, 신올마 = 신규 스킬까지 올 마스터
SKILL_WORDS = {"덥충멀마": "더블샷·충격샷·멀티샷 마스터", "덥충마": "더블샷·충격샷 마스터", "덥마": "더블샷 마스터", "충마": "충격샷 마스터",
               "멀샷마": "멀티샷 마스터", "멀마": "멀티샷 마스터", "와마": "와일드스윙 마스터", "프마": "프레임쇼크 마스터", "투쉴마": "수호의기원·쉴드 마스터",
               "쉴마": "쉴드 마스터", "휩마": "휩쓸기 마스터", "냉기마": "냉기부여 마스터", "전기마": "전기부여 마스터", "포아마": "포레스트아이 마스터",
               "파샷마": "파워샷 마스터", "소드마": "소울드레인샷 마스터", "일도양단": "일도양단"}
SKILL_RE = re.compile("(" + "|".join(sorted(SKILL_WORDS, key=len, reverse=True)) + r")|(화폭|치격|소드|쉴드|휩|와|프|덥|충|아프|수기)\s?(\d)\s?단")
SKILL_FULL = {"화폭": "화염폭풍", "치격": "치명적일격", "소드": "소울드레인샷", "쉴드": "쉴드", "휩": "휩쓸기", "와": "와일드스윙", "프": "프레임쇼크",
              "덥": "더블샷", "충": "충격샷", "아프": "아이스프리즌", "수기": "수호의기원"}
# 도감 효과 (제작자: pve, pvp, 명, 크 같은 수치가 쭉 적혀 있으면 도감 효과). 게임의 도감 '획득 옵션' 창 순서와 이름으로 통일한다
# (제작자 스샷 2026-11-03). 값은 글에 적힌 대로 '기본 + 이벤트' 합이고, 'a / b%' 는 고정값 / % 값.
V = r"(\d+(?:\.\d+)?)"
PV = r"(\d+(?:\.\d+)?)\s?%"
PAIR = V + r"\s?%?\s*/\s*" + V + r"\s?%?"
# (게임 이름, 줄 안에서 찾는 식). 식의 1번 묶음이 고정값, 2번 묶음이 % 값 (없으면 하나만)
DEX_ORDER: list[tuple[str, str]] = [
    ("명중", r"(?<![가-힣])명(?:중)?\s*:?\s*" + V + r"(?!\s*%)"),
    ("회피", r"회피\s*:?\s*" + V),
    ("크리티컬", r"(?<![가-힣])크(?:리티컬|리)?\s*:?\s*" + V + r"(?!\s*%)(?!\s*/)"),
    ("불저항", r"불(?:저항|저)\s*:?\s*" + V),
    ("냉기저항", r"냉(?:기저항|기저|저|기)?\s*:?\s*" + V),
    ("번개저항", r"(?<![가-힣])번(?:개저항|개저|저|개)?\s*:?\s*" + V),
    ("속성저항", r"속(?:성저항|저)\s*:?\s*" + V),
    ("체력", r"(?<![가-힣])체(?:력)?\s*:?\s*" + V + r"(?!\s*%)(?:\s*/\s*" + V + r"\s?%)?"),
    ("마나", r"(?<![가-힣])마(?:나|력)?\s*:?\s*" + V + r"(?!\s*%)(?:\s*/\s*" + V + r"\s?%)?"),
    ("체력재생", r"체(?:력)?\s?(?:재생|재|젠)\s*:?\s*" + V),
    ("마나재생", r"마(?:나)?\s?(?:재생|재|젠)\s*:?\s*" + V),
    ("힘", r"(?<![가-힣])힘\s*:?\s*" + V),
    ("지능", r"(?<![가-힣])지(?:능)?\s*:?\s*" + V),
    ("민첩", r"(?<![가-힣])민(?:첩)?\s*:?\s*" + V),
    ("이동속도", r"이(?:동)?\s?속(?:도)?\s*:?\s*" + V),
    ("막기", r"막기\s*:?\s*" + V),
    ("아머", r"아머\s*:?\s*" + V),
    ("PVE 데미지", r"pve\s*(?:데미지(?!\s*감)|뎀(?!감))?\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("PVP 데미지", r"pvp\s*(?:데미지(?!\s*감)|뎀(?!감))?\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("PVE 데미지 감소", r"pve\s*(?:데미지\s*감소|뎀감|뎀\s*감소)\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("PVP 데미지 감소", r"pvp\s*(?:데미지\s*감소|뎀감|뎀\s*감소)\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("아이템 드랍", r"아(?:이템\s?드랍|드|)\s*/?\s*(?:골드)?\s*:?\s*" + V + r"\s?%?(?:\s*골드\s*:?\s*" + V + r")?"),
    ("골드 드랍", r"골드\s?(?:드랍)?\s*:?\s*" + V + r"\s?%?(?!\s*만)"),
    ("보스 데미지", r"보(?:스)?\s?(?:데미지|뎀)\s*:?\s*" + V),
    ("크리티컬 저항", r"크(?:리티컬|리)?\s?저(?:항)?\s*:?\s*" + V),
    ("크리티컬 데미지 감소", r"크(?:리티컬|리)?\s?(?:데미지\s*감소|뎀감)\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("데들리 저항", r"데들리\s?저(?:항)?\s*:?\s*" + V),
    ("데들리 데미지 감소", r"데들리\s?(?:데미지\s*감소|뎀감)\s*:?\s*" + V + r"\s?%?(?:\s*/\s*" + V + r"\s?%)?"),
    ("경험치", r"경(?:험치|치)\s*:?\s*" + V),
]
DEX_RE = [(name, re.compile(rx, re.I)) for name, rx in DEX_ORDER]
# 도감 랭킹 (일반, 코스튬, 라이딩 %)
COLLECT_RE = [("일반", re.compile(r"일반\s*(?:도감)?\s*:?\s*" + PV)), ("코스튬", re.compile(r"코(?:스튬|튬)\s*(?:도감)?\s*:?\s*" + PV)),
              ("라이딩", re.compile(r"라이딩\s*(?:도감)?\s*:?\s*" + PV))]
# 스펙 줄인지: 수치 말과 숫자만 남는 줄
STAT_WORDS = re.compile(r"pve|pvp|명중|회피|크리티컬|크리|불저항|냉기저항|번개저항|속성저항|불저|냉저|번저|속저|냉기|번개|체력재생|마나재생|체력|마나|마력|체재|마재|체젠|마젠"
                        r"|재생|지능|민첩|이동속도|이속|막기|아머|데미지|감소|뎀감|뎀|아이템|드랍|아드|골드|보스|저항|데들리|경험치|경치|일반|코스튬|코튬|라이딩"
                        r"|도감|힘|민|지|체|마|명|크|냉|번|불|속|아|등등|등|기본|이벤트", re.I)


def is_stat_line(line: str) -> bool:
    rest = STAT_WORDS.sub("", line)
    rest = re.sub(r"[\d.,%/:()\[\]\s~\-+※•■□▶·*]", "", rest)
    return rest == "" and re.search(r"\d", line) is not None


def _fmt(v: str) -> str:
    return f"{float(v):g}"


def parse_dex(text: str) -> tuple[list[list[str]], dict[str, float]]:
    """캐릭터 글의 스펙 줄들 -> (게임 도감 순서의 [이름, 값] 목록, 도감 랭킹 %)"""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    stat_lines = [l for l in lines if is_stat_line(l)]
    found: dict[str, str] = {}
    for line in stat_lines:
        work = line
        # '힘/민/지 4/6/3', '힘/민/지능 3/8/2'
        m = re.search(r"힘\s*/\s*민(?:첩)?\s*/\s*지(?:능)?\s*:?\s*" + V + r"\s*/\s*" + V + r"\s*/\s*" + V, work)
        if m:
            found.setdefault("힘", _fmt(m.group(1))); found.setdefault("민첩", _fmt(m.group(2))); found.setdefault("지능", _fmt(m.group(3)))
            work = work[:m.start()] + work[m.end():]
        # '체력 마나 재생 5 / 3.5'
        m = re.search(r"체(?:력)?\s*/?\s*마(?:나)?\s*재생\s*:?\s*" + V + r"\s*/\s*" + V, work)
        if m:
            found.setdefault("체력재생", _fmt(m.group(1))); found.setdefault("마나재생", _fmt(m.group(2)))
            work = work[:m.start()] + work[m.end():]
        # '아드/골드 50.39' (하나면 둘 다), '아드 27.24골드26.04', '아드 47.99% 골드 47.49%'
        m = re.search(r"아(?:이템\s?드랍|드|)\s*/?\s*(골드)?\s*:?\s*" + V + r"\s?%?(?:\s*골드\s*:?\s*" + V + r")?", work, re.I)
        if m and (m.group(1) or m.group(3) or re.match(r"\s*아", work)):
            found.setdefault("아이템 드랍", _fmt(m.group(2)))
            found.setdefault("골드 드랍", _fmt(m.group(3) or m.group(2)))
            work = work[:m.start()] + work[m.end():]
        for name, rx in DEX_RE:
            if name in found or name in ("아이템 드랍",):
                continue
            m = rx.search(work)
            if not m:
                continue
            g = m.groups()
            val = _fmt(g[0])
            if len(g) > 1 and g[1]:
                val = f"{val} / {_fmt(g[1])}%"
            elif "%" in work[m.end() - 2: m.end() + 2] or name in ("경험치", "크리티컬 저항", "데들리 저항", "보스 데미지"):
                val = f"{val}%"
            found[name] = val
            work = work[:m.start()] + " " + work[m.end():]
    dex = [[name, found[name]] for name, _ in DEX_ORDER if name in found]
    collect: dict[str, float] = {}
    for name, rx in COLLECT_RE:
        m = rx.search(text)
        if m:
            collect[name] = float(m.group(1))
    # '53.35 / 49.94' 처럼 이름 없이 % 둘만 있는 줄 = 일반 / 코스튬 도감
    if not collect:
        for l in lines:
            m = re.fullmatch(r"(\d{1,2}(?:\.\d+)?)\s*%?\s*/\s*(\d{1,2}(?:\.\d+)?)\s*%?", l)
            if m:
                collect = {"일반": float(m.group(1)), "코스튬": float(m.group(2))}
                break
    return dex, collect


def char_dex(text: str) -> tuple[str, list[list[str]], dict[str, float]]:
    """(짧은 요약, 도감 효과 표, 도감 랭킹 %). 요약: '노도감' / '저도감' / '도감 57%' / '도감 효과 · 명7 크5 체898 아드98'"""
    dex, collect = parse_dex(text)
    if re.search(r"노도감|도감\s?없", text):
        return "노도감", dex, collect
    if re.search(r"저도감", text):
        return "저도감", dex, collect
    head = ""
    if "일반" in collect:
        head = f"도감 {collect['일반']:g}%"
    else:
        dm = re.search(r"도감\s?[^\n%]{0,12}?(\d+(?:\.\d+)?)\s?%", text)
        if dm:
            head = f"도감 {float(dm.group(1)):g}%"
    if len(dex) >= 4:
        d = dict(dex)
        short = {"명중": "명", "크리티컬": "크", "체력": "체", "이동속도": "이속", "PVE 데미지": "pve", "아이템 드랍": "아드"}
        parts = [f"{s}{d[k].split(' / ')[0].rstrip('%')}" for k, s in short.items() if k in d]
        return (head + " · " if head else "도감 효과 · ") + " ".join(parts), dex, collect
    return head, dex, collect


def char_skills(text: str) -> str:
    sk = re.search(r"(신|구)?올마", text)
    out = []
    if sk:
        out.append(sk.group(0) + (" (일부 제외)" if re.search(r"뺀|제외", text) else ""))
    for m in SKILL_RE.finditer(text):
        if m.group(1):
            w = SKILL_WORDS[m.group(1)]
        else:
            w = f"{SKILL_FULL[m.group(2)]} {m.group(3)}단"
        # 같은 스킬이 이미 있으면(덥충마 뒤의 덥마, 부캐의 화폭2단) 더하지 않는다
        names = {p.split(" ")[0] for p in w.split("·")}
        have = {p.split(" ")[0] for o in out for p in o.split("·")}
        if not names <= have:
            out.append(w)
    return " · ".join(out[:5])


SCAM = re.compile(r"사기.{0,12}(주의|조심|신고)|(주의|조심|신고).{0,12}사기|먹튀", re.S)


def _char_fields(text: str, level: int, job: str | None, price: float, side: str, raw: str, server: str | None = None) -> dict:
    sv = re.search(SERVER_WORD, text)
    server = server or (SERVERS[sv.group(0)] if sv else None)
    skills = char_skills(text)
    dex, dex_table, collect = char_dex(text)
    gm = re.search(r"보석\s?:?\s?([1-4]{3})(?!\d)", text) or re.search(r"(?<![\d.])([1-4]{3})\s?(?:\(?아드\)?)?\s?(?:보석|귀속|아드)", text)
    gems = gm.group(1) if gm else ""
    pvp = bool(re.search(r"쟁캐|쟁캘|쟁\s|막피", text))
    scope = "템통" if re.search(r"템통|템\s?포함|템까지|풀템", text) else ("캘" if re.search(r"(?<!쟁)캘|캐릭터?만|몸만|몸\s?팝|몸\s?판", text) else "")
    raw = re.sub(r"닉(?:네임|넴)?\s?:?\s?\S+", "", raw)  # 캐릭터 닉은 빼고
    return {"side": side, "server": server, "level": level, "job": job, "skills": skills, "dex": dex, "dexTable": dex_table, "collect": collect, "gems": gems, "pvp": pvp,
            "scope": scope, "price": price, "raw": re.sub(r"\s+", " ", raw).strip()[:60]}


def parse_chars(m: dict, rs: Resolver) -> list[dict]:
    text = m["text"]
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines or SCAM.search(text):
        return []
    head = "\n".join(lines[:4])
    side = "buy" if BUY.search(head) and not SELL.search(head) else "sell"
    out = []
    # 1) 한 줄짜리 캐릭터들
    for line in lines:
        cl = CHAR_LINE.match(re.sub(r"\(.*?\)", "", line).strip())
        if not cl:
            continue
        v = float(cl.group(5))
        if cl.group(6) is None and v >= 300:
            continue
        if 3 <= v <= 1500:
            out.append(_char_fields(line + "\n" + text, int(cl.group(2)), JOBS[cl.group(4)], v, side, line,
                                    SERVERS.get(cl.group(1) or "")))
    if out:
        return out
    # 2) 글 전체가 캐릭터 하나
    if not CHAR_HINT.search(text) and not LEVEL_JOB.search(head):
        return []
    lj = LEVEL_JOB.search(text)
    level = job = None
    if lj:
        level, job = int(lj.group(1)), JOBS[lj.group(2)]
    else:
        lf = LEVEL_FIRST.search(text)
        if lf:
            level = int(lf.group(1))
            jm = re.search(r"전사|렌저|레인저|법사|마법사|무도가", text)
            job = JOBS[jm.group(0)] if jm else None
    if level is None:
        return []
    price = None
    unit = None
    for line in lines[:2]:  # 첫 줄의 '(55장)'
        up = UNIT_PRICE.search(line)
        if up and 3 <= float(up.group(1)) <= 1500 and not parse_line(line, rs):
            price, unit = float(up.group(1)), up.group(2)
    for pm in (CHAR_PRICE.finditer(text) if price is None else []):
        v = float(pm.group(1))
        if 3 <= v <= 1500:
            price, unit = v, pm.group(2)
            break
    if price is None:
        for line in lines:
            if parse_line(line, rs):
                continue  # 물건 줄
            up = UNIT_PRICE.search(line) or LINE_PRICE.match(line)
            if up and 3 <= float(up.group(1)) <= 1500:
                price, unit = float(up.group(1)), up.group(2)
                break
    if price is None:
        ps = PRICE_SELL.search(text)
        if ps and 3 <= float(ps.group(1)) <= 1500:
            price = float(ps.group(1))
    if price is None or (unit == "만" and price >= 300):
        return []
    return [_char_fields(text, level, job, price, side, lines[0])]


def char_prices(msgs: list[dict], rs: Resolver) -> dict:
    """캐릭터 글 -> 한 캐릭터 한 줄 (같은 사람이 같은 캐릭터를 되풀이 올린 것은 하나로, 처음과 마지막 날짜). 닉네임도 넣는다 (제작자 요청)"""
    rows: dict[tuple, dict] = {}
    for m in msgs:
        for c in parse_chars(m, rs):
            key = (m["who"], m["tel"], c["server"], c["level"], c["job"], c["price"], c["side"])
            r = rows.get(key)
            if r:
                r["n"] += 1
                r["last"] = max(r["last"], m["date"])
                r["first"] = min(r["first"], m["date"])
            else:
                c.update({"who": m["who"], "tel": m["tel"], "n": 1, "first": m["date"], "last": m["date"]})
                rows[key] = c
    out = sorted(rows.values(), key=lambda r: (r["last"], r["first"]), reverse=True)
    bands = []
    for lo in (20, 30, 40, 50):
        xs = [r["price"] for r in out if r["side"] == "sell" and lo <= r["level"] < lo + 10 and r["scope"] != "템통"]
        if xs:
            bands.append({"band": f"{lo}대", "n": len(xs), "med": round(statistics.median(xs), 1), "min": min(xs), "max": max(xs)})
    return {"rows": out, "bands": bands}

# 톡방·게임 은어 (제작자가 알려 준 것). 물건 줄임말은 ALIASES·NON_WIKI·JOB_GROUPS·items 의 abbr 에서 저절로 모은다
CHAT_SLANG = {"월거": "월드거래 (여러 서버가 같이 쓰는 월드 거래)", "캘": "캐릭터만 (템 없이)", "템통": "캐릭터 + 템까지 통째로",
              "장": "현금 1만 원 (1장 = 1만 원)", "콩": "현금 1만 원 (1콩 = 1만 원)", "구올마": "신규 스킬 패치 전 스킬 올 마스터",
              "신올마": "신규 스킬까지 올 마스터", "노도감": "도감을 거의 안 채움", "저도감": "도감을 조금 채움", "쟁캐": "전쟁(PVP)용 캐릭터",
              "플톡": "카톡 오픈채팅 프로필로 연락", "풀톡": "카톡 오픈채팅 프로필로 연락", "노강": "강화 안 한 것 (+0)"}


def write_chat_market(data: dict, rs: "Resolver") -> None:
    """챗봇용 시세 요약과 줄임말 표 -> public/data/chatmarket.json (화면 src/chatMarket.ts 가 질문에 맞는 것만 붙인다)"""
    def stat(it: dict) -> dict:
        return {k: it.get(k) for k in ("med", "min", "max", "n", "sellers", "first", "last", "recent", "before")}

    def item(it: dict) -> dict:
        out = {"name": it["name"], "abbr": it.get("abbr") or [], "cat": it.get("cat"), **stat(it),
               "other": it.get("other"),
               "groups": [{"label": g["label"], **stat(g)} for g in (it.get("groups") or [])[:8]],
               "samples": [f'{x["date"]} {x["raw"]}' for x in (it.get("samples") or [])[:4]]}
        return out

    slang: dict[str, str] = dict(CHAT_SLANG)
    for k, v in ALIASES.items():
        if v:
            slang.setdefault(k, v)
    for k, v in NON_WIKI.items():
        slang.setdefault(k, v)
    for k, (label, jobs) in JOB_GROUPS.items():
        slang.setdefault(k, label + " = " + " · ".join(f"{j} {n}" for j, n in jobs.items()))
    for k, v in SKILL_WORDS.items():
        slang.setdefault(k, v)
    for k, v in SKILL_BOOK.items():
        if len(k) >= 2:
            slang.setdefault(k, v + " (스킬)")
            slang.setdefault(k + "북", v + " 스킬북")
            slang.setdefault(k + "마북", v + " 마지막 단계 스킬북")
    for it in data["items"] + data["itemsBuy"]:
        for a in it.get("abbr") or []:
            if len(a) >= 2:
                slang.setdefault(a, it["name"])
    gold = data["gold"]
    week = [d for d in gold if d["date"] >= data["lastWeek"]]
    meds = sorted(d["sell"]["med"] for d in week if d.get("sell"))
    buys = sorted(d["buy"]["med"] for d in week if d.get("buy"))
    chat = {
        "source": data["source"],
        "gold": {"sell7": meds[len(meds) // 2] if meds else None, "buy7": buys[len(buys) // 2] if buys else None,
                 "days": [[d["date"], (d.get("sell") or {}).get("med"), (d.get("buy") or {}).get("med")] for d in gold[-14:]]},
        "items": [item(it) for it in data["items"]],
        "itemsBuy": [item(it) for it in data["itemsBuy"]],
        "chars": data["chars"].get("bands", []),
        "slang": slang,
    }
    CHAT_OUT.write_text(json.dumps(chat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("챗봇 시세 자료", {"items": len(chat["items"]), "slang": len(slang), "kb": CHAT_OUT.stat().st_size // 1024})


def main() -> None:
    files = sorted(SRC.glob("*.txt")) if SRC.exists() else []
    if not files:
        print("시세 동향: 자료/카톡 이 없어서 건너뜀")
        return
    # 같은 방을 여러 번 내보낸 파일은 날짜가 겹친다. 날짜마다 가장 새 파일의 글만 쓴다
    # (2026-11-10 PC 내보내기는 닉네임을 바꾼 사람을 지금 닉네임으로 적어서, 같은 글이라도 예전 파일과 겹쳐 셌다)
    rooms, msgs = [], []
    covered: dict[str, set[str]] = {}
    for f in sorted(files, key=lambda f: f.stem.rsplit("_", 1)[-1], reverse=True):
        room, ms = parse(f)
        rooms.append(room)
        seen = covered.setdefault(room, set())
        msgs.extend(m for m in ms if m["date"] not in seen)
        seen.update(m["date"] for m in ms)
    msgs = dedupe(msgs)
    dates = sorted({m["date"] for m in msgs})
    last = datetime.date.fromisoformat(dates[-1])
    last_week = (last - datetime.timedelta(days=6)).isoformat()
    gold = gold_days(msgs)
    gold_who = gold_people(msgs)
    rs = Resolver()
    items = item_prices(msgs, last_week, rs, "sell")
    items_buy = item_prices(msgs, last_week, rs, "buy")
    # 반대쪽 값 (팝니다 줄에 '삽니다 25만' 처럼 같이 보인다)
    for a, b in ((items, items_buy), (items_buy, items)):
        other = {it["name"]: it for it in b}
        for it in a:
            o = other.get(it["name"])
            it["other"] = {"med": o["med"], "n": o["n"]} if o else None
    chars = char_prices(msgs, rs)
    # 위키에 없는 물건의 그림: 자료/이미지/시세동향/<이름>.png (제작자 도감 스샷에서 자른 것, make_trend_icons.py). 이름의 괄호 설명은 뺀다
    for it in items + items_buy:
        icon = SKILL_ICONS.get(it["name"]) or icon_for(it["name"])
        if icon:
            it["icon"] = icon
    data = {
        "source": {"rooms": sorted(set(rooms)), "from": dates[0], "to": dates[-1], "messages": len(msgs),
                   "built": datetime.date.today().isoformat(), "rate": USUAL_RATE},
        "lastWeek": last_week,
        "gold": gold,
        "goldPeople": gold_who,
        "items": items,
        "itemsBuy": items_buy,
        "chars": chars,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("시세 동향", {"rooms": len(set(rooms)), "messages": len(msgs), "days": len(gold), "items": len(items), "itemsBuy": len(items_buy), "chars": len(chars["rows"]),
                     "wiki": sum(1 for it in items if it["wiki"])})
    write_chat_market(data, rs)
    if "--unknown" in sys.argv:
        print("위키에 없는 줄임말:", sorted(rs.unknown.items(), key=lambda kv: -kv[1])[:80])
        print("숫자 옵션 수가 안 맞는 물건:", [(k, range_opts(k)[0], sorted(set(v))[:6], len(v)) for k, v in sorted(NUM_MISMATCH.items(), key=lambda kv: -len(kv[1]))])


if __name__ == "__main__":
    main()
