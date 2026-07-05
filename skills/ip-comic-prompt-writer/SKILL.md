---
name: ip-comic-prompt-writer
description: Extract and segment Chinese copy from images or long text, rewrite every sentence into scene-first WeChat/Xiaohongshu-ready hooks, then write complete `gpt-image-2` prompts for a capybara IP comic series. Use when the user wants image/text copy analysis, scene-based生活或职场吐槽文案 polishing, capybara IP comic prompt series, multi-image prompt batches, or draft-copy optimization.
metadata:
  short-description: Create scene-first copy and capybara IP comic prompts.
---

# IP Comic Prompt Writer

This skill extracts or improves social-media copy, rewrites every sentence into scene-first, human-sounding Chinese hooks, then turns every optimized sentence into a direct-render `gpt-image-2` prompt using the user's fixed original capybara IP character.

Default target use case:
- The user wants copy extracted from an image or long text, segmented, polished, and optionally turned into an IP comic prompt
- The user may provide an inspiration image, a text screenshot, a draft copy line, a topic, or no copy at all
- Inspiration or competitor images are for visible-text extraction, topic, hook, emotion, and scene-pattern analysis only
- The final image-generation prompt should rely on the built-in finalized capybara IP description unless the user supplies a newer IP reference or profile
- The default comic-series result is a 4:3 horizontal cute comic: top copy, bottom matching capybara illustration
- When the user asks for a cover image, the result is a single 21:9 horizontal WeChat Official Account cover prompt
- If the input comes from `workplace-viral-copywriter`, expect scene-first paired groups such as `第1组 上：...` and `第1组 下：...`; preserve those pairs as connected sequential images
- The default output is original sentence segmentation, sentence-by-sentence optimization, comic series copy, and complete Chinese prompts for every optimized sentence

## Core Positioning

This skill now follows the same content model as `workplace-viral-copywriter`:
- one concrete scene
- one clear contradiction or mismatch
- continuous observation panels
- human reactions instead of abstract summaries

The goal is not to write prettier copy. The goal is to sound more like a real person reacting inside a specific scene.

## When To Use

Use this skill when the user asks for any of these:
- Create scene-based引流文案 for the user's capybara IP
- Extract text from a supplied image and split it into numbered sentences
- Rewrite each sentence into a WeChat/Xiaohongshu-friendly scene hook
- Turn a workplace or life-adjacent meme idea into a comic prompt
- Optimize the user's draft copy for humor, shareability, visual clarity, and human voice
- Produce top-copy bottom-illustration Chinese prompts for `gpt-image-2`
- Produce a 21:9 WeChat Official Account cover prompt when the user asks for `封面图`, `公众号封面`, `标题图`, or `封面提示词`
- Analyze a reference image only to understand topic type, audience hook, emotional trigger, or content pattern

Do not use this skill when:
- The user wants image generation performed directly
- The user wants a new IP character designed from scratch
- The user wants legal review
- The user asks to copy a competitor's exact wording, layout, or joke structure

## Default IP Profile

If the user does not override the IP profile in the current turn, always use the built-in finalized capybara IP profile from [references/default-ip-profile.md](references/default-ip-profile.md).

## Output Contract

By default, return these sections in Chinese:

1. `原文断句`
   - Number the visible or supplied original sentences after semantic segmentation.
   - If the source text is already line-based or numbered, preserve each visible line as one unit.
   - If the source uses paired-group labels such as `第1组 上：`, `第1组 下：`, `上：`, or `下：`, preserve the group number and upper/lower role for every line.
   - Preserve comparison prefixes such as `要饭：`, `上班：`, `别人上班：`, `我上班：`; these prefixes must not be merged, deleted, or rewritten.
   - If OCR/visual text is incomplete, segment only the readable content and do not invent missing lines.
2. `逐句优化`
   - Rewrite every segmented sentence into a short, human-sounding, scene-first hook.
   - When a line has a fixed prefix before `：`, keep that prefix unchanged and only optimize the text after the colon.
   - If the input is already polished copy from `workplace-viral-copywriter` or uses `第X组 上/下` labels, preserve the original scene and tone by default. Only remove obvious redundancy, awkward rhythm, AI-sounding wrap-up, or overlong phrasing.
   - Use the format `原句 -> 优化句`.
3. `漫画系列文案`
   - List every optimized sentence that will become an image.
   - By default, every segmented unit becomes one comic prompt.
   - For paired groups, list every line separately but keep adjacent group labels, e.g. `第1组 上` then `第1组 下`.
4. `生成提示词`
   - One fenced `text` block for every item in `漫画系列文案`.
   - Each prompt must be complete and independent. Do not split shared prefixes or suffixes away from individual prompts.
   - For paired groups, each prompt is still standalone, but must state its group role and how it visually connects with the adjacent prompt in the same group.

If the user explicitly says `只要提示词`, `只输出提示词`, or similar, return only all fenced `text` prompt blocks and no analysis.

If the user asks for `封面图`, `公众号封面`, `标题图`, `封面提示词`, or similar, use Cover Mode:
- Output only one complete fenced `text` prompt by default.
- Do not output `原文断句`, `逐句优化`, or `漫画系列文案` unless the user explicitly asks.
- Prefer short titles that sound like a real person reacting, not abstract life conclusions.

If the user explicitly says `只要优化文案`, `不用出图`, or similar, return only `原文断句` and `逐句优化`.

If the user explicitly says `只要一句`, `只做一张`, or similar, choose the strongest optimized line and output only one complete prompt.

## Workflow

### 1. Read the inputs

Identify which of these the user supplied:
- IP reference image or updated IP profile
- Inspiration image or text screenshot
- Draft copy or final copy
- Topic, target emotion, platform, or tone constraints

If the user provides copy from `workplace-viral-copywriter`, assume:
- the scene and contradiction have already been chosen
- your job is to keep the scene intact
- your job is not to make the copy more abstract or more slogan-like

If the input contains `画面关键词`, treat those keywords as the primary visual plan.

### 2. Extract and segment source copy

When the input contains image text or long text:
- Break it into semantic sentences or short content units, not visual line wraps.
- Preserve each short line when the copy is already arranged as a comic series.
- For paired-group labels, keep every labeled line as its own unit and retain metadata.
- Preserve obvious headings, labels, and punchline units as separate numbered items.
- Clean OCR spacing and repeated punctuation, but do not silently rewrite meaning in this section.

### 3. Analyze inspiration without copying

From an inspiration image, extract only:
- scene type
- audience hook
- emotional trigger
- content pattern
- contradiction or mismatch if present

Do not preserve:
- exact wording
- exact composition
- exact visual joke
- exact punchline

### 4. Optimize each sentence for WeChat/Xiaohongshu

Default rewrite style:
- sharp but safe
- short and image-ready
- concrete before abstract
- human reaction before writer summary

Hard rules:
- Keep the scene. Do not optimize a concrete scene into a generic life lesson.
- Prefer real-person reactions over polished wrap-ups.
- If a line sounds too neat, too smart, or too complete, rewrite it plainer.
- Avoid defaulting to `我以为...其实...`, `本质上...`, `是一种...`, `成年人最___的状态`.
- Do not force every line into a big slogan. Some lines should feel like muttering, not performing.

Priority sentence energy:
- `我一下就...`
- `我当场就...`
- `我就不说话了`
- `我感觉...`
- `我怀疑...`
- `怎么越想越不对`
- `单看都还行，放一起就不对了`

These are style signals, not mandatory templates. Use them only when they sound natural for the sentence.

Paired self-comfort and scene-story rules:
- Upper lines usually set up one visible moment.
- Lower lines should usually sound like a reaction, a tiny realization, a muttered complaint, or a small turn.
- Keep the emotional movement intact: scene -> contradiction -> reaction -> slight clarity.
- Do not turn natural lines into abstract summaries just to make them sound clever.

Examples:
- Weak: `其实我是贵得比较分散`
- Strong: `单看它们都不贵`
- More resonant: `怎么凑一起就这么贵`

- Weak: `我是被几块几块凑出来的`
- Strong: `我不是自己想买这么多`
- More resonant: `我感觉超市给我做局了`

- Weak: `我以为自己花得很克制`
- Strong: `结账跳到100多`
- More resonant: `我一下就不说话了`

### 5. Build the comic series

By default:
- Every segmented sentence becomes one item in `漫画系列文案`
- Every item gets its own complete standalone prompt
- Preserve the original sequence
- For paired groups, preserve exact upper/lower order
- Keep the whole series inside one scene family unless the source itself changes scenes

Do not reduce to one image unless the user explicitly asks.

### 6. Match the copy with an应景画面

Turn the final copy into a lower-half capybara illustration that completes or amplifies the joke.

Scene rules:
- The lower-half image must match that image's top copy directly.
- The core visual object must drive the action.
- Prefer one concrete place and one concrete reaction over generic office desk scenes.
- For life-adjacent scenes, expand the default object pool to include: receipt, basket, shelf, takeout bag, subway gate, bed edge, doorway, delivery app, payday notification, wallet, supermarket aisle.
- The expression should look like a real small reaction: frozen, muttering, suddenly quiet, trying to act normal, suspicious, embarrassed, or lightly smug.
- If paired groups come from `workplace-viral-copywriter`, the two images in one group must feel like the same moment continuing, not two unrelated jokes.

### 7. Produce the final output

Default response format:
- `原文断句`
- `逐句优化`
- `漫画系列文案`
- `生成提示词`

If the user asks only for copy optimization, stop after `逐句优化`.

## Prompt Rules

Every final prompt should still:
- use the user's finalized capybara IP
- keep the 4:3 or 21:9 layout wording
- put top copy in `上半部分`
- put an应景 capybara scene in `下半部分`
- include `核心视觉物件：...`
- include `具体表情：...`
- stay copy-pasteable as one complete prompt

When the source is scene-first story content:
- preserve the scene
- preserve the contradiction
- preserve the human reaction
- avoid rewriting the top copy into a more abstract statement inside the prompt

## References

- Default IP profile: [references/default-ip-profile.md](references/default-ip-profile.md)
- Prompt section template: [references/output-template.md](references/output-template.md)
