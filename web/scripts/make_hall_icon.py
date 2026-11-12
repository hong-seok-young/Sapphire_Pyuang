"""명예의 전당 홈 칸 아이콘 (2026-11-12 제작자 '명예의 전당은 길드 랭킹과 아이콘 다르게': 둘 다 🏆 였다).
강화 비교·성장코인샵 아이콘과 같이 18x18 도트로 그린 금빛 전당(기둥과 지붕, 지붕 가운데 사파이어)을 6배(108px)로 키워 저장한다.

    python web/scripts/make_hall_icon.py   ->  web/public/icons/hall.png
"""
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "public" / "icons" / "hall.png"
N = 18
SCALE = 6
P = {
    "k": (26, 18, 38), "w": (255, 255, 255), "o": (255, 244, 170), "y": (255, 214, 64), "Y": (214, 142, 26),
    "N": (150, 88, 20), "d": (52, 34, 70), "b": (70, 140, 255), "B": (34, 76, 200), "c": (170, 215, 255),
}


def main() -> None:
    cells: dict[tuple[int, int], str] = {}
    # 지붕 (세모), 가운데 사파이어
    for y, (a, b) in {2: (8, 9), 3: (6, 11), 4: (4, 13), 5: (2, 15)}.items():
        for x in range(a, b + 1):
            cells[(x, y)] = "y"
    for x in range(2, 16):
        cells[(x, 5)] = "Y"
    for (x, y), c in {(8, 3): "c", (9, 3): "b", (8, 4): "b", (9, 4): "B"}.items():
        cells[(x, y)] = c
    # 처마 두 줄
    for x in range(1, 17):
        cells[(x, 6)] = "o" if x < 9 else "y"
    for x in range(2, 16):
        cells[(x, 7)] = "Y"
    # 기둥 넷 (왼쪽 밝고 오른쪽 그늘), 사이는 어두운 안쪽
    for y in range(8, 14):
        for x in range(2, 16):
            cells[(x, y)] = "d"
        for left in (2, 6, 10, 14):
            cells[(left, y)] = "o"
            cells[(left + 1, y)] = "y" if y < 13 else "Y"
    # 받침과 계단
    for x in range(1, 17):
        cells[(x, 14)] = "y"
    for x in range(0, 18):
        cells[(x, 15)] = "Y" if x < 17 else "N"
    for x in range(0, 18):
        cells[(x, 16)] = "N"
    # 테두리 (바깥 한 칸)
    out = dict(cells)
    for x in range(N):
        for y in range(N):
            if (x, y) not in cells and any((x + dx, y + dy) in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out[(x, y)] = "k"
    # 반짝임 (테두리 없이)
    for x, y in ((15, 0), (14, 1), (16, 1), (15, 2), (15, 1)):
        out[(x, y)] = "w" if (x, y) == (15, 1) else "o"
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    for (x, y), c in out.items():
        if 0 <= x < N and 0 <= y < N:
            im.putpixel((x, y), (*P[c], 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.resize((N * SCALE, N * SCALE), Image.NEAREST).save(OUT, optimize=True)
    print("icon:", OUT)


if __name__ == "__main__":
    main()
