from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "scribepad-review-demo.gif"
W, H = 960, 540


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


TITLE = font(22, True)
BODY = font(16)
SMALL = font(13)
MONO = font(14)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = None, radius: int = 12) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, fill: str = "#24292f", fnt=BODY) -> None:
    draw.text(xy, value, fill=fill, font=fnt)


def base_frame() -> Image.Image:
    img = Image.new("RGB", (W, H), "#f6f8fa")
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, H), fill="#f6f8fa")
    rounded(draw, (42, 34, 918, 506), "#ffffff", "#d0d7de", 16)
    draw.rounded_rectangle((42, 34, 918, 82), radius=16, fill="#24292f")
    draw.rectangle((42, 58, 918, 82), fill="#24292f")
    for i, color in enumerate(["#ff5f57", "#ffbd2e", "#28c840"]):
        draw.ellipse((70 + i * 24, 53, 82 + i * 24, 65), fill=color)
    text(draw, (132, 50), "scribepad", "#f6f8fa", TITLE)
    text(draw, (245, 55), "Review long AI plans before implementation", "#8c959f", SMALL)
    return img


def draw_outline(draw: ImageDraw.ImageDraw, active: int, locked: set[int]) -> None:
    rounded(draw, (66, 108, 300, 476), "#f6f8fa", "#d0d7de", 10)
    text(draw, (88, 130), "Plan outline", "#24292f", TITLE)
    items = [
        "Problem framing",
        "Implementation steps",
        "Risk checkpoints",
        "Handoff contract",
    ]
    for i, item in enumerate(items):
        y = 180 + i * 62
        fill = "#dbeafe" if i == active else "#ffffff"
        outline = "#0969da" if i == active else "#d0d7de"
        rounded(draw, (86, y, 280, y + 42), fill, outline, 8)
        if i in locked:
            draw.arc((105, y + 9, 121, y + 25), 180, 360, fill="#1f883d", width=3)
            draw.rounded_rectangle((104, y + 19, 122, y + 32), radius=3, fill="#1f883d")
            draw.rectangle((112, y + 25, 114, y + 29), fill="#ffffff")
        else:
            draw.ellipse((104, y + 12, 122, y + 30), outline="#8c959f", width=2)
            draw.ellipse((110, y + 18, 116, y + 24), fill="#8c959f")
        text(draw, (134, y + 13), item, "#24292f", SMALL)


def draw_doc(draw: ImageDraw.ImageDraw, focus: int, locked: set[int], approved: bool) -> None:
    rounded(draw, (326, 108, 646, 476), "#ffffff", "#d0d7de", 10)
    text(draw, (352, 130), "docs/plan.md", "#24292f", TITLE)
    sections = [
        ("## Problem framing", ["Clarify the review gate before code.", "Keep decisions visible and explicit."]),
        ("## Implementation steps", ["Parse Markdown into reviewable sections.", "Track locked checkpoints locally."]),
        ("## Risk checkpoints", ["Do not continue without human approval.", "Export a clean agent-readable plan."]),
        ("## Handoff contract", ["Return exactly one approved Markdown path.", "Let Codex or Claude continue from there."]),
    ]
    y = 178
    for i, (heading, lines) in enumerate(sections):
        if i == focus:
            rounded(draw, (348, y - 8, 624, y + 67), "#fff8c5" if i not in locked else "#dafbe1", None, 8)
        text(draw, (360, y), heading, "#0969da" if i == focus else "#57606a", MONO)
        for j, line in enumerate(lines):
            text(draw, (376, y + 24 + j * 18), line, "#24292f", SMALL)
        y += 76
    if approved:
        rounded(draw, (430, 410, 540, 450), "#1f883d", None, 9)
        text(draw, (459, 421), "Done", "#ffffff", BODY)


def draw_panel(draw: ImageDraw.ImageDraw, step: int, lock_progress: float, approved: bool) -> None:
    rounded(draw, (672, 108, 894, 476), "#f6f8fa", "#d0d7de", 10)
    text(draw, (696, 130), "Review", "#24292f", TITLE)
    labels = ["Inspect", "Lock", "Normalize", "Export"]
    for i, label in enumerate(labels):
        y = 182 + i * 54
        active = i == step
        rounded(draw, (696, y, 870, y + 36), "#dbeafe" if active else "#ffffff", "#0969da" if active else "#d0d7de", 8)
        text(draw, (718, y + 9), label, "#0969da" if active else "#57606a", BODY)
    if step == 1:
        x = int(728 + lock_progress * 78)
        draw.line((728, 394, 806, 394), fill="#8c959f", width=8)
        draw.ellipse((x - 12, 382, x + 12, 406), fill="#1f883d")
        text(draw, (824, 384), "locked", "#1f883d", SMALL)
    elif step == 3 or approved:
        rounded(draw, (714, 378, 854, 424), "#1f883d", None, 9)
        text(draw, (742, 392), "Approved", "#ffffff", BODY)
        text(draw, (704, 440), "~/.local/state/scribepad/...", "#57606a", SMALL)
    else:
        text(draw, (704, 386), "Human review stays in control.", "#57606a", SMALL)


def frame_at(index: int) -> Image.Image:
    phase = min(index // 18, 3)
    local = index % 18
    locked = {1, 2} if phase >= 2 else ({1} if phase == 1 and local > 9 else set())
    approved = phase == 3 and local > 8
    img = base_frame()
    draw = ImageDraw.Draw(img)
    draw_outline(draw, phase, locked)
    draw_doc(draw, phase, locked, approved)
    draw_panel(draw, phase, min(local / 12, 1), approved)
    if not approved:
        cursor_x = 700 + min(local, 12) * 9
        cursor_y = 196 + phase * 54
        draw.polygon([(cursor_x, cursor_y), (cursor_x, cursor_y + 28), (cursor_x + 19, cursor_y + 19)], fill="#24292f")
    return img


def main() -> None:
    frames = [frame_at(i) for i in range(72)]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=80,
        loop=0,
        optimize=True,
    )
    print(OUT)


if __name__ == "__main__":
    main()
