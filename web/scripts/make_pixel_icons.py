"""Pixel icons for the app's own buttons (bell, tabs, my info, app download), drawn to sit next to IMO item icons
(제작자 요청: 아이콘을 아이모 그래픽 느낌으로). 16x16 sprites with a dark outline, shown 2~3x with pixelated scaling.
Where the game has a picture (book, medal, coin, scroll ...), the app uses the game's own item icon instead (Home.tsx).

    python web/scripts/make_pixel_icons.py   ->  web/public/icons/*.png
"""
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"

PALETTE = {
    ".": None,
    "k": (26, 18, 38),     # outline
    "w": (255, 255, 255),
    "l": (214, 214, 228),  # light gray
    "g": (140, 140, 160),  # gray
    "G": (92, 92, 112),    # dark gray
    "y": (255, 214, 64),   # gold
    "Y": (214, 142, 26),   # dark gold
    "o": (255, 244, 170),  # gold highlight
    "r": (232, 72, 60),    # red
    "R": (156, 36, 48),    # dark red
    "b": (80, 168, 255),   # blue
    "B": (40, 92, 184),    # dark blue
    "c": (176, 232, 255),  # glass
    "n": (176, 104, 48),   # brown
    "N": (110, 60, 28),    # dark brown
    "q": (246, 228, 182),  # paper
    "Q": (214, 184, 118),  # paper shade
    "e": (88, 200, 96),    # green
    "E": (40, 128, 60),    # dark green
    "s": (250, 204, 160),  # skin
    "p": (178, 132, 255),  # purple
    "P": (104, 64, 196),   # dark purple
}

SPRITES = {
    "bell": [
        "................",
        ".......kk.......",
        "......kyyk......",
        ".....kyoyyk.....",
        "....kyoyyyyk....",
        "....kyoyyyyk....",
        "...kyoyyyyyyk...",
        "...kyoyyyyyyk...",
        "...kyyyyyyyyk...",
        "..kyyyyyyyyyyk..",
        "..kYyyyyyyyyYk..",
        ".kYYYYYYYYYYYYk.",
        ".kkkkkkkkkkkkkk.",
        "......kYYk......",
        ".......kk.......",
        "................",
    ],
    "home": [
        "................",
        ".......kk.......",
        "......krrk......",
        ".....krrrrk.....",
        "....krrrrrrk....",
        "...krrrrrrrrk...",
        "..krrrrrrrrrrk..",
        ".kRRRRRRRRRRRRk.",
        "..kqqqqqqqqqqk..",
        "..kqkkkqqkkkqk..",
        "..kqkbkqqknkqk..",
        "..kqkkkqqknkqk..",
        "..kqqqqqqknkqk..",
        "..kQQQQQQknkQk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
    "map": [
        "................",
        ".kkkkkkkkkkkkkk.",
        ".kqqqqqQqqqqqqk.",
        ".kqeeqqQqqbbbqk.",
        ".kqeeeqQqbbbbqk.",
        ".kqqeqqQqqbbqqk.",
        ".kqqqqqQqqqqqqk.",
        ".kqqrqqQqrqqqqk.",
        ".kqqqrqQrqqeeqk.",
        ".kqqqqrQqqqeeqk.",
        ".kqbbrqQrqqqqqk.",
        ".kqbbqqQqrqqqqk.",
        ".kqqqqqQqqqqqqk.",
        ".kQQQQQQQQQQQQk.",
        ".kkkkkkkkkkkkkk.",
        "................",
    ],
    "search": [
        "................",
        "...kkkkk........",
        "..kcwwcck.......",
        ".kcwccccck......",
        ".kcwccccck......",
        ".kccccccck......",
        ".kccccccck......",
        "..kccccck.......",
        "...kkkkkkk......",
        "........kNNk....",
        ".........kNNk...",
        "..........kNNk..",
        "...........kNNk.",
        "............kkk.",
        "................",
        "................",
    ],
    "gear": [
        "................",
        "..kkkkkkkkkkkk..",
        "..kllllllllllk..",
        "..klrrrrrrrrlk..",
        "..klrRrrrrRrlk..",
        "..klrrryyrrrlk..",
        "..klrrryyrrrlk..",
        "..klrrrrrrrrlk..",
        "..klrrrrrrrrlk..",
        "...klrrrrrrlk...",
        "...klrrRrrrlk...",
        "....klrrrrlk....",
        ".....klrrlk.....",
        "......kllk......",
        ".......kk.......",
        "................",
    ],
    "info": [
        "................",
        "................",
        "................",
        ".kkkkkk..kkkkkk.",
        "kqqqqqqkkqqqqqqk",
        "kqggggqkkqggggqk",
        "kqqqqqqkkqqqqqqk",
        "kqgggqqkkqggggqk",
        "kqqqqqqkkqqqqqqk",
        "kqggggqkkqgggqqk",
        "kqqqqqqkkqqqqqqk",
        "kQQQQQQkkQQQQQQk",
        "kBBBBBBkkBBBBBBk",
        ".kkkkkkkkkkkkkk.",
        "................",
        "................",
    ],
    "chat": [
        "................",
        "................",
        "................",
        "..kkkkkkkkkkkk..",
        ".kwwwwwwwwwwwwk.",
        ".kwwwwwwwwwwwwk.",
        ".kwkkwwkkwwkkwk.",
        ".kwkkwwkkwwkkwk.",
        ".kwwwwwwwwwwwwk.",
        ".kllllllllllllk.",
        "..kkkkklllkkkk..",
        "......kllk......",
        ".......kk.......",
        "................",
        "................",
        "................",
    ],
    "me": [
        "................",
        "......kkkk......",
        ".....knnnnk.....",
        "....knnnnnnk....",
        "....knsssssk....",
        "....kssssssk....",
        "....kskssksk....",
        ".....kssssk.....",
        "......kssk......",
        "....kkbbbbkk....",
        "...kbbbbbbbbk...",
        "..kbbbbbbbbbbk..",
        "..kbbbbbbbbbbk..",
        "..kBBBBBBBBBBk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
    "phone": [
        "................",
        "....kkkkkkkk....",
        "...kGGGGGGGGk...",
        "...kGccccccGk...",
        "...kGwcceccGk...",
        "...kGcceeccGk...",
        "...kGcceeccGk...",
        "...kGeeeeeeGk...",
        "...kGceeeecGk...",
        "...kGcceeccGk...",
        "...kGccccccGk...",
        "...kGGGGGGGGk...",
        "...kGGGllGGGk...",
        "...kGGGGGGGGk...",
        "....kkkkkkkk....",
        "................",
    ],
}


def fix(rows: list[str]) -> list[str]:
    """Rows typed by hand: pad or cut to 16, and turn a capital K (outline written inside a row) into k."""
    return [(r.replace("K", "k") + "." * 16)[:16] for r in rows]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, rows in SPRITES.items():
        rows = fix(rows)
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = im.load()
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                color = PALETTE.get(ch)
                if color:
                    px[x, y] = (*color, 255)
        im.save(OUT / f"{name}.png")
    print("icons:", ", ".join(SPRITES))


if __name__ == "__main__":
    main()
