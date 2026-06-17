---
name: workplace-viral-copywriter
description: Generate viral, platform-safe Chinese workplace copy for a capybara IP WeChat Official Account, including article topics, 5-6 paired two-line image groups, cover hooks, interaction questions, and hashtags. Use when the user wants WeChat/Xiaohongshu workplace resonance copy, trend-informed topic ideation, anti-fatigue content planning, or captions that can later be turned into comic prompts.
---

# Workplace Viral Copywriter

This skill writes viral Chinese workplace copy for the user's capybara IP account. It researches current workplace resonance points first, then generates original text; use `ip-comic-prompt-writer` later to convert approved lines into image-generation prompts.

## Core Positioning

Default account voice:
- 打工人嘴替
- 劝自己清醒
- 低能量自救
- 情绪止损
- 钱少事多的荒诞感
- 不把同事、领导、公司关系写得太认真

Default reader:
- 普通上班族
- 想转发给朋友或同事，但不想显得攻击性太强
- 喜欢短句、金句、冷幽默、自我安慰式清醒

## Output Contract

Unless the user asks for a different format, output these sections in Chinese:

1. `调研摘要`
   - Before writing the article, do a light web research pass by default.
   - Summarize 3-5 recent workplace resonance points in your own words.
   - Do not quote, paste, or near-copy online posts, titles, punchlines, competitor copy, character concepts, or layouts.
   - If search is unavailable, state that the research pass could not be completed and continue from the built-in motif bank.
2. `选题判断`
   - Identify the primary motif: 工资, 同事, 领导, 情绪止损, 荒诞对比, 关系降级, 背锅, 加班, 绩效, 秒回, 团建, 周报, or 消息焦虑.
   - Explain the reader resonance in 1-2 short sentences.
   - Choose only one best-fit theme from the research, rather than mixing many hot topics into one article.
3. `爆款标题`
   - Give 8-12 WeChat Official Account title options.
   - Titles should be sharp, short, safe, and conversational. Prefer discovery phrases, half-sentence hooks, and "I noticed" style openings over essay-like titles.
4. `正文文案`
   - Write 10-12 lines organized as 5-6 paired image groups.
   - Use the exact group format: `第1组 上：...` and `第1组 下：...`.
   - The upper line sets up a workplace scene, small feeling, or ordinary problem.
   - The lower line gives the turn: relief, self-comfort, deadpan punchline, or gentle correction.
   - Every line should be image-ready and able to become one capybara comic image, but each pair should feel connected.
   - Each line should be short enough for large cover-style text.
5. `画面关键词`
   - For every paired group, give 2-3 visual keywords or props that can be handed to `ip-comic-prompt-writer`.
   - Prefer concrete props with metaphor value: mirror, copier, pot, shield, gear, phone popup, salary slip, rice bowl, brick wall, badge, switch box, tangled yarn, door, receipt, clock, or battery.
6. `封面金句`
   - Give 1-3 strongest cover candidates.
   - Each should work as big text on a thumbnail.
7. `互动问题`
   - Give 2-4 compliant article-ending questions.
   - Do not induce following, sharing, reposting, screenshots, group joining, or reward collection.
8. `话题标签`
   - Give exactly 3 high-traffic hashtags with `#`.
   - Default to broad, stable tags such as `#打工人日常`, `#职场边界感`, `#情绪止损`, replacing one tag when the article has a clearer theme such as salary, coworkers, leadership, overtime, or meetings.

If the user asks for only one of these sections, output only that section.

## Viral Motifs

Use researched resonance points first. Use these proven motifs as filters and fallback patterns, not as the only source of ideas:

- `工资不配消耗我`: low salary does not deserve emotional overinvestment.
- `上班比要饭难`: absurd comparison that makes work feel more ridiculous than begging.
- `同事只是同事`: relationship downgrading and low-cost social boundaries.
- `工作只是谋生，不是卖命`: self-protection and emotional stop-loss.

Use adjacent motifs when the topic requires them:
- 老好人背锅
- 秒回焦虑
- 下班失联
- 周报废话
- 会议循环
- 绩效玄学
- 领导画饼
- 团建表演
- 公司不是家
- 上班人设

## Anti-Fatigue Rules

Do not mechanically repeat a prior viral sentence or overuse one phrase.

- Replicate the emotional structure, not the exact wording.
- Use research to rotate surface scenes and complaint targets; do not let every article begin from salary or `这点工资不配`.
- Each article must have one core complaint target: salary, instant replies, overtime, coworkers, leaders, blame, team building, weekly reports, message anxiety, performance review, or meetings.
- The same series may run for at most 3 consecutive posts. The 4th post must change scene, target, or sentence pattern.
- Avoid publishing multiple posts whose first lines all start with `这点工资不配...`.
- When using a proven motif, rotate the surface form:
  - `这点工资不配让我___`
  - `钱没到位，心别先到岗`
  - `上班只是谋生，不是卖命`
  - `工作可以认真，但别把自己赔进去`
  - `成年人上班，最先学会的是情绪止损`

## Writing Rules

Default tone is 劝自己清醒: it should feel like the reader is comforting themselves after work, not shouting at the workplace.

Every article should include:
- A soft but clear opening judgment.
- A specific workplace moment discovered from research or chosen from the topic bank.
- A money or energy anchor.
- A relationship downgrade or emotional stop-loss line.
- One absurd comparison.
- One screenshot-worthy final line.

Pair rhythm rules:
- Each article has 5-6 groups. Each group covers one small feeling only.
- Upper line: use a concrete everyday workplace scene, not a slogan.
- Lower line: give a gentle turn, self-comfort, deadpan punchline, or small boundary.
- Group progression should usually be: work positioning -> relationship downgrade -> money/energy anchor -> emotional stop-loss -> self-comfort.
- At most 2 lines per article may be sharply confrontational. Most lines should feel light, resigned, clear, and relatable.
- Do not make every line sound like a title. Let some lines be simple and human.

Use hook patterns sparingly inside the pair:
- Gentle contrast: `不是...只是...`
- Small realization: `后来才发现...`
- Discovery hook: `上班久了才发现...`, `我以前以为...`, `有一种同事/领导...`
- Self-comfort: `慢一点也没关系`
- Relationship downgrade: `能共事就够了`
- Absurd but soft comparison: `有些事，急得像公司要上市`
- Quiet boundary: `下班后，先把自己还给自己`

Reduce hard-edged words:
- Avoid overusing `不配`, `凭什么`, `别让`, `必须`, `最该`, `公共接口`.
- Use softer alternatives: `不值得`, `慢一点`, `先放一放`, `没关系`, `别太上头`, `不用太认真`, `先照顾自己`.

Avoid:
- Profanity.
- Direct personal attacks.
- Real-person or real-company accusations.
- Sexualized workplace speculation.
- Defamation-risk claims.
- Explicit cross-platform diversion.
- `关注`, `转发`, `分享截图`, `进群`, `领福利`, `扫码`, `看完整版` calls to action unless the user explicitly asks for ad copy and risk review.

## Research Workflow

Research is the default workflow for full article generation, including empty input, "明天文案", topic ideation, or a named theme. Prioritize WeChat-adjacent text ecosystems first, then broader public text communities.

1. Search lightly before generating copy. Prefer query combinations around `打工人`, `上班`, `职场`, `领导`, `同事`, `工资`, `内耗`, `加班`, `周报`, `开会`, `背锅`, `下班消息`.
2. Prefer sources that reveal text-based workplace resonance: WeChat/公众号-adjacent search results, Zhihu, Weibo, Baidu search results and trend pages. Use Xiaohongshu/Douyin-style sources only as secondary language signals when available.
3. Use search or platform tools only to identify emotions, scenes, recurring phrases, and topic structure.
4. Build a `共鸣点池` with:
   - workplace moment: leadership nickname changes, polite people receiving extra work, instant replies, blame-taking, forced responsibility, meeting loops, performance ambiguity
   - emotion core: wronged, false impression, guilty, annoyed, drained, suddenly clear
   - visual object: mirror, pot, shield, gear, phone popup, rice bowl, brick wall, badge, switch box, tangled yarn
   - fit judgment: capybara-friendly, low aggression, safe to repost
5. Choose one best-fit theme for the article and write original capybara-account copy.

For research details, read `references/topic-research.md`.

Originality boundary:
- Never copy online original wording, competitor titles, punchlines, character concepts, watermarks, specific panel sequencing, or layout.
- Keep only topic direction, emotional structure, common workplace scenario, and abstract phrase pattern.
- If a search result mentions a real company, real person, or controversial incident, generalize it into a generic workplace scene before writing.
- If the user provides competitor images, analyze only theme, rhythm, prop logic, and emotional transition; do not mimic the competitor's exact copy or visual identity.

## Formula Reference

For title formulas, article skeletons, and motif examples, read `references/viral-formulas.md`.

For proven account-specific winners, read `references/published-winners.md`.

## Handoff To Image Prompt Skill

The `正文文案` lines should be directly usable as input to `ip-comic-prompt-writer`.

For paired outputs:
- Keep the group labels when useful for editing.
- When handing off to image prompts, each upper and lower line can become one image in sequence.
- The two images in each group should remain adjacent because their meanings are connected.

When the user asks for both copy and image prompts:
1. Generate the copy with this skill first.
2. Then pass only the final `正文文案` lines to `ip-comic-prompt-writer`.
3. Keep the copy stable between the two steps.
