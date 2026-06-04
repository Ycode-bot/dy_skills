# Activity CMS PSD Annotation Guide

本文档给 UI、运营和活动配置同学使用。目标是让 PSD 成为 Skill 可以稳定解析的结构化输入，而不是让 Skill 对混乱设计稿做猜测切图。

## Core Principle

PSD must describe the CMS component structure.

PSD 不是纯视觉截图。每个可编辑 CMS 模块都应该是独立图层组，并使用轻量标注命名。Skill 只对规范标注做高置信生成；未标注或混放的内容只进入候选报告。

## Required Syntax

Use these prefixes in layer/group names:

| Prefix | Meaning | Example |
|---|---|---|
| `cms:` | CMS component group | `cms:countDown#mainCountdown` |
| `asset:` | Exportable image asset | `asset:url` |
| `text:` | Editable text/config reference | `text:actTime` |
| `style:` | Style/color reference | `style:numColor` |
| `tab:` | Tab name inside `tabComp` | `tab:Leaderboard` |

Format:

```txt
cms:<componentName>#<localName>
```

- `componentName` must match the CMS component catalog, for example `piccomponent`, `countDown`, `tabComp`, `drawPool2`.
- `localName` is a readable local alias, for example `hero`, `mainCountdown`, `leaderboard`.
- Do not put spaces in `componentName`. Use English camelCase exactly as listed in `component-catalog.md`.

## Correct Example

```txt
画板 1
  page:Redline Rivals

  cms:piccomponent#hero
    asset:url
      hero background
      title art
      decorative objects

  cms:countDown#mainCountdown
    text:actTime
    style:backgroundColor
    style:numBg
    style:numColor
    style:numBorder
    style:textColor
    countdown visual reference

  cms:tabComp#mainTabs
    tab:Upgrade Prize Pool
      cms:drawPool2#upgradePrizePool
        text:drawText1
        text:drawText2
        style:buttonColor
    tab:Daily Task
      cms:taskDraw#dailyTask
    tab:Leaderboard
      cms:commonGiftRank#leaderboard

  cms:piccomponent#rules
    asset:url
```

## Hard Rules

- Do not put `cms:countDown` inside `cms:piccomponent#hero`.
- Do not merge banner, countdown, tab, draw, rank, and rules into one large image group.
- Do not write business IDs in PSD.
- Do not name a visual-only decorative group as a functional CMS component.
- Keep the layer order top-to-bottom matching the page order.
- Keep text layers editable when the text should become CMS config.

## Business IDs

UI does not provide backend IDs.

Do not write these in PSD:

```txt
actId
actIdTest
testId
rankId
rankTestId
taskId
signupId
drawId
```

Skill will leave these blank in JSON. Operators fill them in JSON or the CMS right panel.

## Asset Rules

Only groups/layers marked with `asset:` are guaranteed to be exported as PNG files.

Recommended asset naming:

```txt
asset:url
asset:bg
asset:buttonImg
asset:titleImg
asset:ruleImg
```

For `piccomponent`, the main image should usually be:

```txt
cms:piccomponent#hero
  asset:url
```

The generated JSON will reference:

```json
"url": ["asset://hero"]
```

Operators must upload the exported PNG to CDN and replace `asset://hero` before save/preview.

## Text and Style Rules

Use `text:` for values that should be editable or used as CMS config:

```txt
text:actTime
text:drawText1
text:record
```

Use `style:` for visual style hints:

```txt
style:backgroundColor
style:numBg
style:numColor
style:numBorder
style:textColor
```

Skill may infer colors from the marked visual reference, but operators should still review `theme.md`.

## Bad Examples

### Countdown Inside Banner

```txt
cms:piccomponent#hero
  title art
  background
  countdown numbers
```

Why this is wrong: Skill cannot know whether the countdown should be static image or editable CMS `countDown`.

Correct:

```txt
cms:piccomponent#hero
cms:countDown#mainCountdown
```

### One Huge Screenshot Group

```txt
cms:piccomponent#fullPage
  everything
```

Why this is wrong: It removes editability and prevents CMS component mapping.

### Business IDs in PSD

```txt
field:actId=1200
field:testId=1716
```

Why this is wrong: IDs are operational/backend configuration, not UI design.

## When Unsure

If UI cannot determine the exact CMS component, use a candidate marker:

```txt
candidate:leaderboard#mainRank
candidate:draw#mainLottery
```

Skill should put this into `component-detection.json` and `import-notes.md` for operations to confirm.
