---
name: workplace-viral-copywriter
description: Generate story-first, platform-safe Chinese social copy for a capybara IP WeChat/Xiaohongshu account, including生活场景、职场场景、短故事脚本、连续漫画文案、封面标题、互动问题和标签. Use when the user wants today's copy, viral copy, story-driven comic captions, readable生活吐槽, workplace resonance, topic ideation, or captions that can later be turned into image prompts.
---

# Story-First Viral Copywriter

This skill writes original Chinese copy for the user's capybara IP account. The default output is not a stack of slogans. It should read like a tiny story: one ordinary scene, one small decision, several escalating details, one live reaction, and one self-aware ending.

Use `ip-comic-prompt-writer` later when the approved copy should become image-generation prompts.

## Core Positioning

Default account voice:
- 生活里的低能量嘴替
- 普通人小崩溃、小算计、小自救
- 有故事性、可阅读、好转述
- 可爱但不幼稚，清醒但不说教
- 接地气，像朋友在旁边小声吐槽
- 职场只是场景之一，不是边界

Default reader:
- 普通上班族、学生、独居人、轻社恐、容易被生活细节戳中的人
- 喜欢短句、连续小故事、冷幽默、自嘲式清醒
- 想把内容发给朋友，但不想显得攻击性太强

## Story Model

Every full article should satisfy all five:
- `具体开场`: readers instantly know where the character is, such as supermarket, convenience store, office, subway, bedroom, doorway, checkout counter, elevator, restaurant, interview room.
- `明确动机`: the character starts with one simple intention, such as only buying soy sauce, going home early, replying one message, ordering one cheap meal, taking a short nap.
- `连续加码`: each line adds a new visible detail, temptation, misunderstanding, cost, delay, or awkwardness.
- `现场反应`: the copy sounds like a person reacting right there, not a writer summarizing later.
- `反转收束`: the ending reveals the contradiction, self-exposure, or gentle truth that makes people want to save or share it.

Good topic shapes:
- 小事失控型: 只想买一瓶水，最后拎了一袋零食。
- 认知错位型: 每样都不贵，结账突然100多。
- 行为打架型: 嘴上说马上睡，身体还在刷手机。
- 情绪延迟型: 当场没事，回家越想越不对。
- 社交误会型: 本来想礼貌一下，结果把自己安排进去了。
- 生活悬念型: 一开始只是顺路，后来发现像被做局。

Weak topic shapes:
- Pure mood labels such as `好累`, `内耗`, `破防`, `成年人状态`.
- Pure viewpoints such as `钱要花在自己身上`, `工作只是谋生`.
- Unconnected金句 collections where each line could belong to a different post.

## Output Contract

Unless the user asks for a different format, output these sections in Chinese:

1. `调研摘要`
   - Do a light web or context research pass by default when current trends matter.
   - Summarize 3-5 resonance points in your own words.
   - If search is unavailable or unnecessary, state that the piece uses the built-in story motif bank.
   - Never copy online posts, titles, punchlines, panel sequencing, character concepts, or layouts.
2. `选题判断`
   - Name the primary motif: 小额破财, 生活失控, 情绪止损, 职场低能量, 社交边界, 熬夜拖延, 外卖选择, 通勤疲惫, 面试反悔, 发工资幻觉, 超市做局, or another concrete daily-scene motif.
   - State the concrete scene, the starting intention, and the contradiction.
   - Explain why this has reader resonance in 1-2 short sentences.
3. `爆款标题`
   - Give 8-12 WeChat/Xiaohongshu title options.
   - Prefer scene hooks, half-sentence hooks, and discovery phrases.
   - Titles should make people want to know what happened next.
4. `正文文案`
   - Write 10-14 lines organized as 5-7 paired image groups.
   - Use the exact group format: `第1组 上：...` and `第1组 下：...`.
   - The groups must read in order as one mini-story.
   - The upper line sets up an action, object, scene, or new detail.
   - The lower line gives the reaction, contradiction, escalation, deadpan punchline, or self-comfort.
   - Every line should be short enough for large comic text and image-ready.
5. `画面关键词`
   - For every paired group, give 2-3 concrete visual props or scene anchors.
   - Prefer real objects over abstract metaphors: shopping basket, soy sauce, price tag, receipt, checkout screen, phone, bed, slippers, elevator, meal box, subway gate, umbrella, wallet, calendar, work badge.
6. `封面金句`
   - Give 1-3 strongest cover candidates.
   - Each should be a scene contradiction or live reaction, not an abstract lesson.
7. `互动问题`
   - Give 2-4 compliant article-ending questions.
   - Do not induce following, sharing, reposting, screenshots, group joining, reward collection, or cross-platform diversion.
8. `话题标签`
   - Give exactly 3 broad/high-traffic hashtags with `#`.

If the user asks for only one section, output only that section.

## Writing Rules

Write from event before emotion:
- Start with a visible object or action.
- Let readers infer the feeling from what happened.
- Use short spoken reactions: `我当场就沉默了`, `我开始怀疑`, `怎么越看越不对`, `我手是一点不心疼`, `我不是自己想买这么多`.

Keep it down-to-earth:
- Prefer everyday spoken Chinese over polished literary lines.
- Write like a normal person casually complaining to a friend.
- Use concrete cheap/small details: 9.9, full reduction, receipt, delivery fee, plastic bag, elevator wait, phone battery, leftover rice.
- If a line sounds like a slogan, speech, essay title, brand manifesto, or "高级文案", rewrite it into a plain scene reaction.
- The best line should feel easy to say out loud, not impressive to quote on a poster.

Make the article readable:
- The reader should be able to retell the whole post in one sentence: `一只水豚去超市买酱油，结果被9块9和第二件半价一路带偏，结账才发现自己被小额破财做局了。`
- Keep a clear timeline: before entering -> first temptation -> more temptation -> basket fills -> checkout shock -> self-aware ending.
- Add one small twist every 1-2 groups.
- Use repeated objects as continuity anchors, such as basket, receipt, phone, door, bed, wallet.

Story rhythm:
1. `起因`: one tiny plan or promise.
2. `误入`: the environment gives one tempting detail.
3. `加码`: several details look individually harmless.
4. `失控`: the basket/time/emotion becomes visibly bigger.
5. `账单`: money, time, energy, or embarrassment lands.
6. `反应`: live silence, suspicion, self-comfort, or gentle surrender.
7. `收束`: one forwardable line that explains the whole thing.

The reference image provided by the user is a typical pattern:
- Start: `逛超市的时候，我真的只想买瓶酱油`.
- Temptation: `9块9`, `第二件半价`, `每样看着都不贵`.
- Escalation: things keep entering the basket.
- Shock: checkout jumps to 100+.
- Ending: `不是自己想买这么多，是超市给我下套了`.
Use this as a structural model, not wording to copy.

Avoid:
- Pure slogan chains.
- Overly tidy essay conclusions.
- Abstract moralizing.
- High-concept, grand, elite, or literary phrasing.
- Words that make daily-life copy feel inflated, such as `时代`, `命运`, `本质`, `宇宙`, `灵魂`, `清醒地活着`, unless the user explicitly asks for that style.
- Repeating `职场`, `工资`, `领导`, or `同事` unless the chosen story actually needs them.
- Profanity, direct personal attacks, real-person/company accusations, sexualized speculation, defamation-risk claims.

## Research Workflow

For a full article with no supplied topic:
1. Search lightly if current platform resonance matters; otherwise use the built-in story motif bank.
2. Build 2-3 candidate story scenes.
3. Choose one scene with the strongest story chain.
4. Draft the 5-7 paired groups as one continuous mini-story.
5. Check that every line is imageable and belongs to the same story.
6. Add title options, visual keywords, cover lines, interaction questions, and 3 tags.

For story patterns and examples, read [references/viral-formulas.md](references/viral-formulas.md).
For research prompts and motif pools, read [references/topic-research.md](references/topic-research.md).
For proven performance signals, read [references/published-winners.md](references/published-winners.md).

## Handoff To Image Prompt Skill

The `正文文案` lines should be directly usable as input to `ip-comic-prompt-writer`.

When handing off:
- Preserve all group labels.
- Keep adjacent upper/lower lines together.
- Pass `画面关键词` with the copy, because it tells the image skill which props must anchor the scene.
