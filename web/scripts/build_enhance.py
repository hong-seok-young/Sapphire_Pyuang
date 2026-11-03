"""강화 비교 자료 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 몇 퍼센트가 강해지는지'):
자료/장비_강화·재설정/추출 (카페 글 331665 의 첨부 '아이모 무기 강화수치(26.10)', 자료/scripts/extract_enhance.py) + 위키 장비 표 -> public/data/enhance.json

계산 (엑셀 '강화 가산치' 시트): 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100). 가산값은 +0~+15 마다
전사·레인저·무도가 무기는 하나의 표(공통), 마법사 무기는 무기마다 다른 표. 엑셀 '공격력 산출값'(+0~+10)과 같은 값이 나온다.
무기 목록은 엑셀의 무기 (Lv.27 이상) + 위키 장비 표에만 있는 무기 (기본 공격은 위키 '공격' 칸, 엑셀과 겹치는 42개는 모두 같다).
마법사 무기 중 가산치 표에 없는 것은 강화 수치를 모르므로 bonus 를 비운다 (화면은 +0 만).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료" / "장비_강화·재설정" / "추출"
EQUIP = ROOT / "web" / "public" / "data" / "equipment.json"
OUT = ROOT / "web" / "public" / "data" / "enhance.json"


def key(name: str) -> str:
    return re.sub(r"\s+", "", name)


def main() -> None:
    if not (SRC / "무기_공격력.json").exists():
        print("강화 비교: 자료/장비_강화·재설정 이 없어서 건너뜀")
        return
    excel = json.loads((SRC / "무기_공격력.json").read_text(encoding="utf-8"))
    bonus = json.loads((SRC / "강화_가산치.json").read_text(encoding="utf-8"))
    common = next(iter(bonus["공통"].values()))
    mage = {key(k): v for k, v in bonus["마법사"].items()}
    weapons = []
    seen = set()
    for w in excel:
        if w["보조"]:
            continue
        lo, hi = w["단계"]["+0"]
        k = key(w["무기"])
        seen.add(k)
        weapons.append({"name": w["무기"], "job": w["직업"], "lv": w["제한"], "min": lo, "max": hi,
                        "bonus": "mage" if w["직업"] == "마법사" else "common", "src": "excel"})
    if EQUIP.exists():
        for t in json.loads(EQUIP.read_text(encoding="utf-8")):
            h = t["headers"]
            if "무기" not in t["slot"] or "공격" not in h:
                continue
            ai, li, ji = h.index("공격"), h.index("레벨제한"), h.index("직업")
            for r in t["rows"]:
                name = r["name"]
                if name.startswith("+") or "[" in name or "/" in name or key(name) in seen:
                    continue  # 미리 강화된 이벤트 무기(+4로크의검[20~29LV])와 이름이 둘로 나뉜 것은 뺀다
                m = re.match(r"^\s*(\d+)\s*[-~]\s*(\d+)", r["cells"][ai] or "")
                if not m:
                    continue
                job = r["cells"][ji]
                lv = int(r["cells"][li]) if str(r["cells"][li]).isdigit() else None
                b = ("mage" if key(name) in mage else None) if job == "마법사" else "common"
                seen.add(key(name))
                weapons.append({"name": name, "job": job, "lv": lv, "min": int(m.group(1)), "max": int(m.group(2)), "bonus": b, "src": "wiki"})
    weapons.sort(key=lambda w: (w["job"], w["lv"] or 0, w["name"]))
    data = {
        "source": "카페 글 331665 '아이모 장비 강화 수치 및 재설정 고서' 첨부 (무기 강화수치 26.10) + 위키 장비 표",
        "common": common,
        "mage": {k: v for k, v in mage.items()},
        "weapons": weapons,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("강화 비교", {"무기": len(weapons), "엑셀": sum(w["src"] == "excel" for w in weapons), "강화 모름": sum(w["bonus"] is None for w in weapons)})


if __name__ == "__main__":
    main()
