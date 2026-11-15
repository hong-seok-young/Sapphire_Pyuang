"""아이템 지식 (제작자 2026-11-15 '그 템에 대한 모든 지식이 다 나오게 해 줘': 오색가죽·망가진목걸이 화면에 떨구는 몬스터와 공식 이벤트만 보여서
'이걸로 대체 뭐 하는 건지 어따 쓰는 건지'를 몰랐다). 아이템 화면이 이미 쓰는 것(위키 드랍·장비 표, 아이템 책 = 게임 정보·도감·상점·톡방 시세·제작, 공식 소식)
말고 자료 저장소에 흩어져 있던 것을 아이템 이름으로 모은다:

- 카페 글 (드랍표_추출/글*/*.txt): 그 이름이 나오는 줄을 그 칸의 머리(① NPC, ✅ 지역, 《 퀘스트 》 …)와 함께. 퀘스트 재료, NPC 교환, 상점, 공략 팁.
  몬스터 드랍 목록 칸(이름만 쉼표로 늘어놓은 줄)은 '떨구는 몬스터' 칸과 겹쳐서 뺀다
- 길드 자료 (제공/*.md, 링크/블로그·카페 글): 그 이름이 나오는 줄
- 해외 팬 위키 한국어 번역 (fandom/ko/*.md, 찾는 말로 맞춤): 그 문서 전체
- 상자·뽑기: 게임 상점 상자 구성품(book.json parts)과 컴투스 공식 확률 표(odds.json)에서 그 아이템이 나오는 곳과 확률
- 강화 비교에 있는 무기인지

-> public/data/lore/NN.json (띄어쓰기 뺀 이름의 해시 % 64 로 나눈 64 조각, 화면 `src/pages/Detail.tsx` 가 그 아이템의 조각 하나만 받는다).
화면은 로그인한 길드원만 (data/ 아래). 카톡 원문은 넣지 않는다 (휴대폰 뒷자리·잡담).
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SAPPHIRE_DATA") or ROOT / "자료")
OUT = ROOT / "web" / "public" / "data"
SHARDS = 64

nk = lambda s: re.sub(r"\s+", "", s or "")


def shard(name: str) -> int:
    """화면 src/lore.ts shardOf 와 같은 셈 (띄어쓰기 뺀 이름의 글자 번호)"""
    h = 0
    for c in nk(name):
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return h % SHARDS


def _read(name: str):
    p = OUT / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


class Finder:
    """글 안에서 아이템 이름(띄어쓰기 무시)을 찾는다. 짧은 이름이 긴 이름 안에서 걸리지 않게 그 자리에서 가장 긴 이름만"""

    def __init__(self, names: dict[str, str]):
        self.names = names  # 띄어쓰기 뺀 이름 -> 보일 이름
        self.by2: dict[str, list] = {}
        for k in names:
            if len(k) >= 3:
                self.by2.setdefault(k[:2], []).append(k)
        for v in self.by2.values():
            v.sort(key=len, reverse=True)

    def find(self, text: str) -> set:
        s = nk(text)
        hits = set()
        i = 0
        while i < len(s) - 2:
            for k in self.by2.get(s[i:i + 2], ()):
                if s.startswith(k, i):
                    hits.add(k)
                    i += len(k) - 1
                    break
            i += 1
        return hits


HEAD = re.compile(r"^\s*(?:[①-⑳]|✅️?|《|【|<|\d{1,2}\.\s|▶|■|◆|●)")
NAME_LIST = re.compile(r"^[^→*]*(,[^,→*]+){3,}$")  # 이름만 쉼표로 늘어놓은 칸 (몬스터 드랍 목록)


def post_lines(finder: Finder, crafted: set):
    """카페 글마다 이름이 나오는 줄 -> {이름: [[글 번호, 제목, [줄들]]]}"""
    out: dict[str, dict] = {}
    for f in sorted(DATA.glob("드랍표_추출/글*/*.txt")):
        t = f.read_text(encoding="utf-8")
        first = t.split("\n", 1)[0].strip("# ")
        title = re.sub(r"\s*_ReMAKE.*", "", first).strip().replace("_", " · ")
        pid = f.stem
        for cell in t.split("|"):
            parts = [p.strip() for p in cell.split(" / ")]
            parts = [p for p in parts if p and p not in ("대한민국 모임의 시작, 네이버 카페", "naver.me")]
            head = ""
            for i, p in enumerate(parts):
                if HEAD.match(p):
                    head = p
                hits = finder.find(p)
                if not hits or NAME_LIST.match(p) or re.match(r"^(HP|재부활|레벨|Lv)", p):
                    continue
                for k in hits:
                    if "→" in p and (k, pid) in crafted:
                        continue  # 쓰는 곳·만드는 법 칸에 이미 있는 제작 줄
                    bare = len(re.sub(r"[+\d*()x×개\s]|강", "", nk(p))) <= len(k) + 1  # 이름(과 개수)만 있는 칸
                    if bare and (not head or head == p):
                        continue  # 표 칸에 이름만 늘어놓은 것 (유니크 목록, 강화 표 머리)
                    lines = []
                    if head and head != p:
                        lines.append(head)
                    # 한 줄이 ' / ' 로 끊긴 제작·교환 줄만 앞뒤를 잇는다 ('재료(*n), / 재료(*n) / → 결과')
                    if i > 0 and parts[i - 1] != head and (p.startswith("→") or parts[i - 1].endswith(",")):
                        lines.append(parts[i - 1])
                    lines.append(p)
                    if i + 1 < len(parts) and not HEAD.match(parts[i + 1]) and (parts[i + 1].startswith("→") or p.endswith(",")):
                        lines.append(parts[i + 1])
                    for j in range(i + 1, min(i + 9, len(parts))):  # 그 NPC 칸 끝의 설명 '(중 1개 선택하여 랜덤한 재료 교환)'
                        if HEAD.match(parts[j]):
                            break
                        if parts[j].startswith("(") and re.search(r"중\s*1|교환|선택|확률|랜덤", parts[j]):
                            lines.append(parts[j])
                            break
                    rows = out.setdefault(k, {}).setdefault(pid, [title, []])[1]
                    for ln in lines:
                        if ln not in rows:
                            rows.append(ln)
    return {k: [[pid, v[0], v[1][:12]] for pid, v in list(d.items())[:12]] for k, d in out.items()}


def guild_lines(finder: Finder):
    """길드 자료(제공/*.md, 링크 글)에서 이름이 나오는 줄 -> {이름: [[출처, [줄들]]]}"""
    skip = ("README.md", "기록.md", "To_do.md", "사용기록.md", "아이템_쓰는곳.md", "운영진_때리기.md", "기부함.md", "장비대여.md")
    files = [p for p in sorted(DATA.glob("제공/*.md")) if p.name not in skip]
    files += sorted(DATA.glob("링크/블로그/*.txt")) + sorted(DATA.glob("링크/카페/*.txt"))
    out: dict[str, dict] = {}
    for f in files:
        text = f.read_text(encoding="utf-8")
        src = f.stem.replace("_", " ")
        if f.parent.name in ("블로그", "카페"):
            m = re.match(r"#\s*(.+)", text)
            src = ("블로그 · " if f.parent.name == "블로그" else "카페 글 · ") + (m.group(1).strip() if m else f.stem)
        for line in text.splitlines():
            line = line.strip().lstrip("-* ").strip()
            if line.startswith("|"):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
                    continue
                line = " · ".join(c for c in cells if c)
            line = re.sub(r"`([^`]*)`", r"\1", line.lstrip("# ").strip())
            line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)
            if len(line) < 6 or line.startswith(("http", "스샷", "원본")) or re.search(r"\.(webp|png|jpg|json|py|mjs|ts|tsx)\b", line):
                continue
            for k in finder.find(line):
                rows = out.setdefault(k, {}).setdefault(src, [])
                if line not in rows and len(rows) < 8:
                    rows.append(line)
    return {k: [[s, v] for s, v in list(d.items())[:8]] for k, d in out.items()}


def fandom_docs(names: dict):
    """해외 위키 번역 문서 -> {이름: [{t, url, cat, body}]} (찾는 말·이름이 우리 이름과 띄어쓰기 빼고 같으면)"""
    out: dict[str, list] = {}
    skip = ("NPC_", "몬스터_", "지역_", "가이드_", "스킬_", "퀘스트_")
    for f in sorted(DATA.glob("fandom/ko/*.md")):
        if f.name.startswith(skip):
            continue
        for sec in f.read_text(encoding="utf-8").split("\n## ")[1:]:
            lines = sec.split("\n")
            title = lines[0].strip()
            meta = lines[1] if len(lines) > 1 else ""
            url = (re.search(r"원문:\s*(\S+)", meta) or [None, ""])[1]
            cat = (re.search(r"분류:\s*([^·]+)", meta) or [None, ""])[1].strip()
            look = [x.strip() for x in (re.search(r"찾는 말:\s*(.+)$", meta) or [None, ""])[1].split(",")]
            look.append(re.sub(r"\s*\([^)]*\)\s*$", "", title))
            body = [x for x in lines[2:] if x.strip() and not x.startswith("(그림")]
            doc = {"t": title, "url": url, "cat": cat, "body": body}
            for k in {nk(x) for x in look if x}:
                if k in names and doc not in out.setdefault(k, []):
                    out[k].append(doc)
    return out


def main() -> None:
    wiki = _read("items.json") or {}
    book = _read("book.json") or {}
    if not wiki and not book:
        print("아이템 지식: items.json·book.json 이 없어 건너뜀")
        return
    names: dict[str, str] = {}
    for n, it in wiki.items():
        names.setdefault(nk(n), n)
        for a in it.get("aka", []):
            names.setdefault(nk(a), n)
    for n in book.get("items", {}):
        names.setdefault(nk(n), n)
    finder = Finder(names)

    crafted = set()
    for r in book.get("craft", []):
        for n, _ in r["ins"] + r["to"]:
            if r.get("post"):
                crafted.add((nk(n), r["post"]))

    lore: dict[str, dict] = {}
    put = lambda k, field, v: lore.setdefault(k, {}).__setitem__(field, v)
    for k, v in post_lines(finder, crafted).items():
        put(k, "posts", v)
    for k, v in guild_lines(finder).items():
        put(k, "guild", v)
    for k, v in fandom_docs(names).items():
        put(k, "fw", v)

    # 상자·뽑기: 게임 상점 상자 구성품, 공식 확률 표
    for box, vs in book.get("items", {}).items():
        for v in vs:
            for n, c in v.get("parts") or []:
                k = nk(n)
                rows = lore.setdefault(k, {}).setdefault("box", [])
                if [box, c] not in rows:
                    rows.append([box, c])
    odds = _read("odds.json") or {}
    for t in odds.get("tables", []):
        label = " > ".join(t.get("path", []))
        for s in t.get("sections", []):
            for r in s.get("r", []):
                if not r:
                    continue
                k = nk(re.sub(r"\s*[x×]\s*\d+\s*$|\s*\(\d+개\)\s*$", "", str(r[0])))
                if k not in names:
                    continue
                prob = next((c for c in r[1:] if isinstance(c, str) and c.endswith("%")), "")
                if not prob:
                    continue  # 강화 효과 표처럼 확률이 아닌 표
                rows = lore.setdefault(k, {}).setdefault("odds", [])
                row = [t["key"], label + (" · " + s["t"] if s.get("t") and s["t"] not in label else ""), prob]
                if row not in rows and len(rows) < 30:
                    rows.append(row)

    enh = _read("enhance.json") or {}
    for w in enh.get("weapons", []):
        k = nk(w["name"])
        lore.setdefault(k, {})["enh"] = 1

    out = OUT / "lore"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.json"):
        f.unlink()
    shards: list[dict] = [{} for _ in range(SHARDS)]
    for k, v in lore.items():
        if k in names or v.get("box") or v.get("odds"):
            shards[shard(k)][k] = v
    for i, d in enumerate(shards):
        (out / f"{i:02d}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    count = lambda f: sum(1 for v in lore.values() if v.get(f))
    size = sum(p.stat().st_size for p in out.glob("*.json")) // 1024
    print("아이템 지식", {"아이템": sum(len(d) for d in shards), "카페 글": count("posts"), "길드 자료": count("guild"), "해외 위키": count("fw"),
                      "상자": count("box"), "공식 확률": count("odds"), "강화 비교": count("enh"), "kb": size, "큰 조각 kb": max(p.stat().st_size for p in out.glob("*.json")) // 1024})


if __name__ == "__main__":
    main()
