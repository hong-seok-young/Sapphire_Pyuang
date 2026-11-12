"""성장코인샵 홈 칸 아이콘 (2026-11-12 제작자 '크롬에서 보면 왜 이미지 안 나와': 🪙 는 2020년 이모지라 윈도우 10 크롬에서 빈 네모로 나온다).
강화 비교 아이콘과 같이 18x18 도트로 그린 금화 + 성장 화살표를 6배(108px)로 키워 저장한다.

    python web/scripts/make_gcoin_icon.py   ->  web/public/icons/gcoin.png
"""
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "public" / "icons" / "gcoin.png"
N = 18
SCALE = 6
P = {
    "k": (26, 18, 38), "w": (255, 255, 255), "o": (255, 244, 170), "y": (255, 214, 64), "Y": (214, 142, 26),
    "N": (150, 88, 20), "g": (96, 222, 120), "G": (34, 150, 70),
}


def main() -> None:
    cells: dict[tuple[int, int], str] = {}
    cx = cy = 8.5
    # 금화: 바깥 테(진한 금), 안쪽 면(금), 왼쪽 위 빛
    for x in range(N):
        for y in range(N):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if d2 <= 7.6 ** 2:
                cells[(x, y)] = "Y" if d2 > 6.0 ** 2 else "y"
    for x, y in ((4, 5), (5, 4), (4, 6), (6, 4), (5, 5)):
        cells[(x, y)] = "o"
    # 아래·오른쪽 그림자 테
    for (x, y), c in list(cells.items()):
        if c == "Y" and (x - cx) + (y - cy) > 4:
            cells[(x, y)] = "N"
    # 성장 화살표 (가운데, 초록 위로)
    for y in range(7, 14):
        cells[(8, y)] = "g"
        cells[(9, y)] = "G"
    for i, y in enumerate((4, 5, 6)):
        for x in range(8 - i, 10 + i):
            cells[(x, y)] = "g" if x <= 8 else "G"
    # 테두리 (바깥 한 칸)
    out = dict(cells)
    for x in range(N):
        for y in range(N):
            if (x, y) not in cells and any((x + dx, y + dy) in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out[(x, y)] = "k"
    # 반짝임 (테두리 없이)
    for x, y in ((16, 1), (15, 2), (17, 2), (16, 3), (16, 2)):
        out[(x, y)] = "w" if (x, y) == (16, 2) else "o"
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    for (x, y), c in out.items():
        if 0 <= x < N and 0 <= y < N:
            im.putpixel((x, y), (*P[c], 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((N * SCALE, N * SCALE), Image.NEAREST).save(OUT, optimize=True)
    print("icon:", OUT)


if __name__ == "__main__":
    main()
