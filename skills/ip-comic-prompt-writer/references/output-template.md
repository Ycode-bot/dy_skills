# Output Template

Use these prompt structures for the `生成提示词` section unless the user explicitly asks for a different layout, variants, or a no-text version.

The default visual format is a 4:3 horizontal cute comic series: top copy, bottom matching capybara illustration. If the input comes from `workplace-viral-copywriter` and uses paired groups such as `第1组 上：...` / `第1组 下：...`, keep every line as a separate prompt but make the two prompts in the same group visually continuous: upper image sets up the scene, lower image reacts, releases, or reframes it. If `画面关键词` are supplied, prioritize those props and scenes for the matching group before inventing new objects. If the copy has a locked prefix such as `要饭：` or `上班：`, keep that prefix in the top text exactly. Repeat this full prompt structure for every optimized sentence. Do not use shared prefixes or suffixes.

For cover requests such as `封面图`, `公众号封面`, `标题图`, or `封面提示词`, use the 21:9 cover template below instead of the 4:3 comic template. Output one prompt only by default.

## 4:3 Comic Prompt Template

```text
请根据我已经定版的原创水豚IP形象来作画，严格保持角色核心特征不变：奶油燕麦色圆润水豚身体，深棕色居中口鼻区，小黑困困眼，粉色耳朵内侧，头顶三撮短毛，小短手小短脚，基础表情气质平静、无语、呆萌。注意：平静、无语、呆萌只是角色底色，不是每张图的最终表情；本张图必须根据文案设计具体微表情。不要重新设计角色，不要改变物种，不要写实，不要3D。

生成一张4:3横版萌系搞笑条漫，白色背景，上半部分文案、下半部分插画。

上半部分：
用大号黑色圆润中文字体写：
“这里放原创或优化后的文案”

下半部分：
核心视觉物件：这里写一个不可缺席的视觉锚点，例如镜子、复印机、套娃、黑锅、盾牌、警戒线、榨汁机、电池、打结毛线、大饼投影、遥控器、牵线、弹射锅、奖杯吸铁石、倾斜天平、翻译机、收银机、小票、购物篮、货架、地铁闸机、床边、玄关、外卖袋、工资到账提示等。

具体表情：这里必须写一个可画出来的低能量微表情，包含眼神、嘴型或脸颊、身体姿态、小动作。不要只写“平静”“无语”“呆萌”。优先写成真实小反应，例如：眼神发直、耳朵微微后缩、我一下愣住了似的、嘴巴抿成短线、爪子停在半空；或眼睛半眯松下来、肩膀一下塌了、装作没事地把东西往篮子里放。

如果这条文案属于双句组图，请写明：本图属于第X组上/下，与同组另一张形成连续情绪关系。同组两张图必须共享一个核心场景、核心视觉物件或关键道具，也必须形成真实反应变化，例如看着价格牌犹豫/结账后突然不说话，走到门口还想出去/又把自己劝回去，想回消息/把手机扣下后松一口气。

原创水豚……这里描述与文案对应的应景画面，必须包含核心视觉物件、主体动作、关键道具、场景位置、具体表情、身体姿态、小动作和场景里的冷幽默。不要把生活化文案画回 generic 办公桌。超市就画货架、价签、购物篮、收银台、小票；发工资就画到账提示、工资条、钱包、购物车；熬夜就画床边、手机、钟表、灯光；出门犹豫就画玄关、门口、鞋子、包。核心视觉物件必须参与动作，不能只是背景装饰。可以用老板剪影、同事背影、手部、聊天气泡、屏幕头像、工牌等符号化配角表达关系，但水豚必须是唯一完整角色和画面焦点。表情要贴合“当场反应”，可以是突然安静、越想越不对、装没事、心虚、愣住、偷偷得意、认命、轻微怀疑、想解释又懒得解释。不要把下半部分写成抽象概念图。

整体风格：粗黑轮廓、大色块平涂、少量柔和阴影、低饱和暖色调。背景简洁但可以有少量应景道具。可以使用符号化配角，但不要完整写实人物、复杂群像或抢走水豚主体。不要水印，不要写实，不要3D。
```

## 21:9 Cover Prompt Template

Use this template for WeChat Official Account cover prompts. The cover is not a full story panel. It should read clearly as a thumbnail: short title, large capybara, one strong visual metaphor, minimal props.

```text
请根据我已经定版的原创水豚IP形象来作画，严格保持角色核心特征不变：奶油燕麦色圆润水豚身体，深棕色居中口鼻区，小黑困困眼，粉色耳朵内侧，头顶三撮短毛，小短手小短脚，基础表情气质平静、无语、呆萌。注意：平静、无语、呆萌只是角色底色，不是本张封面的最终表情；本张封面必须根据主题设计具体微表情。不要重新设计角色，不要改变物种，不要写实，不要3D。

生成一张21:9横版萌系搞笑公众号封面图，白色背景，左侧/上方大字标题，右侧/下方水豚插画。

标题区域：
用大号黑色圆润中文字体写一个8-14字左右的两行短标题：
“这里放封面标题”

插画区域：
核心视觉物件：这里只放一个最强视觉锚点。生活场景优先用真实物件，比如收银机、小票、购物篮、货架、工资到账提示、钱包、玄关、闸机、外卖袋。职场场景再使用工资单盾牌、发光手机弹窗、公司齿轮、脑子开关、黑锅、镜子、复印机、打结毛线、情绪电池等。最多再加一个辅助道具，不要堆叠复杂场景。

具体表情：这里必须写一个可画出来的低能量微表情，包含眼神、嘴型或脸颊、身体姿态、小动作。优先是生活里那种小反应，不是大道理表情。例如：眼神发直、嘴巴抿成短线、身体微微后仰、像突然反应过来不太对；或眼睛半眯、肩膀一下松掉、一只爪子还扶着购物篮。

原创水豚作为唯一完整角色，占画面右侧或下方的视觉中心，主体要大、清楚、缩略图可识别。画面只表达一个核心主题，不做多格叙事。标题优先使用真实反应句或场景矛盾句，不要抽象人生结论。核心视觉物件必须参与动作，例如水豚站在收银机前盯着100+金额愣住、水豚抱着购物篮怀疑自己被做局、水豚站在玄关又把鞋脱回去。不要使用超过两个核心道具，不要复杂背景，不要完整人物或群像。

整体风格：粗黑轮廓、大色块平涂、少量柔和阴影、低饱和暖色调。背景简洁但可以有少量应景道具。可以使用聊天气泡、老板剪影、屏幕头像等符号化元素，但不要完整写实人物、复杂群像或抢走水豚主体。不要水印，不要写实，不要3D。
```
