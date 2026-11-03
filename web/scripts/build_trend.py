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
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료" / "카톡"
OUT = ROOT / "web" / "public" / "data" / "trend.json"

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
    with path.open(encoding="utf-8-sig") as f:
        for i, raw in enumerate(f):
            line = raw.rstrip("\n")
            if i == 0:
                m = ROOM.match(line)
                if m:
                    room = m.group(1).strip()
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
BARE_GOLD_FROM = 300  # 단위 없는 숫자가 이보다 크면 만 골드

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
NOT_ITEM_WORDS = {"보석", "코튬", "코스튬", "아이템", "장비", "무기", "방어구", "캐릭터", "계정", "통판매", "대리판매", "도감", "도감용",
                  "전사", "렌저", "레인저", "법사", "마법사", "무도가", "신발", "투구", "갑옷", "장갑", "모자", "반지", "벨트", "망토", "목걸이", "이상", "이하",
                  "아드", "싸게", "급매", "빠르게", "각개", "일괄", "통매입", "매입", "판완", "예약"}
# 줄임말 한 글자가 두 글자를 줄인 것
SQUEEZE = {"닼": "다크", "롭": "로브", "렌": "레인"}
# 자동으로 풀기 어려운 줄임말 (제작자 확인). 값이 None 이면 위키에 없는 물건이라 줄임말 그대로 둔다
ALIASES: dict[str, str | None] = {
    "의망": "의지의 망토", "반죽망": "반죽음의망토", "죽망": "죽음의망토", "헌보": "헌터보우",
    "닼스": "다크스컬", "닼소": "다크스틸소드", "닼쉴": "다크스틸쉴드", "닼아": "다크스틸아머", "닼투": "다크스틸투구",
    "뿌벨": "거친뿌리의벨트", "뿌리벨": "거친뿌리의벨트", "건마벨": "건조한마력의벨트", "마재벨": "마나재생벨트", "서약벨": "서약자의벨트",
    "가지갑": "세계수가지갑옷", "껍갑": "세계수껍질갑옷", "세계롭": "세계수잎로브", "세계수롭": "세계수잎로브",
    "광전사": "광전사의부츠", "정반": "정화된힘의반지", "약반": "약속의반지", "현인장": "현인의장갑", "정화장": "정화의장갑",
    "카소": "카이저소드", "파홀": "파괴의홀", "임페": "임페리얼보우", "스카장": "스카우트장갑", "학모": "학자의모자", "방모": "방랑자의모자",
    "백레": "백색레이피어", "고봉": "고대의봉", "승건": "승리의건틀릿", "윙부": "윙깃부츠", "스파쉴": "스파르탄쉴드", "샤쿤": "샤쿤그리브",
    "강골장": "강철골렘장갑", "용투": "용맹의투구", "무투": "무쇠투구", "오순": "오염된순수", "완망": "완벽한어둠",
    "엘프": "엘프의 덧신", "버닝": "버닝블레이드", "레목": "레이븐목걸이", "건마밸": "건조한마력의벨트", "닥쉴": "다크스틸쉴드",
    "대자": "대자연", "반죽": "반죽음의망토", "고지": "고요의지팡이", "광부": "광전사의부츠", "대천": "대천사",  # 제작자 확인 2026-11-03
    "재벨": "재생의벨트", "글라": "글라디우스", "샤보": "샤도우보우", "하갑": "하이가드갑옷", "티벨": "티타늄벨트",
    "거뼈": "거미줄뼈갑옷", "황목": "황금목걸이", "닥스": "다크스컬", "글라": "글라디우스", "숲요장": "숲요정의장갑", "속모": "속전속결의모자", "속전모": "속전속결의모자", "사용장": "사막용병의장갑", "재벨": "재생의벨트", "데조모": "데조르바의모자", "강장": "강철골렘장갑",
}


# 위키에 없는 물건의 보이는 이름 (제작자 설명 2026-11-03). 아드셋: 보석 3개가 한 세트이고 232, 333 같은 숫자는 1, 2, 3번 보석의 등급(1~4).
# '지2 아드셋' = 2번 보석이 아드레날린 보석이고 셋 다 2등급, 등급만큼 속성(지능2)이 붙는다. 캐릭터 글의 '보석 333' 도 같은 등급 표시.
# '12번보석셋' = 1, 2번 보석이 있는 세트
GEMSET = re.compile(r"^(\d{1,3})번?보석셋$")
NON_WIKI = {"아드셋": "아드레날린 보석 세트 (아드셋)", "목청높여": "목청높여 (코스튬)", "목청": "목청높여 (코스튬)",
            # 마법서: 스 = S등급, 에 = A등급, 갑 = 갑옷마법서, 무 = 무기마법서 (제작자 설명). 거불 = 거래불가, 거가 = 거래가능
            "스갑": "S등급 갑옷마법서", "스무": "S등급 무기마법서", "에갑": "A등급 갑옷마법서", "에무": "A등급 무기마법서",
            "SS무": "SS등급 무기마법서", "SS갑": "SS등급 갑옷마법서", "거불스무": "S등급 무기마법서 (거래불가)", "거불스갑": "S등급 갑옷마법서 (거래불가)",
            "거가스무": "S등급 무기마법서 (거래가능)", "거가스갑": "S등급 갑옷마법서 (거래가능)",
            "고주": "고대의 주화", "고대의주화": "고대의 주화"}


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
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", line)
    s = NUMBERING.sub("", s.strip())
    s = re.sub(r"[•■□▶\-–—ㅡ·*~♡❤️🤍,/:]", " ", s)
    s = re.sub(r"(?<=\S)(or|OR|혹은)(?=\S)", " or ", s)
    s = re.sub(r"(?<![가-힣])(" + OPT_KEYS + r") (?=\d)", r"", s)  # '체 446' -> '체446'
    words = s.split()
    if not words:
        return None
    # 가격: 단위 붙은 것 중 현금(장, 콩) 우선, 없으면 만 골드, 없으면 맨 뒤 단위 없는 숫자
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
        rest = words[:-1]
    else:
        return None
    if price is None or price < 0.01 or price > 3000:
        return None
    rest = [w for w in rest if w not in ("or", "OR", "혹은", "ㅍ", "ㅍㅍ", "ㅅ", "ㅅㅅ")]
    opts: list[str] = []
    names: list[str] = []
    enh_word = 0
    for w in rest:
        if w in SKIP_WORDS or SELL.fullmatch(w) or BUY.fullmatch(w):
            continue
        o = norm_opt(w)
        if o:
            opts.append(o)
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?%?", w):
            continue  # 옵션을 숫자만으로 적은 것 ('3 1 10 엘프의덧신')
        em = re.fullmatch(r"\+?(\d{1,2}|[오육칠팔구십])강", w)
        if em:  # '6강', '육강' (제작자 지적)
            enh_word = KNUM.get(em.group(1)) or int(em.group(1))
            continue
        if re.search(r"[가-힣a-zA-Z]", w):
            w = re.sub(r"팝니다|삽니다|판매|구매|노강|노작", "", w)
            w = re.sub(r"^(\+?(?:\d{1,2}|[오육칠팔구십]))강(?=[가-힣])", r"\1", w)  # '6강바슬신' -> '6바슬신'
            while True:  # 이름 앞에 붙은 옵션 ('지3대자')
                g = OPT_GLUED.match(w)
                if not g:
                    break
                o = norm_opt(g.group(0))
                if not o:
                    break
                opts.append(o)
                w = w[g.end():]
            if len(re.sub(r"[^가-힣a-zA-Z]", "", STAT_RE.sub("", w))) < 2:
                continue  # 스펙 말만 남음
            if w:
                names.append(w)
    if not names:
        return None

    def try_word(w: str) -> tuple[str, str, int] | None:
        """낱말 하나 -> (위키 이름, 줄임말, 강화). 통째로 먼저, 안 되면 앞의 강화 숫자(8헌보, 팔닼소)를 떼고"""
        m = ENHANCE_RE.match(w)
        for k, c in enumerate([w] + ([w[m.end():]] if m else [])):
            c = re.sub(r"[^가-힣a-zA-Z0-9]", "", c)
            if len(c) < 2 or c in NOT_ITEM_WORDS:
                continue
            found = rs.resolve(c)
            if found:
                return found, c, (_enh_value(m) if k == 1 and m else 0)
        return None

    joined = "".join(names)
    gs = GEMSET.match(joined)
    if gs:  # '12번보석셋' = 1, 2번 보석이 있는 세트 (제작자 설명). 앞 숫자는 강화가 아니다
        name = "·".join(gs.group(1)) + "번 보석 세트"
        return {"name": name, "wiki": False, "enh": 0, "opts": opts, "price": round(price, 2), "abbr": joined}
    hit = try_word(joined)
    if not hit and len(names) > 1:
        for w in names:  # 물건이 둘이거나 설명 말이 섞였을 때: 낱말 하나씩
            hit = try_word(w)
            if hit:
                break
    if hit:
        name, abbr, enh = hit
        wiki = True
    else:
        # 위키에 없는 물건: 줄임말 그대로 (강화 숫자는 떼어 둔다)
        m = ENHANCE_RE.match(joined)
        c = joined[m.end():] if m and len(joined) - m.end() >= 2 else joined
        c = re.sub(r"[^가-힣a-zA-Z0-9]", "", c)
        if len(c) < 2 or len(c) > 12 or not re.search(r"[가-힣a-zA-Z]{2}", c) or NOT_ITEM.search(c) or c in NOT_ITEM_WORDS:
            return None
        enh = _enh_value(m) if m and c != joined else 0
        abbr = c
        name = NON_WIKI.get(c, c)
        wiki = False
        rs.unknown[c] += 1
    enh = enh or enh_word
    return {"name": name, "wiki": wiki, "enh": enh if enh <= 20 else 0, "opts": opts, "price": round(price, 2), "abbr": abbr}


EQUIP_JSON = ROOT / "web" / "public" / "data" / "equipment.json"
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
    if any(x["enh"] for x in xs):
        return "enhance"
    if any(ENCHANT_RE.match(o) for x in xs for o in x["opts"]):
        return "enchant"
    return "none"


def group_label(kind: str, x: dict) -> str:
    """속성부여 템은 주 스탯(힘·민첩·지능, 없으면 체력·마나)으로, 강화 템은 강화 단계로, 나머지는 하나로"""
    if kind == "enchant":
        ench = [o for o in x["opts"] if ENCHANT_RE.match(o)]
        main = [o for o in ench if o.startswith(MAIN_STATS)]
        return (main or ench or ["노작"])[0]
    if kind == "enhance":
        return f"+{x['enh']}" if x["enh"] else "노강"
    return "전체"


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
        by_group: dict[str, list[dict]] = defaultdict(list)
        for x in xs:
            by_group[group_label(kind, x)].append(x)
        groups = []
        for label, gx in by_group.items():
            by_var: dict[str, list[dict]] = defaultdict(list)
            for x in gx:
                by_var[variant_label(x["enh"], x["opts"])].append(x)
            variants = [{"label": vl, **summary(v)} for vl, v in by_var.items()]
            variants.sort(key=lambda v: (-v["n"], v["label"]))
            groups.append({"label": label, **summary(gx), "variants": variants})
        groups.sort(key=lambda g: group_sort_key(kind, g))
        variants = [v for g in groups for v in g["variants"]]
        variants.sort(key=lambda v: (-v["n"], v["label"]))
        abbrs: dict[str, int] = defaultdict(int)
        for x in xs:
            if x["abbr"] != name.replace(" ", ""):
                abbrs[x["abbr"]] += 1
        out.append({"name": name, "wiki": xs[0]["wiki"], "kind": kind,
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
               "쉴마": "쉴드 마스터", "휩마": "휩쓸기 마스터", "냉기마": "냉기부여 마스터", "전기마": "전기부여 마스터", "포아마": "포아마(?)",
               "파샷마": "파워샷 마스터", "소드마": "소울드레인샷 마스터", "일도양단": "일도양단"}
SKILL_RE = re.compile("(" + "|".join(sorted(SKILL_WORDS, key=len, reverse=True)) + r")|(화폭|치격|소드|쉴드|휩|와|프|덥|충)\s?(\d)\s?단")
SKILL_FULL = {"화폭": "화염폭풍", "치격": "치명적일격", "소드": "소울드레인샷", "쉴드": "쉴드", "휩": "휩쓸기", "와": "와일드스윙", "프": "프레임쇼크",
              "덥": "더블샷", "충": "충격샷"}
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

def main() -> None:
    files = sorted(SRC.glob("*.txt")) if SRC.exists() else []
    if not files:
        print("시세 동향: 자료/카톡 이 없어서 건너뜀")
        return
    rooms, msgs = [], []
    for f in files:
        room, ms = parse(f)
        rooms.append(room)
        msgs.extend(ms)
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
    print("시세 동향", {"rooms": len(rooms), "messages": len(msgs), "days": len(gold), "items": len(items), "itemsBuy": len(items_buy), "chars": len(chars["rows"]),
                     "wiki": sum(1 for it in items if it["wiki"])})
    if "--unknown" in sys.argv:
        print("위키에 없는 줄임말:", sorted(rs.unknown.items(), key=lambda kv: -kv[1])[:80])


if __name__ == "__main__":
    main()
