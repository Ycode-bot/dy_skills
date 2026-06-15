# Activity CMS PSD Skill Operator Usage

本文档给运营同学使用，说明如何调用 Skill、检查素材包、主题包和真实组件 JSON。

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
把这个 PSD 生成 activityincms 可导入 JSON、素材包和主题包，输出到 /Users/you/Documents/activity-output
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
cms-page-config.json
theme.json
theme.md
```

First check `cms-page-config.json`, `assets/`, `theme.json`, and `theme.md`.

Developer debug mode may additionally create `inspect/`, `import-notes.md`, and `cms-page-config.local-preview.json`. These are not default operator deliverables.

Recognized `组件:` modules should appear as real CMS components after import. `切图:` assets are used as replacement material for those components or for pure static visual blocks.

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

The normal delivery file is `cms-page-config.json`; do not expect separate visual/component JSON files.

## Required Checks After Import

- The canvas structure matches the PSD module order.
- Each PSD module appears only once. For example, a draw area should be either a real draw component or a static image component, not both.
- Static image components use CDN URLs, not `asset://xxx`.
- Recognized `组件:` modules appear as real CMS components, not static image placeholders.
- Check component `meta.relatedCutAssets` for related cut assets.
- Check component `meta.todos` for missing IDs, backend configs, and asset replacement reminders.
- All backend IDs are filled:
  - activity test/formal IDs
  - rank IDs
  - task IDs
  - signup IDs
  - draw IDs
- Preview works after CDN URLs and IDs are filled.

## Required Checks For Assets

- Every PSD layer/group named `切图:<name>` has a matching PNG in `assets/`.
- If the PSD name includes a target size such as `切图:头图[750x300]`, ask研发 to run `--debug` when you need exact target/export size diagnostics.
- If no target size is written, the exported PNG should use the layer/group's actual PSD bounds.
- `size-mismatch` means Skill did not crop or stretch the image automatically; ask UI to adjust the PSD group or rename the expected size.

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

## Debug Reports

- `theme.json`: machine-readable palette and theme tokens.
- `theme.md`: human-readable colors and visual style summary.
When generated with `--debug`:

- `inspect/layers.json`: PSD layer tree.
- `inspect/export-report.json`: asset source, layer path, confidence, fallback reason.
- `inspect/component-detection.json`: detected CMS modules and low-confidence candidates.
- `import-notes.md`: human-readable debug handoff notes.

If a component is listed as a candidate, confirm it with operations before using it as a real CMS component.
