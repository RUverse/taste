"""Build spec/examples/moods.taste, a small sample that uses most of the format.

Run from python/: ``uv run python scripts/build_example.py``. Images are generated, and every
timestamp is fixed, so rebuilding gives the same manifest.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import taste.document
from taste import Taste

STAMP = "2026-10-03T12:00:00Z"
OUTPUT = Path(__file__).resolve().parents[2] / "spec" / "examples" / "moods.taste"
AGENT = "agent:hermes"


def image(
    width: int,
    height: int,
    top: tuple[int, int, int],
    bottom: tuple[int, int, int],
    label: str,
    fmt: str = "PNG",
) -> bytes:
    canvas = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(canvas)
    for y in range(height):
        mix = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(a + (b - a) * mix) for a, b in zip(top, bottom, strict=True)),
        )
    draw.text((width // 20, height // 20), label, fill=(240, 240, 240))
    output = io.BytesIO()
    canvas.save(output, fmt, **({"quality": 85} if fmt == "JPEG" else {"optimize": True}))
    return output.getvalue()


def build() -> Taste:
    taste.document.now = lambda: STAMP  # type: ignore[assignment]
    doc = Taste.new("rez's moods", "A sample .taste file with two collections.")

    rainy = doc.add_collection(
        "Rainy Sunday",
        vibe="Quiet, melancholic, warm. Grey light, slow pacing, nothing loud.",
        tags={"mood": ["melancholic", "cozy"], "season": "autumn"},
        icon="cloud-rain",
    )["id"]
    neon = doc.add_collection(
        "Neon Nights",
        vibe="Lonely cities after midnight: wet streets, synths, people passing each other.",
        tags={"mood": ["lonely", "dreamy"], "palette": ["magenta", "cyan"]},
        icon="moon",
    )["id"]
    doc.set_cover(neon, image(600, 600, (40, 0, 60), (0, 90, 120), "Neon Nights", "JPEG"))

    lost = doc.add_item(
        "movie",
        "Lost in Translation",
        year=2003,
        summary="A fading actor and a young woman drift through Tokyo.",
        ids={"tmdb": 153, "imdb": "tt0335266"},
        meta={"director": "Sofia Coppola", "genres": ["Drama", "Romance"], "runtime": 102},
        availability=[
            {"service": "netflix", "region": "DE", "type": "subscription", "checked": "2026-10-01"}
        ],
        tags={"mood": ["lonely", "tender"], "watched": True, "rating": 5},
    )
    doc.attach(
        lost, image(200, 300, (220, 170, 150), (90, 60, 70), "poster", "JPEG"), role="poster"
    )
    doc.attach(
        lost,
        image(1280, 536, (20, 30, 70), (200, 60, 140), "window"),
        role="screenshot",
        id="window",
        at={"time": "00:23:41"},
        caption="Charlotte sits in the hotel window above Tokyo at night.",
        tags={"palette": ["blue", "neon"]},
    )
    doc.attach(
        lost,
        image(1280, 536, (150, 150, 160), (90, 95, 110), "rain"),
        role="screenshot",
        id="rain",
        at={"time": "01:02:10"},
        caption="Rain on the taxi window, city lights blurred.",
    )

    mood = doc.add_item(
        "movie",
        "In the Mood for Love",
        year=2000,
        ids={"tmdb": 843, "imdb": "tt0118694"},
        meta={"director": "Wong Kar-wai", "genres": ["Drama", "Romance"], "runtime": 98},
        tags={"mood": "longing"},
    )
    doc.attach(mood, url="https://image.tmdb.org/t/p/w500/sample-poster.jpg", role="poster")

    series = doc.add_item(
        "tv",
        "Night Ferry",
        year=2024,
        summary="A fictional slow-burn series used as a sample.",
        meta={"creators": ["Sample Creator"], "seasons": 1},
    )
    episode = doc.add_item(
        "tv.episode", "The Last Crossing", parent=series, meta={"season": 1, "episode": 3}
    )
    doc.attach(
        episode,
        image(1280, 720, (10, 20, 40), (60, 80, 110), "S01E03"),
        role="screenshot",
        at={"season": 1, "episode": 3, "time": "00:41:05"},
        caption="Empty ferry deck in the rain, one light on.",
    )

    track = doc.add_item(
        "music.track",
        "Motion Picture Soundtrack",
        year=2000,
        meta={"artists": ["Radiohead"], "album": "Kid A", "duration": 260},
        availability=[{"service": "spotify"}],
    )
    nightcall = doc.add_item(
        "music.track",
        "Nightcall",
        year=2010,
        meta={"artists": ["Kavinsky"], "duration": 258},
        by=AGENT,
    )

    article = doc.add_item(
        "article",
        "In Praise of Slowness",
        summary="Sample essay on unhurried attention.",
        meta={"author": "Sample Author", "site": "example.com", "published": "2024-05-02"},
        links=[{"url": "https://example.com/in-praise-of-slowness", "label": "Original"}],
    )
    doc.attach(
        article,
        b"# In Praise of Slowness\n\nA saved copy of the article would go here.\n",
        role="snapshot",
        type="text/markdown",
        name="in-praise-of-slowness.md",
    )

    game = doc.add_item(
        "game",
        "Kentucky Route Zero",
        year=2020,
        meta={"developers": ["Cardboard Computer"], "platforms": ["PC", "Switch"]},
        tags={"mood": ["melancholic", "dreamy"]},
    )
    doc.attach(
        game,
        image(1280, 720, (5, 5, 20), (40, 70, 60), "Act II"),
        role="screenshot",
        at={"platform": "PC", "chapter": "Act II", "playtime": "3:12:00"},
        caption="A gas station alone under a huge night sky.",
    )

    doc.add_entry(rainy, lost, note="The hotel window scenes.", show=["rain"])
    doc.add_entry(rainy, track)
    doc.add_entry(rainy, article, by=AGENT, reason="Same stillness as the films.")
    doc.add_entry(rainy, game)
    doc.add_entry(neon, lost, show=["window"])
    doc.add_entry(neon, mood)
    doc.add_entry(neon, episode)
    doc.add_entry(neon, nightcall, by=AGENT, reason="Night driving synths, matches the palette.")
    return doc


def main() -> int:
    doc = build()
    doc.save(OUTPUT)
    doc.close()
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
