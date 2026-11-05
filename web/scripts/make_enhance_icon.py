"""강화 비교 홈 칸 아이콘 (제작자 2026-11-05: 초안 5개 중 3안 '빛나는 검 + 강화 별빛').
18x18 도트로 그린 뒤 6배(108px)로 키워 저장한다: 칸에서 36px 로 보이므로 폰 화면 배율 2·3배에서 도트가 그대로 또렷하다.

    python web/scripts/make_enhance_icon.py   ->  web/public/icons/enhance.png
"""
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "public" / "icons" / "enhance.png"
N = 18
SCALE = 6
P = {
    "k": (26, 18, 38), "w": (255, 255, 255), "y": (255, 214, 64), "Y": (214, 142, 26), "o": (255, 244, 170),
    "b": (80, 168, 255), "c": (176, 232, 255), "n": (176, 104, 48), "N": (110, 60, 28),
}


def main() -> None:
    main_cells: dict[tuple[int, int], str] = {}
    fx: dict[tuple[int, int], str] = {}

    def px(x: int, y: int, c: str, glow: bool = False) -> None:
        if 0 <= x < N and 0 <= y < N:
            (fx if glow else main_cells)[(x, y)] = c

    # 날 (왼쪽 아래 -> 오른쪽 위, 흰빛과 하늘빛 두 칸)
    for i in range(9):
        px(6 + i, 11 - i, "w")
        px(7 + i, 11 - i, "c")
    px(15, 2, "w")
    px(16, 1, "w")
    # 가드, 손잡이, 사파이어 끝
    for x, y in ((3, 9), (4, 10), (5, 11), (6, 12), (7, 13), (8, 14)):
        px(x, y, "y")
    px(3, 9, "Y")
    px(8, 14, "Y")
    px(5, 12, "n")
    px(4, 13, "N")
    px(3, 14, "n")
    for x, y in ((1, 14), (2, 14), (1, 15), (2, 15)):
        px(x, y, "b")
    px(1, 14, "c")
    # 강화 별빛 (테두리 없이)
    px(4, 4, "w", True)
    for d in (1, 2, 3):
        c = "y" if d < 3 else "o"
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            px(4 + dx, 4 + dy, c, True)
    px(14, 8, "o", True)
    px(9, 3, "y", True)

    cells = dict(main_cells)
    for x in range(N):
        for y in range(N):
            if (x, y) not in main_cells and any((x + dx, y + dy) in main_cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                cells[(x, y)] = "k"
    cells.update(fx)
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    for (x, y), c in cells.items():
        im.putpixel((x, y), (*P[c], 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((N * SCALE, N * SCALE), Image.NEAREST).save(OUT, optimize=True)
    print("icon:", OUT)


if __name__ == "__main__":
    main()
