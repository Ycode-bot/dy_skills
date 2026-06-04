# Activity CMS PSD Skill Operator Usage

本文档给运营同学使用，说明如何调用 Skill、检查产物、导入 activityincms。

## Install Dependencies

The Skill uses Python and PSD parsing libraries.

```bash
python3 -m pip install -r skills/activity-cms-psd/requirements.txt
```

Required Python packages:

- `Pillow`
- `psd-tools[composite]`

Adobe Photoshop is not required.

## Invoke The Skill

In Codex, use a direct request:

```txt
使用 activity-cms-psd skill 处理 /Users/you/Downloads/activity.psd，输出到 /Users/you/Documents/activity-output
```

Or:

```txt
把这个 PSD 转成 activityincms 的整页导入 JSON，输出到 /Users/you/Documents/activity-output
```

If the Skill is not auto-discovered, reference the installed Skill explicitly:

```txt
按 activity-cms-psd 的规则处理这个 PSD，生成素材包和 CMS JSON
```

## Output Directory

If the output parent is:

```txt
/Users/you/Documents/activity-output
```

The final package will be:

```txt
/Users/you/Documents/activity-output/<psd-name>-<YYYYMMDDHHMM>/
```

Expected files:

```txt
assets/
inspect/
  preview.png
  psd-inspect.json
  layers.json
  slices.json
  export-report.json
  component-detection.json
cms-page-config.json
theme.md
import-notes.md
```

## Import Into Activity CMS

1. Open activityincms.
2. Enter the activity builder.
3. Click `导入整页JSON`.
4. Select:

```txt
<package-dir>/cms-page-config.json
```

5. Confirm overwrite if importing into an existing canvas.
6. Review warnings and todos.

## Required Checks After Import

- The canvas structure matches the PSD module order.
- Static image components use CDN URLs, not `asset://xxx`.
- `countDown` is editable as CMS `94 - 倒计时`, not embedded in banner image.
- `tabComp` contains the expected tab names and nested components.
- All backend IDs are filled:
  - activity test/formal IDs
  - rank IDs
  - task IDs
  - signup IDs
  - draw IDs
- Preview works after CDN URLs and IDs are filled.

## Asset Upload

Skill-generated JSON uses local placeholders:

```json
"url": ["asset://hero"]
```

Upload the matching file from `assets/`, then replace the placeholder with the CDN URL:

```json
"url": ["//cdn.example.com/path/hero.png"]
```

Activity CMS does not upload `asset://` files automatically.

## Business ID Policy

UI does not provide business IDs in PSD.

Skill intentionally leaves these blank:

- `actId`
- `actIdTest`
- `testId`
- `rankId`
- `rankTestId`
- task/signup/draw IDs

Fill them in JSON before import or in the CMS right panel after import.

## Reading Reports

- `import-notes.md`: human-readable handoff notes.
- `theme.md`: colors and visual style summary.
- `inspect/layers.json`: PSD layer tree.
- `inspect/export-report.json`: asset source, layer path, confidence, fallback reason.
- `inspect/component-detection.json`: detected CMS modules and low-confidence candidates.

If a component is listed as a candidate, confirm it with operations before using it as a real CMS component.
