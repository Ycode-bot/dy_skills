#!/usr/bin/env python3
"""Create an activity-cms-psd output package directory."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageStat

ASSET_RULES = {
    "hero": {
        "file": "assets/hero.png",
        "keywords": ["遗迹之旅头图", "头图", "banner", "hero"],
        "purpose": "顶部主视觉/头图区域",
        "min_width_ratio": 0.25,
        "min_height": 80,
        "max_height_ratio": 0.35,
    },
    "introRules": {
        "file": "assets/intro-rules.png",
        "keywords": ["活动规则", "规则说明", "规则", "rules", "intro"],
        "purpose": "活动说明/规则区域",
        "min_width_ratio": 0.35,
        "min_height": 80,
        "max_height_ratio": 0.5,
    },
    "drawSection": {
        "file": "assets/draw-section.png",
        "keywords": ["抽奖", "draw", "lottery"],
        "purpose": "抽奖区域静态视觉参考",
        "min_width_ratio": 0.35,
        "min_height": 80,
        "max_height_ratio": 0.55,
    },
    "poolSection": {
        "file": "assets/pool-section.png",
        "keywords": ["奖池", "Prize Pool", "pool"],
        "purpose": "奖池等级/底部区域静态视觉参考",
        "min_width_ratio": 0.35,
        "min_height": 80,
        "max_height_ratio": 0.55,
    },
}

COMPONENT_ALIASES = {
    "piccomponent": ["头图", "banner", "hero", "静态图", "静态图片"],
    "countDown": ["倒计时", "countdown", "timer"],
    "tabComp": ["选项卡", "tab", "tabs"],
    "drawPool2": ["奖池升级", "抽奖", "draw", "lottery"],
    "commonGiftRank": ["榜单", "leaderboard", "rank"],
    "taskDraw": ["任务", "task"],
    "signUp2": ["报名", "signup", "enroll"],
    "giftExchange": ["兑换", "exchange"],
}

GENERATED_COMPONENTS = {
    "piccomponent",
    "countDown",
    "tabComp",
    "drawPool2",
    "drawPool",
    "blackbox",
    "taskDraw",
    "commonGiftRank",
    "commonDailyRank",
    "h2hRank",
    "signUp2",
    "signUpGroup",
    "giftExchange",
}


def slugify(value: str) -> str:
    value = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "activity"


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d%H%M")


def unique_package_dir(parent: Path, name: str) -> Path:
    package_dir = parent / name
    if not package_dir.exists():
        return package_dir

    index = 2
    while True:
        candidate = parent / f"{name}-{index}"
        if not candidate.exists():
            return candidate
        index += 1


def default_output_dir(psd_path: Path) -> Path:
    cwd = Path.cwd()
    return resolve_output_dir(psd_path, str(cwd / "work" / "activity-output"))


def resolve_output_dir(psd_path: Path, out: str | None) -> Path:
    parent = Path(out).expanduser() if out else Path.cwd() / "work" / "activity-output"
    if not parent.is_absolute():
        parent = Path.cwd() / parent
    parent = parent.resolve()

    package_name = f"{slugify(psd_path.stem)}-{timestamp()}"
    return unique_package_dir(parent, package_name)


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def bbox_to_dict(bbox) -> dict:
    left, top, right, bottom = [int(value) for value in tuple(bbox)]
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": max(0, right - left),
        "height": max(0, bottom - top),
    }


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def walk_psd_layers(container, parent_path: str = "") -> list[dict]:
    records = []
    for layer in container:
        name = layer.name or ""
        path = f"{parent_path}/{name}" if parent_path else name
        bbox = bbox_to_dict(layer.bbox)
        record = {
            "name": name,
            "path": path,
            "kind": getattr(layer, "kind", ""),
            "visible": bool(getattr(layer, "visible", True)),
            "isGroup": bool(layer.is_group()),
            "bbox": bbox,
        }
        records.append(record)
        if layer.is_group():
            record["children"] = walk_psd_layers(layer, path)
    return records


def flatten_layers(container, parent_path: str = "") -> list[tuple[object, dict]]:
    items = []
    for layer in container:
        name = layer.name or ""
        path = f"{parent_path}/{name}" if parent_path else name
        record = {
            "name": name,
            "path": path,
            "kind": getattr(layer, "kind", ""),
            "visible": bool(getattr(layer, "visible", True)),
            "isGroup": bool(layer.is_group()),
            "bbox": bbox_to_dict(layer.bbox),
        }
        items.append((layer, record))
        if layer.is_group():
            items.extend(flatten_layers(layer, path))
    return items


def score_layer(record: dict, rule: dict, canvas_width: int, canvas_height: int) -> tuple[int, str]:
    if not record["visible"]:
        return 0, "layer hidden"

    bbox = record["bbox"]
    if bbox["width"] <= 0 or bbox["height"] <= 0:
        return 0, "empty bounds"

    if bbox["width"] < canvas_width * rule.get("min_width_ratio", 0):
        return 0, "bounds too narrow for this asset"

    if bbox["height"] < rule.get("min_height", 0):
        return 0, "bounds too short for this asset"

    if (
        bbox["width"] >= canvas_width * 0.92
        and bbox["height"] >= canvas_height * rule.get("max_height_ratio", 0.5)
    ):
        return 0, "bounds too broad for a reusable asset"

    name_norm = normalize_name(record["name"])
    path_norm = normalize_name(record["path"])
    best = 0
    reason = "no keyword match"
    for keyword in rule["keywords"]:
        key = normalize_name(keyword)
        if not key:
            continue
        if name_norm == key:
            return 100, f"exact layer name match: {keyword}"
        if key in name_norm:
            best = max(best, 88)
            reason = f"layer name contains: {keyword}"
        elif key in path_norm:
            best = max(best, 62)
            reason = f"layer path contains: {keyword}"

    if record["isGroup"]:
        best += 4

    return best, reason


def resize_to_cms_width(image: Image.Image, cms_width: int) -> Image.Image:
    if image.width <= 0 or image.height <= 0:
        return image
    if image.width < cms_width * 0.45:
        return image
    if abs(image.width - cms_width) <= 2:
        return image
    scale = cms_width / image.width
    height = max(1, int(round(image.height * scale)))
    return image.resize((cms_width, height), Image.LANCZOS)


def parse_cms_annotation(name: str) -> tuple[str | None, str | None]:
    match = re.search(r"cms:([A-Za-z][A-Za-z0-9_]*)(?:#([A-Za-z0-9_-]+))?", name or "")
    if not match:
        return None, None
    return match.group(1), match.group(2) or match.group(1)


def detect_alias_component(name: str) -> tuple[str | None, str]:
    name_norm = normalize_name(name)
    for component_name, aliases in COMPONENT_ALIASES.items():
        for alias in aliases:
            if normalize_name(alias) in name_norm:
                return component_name, f"name contains alias: {alias}"
    return None, "no component alias"


def detect_component_layers(flat_layers: list[tuple[object, dict]]) -> list[dict]:
    detections = []
    for _layer, record in flat_layers:
        if not record["visible"] or record["bbox"]["width"] <= 0 or record["bbox"]["height"] <= 0:
            continue

        component_name, local_name = parse_cms_annotation(record["name"])
        if component_name:
            detections.append({
                "componentName": component_name,
                "localName": local_name,
                "sourceLayer": record["path"],
                "bounds": record["bbox"],
                "confidence": 0.99 if component_name in GENERATED_COMPONENTS else 0.7,
                "generated": component_name in GENERATED_COMPONENTS,
                "sourceType": "cms-annotation",
                "reason": "explicit cms annotation" if component_name in GENERATED_COMPONENTS else "component is not in the supported generation set",
            })
            continue

        alias_component, reason = detect_alias_component(record["name"])
        if alias_component:
            detections.append({
                "componentName": alias_component,
                "localName": slugify(record["name"]),
                "sourceLayer": record["path"],
                "bounds": record["bbox"],
                "confidence": 0.55,
                "generated": False,
                "sourceType": "alias-candidate",
                "reason": f"{reason}; candidate only because PSD is not explicitly annotated",
            })

    detections.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"], item["sourceLayer"]))
    return detections


def export_component_asset(layer, detection: dict, assets_dir: Path, cms_width: int) -> dict:
    asset_name = slugify(detection["localName"])
    output_path = assets_dir / f"{asset_name}.png"
    image = layer.composite()
    if image is None:
        raise ValueError("layer composite is empty")
    image = resize_to_cms_width(image.convert("RGBA"), cms_width)
    image.save(output_path)
    return {
        "assetName": asset_name,
        "file": f"assets/{asset_name}.png",
        "assetRef": f"asset://{asset_name}",
        "sourceType": "cms-annotation-asset",
        "layerPath": detection["sourceLayer"],
        "bounds": detection["bounds"],
        "confidence": detection["confidence"],
        "exportedWidth": image.width,
        "exportedHeight": image.height,
        "fileSizeBytes": output_path.stat().st_size,
    }


def export_layer_assets(psd_path: Path, assets_dir: Path, inspect_dir: Path, cms_width: int) -> dict:
    report = {
        "engine": "psd-tools",
        "status": "ok",
        "assets": {},
    }

    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        report["status"] = "unavailable"
        report["error"] = str(exc)
        write_json(inspect_dir / "layers.json", {"layers": []})
        write_json(inspect_dir / "component-detection.json", {"detections": []})
        write_json(inspect_dir / "export-report.json", report)
        return report

    try:
        psd = PSDImage.open(psd_path)
    except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
        report["status"] = "failed"
        report["error"] = str(exc)
        write_json(inspect_dir / "layers.json", {"layers": []})
        write_json(inspect_dir / "component-detection.json", {"detections": []})
        write_json(inspect_dir / "export-report.json", report)
        return report

    canvas_width, canvas_height = psd.size
    tree = walk_psd_layers(psd)
    flat_layers = flatten_layers(psd)
    detections = detect_component_layers(flat_layers)
    write_json(inspect_dir / "layers.json", {
        "source": str(psd_path),
        "engine": "psd-tools",
        "canvasWidth": canvas_width,
        "canvasHeight": canvas_height,
        "layers": tree,
    })
    write_json(inspect_dir / "component-detection.json", {
        "source": str(psd_path),
        "engine": "psd-tools",
        "detections": detections,
    })

    for layer, record in flat_layers:
        detection = next((item for item in detections if item["sourceLayer"] == record["path"]), None)
        if not detection or not detection["generated"] or detection["componentName"] != "piccomponent":
            continue
        try:
            asset_info = export_component_asset(layer, detection, assets_dir, cms_width)
            detection["assetName"] = asset_info["assetName"]
            detection["assetRef"] = asset_info["assetRef"]
            detection["assetFile"] = asset_info["file"]
            report["assets"][asset_info["assetName"]] = asset_info
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            detection["generated"] = False
            detection["reason"] = f"annotated piccomponent export failed: {exc}"

    for asset_name, rule in ASSET_RULES.items():
        best_layer = None
        best_record = None
        best_score = 0
        best_reason = ""

        for layer, record in flat_layers:
            score, reason = score_layer(record, rule, canvas_width, canvas_height)
            if score > best_score:
                best_layer = layer
                best_record = record
                best_score = score
                best_reason = reason

        if best_layer is None or best_record is None or best_score < 75:
            report["assets"][asset_name] = {
                "file": rule["file"],
                "assetRef": f"asset://{asset_name}",
                "sourceType": "composite-slice-fallback",
                "confidence": 0.58,
                "fallbackReason": best_reason or "no matching layer/group",
            }
            continue

        try:
            image = best_layer.composite()
            if image is None:
                raise ValueError("layer composite is empty")
            image = resize_to_cms_width(image.convert("RGBA"), cms_width)
            output_path = assets_dir / Path(rule["file"]).name
            image.save(output_path)
            report["assets"][asset_name] = {
                "file": rule["file"],
                "assetRef": f"asset://{asset_name}",
                "sourceType": "psd-tools-layer-group" if best_record["isGroup"] else "psd-tools-layer",
                "layerPath": best_record["path"],
                "bounds": best_record["bbox"],
                "confidence": round(min(0.99, best_score / 100), 2),
                "matchReason": best_reason,
                "exportedWidth": image.width,
                "exportedHeight": image.height,
                "fileSizeBytes": output_path.stat().st_size,
            }
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            report["assets"][asset_name] = {
                "file": rule["file"],
                "assetRef": f"asset://{asset_name}",
                "sourceType": "composite-slice-fallback",
                "confidence": 0.5,
                "layerPath": best_record["path"],
                "bounds": best_record["bbox"],
                "fallbackReason": f"psd-tools export failed: {exc}",
            }

    report["detections"] = detections
    write_json(inspect_dir / "component-detection.json", {
        "source": str(psd_path),
        "engine": "psd-tools",
        "detections": detections,
    })
    write_json(inspect_dir / "export-report.json", report)
    return report


def get_content_image(image: Image.Image) -> tuple[Image.Image, dict]:
    if image.width < 1000:
        return image, {
            "x": 0,
            "y": 0,
            "width": image.width,
            "height": image.height,
            "reason": "full canvas"
        }

    left_half = image.crop((0, 0, image.width // 2, image.height)).convert("L")
    right_half = image.crop((image.width // 2, 0, image.width, image.height)).convert("L")
    left_alpha = image.crop((0, 0, image.width // 2, image.height)).getchannel("A")
    right_alpha = image.crop((image.width // 2, 0, image.width, image.height)).getchannel("A")
    left_alpha_mean = ImageStat.Stat(left_alpha).mean[0]
    right_alpha_mean = ImageStat.Stat(right_alpha).mean[0]
    left_mean = ImageStat.Stat(left_half).mean[0]
    right_mean = ImageStat.Stat(right_half).mean[0]
    right_extrema = right_half.getextrema()

    if right_alpha_mean < 3 and left_alpha_mean > right_alpha_mean + 20:
        width = image.width // 2
        return image.crop((0, 0, width, image.height)), {
            "x": 0,
            "y": 0,
            "width": width,
            "height": image.height,
            "reason": "right half is transparent"
        }

    if right_mean < 8 and right_extrema[1] < 24 and left_mean > right_mean + 8:
        width = image.width // 2
        return image.crop((0, 0, width, image.height)), {
            "x": 0,
            "y": 0,
            "width": width,
            "height": image.height,
            "reason": "right half is visually blank"
        }

    return image, {
        "x": 0,
        "y": 0,
        "width": image.width,
        "height": image.height,
        "reason": "full canvas"
    }


def save_slices(psd_path: Path, assets_dir: Path, inspect_dir: Path, cms_width: int) -> list[dict]:
    image = Image.open(psd_path).convert("RGBA")
    content_image, content_rect = get_content_image(image)
    scale = cms_width / content_image.width
    cms_height = max(1, int(content_image.height * scale))
    cms_image = content_image.resize((cms_width, cms_height), Image.LANCZOS)

    slices = [
        {
            "name": "fullPage",
            "file": "assets/full-page.png",
            "assetRef": "asset://fullPage",
            "purpose": "完整 CMS 宽度页面预览图",
            "ratio": [0, 1]
        },
        {
            "name": "hero",
            "file": "assets/hero.png",
            "assetRef": "asset://hero",
            "purpose": "顶部主视觉/头图区域",
            "ratio": [0, 0.32]
        },
        {
            "name": "introRules",
            "file": "assets/intro-rules.png",
            "assetRef": "asset://introRules",
            "purpose": "活动说明/规则区域",
            "ratio": [0.32, 0.46]
        },
        {
            "name": "drawSection",
            "file": "assets/draw-section.png",
            "assetRef": "asset://drawSection",
            "purpose": "抽奖区域静态视觉参考",
            "ratio": [0.46, 0.72]
        },
        {
            "name": "poolSection",
            "file": "assets/pool-section.png",
            "assetRef": "asset://poolSection",
            "purpose": "奖池等级/底部区域静态视觉参考",
            "ratio": [0.72, 1]
        }
    ]

    for item in slices:
        start_ratio, end_ratio = item["ratio"]
        top = 0 if item["name"] == "fullPage" else int(cms_height * start_ratio)
        bottom = cms_height if item["name"] == "fullPage" else int(cms_height * end_ratio)
        bottom = max(top + 1, min(cms_height, bottom))
        crop = cms_image.crop((0, top, cms_width, bottom))
        output_path = assets_dir / Path(item["file"]).name
        crop.save(output_path)
        item["cmsRect"] = {
            "x": 0,
            "y": top,
            "width": cms_width,
            "height": bottom - top
        }
        item["sourceRect"] = {
            "x": content_rect["x"],
            "y": content_rect["y"] + int(top / scale),
            "width": content_image.width,
            "height": int((bottom - top) / scale)
        }
        item["fileSizeBytes"] = output_path.stat().st_size

    write_json(inspect_dir / "slices.json", {
        "source": str(psd_path),
        "sourceWidth": image.width,
        "sourceHeight": image.height,
        "contentRect": content_rect,
        "cmsWidth": cms_width,
        "cmsHeight": cms_height,
        "scale": round(scale, 4),
        "slices": slices
    })

    return slices


def component_meta(detection: dict, todos: list[str] | None = None) -> dict:
    meta = {
        "confidence": detection.get("confidence", 0.99),
        "sourceLayer": detection.get("sourceLayer"),
        "sourceType": detection.get("sourceType"),
    }
    if todos:
        meta["todos"] = todos
    return meta


def build_component_from_detection(detection: dict) -> dict:
    component_name = detection["componentName"]
    if component_name == "piccomponent":
        asset_ref = detection.get("assetRef") or f"asset://{slugify(detection['localName'])}"
        return {
            "componentName": "piccomponent",
            "config": {
                "url": [asset_ref]
            },
            "meta": component_meta(detection, [f"上传 {detection.get('assetFile', detection['localName'])} 并替换 {asset_ref} 为 CDN URL"])
        }

    if component_name == "countDown":
        return {
            "componentName": "countDown",
            "config": {
                "actIdTest": "",
                "actId": "",
                "type": 1,
                "actTime": "",
                "ableDrag": True,
                "width": 320,
                "height": 120
            },
            "styleConfig": {
                "backgroundColor": "",
                "numBg": "#ffffff",
                "numColor": "#8b3f12",
                "numBorder": "#f1a84c",
                "textColor": "#ffffff"
            },
            "meta": component_meta(detection, ["补充活动ID测试ID", "补充活动ID正式ID", "确认倒计时活动时间来源"])
        }

    if component_name == "tabComp":
        return {
            "componentName": "tabComp",
            "config": {
                "tabs": []
            },
            "meta": component_meta(detection, ["补充 tab 名称和 tab 内组件，或按 tab: 标注 PSD"])
        }

    todos = ["确认后台业务配置和业务ID"]
    if component_name in {"drawPool2", "drawPool", "blackbox", "taskDraw"}:
        todos = ["补充活动ID测试ID", "补充活动ID正式ID", "确认抽奖/奖池后台配置"]
    elif "Rank" in component_name or component_name in {"commonGiftRank", "commonDailyRank", "h2hRank"}:
        todos = ["确认榜单组件类型", "补充榜单ID"]
    elif component_name in {"signUp2", "signUpGroup"}:
        todos = ["确认报名后台配置", "补充报名活动ID"]

    return {
        "componentName": component_name,
        "config": {},
        "meta": component_meta(detection, todos)
    }


def build_components_from_detections(detections: list[dict]) -> list[dict]:
    generated = [
        item for item in detections
        if item.get("generated") and item.get("sourceType") == "cms-annotation"
    ]
    generated.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"], item["sourceLayer"]))
    return [build_component_from_detection(item) for item in generated]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an activityincms PSD output package.")
    parser.add_argument("psd", help="PSD file path")
    parser.add_argument("--out", help="Package output directory. Existing non-empty dirs get a timestamp suffix.")
    parser.add_argument(
        "--engine",
        choices=["psd-tools", "composite"],
        default="psd-tools",
        help="Asset export engine. psd-tools exports named layers/groups and falls back to composite slices.",
    )
    args = parser.parse_args()

    psd_path = Path(args.psd).expanduser().resolve()
    if not psd_path.exists():
        raise FileNotFoundError(f"PSD not found: {psd_path}")

    package_dir = resolve_output_dir(psd_path, args.out)
    assets_dir = package_dir / "assets"
    inspect_dir = package_dir / "inspect"
    assets_dir.mkdir(parents=True, exist_ok=True)
    inspect_dir.mkdir(parents=True, exist_ok=True)

    skill_dir = Path(__file__).resolve().parents[1]
    inspect_script = skill_dir / "scripts" / "inspect_psd.py"
    subprocess.run(
        [sys.executable, str(inspect_script), str(psd_path), "--out", str(inspect_dir)],
        check=True,
        capture_output=True,
        text=True,
    )

    inspect_json = json.loads((inspect_dir / "psd-inspect.json").read_text(encoding="utf-8"))
    page_title = next((item for item in inspect_json.get("textHints", []) if re.search(r"[A-Za-z]", item)), psd_path.stem)
    cms_width = inspect_json.get("cmsWidth", 750) or 750
    slices = save_slices(psd_path, assets_dir, inspect_dir, cms_width)
    asset_map = {item["name"]: item["file"] for item in slices}
    export_report = {
        "engine": "composite",
        "status": "skipped",
        "assets": {
            item["name"]: {
                "file": item["file"],
                "assetRef": item["assetRef"],
                "sourceType": "composite-slice-fallback",
                "confidence": 0.58,
                "fallbackReason": "composite engine selected",
            }
            for item in slices
            if item["name"] != "fullPage"
        },
    }
    if args.engine == "psd-tools":
        export_report = export_layer_assets(psd_path, assets_dir, inspect_dir, cms_width)
    else:
        write_json(inspect_dir / "layers.json", {"layers": []})
        write_json(inspect_dir / "component-detection.json", {"detections": []})
        write_json(inspect_dir / "export-report.json", export_report)

    detections = export_report.get("detections", [])
    for item in detections:
        if item.get("assetName") and item.get("assetFile"):
            asset_map[item["assetName"]] = item["assetFile"]

    def asset_meta(asset_name: str, fallback_source: str, fallback_confidence: float) -> dict:
        info = export_report.get("assets", {}).get(asset_name, {})
        source_type = info.get("sourceType", "composite-slice-fallback")
        layer_path = info.get("layerPath")
        source = f"{source_type}: {layer_path}" if layer_path else f"{source_type}: {fallback_source}"
        todos = [f"上传 {Path(asset_map[asset_name]).name} 并替换 asset://{asset_name} 为 CDN URL"]
        if source_type == "composite-slice-fallback":
            todos.append("该素材为合成图粗切，请确认范围是否符合预期")
        return {
            "confidence": info.get("confidence", fallback_confidence),
            "source": source,
            "todos": todos,
        }

    detected_components = build_components_from_detections(detections)
    fallback_components = [
        {
            "componentName": "piccomponent",
            "config": {
                "url": ["asset://hero"]
            },
            "meta": asset_meta("hero", "auto slice: hero", 0.72)
        },
        {
            "componentName": "piccomponent",
            "config": {
                "url": ["asset://introRules"]
            },
            "meta": asset_meta("introRules", "auto slice: introRules", 0.66)
        }
    ]

    cms_config = {
        "version": "1.0",
        "page": {
            "title": page_title,
            "backgroundColor": "#000000",
            "designWidth": inspect_json.get("width"),
            "cmsWidth": cms_width,
        },
        "assets": asset_map,
        "components": detected_components or fallback_components
    }

    hints = set(inspect_json.get("textHints", []))
    if not detected_components and {"Upgrade Prize Pool", "Draw 1 time", "Prize Pool"} & hints:
        cms_config["components"].append({
            "componentName": "tabComp",
            "config": {
                "tabs": [
                    {
                        "name": "Upgrade Prize Pool",
                        "content": [
                            {
                                "componentName": "drawPool2",
                                "config": {
                                    "testId": "",
                                    "actId": "",
                                    "drawText1": "Draw 1 time",
                                    "drawText2": "Draw XX times",
                                    "drawNum": "1, 10, 20, 50",
                                    "leftChance": "You have XX more chances",
                                    "record": "Record",
                                    "times": "You have drawn XX time(s)"
                                },
                                "meta": {
                                    "confidence": 0.86,
                                    "alternatives": ["drawPool"],
                                    "todos": ["补充活动ID测试ID", "补充活动ID正式ID", "确认奖池后台配置"]
                                }
                            }
                        ]
                    },
                    {
                        "name": "Daily Task",
                        "content": [],
                        "meta": {"todos": ["确认任务组件类型和任务ID"]}
                    },
                    {
                        "name": "Leaderboard",
                        "content": [],
                        "meta": {"todos": ["确认榜单组件类型和榜单ID"]}
                    }
                ]
            }
        })

    write_json(package_dir / "cms-page-config.json", cms_config)

    (package_dir / "theme.md").write_text(
        "# Theme Notes\n\n"
        f"- PSD: `{psd_path}`\n"
        f"- Design size: `{inspect_json.get('width')} x {inspect_json.get('height')}`\n"
        f"- CMS width: `{inspect_json.get('cmsWidth', 750)}`\n"
        f"- Scale to CMS: `{inspect_json.get('scaleToCms')}`\n"
        f"- Asset export engine: `{args.engine}`\n"
        "- Colors and detailed component styles should be refined after visual slicing.\n",
        encoding="utf-8",
    )

    asset_notes = []
    for item in slices:
        if item["name"] == "fullPage":
            asset_notes.append(
                f"- `{item['file']}`: {item['purpose']}，CMS 坐标 `{item['cmsRect']}`，来源 `composite full page`"
            )
            continue
        info = export_report.get("assets", {}).get(item["name"], {})
        source = info.get("sourceType", "composite-slice-fallback")
        layer_path = info.get("layerPath")
        suffix = f"，图层 `{layer_path}`" if layer_path else ""
        fallback = info.get("fallbackReason")
        fallback_note = f"，fallback：{fallback}" if fallback else ""
        asset_notes.append(
            f"- `{item['file']}`: {item['purpose']}，来源 `{source}`{suffix}{fallback_note}"
        )

    (package_dir / "import-notes.md").write_text(
        "# Import Notes\n\n"
        f"- Package directory: `{package_dir}`\n"
        "- Import JSON: `cms-page-config.json`\n"
        "- Local `asset://` references are placeholders. Upload files from `assets/` and replace them with CDN URLs before save/preview.\n"
        "- Default asset export uses Python `psd-tools`; Photoshop is not required on the operator machine.\n"
        "- If a named layer/group cannot be exported reliably, the asset falls back to composite-image slicing.\n"
        "- Slice details are recorded in `inspect/slices.json`.\n"
        "- PSD layer tree is recorded in `inspect/layers.json`.\n"
        "- Component detection is recorded in `inspect/component-detection.json`.\n"
        "- Asset export source is recorded in `inspect/export-report.json`.\n"
        "\n"
        "## Generated Assets\n\n"
        + "\n".join(asset_notes)
        + "\n\n"
        "- Business IDs are intentionally blank. Fill test/formal activity IDs and any rank/task/draw backend IDs in JSON or the CMS right panel.\n"
        "- Low-confidence or empty tabs should be checked by operations before saving.\n",
        encoding="utf-8",
    )

    result = {
        "packageDir": str(package_dir),
        "importJson": str(package_dir / "cms-page-config.json"),
        "assetsDir": str(assets_dir),
        "inspectJson": str(inspect_dir / "psd-inspect.json"),
        "slicesJson": str(inspect_dir / "slices.json"),
        "layersJson": str(inspect_dir / "layers.json"),
        "componentDetectionJson": str(inspect_dir / "component-detection.json"),
        "exportReportJson": str(inspect_dir / "export-report.json"),
        "preview": str(inspect_dir / "preview.png"),
        "engine": args.engine,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
