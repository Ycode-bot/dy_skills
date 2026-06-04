# Recommended PSD Structure Examples

Use these examples as templates when preparing PSD files for `activity-cms-psd`.

## Minimal Page

```txt
画板 1
  page:Activity Name

  cms:piccomponent#hero
    asset:url

  cms:countDown#mainCountdown
    text:actTime
    style:backgroundColor
    style:numBg
    style:numColor
    style:numBorder
    style:textColor

  cms:piccomponent#rules
    asset:url
```

Generated CMS components:

- `piccomponent`
- `countDown`
- `piccomponent`

## Page With Tabs

```txt
画板 1
  page:Redline Rivals

  cms:piccomponent#hero
    asset:url

  cms:countDown#mainCountdown
    text:actTime
    style:numBg
    style:numColor
    style:textColor

  cms:tabComp#mainTabs
    tab:Upgrade Prize Pool
      cms:drawPool2#upgradePrizePool
        text:drawText1
        text:drawText2
        text:leftChance
        text:record
    tab:Daily Task
      cms:taskDraw#dailyTask
    tab:Leaderboard
      cms:commonGiftRank#leaderboard

  cms:piccomponent#bottomRules
    asset:url
```

Generated CMS structure:

```txt
piccomponent#hero
countDown#mainCountdown
tabComp#mainTabs
  Upgrade Prize Pool
    drawPool2#upgradePrizePool
  Daily Task
    taskDraw#dailyTask
  Leaderboard
    commonGiftRank#leaderboard
piccomponent#bottomRules
```

## Banner And Countdown Separation

Bad:

```txt
cms:piccomponent#hero
  background
  title
  countdown numbers
```

Good:

```txt
cms:piccomponent#hero
  asset:url
    background
    title

cms:countDown#mainCountdown
  countdown visual reference
```

The countdown must be a separate CMS component so operators can fill activity IDs and the runtime can calculate time.

## Visual-Only Decoration

If a decoration should not become an editable component, keep it inside the nearest asset group:

```txt
cms:piccomponent#hero
  asset:url
    background
    title
    decorative coins
    decorative lights
```

If the decoration should be independently replaceable, make it a separate image component:

```txt
cms:piccomponent#floatingCoins
  asset:url
```

## Candidate Module

When the exact CMS component is uncertain:

```txt
candidate:rank#leaderboardArea
candidate:task#dailyTaskArea
```

Skill should report these in `component-detection.json`; operations decide the final CMS component.
