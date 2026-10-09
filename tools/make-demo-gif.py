"""Build the README demo GIF from the three state frames.

Three honest frames, captured by test/visual-check.mjs from a real headless
Chrome running the built plugin (assets/demo-1..3-*.png):

  1. demo-1-folded.png  状态0 — one control per Turn, the steps stay folded
  2. demo-2-spread.png  状态1 — the seams spread: 本步骤 / 展开全部 / 所有步骤
  3. demo-3-open.png    状态2 — every step of that Turn is open

All three are cropped to the SAME window, so the GIF shows the controls changing
instead of the page scrolling, and only that window is embedded in the README.

Run: python tools/make-demo-gif.py
"""
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FRAMES = [
    ASSETS / "demo-1-folded.png",
    ASSETS / "demo-2-spread.png",
    ASSETS / "demo-3-open.png",
]
OUT = ASSETS / "demo.gif"
SHEET = Path(tempfile.gettempdir()) / "dsh-demo-frames-preview.png"  # for eyeballing, never committed

# The window every frame is cut to: the last Turn's two step groups plus the seam
# that carries the controls. Measured once, on the 984x1505 capture.
CROP = (0, 1068, 984, 1400)
WIDTH = 840  # README-friendly: keeps the file small
HOLD_MS = [1300, 1500, 2600]  # the opened frame lingers, so the change is readable


def load(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB").crop(CROP)
    ratio = WIDTH / image.width
    return image.resize((WIDTH, round(image.height * ratio)), Image.LANCZOS)


def main() -> None:
    images = [load(path) for path in FRAMES]
    # One shared palette for every frame: without it the colours shift between
    # frames and the GIF flickers.
    palette = images[0].quantize(colors=128, method=Image.MEDIANCUT)
    frames = [image.quantize(palette=palette, dither=Image.FLOYDSTEINBERG) for image in images]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=HOLD_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(ROOT)}  {WIDTH}px wide, {len(frames)} frames, {size_kb:.0f} KB")

    # Side-by-side contact sheet, so the frames can be inspected in one look.
    width, height = frames[0].size
    sheet = Image.new("RGB", (width * len(frames) + 8 * (len(frames) - 1), height), "white")
    for index, frame in enumerate(frames):
        sheet.paste(frame.convert("RGB"), (index * (width + 8), 0))
    sheet.save(SHEET)
    print(f"wrote {SHEET.name} (preview only)")


if __name__ == "__main__":
    main()
