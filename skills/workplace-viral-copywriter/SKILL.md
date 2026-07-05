---
name: workplace-viral-copywriter
description: Generate viral, platform-safe Chinese workplace copy for a capybara IP WeChat Official Account, including article topics, 5-6 paired two-line image groups, cover hooks, interaction questions, and hashtags. Use when the user wants WeChat/Xiaohongshu workplace resonance copy, trend-informed topic ideation, anti-fatigue content planning, or captions that can later be turned into comic prompts.
---

# Workplace Viral Copywriter

This skill writes viral Chinese workplace copy for the user's capybara IP account. It researches current resonance points first, then generates original text; use `ip-comic-prompt-writer` later to convert approved lines into image-generation prompts.

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

## Topic Selection Model

Default topic model:
- Write one article around one concrete scene, not one abstract mood word
- Prefer a normal person in a specific situation over a fixed "unlucky persona"
- Prefer a visible contradiction that can be expanded into 6-10 observations
- The article should read like continuous observation panels, not stacked viewpoint slogans

The best topics usually satisfy all three:
- `具体场景`: readers can instantly picture where the person is and what they are doing
- `明确矛盾`: the person wants A but keeps doing B, or the process and result do not match
- `连续观察`: each panel can add one more recognizable detail without changing the theme

Good topic shapes:
- 行为打架型: 面试时什么都答应，回家又不想去了
- 认知错位型: 不舍得花99，却愿意花10个9.9
- 结果反差型: 累一天发现只赚了8块钱

Weak topic shapes:
- pure mood labels such as `好累`, `内耗`, `低电量`, `空降疲惫`
- pure viewpoints such as `钱才顶饿`, `工作只是谋生`, `同事只是同事`
- broad categories without a scene, such as `成年人状态`, `最近的我`, `今天上班`

## Output Contract

Unless the user asks for a different format, output these sections in Chinese:

1. `调研摘要`
   - Before writing the article, do a light web research pass by default.
   - Summarize 3-5 recent workplace resonance points in your own words.
   - Do not quote, paste, or near-copy online posts, titles, punchlines, competitor copy, character concepts, or layouts.
   - If search is unavailable, state that the research pass could not be completed and continue from the built-in motif bank.
2. `选题判断`
   - Identify the primary motif: 工资, 同事, 领导, 情绪止损, 荒诞对比, 关系降级, 背锅, 加班, 绩效, 秒回, 团建, 周报, 消息焦虑, or a life-adjacent daily-scene topic that still fits the account voice.
   - State the concrete scene first, then the contradiction or mismatch inside it.
   - Explain the reader resonance in 1-2 short sentences.
   - Choose only one best-fit theme from the research, rather than mixing many hot topics into one article.
3. `爆款标题`
   - Give 8-12 WeChat Official Account title options.
   - Titles should be sharp, short, safe, and conversational. Prefer discovery phrases, half-sentence hooks, and "I noticed" style openings over essay-like titles.
4. `正文文案`
   - Write 10-12 lines organized as 5-6 paired image groups.
   - Use the exact group format: `第1组 上：...` and `第1组 下：...`.
   - The upper line sets up one specific scene moment, action, or recognizable problem inside the chosen topic.
   - The lower line gives the turn: contradiction reveal, deadpan punchline, relief, self-comfort, or gentle correction.
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
- 面试心态
- 发工资当天
- 一天花钱流水账
- 只想买一样结果买一堆
- 想早睡结果一直不睡

## Anti-Fatigue Rules

Do not mechanically repeat a prior viral sentence or overuse one phrase.

- Replicate the emotional structure, not the exact wording.
- Use research to rotate surface scenes and complaint targets; do not let every article begin from salary or `这点工资不配`.
- Rotate not only complaint targets, but also scene families: workplace, commute, shopping, eating, sleep, interviews, payday, rent, and social avoidance.
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

Write from observation before explanation:
- Start from scene, action, object, or behavior.
- Let readers infer the feeling from the scene whenever possible.
- Do not begin from an abstract emotion label and then search for examples.
- If a line sounds like a life summary, rewrite it into one visible moment.

Write like a person reacting, not like a writer summarizing:
- Prefer immediate human reactions over polished conclusions.
- A good lower line should feel like something the person mutters right after the moment happened.
- Keep some sentences a little blunt, a little small, or slightly unfinished if that makes them sound more human.
- Do not chase perfect symmetry, perfect parallelism, or perfect "wrap-up" phrasing.
- If a line sounds too neat, too smart, or too complete, make it plainer and more spoken.

Priority sentence style:
- `我一下就...`
- `我当场就...`
- `我就不说话了`
- `我感觉...`
- `我怀疑...`
- `怎么越想越不对`
- `单看都还行，放一起就不对了`

These are examples of spoken reaction energy, not mandatory phrases. The goal is realism, not repeating a fixed list.

Each article should feel like:
- one concrete scene
- one clear contradiction
- 5-6 continuous observation panels
- one final sentence worth forwarding
- one believable human voice instead of "copywriting voice"

Every article should include:
- A concrete opening scene rather than a broad mood statement.
- One contradiction, mismatch, or behavior conflict that holds the whole article together.
- A money, energy, time, or effort anchor when it strengthens the topic.
- At least one detail panel that makes readers think `我也这样`.
- One screenshot-worthy final line.

Pair rhythm rules:
- Each article has 5-6 groups. Each group covers one small moment or one added observation only.
- Upper line: use a concrete everyday scene, action, or setup, not a slogan.
- Lower line: give a contradiction reveal, deadpan punchline, self-comfort, small boundary, or immediate real-person reaction.
- Group progression should usually be: scene setup -> contradiction expands -> cost/energy/time lands -> one sharper recognition -> final relief or conclusion.
- At most 2 lines per article may be sharply confrontational. Most lines should feel light, resigned, clear, and relatable.
- Do not make every line sound like a title. Let some lines be simple and human.
- Do not let adjacent groups feel like separate topics. They should read like one ongoing bit.
- At least half of the lower lines in one article should sound like live reaction rather than abstract summary.

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
- AI-sounding wrap-ups such as `我以为...其实...`, `本质上...`, `是一种...`, `成年人最___的状态`, unless they are truly the strongest line and have already been pressure-tested against a more spoken alternative.
- Overly tidy conclusion lines that sound written to impress instead of spoken to complain.

## Research Workflow

Research is the default workflow for full article generation, including empty input, "明天文案", topic ideation, or a named theme. Prioritize WeChat-adjacent text ecosystems first, then broader public text communities.

Topic validation before writing:
1. Can the topic be pictured as one concrete scene?
2. Is there one clear contradiction inside it?
3. Can it naturally expand into at least 6 observations?
4. Can the last line become a forwardable summary?

If a candidate topic fails 2 or more of these checks, do not write it as a full article yet. Narrow it to a scene first.

1. Search lightly before generating copy. Prefer query combinations around `打工人`, `上班`, `职场`, `领导`, `同事`, `工资`, `内耗`, `加班`, `周报`, `开会`, `背锅`, `下班消息`, plus life-adjacent scenes when needed such as `面试`, `发工资`, `超市`, `点外卖`, `熬夜`, `租房`, `花钱`.
2. Prefer sources that reveal text-based workplace resonance: WeChat/公众号-adjacent search results, Zhihu, Weibo, Baidu search results and trend pages. Use Xiaohongshu/Douyin-style sources only as secondary language signals when available.
3. Use search or platform tools only to identify emotions, scenes, recurring phrases, and topic structure.
4. Build a `共鸣点池` with:
   - concrete scene: leadership nickname changes, polite people getting extra work, payday confidence, shopping overbuy, interview fake agreement, instant reply pressure, bedtime delay, commute costs
   - contradiction: wants A but does B, saves here but overspends there, looks relaxed but is quietly calculating, says no in mind but says yes out loud
   - emotion core: wronged, false impression, guilty, annoyed, drained, suddenly clear, tiny smugness, awkward pride
   - visual object: mirror, pot, shield, gear, phone popup, salary slip, rice bowl, receipt, cart, wallet, clock, calendar, battery
   - fit judgment: capybara-friendly, low aggression, safe to repost, strong enough for 5-6 connected panels
5. Choose one best-fit scene plus one contradiction for the article and write original capybara-account copy.

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
