#!/usr/bin/env python3
"""Inspect a PSD for the activity-cms-psd skill.

The script intentionally avoids requiring psd-tools. Pillow can open the
composite image for many PSDs, which is enough for first-pass CMS mapping.
"""

from __future__ import annotations

import argparse
import json
import re
from html import unescape
from pathlib import Path

from PIL import Image, UnidentifiedImageError


def extract_text_hints(psd_path: Path) -> list[str]:
    raw = psd_path.read_bytes()
    text = raw.decode("utf-8", errors="ignore")

    layer_snippets = re.findall(r"<photoshop:Layer(?:Name|Text)>([\s\S]*?)</photoshop:Layer(?:Name|Text)>", text)
    snippets: list[str] = list(layer_snippets)

    if not snippets:
        xmp_match = re.search(r"<x:xmpmeta[\s\S]+?</x:xmpmeta>", text)
        if xmp_match:
            xmp = xmp_match.group(0)
            snippets.extend(re.findall(r">([^<>]{2,240})<", xmp))
        snippets.extend(re.findall(r"[A-Za-z][A-Za-z0-9 .,'’:/()&+-]{2,120}", text))

    cleaned: list[str] = []
    seen: set[str] = set()
    noise = re.compile(r"^(rdf|xmp|uuid|photoshop|adobe|instance|document|layer|type|http|www|com)$", re.I)
    for item in snippets:
        value = unescape(item).strip()
        value = re.sub(r"\s+", " ", value)
        if len(value) < 2 or len(value) > 180:
            continue
        lower_value = value.lower()
        if "adobe:docid" in lower_value or "xmp." in lower_value or lower_value.startswith("uuid:"):
            continue
        if value.lower().endswith((".jpg", ".png", ".psd")):
            continue
        if noise.search(value):
            continue
        if re.fullmatch(r"[0-9a-fA-F-]{12,}", value):
            continue
        if value not in seen:
            cleaned.append(value)
            seen.add(value)

    return cleaned[:300]


def open_composite_image(psd_path: Path) -> tuple[Image.Image, str, int, str]:
    try:
        image = Image.open(psd_path)
        frames = getattr(image, "n_frames", 1)
        return image.convert("RGBA"), image.mode, frames, "pillow"
    except UnidentifiedImageError:
        try:
            from psd_tools import PSDImage
        except ImportError as exc:
            raise RuntimeError("Pillow cannot read this PSD and psd-tools is not installed") from exc

        psd = PSDImage.open(psd_path)
        composite = psd.composite()
        if composite is None:
            raise RuntimeError("psd-tools could not composite this PSD")
        return composite.convert("RGBA"), "PSD", 1, "psd-tools"


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a PSD and write preview/text metadata.")
    parser.add_argument("psd", help="PSD file path")
    parser.add_argument("--out", default="activity-output/inspect", help="Output directory")
    parser.add_argument("--preview-width", type=int, default=750, help="Preview image width")
    args = parser.parse_args()

    psd_path = Path(args.psd).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    composite, source_mode, frames, engine = open_composite_image(psd_path)
    scale = args.preview_width / composite.width
    preview_height = max(1, int(composite.height * scale))
    preview = composite.resize((args.preview_width, preview_height), Image.LANCZOS)
    preview_path = out_dir / "preview.png"
    preview.save(preview_path)

    metadata = {
        "file": str(psd_path),
        "sizeBytes": psd_path.stat().st_size,
        "width": composite.width,
        "height": composite.height,
        "mode": source_mode,
        "frames": frames,
        "inspectEngine": engine,
        "cmsWidth": 750,
        "scaleToCms": round(750 / composite.width, 4),
        "preview": str(preview_path),
        "textHints": extract_text_hints(psd_path),
    }

    metadata_path = out_dir / "psd-inspect.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
