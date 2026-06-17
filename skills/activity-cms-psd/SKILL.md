---
name: activity-cms-psd
description: Generate activityincms whole-page JSON drafts from ordinary or annotated PSD activity designs, including asset slicing guidance, CMS component mapping, tab nesting, missing business-ID todos, theme notes, and operator handoff docs. Use when a user asks to turn PSD activity pages into CMS JSON, inspect PSD activity designs for activityincms, or prepare activity-output packages for the activityincms whole-page JSON importer.
metadata:
  short-description: Convert activity PSDs into activityincms JSON drafts.
---

# Activity CMS PSD

Use this skill when converting a PSD activity design into an activityincms import package.

The recommended input is a lightly annotated PSD that follows `references/psd-annotation-guide.md`. Treat `cms:` / `asset:` / `text:` / `style:` / `tab:` annotations as the source of truth. Ordinary unannotated PSDs are supported only as a low-confidence fallback and must produce clear candidate notes instead of pretending the mapping is certain.

For new PSDs, prefer the simplified Chinese annotations:

- `切图:<assetName>` or `切图:<assetName>[widthxheight]` for required PNG exports.
- `组件:<Chinese component label>` for real CMS component generation.

Cut annotations and component annotations are independent but complementary. `组件:` drives the JSON component tree. `切图:` drives the asset package that operators use to replace the generated component's image fields.

## Output Contract

Create the output package in a deterministic directory.

Default output directory:

```txt
<current workspace>/work/activity-output/<psd-file-stem>-<YYYYMMDDHHMM>/
```

If the user says `输出到 <path>` or otherwise gives an output path, treat that path as the parent output directory. Create a child package directory named `<psd-file-stem>-<YYYYMMDDHHMM>/` inside it. If the same child directory already exists, append `-2`, `-3`, etc. Do not create sibling directories like `<out>-<timestamp>`.

When available, run:

```bash
./activity-cms-psd <psd> --out <output-dir>
```

If the CLI environment is not installed, `./activity-cms-psd` runs `./install.sh` automatically on first use. You can also install manually:

```bash
./install.sh
```

`./activity-cms-psd` checks `Ycode-bot/dy_skills@activity-cms-psd` for updates on each run. When newer files are found, it updates the installed skill directory, preserves `.venv`, and restarts once. If the update check fails, continue with the local version. Set `ACTIVITY_CMS_PSD_AUTO_UPDATE=0` to skip this check.

If `--out` is omitted, the script creates the default package directory. The default package folder must be shaped like:

```txt
<output-parent>/<psd-file-stem>-<YYYYMMDDHHMM>/
  assets/
  cms-page-config.json
  theme.json
  theme.md
```

Assets in `assets/` are compressed by Tinify by default when `ACTIVITY_CMS_PSD_TINIFY_KEY` or `TINIFY_API_KEY` is configured. If no key is configured, package generation continues and `theme.md` records that compression was skipped. Use `--no-compress` to disable compression intentionally.

When invoked with `--debug`, the package may additionally include:

```txt
inspect/
  preview.png
  psd-inspect.json
  layers.json
  slices.json
  export-report.json
  component-detection.json
cms-page-config.local-preview.json
import-notes.md
```

`cms-page-config.json` must use the activityincms whole-page import format:

```json
{
  "version": "1.0",
  "page": {
    "title": "Activity Title",
    "backgroundColor": "#000000",
    "designWidth": 1500,
    "cmsWidth": 750
  },
  "assets": {
    "fullPage": "assets/full-page.png",
    "hero": "assets/hero.png",
    "introRules": "assets/intro-rules.png",
    "drawSection": "assets/draw-section.png",
    "poolSection": "assets/pool-section.png"
  },
  "components": []
}
```

Component entries must be sparse overrides, not full CMS default configs. Use `componentName`, optional `config`, optional `styleConfig`, and optional `meta`.

Each PSD module must generate at most one CMS component in `components`. `组件:` annotations should generate real activityincms components with blank business IDs and todos, even when backend configuration is incomplete. Do not output both a static `piccomponent` visual reference and a real functional component for the same annotated module. Use `piccomponent` only for `切图:`-only visual modules or low-confidence fallback modules.

For local sliced assets, use `asset://name` placeholders in JSON and explain in component `meta.todos` that operators must upload assets and replace them with CDN URLs before save/preview.

For local testing, the script may also create `cms-page-config.local-preview.json` when invoked with both `--debug` and `--local-asset-base <url>`. This file should keep the same real component tree as `cms-page-config.json`, replacing only `asset://` references with local HTTP image URLs. It must not downgrade recognized `组件:` modules to images.

Static preview components must preserve PSD vertical layout. When annotated modules overlap or touch in PSD coordinates, merge them into one layout preview slice so activityincms can render the page correctly with normal top-to-bottom `piccomponent` flow.

Default asset export uses Python `psd-tools`, not Adobe Photoshop. It must read the PSD layer/group tree and prioritize annotated groups/layers. In `--debug` mode, also write the tree to `inspect/layers.json`.

- `切图:<assetName>` exports the layer/group as a PNG using its actual bounds.
- `切图:<assetName>[<width>x<height>]` exports the layer/group as a PNG with an optional target-size check.
- `组件:<Chinese label>` generates a real CMS component with sparse config overrides and blank business IDs.
- `cms:<componentName>#<localName>` creates or candidates a CMS component.
- `asset:<fieldName>` marks an exportable image asset.
- `text:<fieldName>` marks editable text/config.
- `style:<fieldName>` marks color/style references.
- `tab:<tabName>` marks tab structure under `tabComp`.

If annotations are missing, fallback name matching may inspect clearly named layers/groups such as `头图`, `banner`, `hero`, `倒计时`, `规则`, `抽奖`, and `奖池`, but those matches must be lower confidence unless the component boundary is unambiguous.

If a layer/group is missing, too broad, hidden, or cannot be composited by `psd-tools`, record the failure in debug reports. Composite-image fallback slices are generated only in `--debug` mode.

In `--debug` mode, write `inspect/export-report.json` for every generated asset with:

- `sourceType`: `psd-tools-layer`, `psd-tools-layer-group`, or `composite-slice-fallback`
- `layerPath` when a layer/group was used
- `bounds`
- `confidence`
- `fallbackReason` when fallback was used

In `--debug` mode, write `inspect/component-detection.json` for every detected module or candidate with:

- source layer path
- recommended `componentName`
- confidence
- whether the module was generated into JSON
- whether it was generated as a real component or downgraded to a static preview
- preview slice bounds and merge information when static modules are merged for layout
- low-confidence or fallback reason when relevant

Photoshop is not required for operators. If a developer later adds a Photoshop-backed exporter, it should be optional only and must not replace `psd-tools` as the default.

In the final response, always state:

- the package directory
- the JSON file to import into activityincms
- which local assets still need CDN upload/replacement
- which business IDs or backend configs operators must fill

## How To Invoke

Users can invoke this skill explicitly:

```txt
使用 activity-cms-psd skill，把这个 PSD 生成 activityincms 可导入 JSON，输出到 /Users/yangdongyu/Desktop/redline-output
```

```txt
$activity-cms-psd 处理 /Users/yangdongyu/Downloads/遗迹-奖池升级(金币文案）.psd，生成 CMS JSON 和素材包
```

Natural language can also trigger it:

```txt
把这个 PSD 转成 activityincms 的整页导入 JSON
```

If the skill is not automatically discovered in a conversation, use the explicit file path:

```txt
按已安装的 activity-cms-psd/SKILL.md 规则处理这个 PSD
```

## Workflow

1. Inspect the PSD basics:
   - file size, canvas size, color mode if available
   - composite preview
   - readable text layers or extracted XMP text
   - whether width is 750 or a 2x 1500 design
   - Run `./activity-cms-psd <psd> --out <output>` from this skill folder to create the package directory, assets, theme files, and `cms-page-config.json`.
   - Configure Tinify before running if image compression is required: `export ACTIVITY_CMS_PSD_TINIFY_KEY="..."`.
   - Use `--debug` only when you need `inspect/` reports, fallback slices, import notes, or local preview JSON.
   - The default command uses `--engine psd-tools`. Use `--engine composite` only for debugging fallback slicing.
2. Identify page modules from top to bottom:
   - First parse explicit `cms:` annotations.
   - Then parse `tab:`, `asset:`, `text:`, and `style:` children.
   - Use fallback name matching only when annotations are absent.
3. Map modules to existing activityincms components:
   - `切图:` annotations: export PNG assets and record target/actual dimensions
   - `组件:` annotations: generate real CMS components with todos for missing IDs/backend config
   - `切图:` annotations: export assets and attach related assets to nearby/generated components
   - high confidence static module with no component annotation: generate `piccomponent`
   - backend-dependent module without fine-grained annotations: still generate the real component, but leave unknown image/config fields empty and add todos
   - low confidence: add a todo to `cms-page-config.json`; in `--debug` mode also write a candidate to `component-detection.json`
   - never invent a component name
4. Generate JSON:
   - leave all business IDs blank
   - import each PSD module once only
   - include `meta.confidence`, `meta.source`, `meta.alternatives`, and `meta.todos` when useful
   - use `tabComp.config.tabs[].content[]` for nested tab content
5. Generate handoff docs:
   - `theme.md`: colors, typography notes, page style, component color recommendations
   - debug-only `import-notes.md`: mapping decisions, low-confidence areas, missing IDs, asset upload reminders

## Component Mapping Rules

Use these common mappings first:

- static visual block -> `piccomponent`
- editable title -> `titleComp`
- editable rich text/rules -> `textComp`
- tabs -> `tabComp`
- black-box draw / blind box -> `blackbox`
- prize pool upgrade with Draw 1/10/20/50, Prize Pool, Lv.1/Lv.2 -> prefer `drawPool2`, alternative `drawPool`
- task draw / task lottery -> `taskDraw`
- signup area -> `signUp2` or `signUpGroup`
- gift exchange -> `giftExchange`
- common rank -> `commonGiftRank`, `commonDailyRank`, or `h2hRank`

If the PSD says `Daily Task` or `Leaderboard` but does not reveal the exact CMS backend/component shape, create an empty tab or static placeholder with todos instead of guessing.

## Business IDs

Do not require or infer business IDs from PSD names.

Always set these to empty when present in generated functional components:

- `testId`
- `actId`
- `rankTestId`
- `rankId`
- task IDs
- signup IDs
- draw IDs

Add todos such as:

- `补充活动ID测试ID`
- `补充活动ID正式ID`
- `确认榜单ID`
- `确认任务后台配置`
- `确认抽奖/奖池后台配置`

## Annotated PSD Mode

Annotated PSD mode is the preferred workflow. UI should follow `references/psd-annotation-guide.md`.

Preferred simplified format:

```txt
切图:头图[750x900]
切图:规则背景
切图:抽奖标题[700x180]

组件:倒计时
组件:奖池升级
组件:榜单
```

Legacy detailed format remains supported:

```txt
cms:piccomponent#hero
  asset:url

cms:countDown#mainCountdown
  text:actTime
  style:numBg
  style:numColor
  style:textColor

cms:drawPool2
  asset:barrageVisualReference
  text:get
  style:barrageBg
  style:barrageColor
  asset:drawImg
  asset:poolImg
  text:drawText1
  text:drawText2

cms:tabComp
  tab:Upgrade Prize Pool
    cms:drawPool2
  tab:Daily Task
```

Annotations are hints, not proof. Still validate component names against activityincms configs when repo access is available.

Hard rules:

- Do not put countdown layers inside a banner image component.
- Do not merge banner, countdown, tabs, draw, rank, and rules into one large image group.
- Do not split drawPool2's floating award notice / barrage into a standalone `piccomponent`; keep it under `cms:drawPool2` with `asset:barrageVisualReference`, `text:get`, `style:barrageBg`, and `style:barrageColor`.
- Do not write business IDs in PSD.
- Only `asset:` layers/groups are guaranteed image exports.

## Current Known Example

For `/Users/yangdongyu/Downloads/遗迹-奖池升级(金币文案）.psd`:

- PSD is an ordinary unannotated design.
- Canvas is `1500 x 5000`, so output coordinates/assets should be normalized to CMS width `750`.
- It contains text such as `Redline Rivals`, `Upgrade Prize Pool`, `Daily Task`, `Extra Fun`, `Leaderboard`, `Draw 1 time`, `Draw 10 times`, `Draw 20 times`, `Draw 50 times`, `Prize Pool`, `Lv.1`.
- Recommended mapping:
  - hero/rules/decorations -> `piccomponent`
  - main tabs -> `tabComp`
  - upgrade prize pool tab -> `drawPool2`, alternative `drawPool`
  - floating award notice above the draw title -> part of `drawPool2`, not a standalone picture component
  - daily task and leaderboard tabs -> empty/candidate tabs with todos unless exact component fit is confirmed

## Quality Bar

The generated package is a CMS draft, not an auto-published activity.

Success means:

- activityincms can import the JSON without errors
- the canvas shows the complete page skeleton
- high-confidence functional blocks become editable CMS components
- low-confidence blocks are visible as static slices with todos
- operators clearly know which IDs, CDN URLs, and backend configs must be filled

## References

- `references/psd-annotation-guide.md`: UI/operations PSD marking standard.
- `references/operator-usage.md`: how to invoke the skill and import JSON.
- `references/component-catalog.md`: activityincms component list with Chinese labels and English purposes.
- `references/example-psd-structure.md`: recommended PSD layer/group structures.
