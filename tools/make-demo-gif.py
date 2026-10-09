"""Build the README demo GIF from the two state screenshots.

Two honest frames, taken by test/visual-check.mjs from the real Chrome probes:
  1. assets/step-fold-default.png  — every Turn shows ONE button, steps folded
  2. assets/step-fold-expanded.png — the same conversation with the steps opened

Run: python tools/make-demo-gif.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FRAMES = [ASSETS / "step-fold-default.png", ASSETS / "step-fold-expanded.png"]
OUT = ASSETS / "demo.gif"

WIDTH = 900          # README-friendly: keeps the file small
HOLD_MS = [1400, 2600]  # the expanded frame lingers, so the change is readable


def main() -> None:
    frames = []
    for path, hold in zip(FRAMES, HOLD_MS):
        image = Image.open(path).convert("RGB")
        ratio = WIDTH / image.width
        image = image.resize((WIDTH, round(image.height * ratio)), Image.LANCZOS)
        # A shared 128-colour palette keeps the two frames from flickering.
        frames.append((image.quantize(colors=128, method=Image.MEDIANCUT), hold))

    first, *rest = frames
    first[0].save(
        OUT,
        save_all=True,
        append_images=[frame for frame, _ in rest],
        duration=[hold for _, hold in frames],
        loop=0,
        optimize=True,
        disposal=2,
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(ROOT)}  {WIDTH}px wide, {len(frames)} frames, {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
