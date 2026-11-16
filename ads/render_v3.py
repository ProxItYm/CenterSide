"""
CenterSide ad — v3.

Pillow renders every frame at 1.5x and pipes raw RGB into ffmpeg (no grain filter,
no zoom artefacts). Discord UI is laid out properly and vertically centred, with a
large caption plate in the lower third so the vertical frame is never half empty.
Scene lengths follow the narration audio.
"""

import math
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

BASE = pathlib.Path(r"C:\Users\maxis\CenterSide\ads")
OUT = BASE / "centerside-ad-final.mp4"

S = 1.5
W, H = 1080, 1920
CW, CH = int(W * S), int(H * S)
FPS = 30
VOICE = "en-US-GuyNeural"
RATE = "+2%"


def px(v):
    return int(round(v * S))


def font(name, size):
    return ImageFont.truetype(str(BASE / name), px(size))


F_BOLD = "fontbold.ttf"
F_REG = "font.ttf"

BG = (49, 51, 56)
RAIL = (30, 31, 34)
SIDE = (43, 45, 49)
TEXT = (219, 222, 225)
MUTED = (148, 155, 164)
CYAN = (37, 217, 255)
MINT = (95, 255, 224)
MAGENTA = (255, 46, 230)
PINK = (240, 179, 255)
VIOLET = (200, 120, 255)


def rr(d, box, radius, fill=None, outline=None, width=2):
    d.rounded_rectangle([px(box[0]), px(box[1]), px(box[2]), px(box[3])],
                        radius=px(radius), fill=fill, outline=outline,
                        width=max(1, px(width)))


def text(d, xy, body, f, fill, anchor="la"):
    d.text((px(xy[0]), px(xy[1])), body, font=f, fill=fill, anchor=anchor)


def wrap(d, body, f, max_w):
    words, lines, line = body.split(), [], ""
    for word in words:
        test = (line + " " + word).strip()
        if d.textlength(test, font=f) <= px(max_w):
            line = test
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def glow_layer(cx, cy, radius, color, strength):
    layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for r in range(px(radius), 0, -10):
        a = int(strength * (1 - r / px(radius)) ** 1.7)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return layer


def base_canvas(t):
    img = Image.new("RGB", (CW, CH), (7, 13, 28))
    d = ImageDraw.Draw(img)
    for i in range(CH):
        frac = i / CH
        d.line([(0, i), (CW, i)], fill=(int(7 + 9 * frac), int(13 + 20 * frac), int(28 + 40 * frac)))

    cx = px(800 + 36 * math.sin(t * 0.55))
    cy = px(240 + 26 * math.cos(t * 0.45))
    img = Image.alpha_composite(img.convert("RGBA"), glow_layer(cx, cy, 640, MAGENTA, 44))
    img = Image.alpha_composite(img, glow_layer(px(160), px(1380), 640, CYAN, 52))
    return img.convert("RGB")


def ease(p):
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3


def caption_plate(img, body, size=52, y=1560):
    """Full-bleed scrim + one line of caption, kept out of TikTok's bottom UI."""
    layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top = px(y - 130)
    for i in range(top, CH):
        frac = (i - top) / max(1, CH - top)
        a = int(232 * min(1.0, frac * 1.9))
        d.line([(0, i), (CW, i)], fill=(5, 8, 15, a))

    f = font(F_BOLD, size)
    lines = wrap(d, body, f, 940)
    block = len(lines) * (size + 6)
    cy = y - block / 2
    for line in lines:
        d.text((px(W / 2), px(cy)), line, font=f,
               fill=(255, 255, 255, 255), anchor="ma")
        cy += size + 6
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


# ---------------------------------------------------------------- discord ui

def measure(d, messages, max_w):
    total = 0
    for msg in messages:
        f = font(F_REG, 34)
        lines = wrap(d, msg["text"], f, max_w)
        h = 46 + len(lines) * 46
        if msg.get("embed"):
            inner = wrap(d, msg["embed"], font(F_REG, 30), max_w - 38)
            h += 36 + len(inner) * 42
        total += h + 30
    return total


def discord_frame(t, messages, *, typing=None, clock="03:12", header_topic="billing · waiting for a reply",
                  appear_at=None, caption=None):
    """Channel view only: header, messages, optional typing. No server rail."""
    img = Image.new("RGB", (CW, CH), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, CW, px(96)], fill=BG)
    text(d, (36, 30), "#", font(F_BOLD, 30), (125, 130, 138))
    text(d, (62, 27), "ticket-0042", font(F_BOLD, 30), (243, 245, 247))
    text(d, (36, 66), header_topic, font(F_REG, 18), MUTED)

    cf = font(F_BOLD, 19)
    cw = d.textlength(clock, font=cf) / S
    rr(d, (W - 150 - cw, 30, W - 44, 70), 13, fill=(57, 60, 66))
    text(d, (W - 97 - cw / 2, 50), clock, cf, (206, 212, 220), anchor="mm")
    d.line([0, px(96), CW, px(96)], fill=(38, 40, 44))

    max_w = W - 150 - 46
    block = measure(d, messages, max_w)
    bottom_reserved = 470 if caption else 80
    area_top, area_bottom = 130, H - bottom_reserved
    y = int(area_top + max(0, (area_bottom - area_top - block) / 2))

    for i, msg in enumerate(messages):
        appear = 0.0 if appear_at is None else appear_at[i]
        p = ease((t - appear) / 0.5)
        if p <= 0:
            continue
        offset = (1 - p) * 28
        alpha = int(255 * min(1, p * 1.6))

        layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)

        color = msg.get("color", VIOLET)
        ar = px(30)
        cx, cy = px(96), px(y + 27 + offset)
        ld.ellipse([cx - ar, cy - ar, cx + ar, cy + ar], fill=color + (alpha,))
        ld.text((cx, cy - px(1)), msg["name"][0].upper(), font=font(F_BOLD, 30),
                fill=(4, 18, 31, alpha), anchor="mm")

        nf = font(F_BOLD, 32)
        ld.text((px(146), px(y + offset)), msg["name"], font=nf,
                fill=msg.get("name_color", TEXT) + (alpha,))
        nw = ld.textlength(msg["name"], font=nf) / S
        ld.text((px(146 + nw + 12), px(y + offset + 9)), msg.get("time", clock),
                font=font(F_REG, 19), fill=(122, 128, 136, alpha))

        body_f = font(F_REG, 34)
        lines = wrap(ld, msg["text"], body_f, max_w)
        ty = y + 42 + offset
        for line in lines:
            ld.text((px(146), px(ty)), line, font=body_f, fill=TEXT + (alpha,))
            ty += 46

        if msg.get("embed"):
            ex0, ey0 = 146, ty + 14
            ew = W - 146 - 46
            inner = wrap(ld, msg["embed"], font(F_REG, 30), ew - 40)
            eh = 42 + len(inner) * 42
            ld.rounded_rectangle([px(ex0), px(ey0), px(ex0 + ew), px(ey0 + eh)],
                                 radius=px(10), fill=(43, 45, 49, alpha))
            ld.rectangle([px(ex0), px(ey0), px(ex0 + 5), px(ey0 + eh)], fill=CYAN + (alpha,))
            iy = ey0 + 19
            for line in inner:
                ld.text((px(ex0 + 24), px(iy)), line, font=font(F_REG, 30),
                        fill=(206, 218, 234, alpha))
                iy += 42
            ty = ey0 + eh + 16

        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
        d = ImageDraw.Draw(img)
        y = int(ty + 30)

    if typing:
        tp = ease((t - typing) / 0.4) if t > typing else 0
        if tp > 0:
            ay = y + 4
            img = img.convert("RGBA")
            ld = ImageDraw.Draw(img)
            ld.ellipse([px(64), px(ay), px(118), px(ay + 54)], fill=CYAN + (235,))
            ld.text((px(91), px(ay + 27)), "C", font=font(F_BOLD, 24), fill=(4, 18, 31), anchor="mm")
            dots = "." * (int(t * 3) % 3 + 1)
            ld.text((px(134), px(ay + 27)), f"CenterSide is typing{dots}",
                    font=font(F_REG, 21), fill=MUTED, anchor="lm")
            img = img.convert("RGB")

    if caption:
        img = caption_plate(img, caption)

    return img


# ---------------------------------------------------------------- cards

def headline_card(t, kicker, rows, sub=None, caption=None):
    img = base_canvas(t)
    d = ImageDraw.Draw(img)
    y = 620

    kf = font(F_BOLD, 19)
    d.line([px(100), px(y + 12), px(146), px(y + 12)], fill=CYAN, width=px(2))
    text(d, (160, y), kicker, kf, CYAN)

    y += 66
    for body, size, fill in rows:
        for line in wrap(d, body, font(F_BOLD, size), 880):
            text(d, (100, y), line, font(F_BOLD, size), fill)
            y += size + 8
        y += 10

    if sub:
        y += 14
        for line in wrap(d, sub, font(F_REG, 28), 840):
            text(d, (100, y), line, font(F_REG, 28), (169, 193, 224))
            y += 40

    if caption:
        img = caption_plate(img, caption)
    return img


def features_card(t):
    img = base_canvas(t)
    d = ImageDraw.Draw(img)
    items = [
        ("Private ticket channels", "one channel per member, nothing leaks"),
        ("Answers from YOUR server", "no guessing, no invented policy"),
        ("Text transcripts on close", "plain text, saved and DM'd"),
        ("Staff pinged only when needed", "a human only when it matters"),
    ]
    y = 560
    for i, (label, sub) in enumerate(items):
        p = ease((t - 0.15 - i * 0.14) / 0.45)
        if p <= 0:
            continue
        off = (1 - p) * 34
        col = MINT if i % 2 else CYAN
        rr(d, (100, y + off - 10, 148, y + off + 38), 14, fill=(18, 32, 54), outline=col + (110,), width=2)
        d.ellipse([px(120), px(y + off + 10), px(128), px(y + off + 18)], fill=col)
        text(d, (176, y + off - 6), label, font(F_BOLD, 40), (233, 242, 255))
        text(d, (176, y + off + 44), sub, font(F_REG, 23), (139, 160, 190))
        y += 140

    return caption_plate(img, "one bot, the whole desk")


def price_card(t):
    img = base_canvas(t)
    d = ImageDraw.Draw(img)
    p = ease((t - 0.1) / 0.5)
    text(d, (100, 660 + (1 - p) * 46), "FREE.", font(F_BOLD, 168), (255, 255, 255))
    text(d, (100, 866 + (1 - p) * 46), "FOREVER.", font(F_BOLD, 168), CYAN)
    text(d, (106, 1092), "no card · no seat limits · no ticket caps", font(F_REG, 32), (169, 193, 224))
    return caption_plate(img, "never paywalled")


def logo(d, cx, cy, r, t):
    for k in (r * 1.9, r * 1.55, r * 1.25):
        a = int(26 * (1 - (k - r) / r) ** 1.5)
        d.ellipse([cx - k, cy - k, cx + k, cy + k], outline=CYAN + (max(0, a),), width=px(2))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(8, 18, 38))
    d.arc([cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9],
          start=-60 + t * 10, end=250 + t * 10, fill=CYAN, width=px(14))
    d.arc([cx - r * 0.56, cy - r * 0.56, cx + r * 0.56, cy + r * 0.56],
          start=-40 - t * 8, end=270 - t * 8, fill=(11, 155, 255), width=px(9))
    d.ellipse([cx - r * 0.27, cy - r * 0.27, cx + r * 0.27, cy + r * 0.27], fill=(150, 248, 255))


def end_card(t):
    img = base_canvas(t)
    d = ImageDraw.Draw(img)
    logo(d, px(540), px(800), px(148), t)
    text(d, (540, 1030), "CenterSide", font(F_BOLD, 100), (255, 255, 255), anchor="ma")
    text(d, (540, 1156), "free · any server · 2 minute setup", font(F_REG, 34), MINT, anchor="ma")
    rr(d, (150, 1244, 930, 1334), 45, fill=(20, 40, 66), outline=CYAN + (120,), width=2)
    text(d, (540, 1289), "proxitym.github.io/CenterSide", font(F_BOLD, 31), CYAN, anchor="mm")
    return img


# ---------------------------------------------------------------- timeline

LINES = [
    "It's three in the morning, and a ticket comes in.",
    "Nobody answers. For two hours.",
    "Then the same question gets answered forty times a day anyway.",
    "CenterSide answers in under half a second.",
    "Private tickets. Answers built from your own server. Transcripts on close.",
    "And it's free. No card, no limits.",
    "CenterSide. Link in bio.",
]


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        print(" ".join(cmd))
        print(result.stderr[-2000:])
        sys.exit(1)
    return result


def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", str(path)])
    return float(out.stdout.strip())


audio_paths = []
for i, line in enumerate(LINES):
    path = BASE / f"line-{i}.mp3"
    run([sys.executable, "-m", "edge_tts", "--voice", VOICE, "--rate", RATE,
         "--text", line, "--write-media", str(path)])
    audio_paths.append(path)

lengths = [duration(p) for p in audio_paths]
scene_len = [lengths[0] + 1.3, lengths[1] + 1.1, lengths[2] + 1.0,
             lengths[3] + 1.2, lengths[4] + 1.0, lengths[5] + 1.0, lengths[6] + 1.8]
starts, acc = [], 0.0
for d in scene_len:
    starts.append(acc)
    acc += d
TOTAL = acc
print("scenes:", [round(x, 2) for x in scene_len], "total:", round(TOTAL, 2))

chat1 = [{"name": "juno", "text": "yo my vip role just vanished", "color": VIOLET,
          "name_color": PINK, "time": "03:12"}]
chat2 = chat1 + [{"name": "juno", "text": "anyone?", "color": VIOLET,
                  "name_color": PINK, "time": "03:41"}]
bot_chat = [
    {"name": "juno", "text": "my vip role vanished after i renewed", "color": VIOLET,
     "name_color": PINK, "time": "03:12"},
    {"name": "CenterSide", "text": "Your renewal landed at 21:04 — the role sync is stuck on the store side.",
     "color": CYAN, "name_color": CYAN, "time": "03:12",
     "embed": "I've flagged it to @Billing with your order id attached. You should have it back within the hour, no need to buy again."},
]


def scene_frame(scene, t):
    if scene == 0:
        return discord_frame(t, chat1, appear_at=[0.15], clock="03:12",
                             caption="3:12am — a ticket comes in")
    if scene == 1:
        return discord_frame(t, chat2, appear_at=[-10, 1.6], clock="05:41",
                             header_topic="billing · still waiting",
                             caption="2 hours later… nobody answered")
    if scene == 2:
        return headline_card(t, "THE REAL COST", [
            ("Answering the same", 74, (255, 255, 255)),
            ("question 40 times", 74, CYAN),
            ("a day.", 74, (255, 255, 255)),
        ], "Every one of them steals a minute from your staff.", caption="that is the whole job")
    if scene == 3:
        return discord_frame(t, bot_chat, appear_at=[0.1, 1.3], clock="03:12",
                             header_topic="billing · CenterSide is here",
                             caption="answered in 0.4 seconds")
    if scene == 4:
        return features_card(t)
    if scene == 5:
        return price_card(t)
    return end_card(t)


cmd = [
    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{CW}x{CH}", "-r", str(FPS), "-i", "-",
    "-vf", f"scale={W}:{H}:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    str(BASE / "video-only.mp4"),
]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

total_frames = int(round(TOTAL * FPS))
for frame_index in range(total_frames):
    t_global = frame_index / FPS
    scene = 0
    for i, start in enumerate(starts):
        if t_global >= start:
            scene = i
    img = scene_frame(scene, t_global - starts[scene])

    if t_global < 0.35:
        img = Image.blend(Image.new("RGB", (CW, CH), (0, 0, 0)), img, t_global / 0.35)
    if TOTAL - t_global < 0.45:
        img = Image.blend(Image.new("RGB", (CW, CH), (0, 0, 0)), img,
                          max(0.0, (TOTAL - t_global) / 0.45))

    proc.stdin.write(img.tobytes())
    if frame_index % 150 == 0:
        print(f"frame {frame_index}/{total_frames}", flush=True)

proc.stdin.close()
proc.wait()
if proc.returncode:
    sys.exit(1)

cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
for path in audio_paths:
    cmd += ["-i", str(path)]
cmd += ["-i", str(BASE / "video-only.mp4")]

chain = []
for i, start in enumerate(starts):
    delay = int(start * 1000)
    chain.append(f"[{i}:a]adelay={delay}|{delay}[a{i}]")
chain.append("".join(f"[a{i}]" for i in range(len(audio_paths))) +
             f"amix=inputs={len(audio_paths)}:normalize=0,loudnorm=I=-15:TP=-1.0:LRA=9[aout]")

cmd += ["-filter_complex", ";".join(chain)]
cmd += ["-map", f"{len(audio_paths)}:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-t", f"{TOTAL:.2f}", "-movflags", "+faststart", str(OUT)]
run(cmd)

print("final:", OUT, round(OUT.stat().st_size / 1024 / 1024, 1), "MB", round(duration(OUT), 2), "s")
for path in BASE.glob("line-*.mp3"):
    path.unlink(missing_ok=True)
