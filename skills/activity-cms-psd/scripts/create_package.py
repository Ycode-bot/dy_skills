#!/usr/bin/env python3
"""Create an activity-cms-psd output package directory."""

from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageStat, UnidentifiedImageError

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

CHINESE_COMPONENT_ALIASES = {
    "奖池升级": "drawPool2",
    "奖池升级节日主题": "drawPool2",
    "抽奖": "drawPool2",
    "金币抽奖": "cntDraw",
    "倒计时": "countDown",
    "选项卡": "tabComp",
    "tab": "tabComp",
    "榜单": "commonGiftRank",
    "礼物榜单": "commonGiftRank",
    "日榜": "commonDailyRank",
    "任务": "taskDraw",
    "任务抽奖": "taskDraw",
    "报名": "signUp2",
    "报名组": "signUpGroup",
    "兑换": "giftExchange",
    "礼物兑换": "giftExchange",
    "盲盒": "blackbox",
    "充值": "rechargeProgressBar",
    "充值进度": "rechargeProgressBar",
    "充值返点": "rebateCoupon",
    "返点": "rebateCoupon",
    "个人信息": "rebateCoupon",
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
    "rechargeProgressBar",
    "rebateCoupon",
}

BACKEND_DEPENDENT_COMPONENTS = {
    "countDown",
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
    "rechargeProgressBar",
    "rebateCoupon",
}

STATIC_PREVIEW_COMPONENTS = {
    "tabComp",
}


def slugify(value: str) -> str:
    value = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "activity"


def unique_asset_name(assets: dict, base_name: str) -> str:
    asset_name = slugify(base_name)
    if asset_name not in assets:
        return asset_name

    index = 2
    while f"{asset_name}-{index}" in assets:
        index += 1
    return f"{asset_name}-{index}"


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


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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


def open_composite_image(psd_path: Path) -> Image.Image:
    try:
        return Image.open(psd_path).convert("RGBA")
    except UnidentifiedImageError:
        try:
            from psd_tools import PSDImage
        except ImportError as exc:
            raise RuntimeError("Pillow cannot read this PSD and psd-tools is not installed") from exc

        psd = PSDImage.open(psd_path)
        composite = psd.composite()
        if composite is None:
            raise RuntimeError("psd-tools could not composite this PSD")
        return composite.convert("RGBA")


def parse_cms_annotation(name: str) -> tuple[str | None, str | None]:
    match = re.search(r"cms:([A-Za-z][A-Za-z0-9_]*)(?:#([A-Za-z0-9_-]+))?", name or "")
    if not match:
        return None, None
    return match.group(1), match.group(2) or match.group(1)


def parse_cut_annotation(name: str) -> dict | None:
    match = re.search(
        r"(?:切图|cut)\s*[:：]\s*([^\[\]［］\n\r]+?)\s*(?:[\[［]\s*(\d+)\s*[xX×*]\s*(\d+)\s*[\]］])?\s*$",
        name or "",
        re.I,
    )
    if not match:
        return None

    local_name = match.group(1).strip()
    width = int(match.group(2)) if match.group(2) else None
    height = int(match.group(3)) if match.group(3) else None
    return {
        "localName": local_name,
        "targetWidth": width,
        "targetHeight": height,
    }


def parse_component_annotation(name: str) -> tuple[str | None, str | None, str | None]:
    match = re.search(r"(?:组件|component)\s*[:：]\s*([^\[\]［］#\n\r]+?)(?:#([A-Za-z0-9_-]+))?\s*$", name or "", re.I)
    if not match:
        return None, None, None

    label = match.group(1).strip()
    label_norm = normalize_name(label)
    component_name = CHINESE_COMPONENT_ALIASES.get(label)
    if not component_name:
        for alias, mapped_name in CHINESE_COMPONENT_ALIASES.items():
            if normalize_name(alias) in label_norm:
                component_name = mapped_name
                break

    return component_name, match.group(2) or slugify(label), label


def parse_field_annotation(name: str, prefix: str) -> str | None:
    match = re.search(rf"{re.escape(prefix)}:([A-Za-z][A-Za-z0-9_]*)", name or "")
    return match.group(1) if match else None


def detect_alias_component(name: str) -> tuple[str | None, str]:
    name_norm = normalize_name(name)
    for component_name, aliases in COMPONENT_ALIASES.items():
        for alias in aliases:
            if normalize_name(alias) in name_norm:
                return component_name, f"name contains alias: {alias}"
    return None, "no component alias"


def detect_component_layers(flat_layers: list[tuple[object, dict]]) -> list[dict]:
    detections = []
    has_explicit_component_annotations = any(
        parse_component_annotation(record["name"])[2] or parse_cms_annotation(record["name"])[0]
        for _layer, record in flat_layers
        if record["visible"]
    )
    for _layer, record in flat_layers:
        if not record["visible"]:
            continue
        if parse_cut_annotation(record["name"]):
            continue

        component_name, local_name = parse_cms_annotation(record["name"])
        if component_name:
            has_bounds = record["bbox"]["width"] > 0 and record["bbox"]["height"] > 0
            detections.append({
                "componentName": component_name,
                "localName": local_name,
                "sourceLayer": record["path"],
                "bounds": record["bbox"],
                "confidence": 0.99 if component_name in GENERATED_COMPONENTS else 0.7,
                "generated": component_name in GENERATED_COMPONENTS and has_bounds,
                "sourceType": "cms-annotation",
                "reason": "explicit cms annotation" if has_bounds else "explicit cms annotation without visual bounds; recorded as candidate only",
            })
            continue

        component_name, local_name, label = parse_component_annotation(record["name"])
        if label:
            detections.append({
                "componentName": component_name or "unknown",
                "localName": local_name,
                "sourceLayer": record["path"],
                "bounds": record["bbox"],
                "confidence": 0.92 if component_name else 0.45,
                "generated": False,
                "sourceType": "component-annotation",
                "componentLabel": label,
                "reason": f"中文组件标注：{label}" if component_name else f"中文组件标注未匹配组件清单：{label}",
            })
            continue

        if record["bbox"]["width"] <= 0 or record["bbox"]["height"] <= 0:
            continue
        if has_explicit_component_annotations:
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


def export_cut_asset(layer, record: dict, cut_info: dict, report: dict, assets_dir: Path) -> dict:
    image = layer.composite()
    if image is None:
        raise ValueError("layer composite is empty")

    image = image.convert("RGBA")
    original_width = image.width
    original_height = image.height
    target_width = cut_info.get("targetWidth")
    target_height = cut_info.get("targetHeight")
    resized = False
    size_status = "default-size"
    size_warning = ""

    if target_width and target_height:
        original_ratio = original_width / original_height if original_height else 0
        target_ratio = target_width / target_height
        if original_ratio and abs(original_ratio - target_ratio) / target_ratio <= 0.01:
            image = image.resize((target_width, target_height), Image.LANCZOS)
            resized = (original_width, original_height) != (target_width, target_height)
            size_status = "resized" if resized else "matched"
        else:
            size_status = "size-mismatch"
            size_warning = "目标尺寸与图层比例不一致，已按原始尺寸导出，未自动裁切或拉伸"

    asset_name = unique_asset_name(report["assets"], cut_info["localName"])
    output_path = assets_dir / f"{asset_name}.png"
    image.save(output_path)
    return {
        "assetName": asset_name,
        "file": f"assets/{asset_name}.png",
        "assetRef": f"asset://{asset_name}",
        "sourceType": "cut-annotation",
        "layerPath": record["path"],
        "bounds": record["bbox"],
        "confidence": 1.0,
        "cutName": cut_info["localName"],
        "targetWidth": target_width,
        "targetHeight": target_height,
        "originalWidth": original_width,
        "originalHeight": original_height,
        "exportedWidth": image.width,
        "exportedHeight": image.height,
        "resized": resized,
        "sizeStatus": size_status,
        "sizeWarning": size_warning,
        "fileSizeBytes": output_path.stat().st_size,
    }


def find_flat_record(flat_layers: list[tuple[object, dict]], layer_path: str):
    return next(((layer, record) for layer, record in flat_layers if record["path"] == layer_path), None)


def apply_annotation_manifest(
    manifest: dict | None,
    flat_layers: list[tuple[object, dict]],
    detections: list[dict],
    report: dict,
    assets_dir: Path,
) -> None:
    if not manifest:
        return

    report["annotationManifest"] = manifest
    report.setdefault("cutAssets", [])
    if manifest.get("components"):
        detections[:] = [
            detection for detection in detections
            if detection.get("sourceType") != "alias-candidate"
        ]

    for item in manifest.get("cuts", []):
        layer_path = item.get("layerPath")
        match = find_flat_record(flat_layers, layer_path)
        if not match:
            report["cutAssets"].append({
                "sourceType": "annotation-manifest",
                "layerPath": layer_path,
                "cutName": item.get("name"),
                "targetWidth": item.get("targetWidth"),
                "targetHeight": item.get("targetHeight"),
                "status": "failed",
                "error": "layerPath not found in PSD",
            })
            continue

        layer, record = match
        cut_info = {
            "localName": item.get("name") or record["name"],
            "targetWidth": item.get("targetWidth"),
            "targetHeight": item.get("targetHeight"),
        }
        try:
            asset_info = export_cut_asset(layer, record, cut_info, report, assets_dir)
            asset_info["sourceType"] = "annotation-manifest-cut"
            report["assets"][asset_info["assetName"]] = asset_info
            report["cutAssets"].append(asset_info)
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            report["cutAssets"].append({
                "sourceType": "annotation-manifest",
                "layerPath": layer_path,
                "cutName": cut_info["localName"],
                "targetWidth": cut_info.get("targetWidth"),
                "targetHeight": cut_info.get("targetHeight"),
                "status": "failed",
                "error": str(exc),
            })

    for item in manifest.get("components", []):
        label = item.get("label") or item.get("name")
        if not label:
            continue
        component_name, local_name, parsed_label = parse_component_annotation(f"组件:{label}")
        layer_path = item.get("layerPath")
        match = find_flat_record(flat_layers, layer_path) if layer_path else None
        bounds = match[1]["bbox"] if match else {"left": 0, "top": 0, "right": 0, "bottom": 0, "width": 0, "height": 0}
        source_layer = layer_path or f"annotation-manifest/组件:{label}"
        if any(
            detection.get("sourceLayer") == source_layer
            and detection.get("sourceType") == "component-annotation"
            and detection.get("componentLabel") == (parsed_label or label)
            for detection in detections
        ):
            continue
        detections.append({
            "componentName": component_name or "unknown",
            "localName": local_name or slugify(label),
            "sourceLayer": source_layer,
            "bounds": bounds,
            "confidence": 0.92 if component_name else 0.45,
            "generated": False,
            "sourceType": "component-annotation",
            "componentLabel": parsed_label or label,
            "reason": f"annotation manifest 组件标注：{label}" if component_name else f"annotation manifest 组件标注未匹配组件清单：{label}",
        })

    detections.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"], item["sourceLayer"]))


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


def export_layer_assets(
    psd_path: Path,
    assets_dir: Path,
    inspect_dir: Path,
    cms_width: int,
    annotation_manifest: dict | None = None,
    include_fallback_assets: bool = True,
) -> dict:
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

    cut_assets = []
    for layer, record in flat_layers:
        cut_info = parse_cut_annotation(record["name"])
        if not cut_info:
            continue
        if not record["visible"] or record["bbox"]["width"] <= 0 or record["bbox"]["height"] <= 0:
            continue
        try:
            asset_info = export_cut_asset(layer, record, cut_info, report, assets_dir)
            report["assets"][asset_info["assetName"]] = asset_info
            cut_assets.append(asset_info)
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            cut_assets.append({
                "sourceType": "cut-annotation",
                "layerPath": record["path"],
                "bounds": record["bbox"],
                "cutName": cut_info["localName"],
                "targetWidth": cut_info.get("targetWidth"),
                "targetHeight": cut_info.get("targetHeight"),
                "status": "failed",
                "error": str(exc),
            })
    report["cutAssets"] = cut_assets
    apply_annotation_manifest(annotation_manifest, flat_layers, detections, report, assets_dir)

    for layer, record in flat_layers:
        detection = next((item for item in detections if item["sourceLayer"] == record["path"]), None)
        if not detection or not detection["generated"]:
            continue
        try:
            asset_info = export_component_asset(layer, detection, assets_dir, cms_width)
            detection["assetName"] = asset_info["assetName"]
            detection["assetRef"] = asset_info["assetRef"]
            detection["assetFile"] = asset_info["file"]
            report["assets"][asset_info["assetName"]] = asset_info
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            detection["visualGenerated"] = False
            detection["visualReason"] = f"annotated visual export failed: {exc}"

    generated_detections = [
        item for item in detections
        if item.get("generated") and item.get("sourceType") == "cms-annotation"
    ]
    for layer, record in flat_layers:
        field_name = parse_field_annotation(record["name"], "asset")
        if not field_name:
            continue
        if not record["visible"] or record["bbox"]["width"] <= 0 or record["bbox"]["height"] <= 0:
            continue
        parent = next(
            (
                item for item in generated_detections
                if record["path"].startswith(f"{item['sourceLayer']}/")
            ),
            None,
        )
        if not parent:
            continue
        try:
            image = layer.composite()
            if image is None:
                raise ValueError("layer composite is empty")
            image = resize_to_cms_width(image.convert("RGBA"), cms_width)
            asset_name = slugify(f"{parent['localName']}-{field_name}")
            output_path = assets_dir / f"{asset_name}.png"
            image.save(output_path)
            asset_info = {
                "assetName": asset_name,
                "file": f"assets/{asset_name}.png",
                "assetRef": f"asset://{asset_name}",
                "sourceType": "psd-tools-field-asset",
                "fieldName": field_name,
                "componentLayerPath": parent["sourceLayer"],
                "layerPath": record["path"],
                "bounds": record["bbox"],
                "confidence": 0.96,
                "exportedWidth": image.width,
                "exportedHeight": image.height,
                "fileSizeBytes": output_path.stat().st_size,
            }
            parent.setdefault("fieldAssets", {})[field_name] = {
                "assetName": asset_name,
                "assetRef": asset_info["assetRef"],
                "assetFile": asset_info["file"],
                "sourceLayer": record["path"],
                "bounds": record["bbox"],
            }
            report["assets"][asset_name] = asset_info
        except Exception as exc:  # pragma: no cover - depends on PSD parser edge cases.
            parent.setdefault("fieldAssetErrors", {})[field_name] = str(exc)

    if include_fallback_assets:
        for asset_name, rule in ASSET_RULES.items():
            if asset_name in report["assets"]:
                continue

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
    image = open_composite_image(psd_path)
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


def rgb_to_hex(color: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*color)


def relative_luminance(color: tuple[int, int, int]) -> float:
    r, g, b = [value / 255 for value in color]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def extract_theme(psd_path: Path, inspect_json: dict, assets_dir: Path, package_dir: Path) -> dict:
    image = open_composite_image(psd_path)
    content_image, _content_rect = get_content_image(image)
    thumb = content_image.convert("RGBA")
    thumb.thumbnail((180, 180), Image.LANCZOS)

    opaque = Image.new("RGBA", thumb.size, (0, 0, 0, 255))
    opaque.alpha_composite(thumb)
    palette_image = opaque.convert("RGB").quantize(colors=8, method=Image.MEDIANCUT).convert("RGB")
    colors = palette_image.getcolors(maxcolors=thumb.width * thumb.height) or []
    colors.sort(key=lambda item: item[0], reverse=True)

    palette = []
    seen = set()
    for count, color in colors:
        if color in seen:
            continue
        seen.add(color)
        palette.append({
            "hex": rgb_to_hex(color),
            "count": count,
            "luminance": round(relative_luminance(color), 4),
        })
        if len(palette) >= 8:
            break

    dominant = palette[0]["hex"] if palette else "#000000"
    light_colors = [item for item in palette if item["luminance"] >= 0.55]
    dark_colors = [item for item in palette if item["luminance"] < 0.35]
    accent_candidates = [item for item in palette if 0.25 <= item["luminance"] <= 0.8]

    theme = {
        "source": str(psd_path),
        "designWidth": inspect_json.get("width"),
        "designHeight": inspect_json.get("height"),
        "cmsWidth": inspect_json.get("cmsWidth", 750),
        "palette": palette,
        "tokens": {
            "backgroundColor": dark_colors[0]["hex"] if dark_colors else dominant,
            "primaryColor": dominant,
            "secondaryColor": palette[1]["hex"] if len(palette) > 1 else dominant,
            "accentColor": accent_candidates[0]["hex"] if accent_candidates else dominant,
            "textColor": light_colors[0]["hex"] if light_colors else "#ffffff",
            "borderColor": accent_candidates[-1]["hex"] if accent_candidates else dominant,
        },
        "notes": [
            "主题色由PSD合成图自动提取，运营和UI仍需人工确认。",
            "如果PSD有明确 style: 标注，后续版本可优先使用标注色。",
        ],
    }
    write_json(package_dir / "theme.json", theme)
    return theme


def component_meta(detection: dict, todos: list[str] | None = None) -> dict:
    meta = {
        "confidence": detection.get("confidence", 0.99),
        "sourceLayer": detection.get("sourceLayer"),
        "sourceType": detection.get("sourceType"),
    }
    if detection.get("relatedCutAssets"):
        meta["relatedCutAssets"] = detection["relatedCutAssets"]
    if todos:
        meta["todos"] = todos
    return meta


def bbox_intersection_area(first: dict, second: dict) -> int:
    left = max(first.get("left", 0), second.get("left", 0))
    top = max(first.get("top", 0), second.get("top", 0))
    right = min(first.get("right", 0), second.get("right", 0))
    bottom = min(first.get("bottom", 0), second.get("bottom", 0))
    return max(0, right - left) * max(0, bottom - top)


def attach_related_cut_assets(detections: list[dict], cut_assets: list[dict]) -> None:
    valid_cuts = [
        item for item in cut_assets
        if item.get("status") != "failed" and item.get("assetRef") and item.get("bounds")
    ]
    for detection in detections:
        bounds = detection.get("bounds") or {}
        related = []
        for item in valid_cuts:
            cut_bounds = item.get("bounds") or {}
            same_layer = item.get("layerPath") == detection.get("sourceLayer")
            intersects = bbox_intersection_area(bounds, cut_bounds) > 0
            if not same_layer and not intersects:
                continue
            related.append({
                "cutName": item.get("cutName") or item.get("assetName"),
                "assetRef": item.get("assetRef"),
                "file": item.get("file"),
                "layerPath": item.get("layerPath"),
            })
        if related:
            detection["relatedCutAssets"] = related


def cms_bbox_from_detection(detection: dict, source_width: int, cms_width: int) -> dict:
    bbox = detection["bounds"]
    scale = cms_width / source_width
    left = int(round(bbox["left"] * scale))
    top = int(round(bbox["top"] * scale))
    right = int(round(bbox["right"] * scale))
    bottom = int(round(bbox["bottom"] * scale))
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": max(0, right - left),
        "height": max(0, bottom - top),
    }


def build_preview_layout_slices(
    detections: list[dict],
    psd_path: Path,
    assets_dir: Path,
    cms_width: int,
) -> tuple[list[dict], list[dict]]:
    preview_items = [
        item for item in detections
        if item.get("generated")
        and item.get("sourceType") == "cms-annotation"
        and item.get("assetRef")
    ]
    preview_items.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"], item["sourceLayer"]))
    if not preview_items:
        return [], []

    source_image = open_composite_image(psd_path)
    content_image, content_rect = get_content_image(source_image)
    scale = cms_width / content_image.width
    cms_height = max(1, int(content_image.height * scale))
    cms_image = content_image.resize((cms_width, cms_height), Image.LANCZOS)

    for item in preview_items:
        item["previewOriginalBounds"] = item["bounds"]
        item["previewCmsBounds"] = cms_bbox_from_detection(item, content_image.width, cms_width)

    groups: list[list[dict]] = []
    current: list[dict] = []
    current_bottom = -1

    def should_merge_preview_group(group: list[dict], next_item: dict, next_top: int, bottom: int) -> bool:
        overlap_tolerance = 2
        return next_top < bottom - overlap_tolerance

    for item in preview_items:
        top = item["previewCmsBounds"]["top"]
        bottom = item["previewCmsBounds"]["bottom"]
        if not current:
            current = [item]
            current_bottom = bottom
            continue
        if should_merge_preview_group(current, item, top, current_bottom):
            current.append(item)
            current_bottom = max(current_bottom, bottom)
            continue
        groups.append(current)
        current = [item]
        current_bottom = bottom
    if current:
        groups.append(current)

    layout_slices = []
    components = []
    for index, group in enumerate(groups, 1):
        group_top = max(0, min(item["previewCmsBounds"]["top"] for item in group))
        if index < len(groups):
            next_top = min(item["previewCmsBounds"]["top"] for item in groups[index])
            group_bottom = max(group_top + 1, min(cms_height, next_top))
        else:
            group_bottom = max(item["previewCmsBounds"]["bottom"] for item in group)
            group_bottom = max(group_top + 1, min(cms_height, group_bottom))

        names = [slugify(item["localName"]) for item in group]
        if len(names) == 1:
            asset_name = names[0]
        else:
            asset_name = f"{names[0]}-to-{names[-1]}-preview"
        output_path = assets_dir / f"{asset_name}.png"
        cms_image.crop((0, group_top, cms_width, group_bottom)).save(output_path)

        asset_ref = f"asset://{asset_name}"
        asset_file = f"assets/{asset_name}.png"
        merged = len(group) > 1
        source_layers = [item["sourceLayer"] for item in group]
        candidate_names = [item["componentName"] for item in group]
        layout_info = {
            "assetName": asset_name,
            "file": asset_file,
            "assetRef": asset_ref,
            "cmsRect": {
                "x": 0,
                "y": group_top,
                "width": cms_width,
                "height": group_bottom - group_top,
            },
            "sourceLayers": source_layers,
            "candidateComponents": candidate_names,
            "merged": merged,
            "mergeReason": "overlapping PSD module bounds" if merged else "",
            "fileSizeBytes": output_path.stat().st_size,
        }
        layout_slices.append(layout_info)

        for item in group:
            item["jsonComponentName"] = "piccomponent"
            item["generationMode"] = "layout-preview"
            item["realComponentCandidate"] = item.get("componentName")
            item["generatedAsRealComponent"] = item.get("componentName") == "piccomponent"
            item["candidateTodos"] = (
                [] if item.get("componentName") == "piccomponent"
                else component_candidate_todos(item.get("componentName"))
            )
            item["previewSlice"] = {
                "assetName": asset_name,
                "file": asset_file,
                "assetRef": asset_ref,
                "cmsRect": layout_info["cmsRect"],
                "merged": merged,
                "sourceLayers": source_layers,
            }
            item["assetName"] = asset_name
            item["assetRef"] = asset_ref
            item["assetFile"] = asset_file

        todos = [
            f"上传 {asset_file} 并替换 {asset_ref} 为 CDN URL",
            "该图为按PSD纵向坐标生成的视觉预览切片"
        ]
        if merged:
            todos.append("该切片合并了重叠/贴边模块，避免CMS流式布局中互相挤压")
        components.append({
            "componentName": "piccomponent",
            "config": {
                "url": [asset_ref]
            },
            "meta": {
                "confidence": min(item.get("confidence", 0.99) for item in group),
                "sourceLayer": " + ".join(source_layers),
                "sourceType": "layout-preview-slice",
                "sourceComponentName": ", ".join(candidate_names),
                "generationMode": "layout-preview",
                "mergedPreviewSlice": merged,
                "todos": todos,
            }
        })

    return components, layout_slices


def component_candidate_todos(component_name: str) -> list[str]:
    if component_name == "countDown":
        return [
            "识别为倒计时组件候选，但预览阶段降级为静态图",
            "真实 countDown 依赖活动ID和接口时间，空ID时无法稳定还原PSD视觉",
            "上线前如需真实倒计时，请在CMS中替换为 countDown 并补充活动ID"
        ]
    if component_name in {"drawPool2", "drawPool", "blackbox", "taskDraw"}:
        return [
            f"识别为 {component_name} 组件候选，但预览阶段降级为静态图",
            "整块PSD视觉图不能直接填入组件内部标题图/奖池图字段",
            "上线前需补充活动ID、后台奖品/奖池配置，并由UI细标注组件内部素材字段"
        ]
    if component_name in {"commonGiftRank", "commonDailyRank", "h2hRank"}:
        return [
            f"识别为 {component_name} 榜单候选，但预览阶段降级为静态图",
            "真实榜单依赖榜单ID和后台数据",
            "上线前请确认榜单类型并补充榜单ID"
        ]
    if component_name in {"signUp2", "signUpGroup"}:
        return [
            f"识别为 {component_name} 报名候选，但预览阶段降级为静态图",
            "真实报名组件依赖报名活动配置",
            "上线前请确认报名后台配置并补充活动ID"
        ]
    if component_name == "giftExchange":
        return [
            "识别为礼物兑换候选，但预览阶段降级为静态图",
            "真实兑换组件依赖后台兑换配置",
            "上线前请确认兑换后台配置和业务ID"
        ]
    if component_name == "tabComp":
        return [
            "识别为 tabComp 候选，但当前PSD只提供tab区域视觉参考",
            "预览阶段降级为静态图，避免空tab结构影响视觉验收",
            "如需真实tab，请用 tab: 标注tab名称和tab内组件结构后重新生成"
        ]
    return [
        f"识别为 {component_name} 候选，但预览阶段降级为静态图",
        "请确认该模块是否需要替换为真实CMS组件"
    ]


def build_static_preview_component(detection: dict, reason_todos: list[str] | None = None) -> dict:
    asset_ref = detection.get("assetRef") or f"asset://{slugify(detection['localName'])}"
    asset_file = detection.get("assetFile", detection.get("localName", asset_ref))
    todos = [
        f"上传 {asset_file} 并替换 {asset_ref} 为 CDN URL"
    ]
    if reason_todos:
        todos.extend(reason_todos)

    return {
        "componentName": "piccomponent",
        "config": {
            "url": [asset_ref]
        },
        "meta": {
            **component_meta(detection, todos),
            "sourceComponentName": detection.get("componentName"),
            "generationMode": "static-preview"
        }
    }


def build_cut_asset_preview_components(cut_assets: list[dict]) -> list[dict]:
    components = []
    for item in cut_assets:
        if item.get("status") == "failed" or not item.get("assetRef"):
            continue
        asset_ref = item["assetRef"]
        asset_file = item.get("file", asset_ref)
        components.append({
            "componentName": "piccomponent",
            "config": {
                "url": [asset_ref]
            },
            "meta": {
                "confidence": item.get("confidence", 1.0),
                "sourceLayer": item.get("layerPath"),
                "sourceType": item.get("sourceType", "cut-annotation"),
                "cutName": item.get("cutName") or item.get("assetName"),
                "generationMode": "cut-asset-preview",
                "todos": [
                    f"上传 {asset_file} 并替换 {asset_ref} 为 CDN URL",
                    "该组件来自 PSD `切图:` 标注，用于运营视觉验收和素材替换"
                ],
            }
        })
    return components


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
                "tabs": [
                    {
                        "name": "Upgrade Prize Pool",
                        "content": []
                    },
                    {
                        "name": "Daily Task",
                        "content": []
                    },
                    {
                        "name": "Leaderboard",
                        "content": []
                    }
                ]
            },
            "meta": component_meta(detection, ["真实 tab 结构候选；确认 tab 名称和 tab 内组件后再用于上线"])
        }

    todos = ["确认后台业务配置和业务ID"]
    if component_name in {"drawPool2", "drawPool", "blackbox", "taskDraw"}:
        todos = ["补充活动ID测试ID", "补充活动ID正式ID", "确认抽奖/奖池后台配置", "确认标题图、奖池图、礼物列表等字段后再用于上线"]
    elif "Rank" in component_name or component_name in {"commonGiftRank", "commonDailyRank", "h2hRank"}:
        todos = ["确认榜单组件类型", "补充榜单ID"]
    elif component_name in {"signUp2", "signUpGroup"}:
        todos = ["确认报名后台配置", "补充报名活动ID"]

    if component_name == "drawPool2":
        field_assets = detection.get("fieldAssets", {})
        draw_img = field_assets.get("drawImg", {}).get("assetRef", "")
        pool_img = field_assets.get("poolImg", {}).get("assetRef", "")
        return {
            "componentName": "drawPool2",
            "config": {
                "testId": "",
                "actId": "",
                "drawImg": draw_img,
                "poolImg": pool_img,
                "get": "get",
                "drawText1": "Draw 1 time",
                "drawText2": "Draw XX times",
                "drawNum": "1, 10, 20, 50",
                "leftChance": "You have XX more chances",
                "record": "Record",
                "times": "You have drawn XX time(s)"
            },
            "styleConfig": {
                "barrageBg": "#ede6fd",
                "barrageColor": "#1e0d6f",
                "contBg": "#1f0900",
                "chanceColor": "#ffffff",
                "contBorder": "#d17a14",
                "floorBg": "#2d1301",
                "floorBorder": "#b86d10",
                "btn1Bg": "#ffffff",
                "btn2BgL": "#c56a00",
                "btn2BgR": "#4a1d00",
                "timesBg": "#6b2f00",
                "timesColor": "#ffffff"
            },
            "meta": component_meta(detection, todos)
        }

    return {
        "componentName": component_name,
        "config": {},
        "meta": component_meta(detection, todos)
    }


def build_components_from_detections(detections: list[dict], preview_mode: bool = False) -> list[dict]:
    generated = [
        item for item in detections
        if (
            item.get("componentName")
            and item.get("componentName") != "unknown"
            and item.get("sourceType") in {"cms-annotation", "component-annotation"}
        )
    ]
    generated.sort(key=lambda item: (item["bounds"]["top"], item["bounds"]["left"], item["sourceLayer"]))

    components = []
    for item in generated:
        component_name = item["componentName"]
        should_static_preview = (
            component_name in BACKEND_DEPENDENT_COMPONENTS
            or component_name in STATIC_PREVIEW_COMPONENTS
        )
        if preview_mode and should_static_preview and item.get("assetRef"):
            item["jsonComponentName"] = "piccomponent"
            item["generationMode"] = "static-preview"
            item["realComponentCandidate"] = component_name
            item["generatedAsRealComponent"] = False
            item["candidateTodos"] = component_candidate_todos(component_name)
            components.append(build_static_preview_component(item, item["candidateTodos"]))
            continue

        item["jsonComponentName"] = component_name
        item["generationMode"] = "real-component"
        item["generatedAsRealComponent"] = True
        item["generated"] = True
        components.append(build_component_from_detection(item))

    return components


def normalize_asset_base(value: str) -> str:
    return value.rstrip("/")


def localize_asset_refs(value, asset_map: dict[str, str], asset_base: str):
    if isinstance(value, str):
        if not value.startswith("asset://"):
            return value
        asset_name = value.replace("asset://", "", 1)
        asset_path = asset_map.get(asset_name)
        if not asset_path:
            return value
        return f"{asset_base}/{Path(asset_path).name}"
    if isinstance(value, list):
        return [localize_asset_refs(item, asset_map, asset_base) for item in value]
    if isinstance(value, dict):
        return {
            key: localize_asset_refs(item, asset_map, asset_base)
            for key, item in value.items()
        }
    return value


def build_local_preview_config(cms_config: dict, asset_map: dict[str, str], asset_base: str) -> dict:
    preview_config = copy.deepcopy(cms_config)
    preview_config["assets"] = {
        asset_name: f"{asset_base}/{Path(asset_path).name}"
        for asset_name, asset_path in asset_map.items()
    }
    preview_config["components"] = localize_asset_refs(
        preview_config.get("components", []),
        asset_map,
        asset_base,
    )
    return preview_config


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
    parser.add_argument(
        "--local-asset-base",
        help="Optional local HTTP base for cms-page-config.local-preview.json, e.g. http://127.0.0.1:8099",
    )
    parser.add_argument(
        "--annotation-manifest",
        help="Optional JSON file that maps existing PSD layer paths to 切图/组件 annotations without modifying the PSD.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Write inspect reports, fallback slices, import notes, and local-preview JSON for developer debugging.",
    )
    args = parser.parse_args()

    psd_path = Path(args.psd).expanduser().resolve()
    if not psd_path.exists():
        raise FileNotFoundError(f"PSD not found: {psd_path}")

    package_dir = resolve_output_dir(psd_path, args.out)
    assets_dir = package_dir / "assets"
    debug_enabled = args.debug
    temp_inspect = tempfile.TemporaryDirectory(prefix="activity-cms-psd-") if not debug_enabled else None
    inspect_dir = package_dir / "inspect" if debug_enabled else Path(temp_inspect.name)
    assets_dir.mkdir(parents=True, exist_ok=True)
    if debug_enabled:
        inspect_dir.mkdir(parents=True, exist_ok=True)
    annotation_manifest = read_json(Path(args.annotation_manifest).expanduser().resolve()) if args.annotation_manifest else None

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
    slices = save_slices(psd_path, assets_dir, inspect_dir, cms_width) if debug_enabled else []
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
        export_report = export_layer_assets(
            psd_path,
            assets_dir,
            inspect_dir,
            cms_width,
            annotation_manifest,
            include_fallback_assets=debug_enabled,
        )
    else:
        write_json(inspect_dir / "layers.json", {"layers": []})
        write_json(inspect_dir / "component-detection.json", {"detections": []})
        write_json(inspect_dir / "export-report.json", export_report)

    detections = export_report.get("detections", [])
    for item in detections:
        if item.get("assetName") and item.get("assetFile"):
            asset_map[item["assetName"]] = item["assetFile"]
    for asset_name, item in export_report.get("assets", {}).items():
        if item.get("file"):
            asset_map[asset_name] = item["file"]

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

    attach_related_cut_assets(detections, export_report.get("cutAssets", []))
    detected_components = build_components_from_detections(detections, preview_mode=False)
    cut_preview_components = build_cut_asset_preview_components(export_report.get("cutAssets", []))
    preview_components = detected_components or cut_preview_components
    layout_slices = []
    if not preview_components:
        preview_components, layout_slices = build_preview_layout_slices(detections, psd_path, assets_dir, cms_width)
    if not preview_components:
        preview_components = build_components_from_detections(detections, preview_mode=True)

    for item in layout_slices:
        asset_map[item["assetName"]] = item["file"]
        export_report.setdefault("assets", {})[item["assetName"]] = {
            "file": item["file"],
            "assetRef": item["assetRef"],
            "sourceType": "layout-preview-slice",
            "confidence": 0.99,
            "bounds": item["cmsRect"],
            "sourceLayers": item["sourceLayers"],
            "candidateComponents": item["candidateComponents"],
            "merged": item["merged"],
            "mergeReason": item["mergeReason"],
            "fileSizeBytes": item["fileSizeBytes"],
        }

    write_json(inspect_dir / "component-detection.json", {
        "source": str(psd_path),
        "engine": export_report.get("engine", args.engine),
        "previewLayoutSlices": layout_slices,
        "detections": detections,
    })
    export_report["detections"] = detections
    export_report["previewLayoutSlices"] = layout_slices
    write_json(inspect_dir / "export-report.json", export_report)
    theme = extract_theme(psd_path, inspect_json, assets_dir, package_dir)

    fallback_components = []
    if "hero" in asset_map:
        fallback_components.append({
            "componentName": "piccomponent",
            "config": {
                "url": ["asset://hero"]
            },
            "meta": asset_meta("hero", "auto slice: hero", 0.72)
        })
    if "introRules" in asset_map:
        fallback_components.append({
            "componentName": "piccomponent",
            "config": {
                "url": ["asset://introRules"]
            },
            "meta": asset_meta("introRules", "auto slice: introRules", 0.66)
        })

    cms_config = {
        "version": "1.0",
        "page": {
            "title": page_title,
            "backgroundColor": theme.get("tokens", {}).get("backgroundColor", "#000000"),
            "designWidth": inspect_json.get("width"),
            "cmsWidth": cms_width,
        },
        "assets": asset_map,
        "components": detected_components or cut_preview_components or fallback_components
    }

    hints = set(inspect_json.get("textHints", []))
    if not (detected_components or cut_preview_components) and {"Upgrade Prize Pool", "Draw 1 time", "Prize Pool"} & hints:
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
    local_preview_json = None
    if debug_enabled and args.local_asset_base:
        local_preview_json = package_dir / "cms-page-config.local-preview.json"
        local_preview_config = copy.deepcopy(cms_config)
        local_preview_config["components"] = preview_components or cms_config["components"]
        write_json(
            local_preview_json,
            build_local_preview_config(
                local_preview_config,
                asset_map,
                normalize_asset_base(args.local_asset_base),
            ),
        )

    (package_dir / "theme.md").write_text(
        "# Theme Notes\n\n"
        f"- PSD: `{psd_path}`\n"
        f"- Design size: `{inspect_json.get('width')} x {inspect_json.get('height')}`\n"
        f"- CMS width: `{inspect_json.get('cmsWidth', 750)}`\n"
        f"- Scale to CMS: `{inspect_json.get('scaleToCms')}`\n"
        f"- Asset export engine: `{args.engine}`\n"
        f"- Background Color: `{theme.get('tokens', {}).get('backgroundColor')}`\n"
        f"- Primary Color: `{theme.get('tokens', {}).get('primaryColor')}`\n"
        f"- Secondary Color: `{theme.get('tokens', {}).get('secondaryColor')}`\n"
        f"- Accent Color: `{theme.get('tokens', {}).get('accentColor')}`\n"
        f"- Text Color: `{theme.get('tokens', {}).get('textColor')}`\n"
        f"- Border Color: `{theme.get('tokens', {}).get('borderColor')}`\n"
        "- See `theme.json` for the full extracted palette.\n",
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
    for item in export_report.get("cutAssets", []):
        if item.get("status") == "failed":
            asset_notes.append(
                f"- `切图:{item.get('cutName')}`: 导出失败，图层 `{item.get('layerPath')}`，错误：{item.get('error')}"
            )
            continue
        target = (
            f"{item.get('targetWidth')}x{item.get('targetHeight')}"
            if item.get("targetWidth") and item.get("targetHeight")
            else "默认实际尺寸"
        )
        warning = f"，提示：{item.get('sizeWarning')}" if item.get("sizeWarning") else ""
        asset_notes.append(
            f"- `{item.get('file')}`: `切图:{item.get('cutName')}`，目标 `{target}`，导出 `{item.get('exportedWidth')}x{item.get('exportedHeight')}`，状态 `{item.get('sizeStatus')}`，图层 `{item.get('layerPath')}`{warning}"
        )

    candidate_notes = []
    visual_component_notes = []
    layout_notes = []
    for item in layout_slices:
        source_layers = " + ".join(item["sourceLayers"])
        merge_note = "，合并重叠/贴边模块" if item["merged"] else ""
        layout_notes.append(
            f"- `{item['file']}`: `{source_layers}` -> CMS 坐标 `{item['cmsRect']}`{merge_note}"
        )
    for item in detections:
        if item.get("previewSlice"):
            visual_component_notes.append(
                f"- `{item.get('sourceLayer')}` -> `piccomponent` 布局切片 `{item['previewSlice']['file']}`，原候选组件 `{item.get('componentName')}`"
            )
            if item.get("componentName") != "piccomponent":
                todos = item.get("candidateTodos") or component_candidate_todos(item.get("componentName"))
                candidate_notes.append(
                    f"- `{item.get('componentName')}`候选：`{item.get('sourceLayer')}`；未生成原因：{'；'.join(todos)}"
                )
        elif item.get("generationMode") == "static-preview":
            visual_component_notes.append(
                f"- `{item.get('sourceLayer')}` -> `piccomponent`，原候选组件 `{item.get('realComponentCandidate')}`，素材 `{item.get('assetFile')}`"
            )
            todos = item.get("candidateTodos") or []
            if todos:
                candidate_notes.append(
                    f"- `{item.get('realComponentCandidate')}`候选：`{item.get('sourceLayer')}`；未生成原因：{'；'.join(todos)}"
                )
        elif item.get("generationMode") == "real-component":
            visual_component_notes.append(
                f"- `{item.get('sourceLayer')}` -> `{item.get('componentName')}`"
            )

    if debug_enabled:
        (package_dir / "import-notes.md").write_text(
            "# Import Notes\n\n"
            f"- Package directory: `{package_dir}`\n"
            "- Import JSON: `cms-page-config.json`\n"
            "- Local `asset://` references are placeholders. Upload files from `assets/` and replace them with CDN URLs before save/preview.\n"
            "- Default asset export uses Python `psd-tools`; Photoshop is not required on the operator machine.\n"
            "- If a named layer/group cannot be exported reliably, the asset falls back to composite-image slicing.\n"
            "- Each PSD module is imported once. `组件:` annotations generate real CMS components; `切图:` annotations generate replacement assets.\n"
            "- `cms-page-config.local-preview.json` is a debug-only local URL variant.\n"
            "- Slice details are recorded in `inspect/slices.json`.\n"
            "- PSD layer tree is recorded in `inspect/layers.json`.\n"
            "- Component detection is recorded in `inspect/component-detection.json`.\n"
            "- Asset export source is recorded in `inspect/export-report.json`.\n"
            "\n"
            "## Generated Assets\n\n"
            + "\n".join(asset_notes)
            + "\n\n"
            "## Generated Components\n\n"
            + ("\n".join(visual_component_notes) if visual_component_notes else "- No annotated components were generated.\n")
            + "\n\n"
            "## Preview Layout Slices\n\n"
            + ("\n".join(layout_notes) if layout_notes else "- None.\n")
            + "\n\n"
            "## Real Component Candidates Not Generated\n\n"
            + ("\n".join(candidate_notes) if candidate_notes else "- None.\n")
            + "\n\n"
            "- Business IDs are intentionally blank. Fill test/formal activity IDs and any rank/task/draw backend IDs in JSON or the CMS right panel.\n"
            "- Low-confidence or empty tabs should be checked by operations before saving.\n",
            encoding="utf-8",
        )

    result = {
        "packageDir": str(package_dir),
        "importJson": str(package_dir / "cms-page-config.json"),
        "assetsDir": str(assets_dir),
        "themeJson": str(package_dir / "theme.json"),
        "themeMd": str(package_dir / "theme.md"),
        "engine": args.engine,
        "debug": debug_enabled,
    }
    if debug_enabled:
        result.update({
            "localPreviewJson": str(local_preview_json) if local_preview_json else None,
            "inspectJson": str(inspect_dir / "psd-inspect.json"),
            "slicesJson": str(inspect_dir / "slices.json"),
            "layersJson": str(inspect_dir / "layers.json"),
            "componentDetectionJson": str(inspect_dir / "component-detection.json"),
            "exportReportJson": str(inspect_dir / "export-report.json"),
            "preview": str(inspect_dir / "preview.png"),
            "importNotes": str(package_dir / "import-notes.md"),
        })
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if temp_inspect is not None:
        temp_inspect.cleanup()


if __name__ == "__main__":
    main()
