"""강화 비교 자료 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 몇 퍼센트가 강해지는지'):
자료/장비_강화·재설정/추출 (카페 글 331665 의 첨부 '아이모 무기 강화수치(26.10)', 자료/scripts/extract_enhance.py) + 위키 장비 표 -> public/data/enhance.json

계산 (엑셀 '강화 가산치' 시트): 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100). 가산값은 +0~+15 마다
전사·레인저·무도가 무기는 하나의 표(공통), 마법사 무기는 무기마다 다른 표. 엑셀 '공격력 산출값'(+0~+10)과 같은 값이 나온다.
무기 목록은 제작자가 준 엑셀의 무기 42개만 (Lv.27 이상, 보조무기 빼고. 제작자 2026-11-04 '내가 준 강화 데이터에 있는 무기들만':
처음엔 위키 장비 표에만 있는 무기도 공통 가산치로 넣었었다).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "자료" / "장비_강화·재설정" / "추출"
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
    weapons.sort(key=lambda w: (w["job"], w["lv"] or 0, w["name"]))
    data = {
        "source": "카페 글 331665 '아이모 장비 강화 수치 및 재설정 고서' 첨부 (무기 강화수치 26.10)",
        "common": common,
        "mage": {k: v for k, v in mage.items()},
        "weapons": weapons,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("강화 비교", {"무기": len(weapons), "직업": {j: sum(w["job"] == j for w in weapons) for j in ("전사", "레인저", "마법사", "무도가")}})


if __name__ == "__main__":
    main()
