---
name: project-tracking-integrator
description: 前端埋点开发与验收闭环。用于创建埋点体系、根据需求实现方法和业务调用、检查业务影响、维护埋点文档、浏览器触发及神策数据验收；各阶段也可单独使用。完整埋点开发默认走到数据验收；明确只生成方法、只审代码或只查数据时严格限定范围。
---

# 前端埋点开发与验收

完整开发默认闭环，各阶段可以单独使用。所有面向使用者的说明、状态、终端摘要和报告使用简体中文；代码标识、事件名、字段名保留原样。内部 JSON 状态码仅用于机器处理，不作为面向用户的结论。

## 任务路由

先用一句中文说明本次范围，不要求用户理解模式代码。

| 请求 | 内部模式 | 完成范围 |
|---|---|---|
| 完成这份埋点、给这个流程加埋点 | `full-lifecycle` | 实现、业务影响检查、文档、浏览器、目标平台验收及修复 |
| 创建埋点体系 | `full-lifecycle` | 最小基础与一个代表事件闭环，不扩展全站 |
| 只接入代码、先不要浏览器或数据验收 | `instrument` | 方法、调用、业务影响、文档和源码检查 |
| 生成埋点方法、只增加 wrapper | `generate-method` | 方法、业务影响、文档及方法范围检查，不要求调用点 |
| 盘点现有体系 | `discover` | 架构与可用能力，不修改代码 |
| 整理截图或表格为契约 | `contract` | 需求整理，不扫描全仓或查询平台 |
| 检查代码、对照文档审计调用 | `verify-source` | 源码证据和差异，不默认操作浏览器 |
| 检查抓到的请求 | `verify-runtime` | 实际 payload 与契约对比 |
| 数据准确吗、神策有没有数据 | `verify-data` | 只读平台查询及对比，不替换成代码审计 |
| 浏览器触发后验收 | `browser-verify` | 页面操作、可见结果、平台数据，不自动改代码 |

“只、仅、先、不要”优先于默认闭环。多项请求按依赖组合。完整开发包括本次埋点问题修复；只读检查不授权代码修改。完整闭环不代表自动部署、生产操作或扩展到未要求的平台。

## 完整闭环

理解需求 → 定位或创建体系 → 实现方法和调用 → 检查业务影响 → 同步或创建文档 → 浏览器验证 → 平台数据验收 → 定位修复 → 重新验收 → 中文交付。

### 1. 理解需求、定位体系

读取适用项目规则；只查明当前任务所需的初始化、公共字段、身份、传输、相近方法和业务触发点。信息可从项目获得时自行查找，只询问影响实现的业务歧义或缺失配置。

- 盘点体系时使用 `scripts/scan-tracking-project.mjs --root <project> --format json`，按 [discovery.md](references/discovery.md) 追踪实际调用，不能以依赖安装证明体系可用。
- 已有体系直接复用；部分缺失只补必要层；没有体系时按 [bootstrap-architecture.md](references/bootstrap-architecture.md) 确认平台和配置，先实现一个代表事件。
- ImaStudio 修改或源码验证前读 [imastudio-pattern.md](references/imastudio-pattern.md)。只查平台数据不因此展开源码审计。
- 多平台需求读 [multi-platform-routing.md](references/multi-platform-routing.md)，不因存在多个 SDK 就双报。

判断业务尚未实现前，按 [discovery.md](references/discovery.md) 核对当前页面入口、真实调用链和服务端策略；尚未定位或当前账号不可见，不等于业务缺失。需要浏览器验收的任务，在理解需求时按 [证据管理](references/evidence-management.md) 建立最小验收依赖矩阵，提前识别账号、设备及外部动作条件。

明确事件、字段类型及来源、触发条件、成功证据、去重、目标平台和验收环境。脚本使用 [Version 2 契约](references/tracking-contract.schema.json)及[示例](references/tracking-contract.example.json)，简单需求不强制给用户输出契约文件。

“示例、例如、参考值”不是固定要求，不可自动放入 `match`、`equals`、`oneOf`、`pattern` 或实现常量。只有明确绑定规则、本次测试值、被操作元素的稳定标识可关联同名事件。缺乏可靠关联依据时说明歧义，不假造判定条件。

### 2. 实现及业务影响

保留现有初始化、身份和公共上下文，新增或修改 typed wrapper，在真实用户行为或业务状态变迁处调用。区分点击、提交、确认成功、失败和重试；明确曝光、关闭、重挂载和重复回调语义。埋点异常不能中断业务。

修改前记录相关工作区基线，修改后按 [business-impact-review.md](references/business-impact-review.md) 审查本次改动。低风险继续；有限不确定性先补查；重大非预期影响优先修复并重审。无法安全修复或必须改变业务行为时给出位置、前后行为、风险及建议，暂停业务触发并等待决策。不得覆盖用户已有改动。

### 3. 文档和源码检查

按 [development-verification.md](references/development-verification.md) 复用现有文档；没有时创建 `docs/tracking/events.md`，只记录本次事件、字段来源、触发条件、代码位置与分层验证状态。实现后先标记待验收，修复和验收后更新，不提前标记数据通过。

```bash
node <skill-dir>/scripts/verify-tracking-source.mjs --root <project> --spec <contract.json> --scope integration --format json
```

仅生成方法使用 `--scope method`。脚本检查真实语法与关联证据，不证明运行时成功；动态参数、间接封装、自动导入等未能解析时，Agent 必须继续追踪并记录具体依据。缺解析依赖不擅自安装或退回全仓字符串匹配判通过。

按项目要求运行相关测试、lint、类型和文档检查。区分已有失败和新增问题。每项未通过必须说明原因、位置、影响、已尝试措施和下一步；可安全修复的问题直接修复。

### 4. 浏览器与登录

完整开发默认进入浏览器验收，独立操作使用 `browser-verify`。执行前读 [browser-verification.md](references/browser-verification.md)，按用户选择及可用能力选工具，优先复用合适的登录会话，不绑定某个插件名。

需要登录但未登录时，请用户在选定的同一浏览器会话完成登录并回复“已登录”。收到回复后重新检查可见登录证据，成功后再继续。等待期间只做不依赖登录的工作。登录失效时暂停并恢复此流程；密码、验证码由用户处理，不读取 Cookie 或存储恢复凭证。若登录本身为待测事件，纳入正式旅程及触发窗口。

正式触发前检查场景依赖和会消耗的账号条件，先验证依赖场景，再执行使其失效的动作；先用只读查询预检确认平台可访问。无法满足的条件明确记录，不通过伪造业务状态绕过。具体流程与恢复命令见 [证据管理](references/evidence-management.md)。

先校验旅程，操作时使用新鲜 DOM、唯一匹配及可见后置结果。禁止位置型 selector 或 `.first()` 绕过歧义。代码检查完成后触发正式业务旅程，记录固定时间窗。异步页面初始化、支付回调等场景，以最终业务结果观测完成作为窗口结束依据，不在点击完成或弹窗容器刚出现时提前结束。

```bash
node <skill-dir>/scripts/run-browser-ingestion-verification.mjs --prepare
node <skill-dir>/scripts/validate-browser-journey.mjs --bundle <verification-bundle.json>
# 在选定浏览器中执行旅程，将逐步证据写入同一 bundle
node <skill-dir>/scripts/validate-browser-report.mjs --bundle <verification-bundle.json>
node <skill-dir>/scripts/run-browser-ingestion-verification.mjs --session <prepared-session-directory>
```

### 5. 平台数据验收

神策按 [sensors-verification.md](references/sensors-verification.md) 使用现有只读凭证查询。凭证解析顺序：用户指定、环境配置、已有私有 `~/.config/imastudio/sensors-credentials.json`。不展示密钥，也不从采集地址推导查询权限。

- 单独查数据必须尝试查询；缺条件说明暂时无法继续，不切换为源码审计。
- 查询按事件、环境和时间窗口获取候选；URL 环境先校验精确 host/端口，再按稳定 `match` 关联及比较字段和次数。
- 字段只按契约验证；未声明最大次数不自行添加一次上限。明确零次且实际零次可通过。
- 查询失败、截断、无数据、字段错误和重复必须区分。任何失败或截断不能判通过。
- 页面成功、发送证据、入库证据分开记录。SDK 全局对象不可见不证明未发送；只有真实捕获面才可判断发送结果。
- 浏览器 runner 的固定时间窗、等待、重查、进度和产物策略按 [browser-verification.md](references/browser-verification.md) 执行；不要在其他阶段另行计算相对时间窗或重复触发页面。
- 关联事件断言、`--resume`、多轮报告选择和窗口补查分别按 [evidence-management.md](references/evidence-management.md) 与 [evidence-review.md](references/evidence-review.md) 执行；字段漂移、重复歧义和查询截断不能靠重试掩盖。
- 指定环境独立验收，不自动升级生产。仅请求多环境时应用 [environment-gates.md](references/environment-gates.md)；生产仍需安全范围及明确授权。
- runner 当前只处理神策 required 目标。其他目标按其真实能力单独验收和合并，不用神策结果替代，也不为通过而删掉 required 目标。

### 6. 修复循环及停止条件

按 [development-verification.md](references/development-verification.md) 分类处理失败。代码问题修复后从业务影响检查重新开始，更新文档，用新的浏览器报告和触发窗口验收；查询或权限故障不作为改代码的理由。

自动修复最多三轮，同一原因连续两轮无新证据或进展时提前停止，给出问题、证据及恢复路径。缺少登录、凭证、服务或安全条件只阻断依赖阶段；保留已完成结论，不能宣称闭环通过。

## 交付

统一中文结果由 `scripts/reporting.mjs` 提供；内部 JSON 保留兼容状态码及中文说明。默认不向用户堆放临时契约和查询文件。runner 成功后暂留最小汇总证据，失败保留原始输入、诊断和可恢复会话；只有用户要求时保留全部中间产物。

完整闭环交付：实现内容、业务影响、文档位置、浏览器和平台结果、已修复问题及残留限制。单独阶段只交付本次范围。所有必需阶段通过才称“闭环验收通过”。完整闭环合并证据使用 `scripts/generate-tracking-report.mjs --mode full-lifecycle --development <development-report.json>`，同时传入契约和本次阶段报告；具体原因必须保留，不能只提示查看其他报告。统计单位是验收场景及实际覆盖条件；未执行、条件缺失、查询故障与验证失败分开说明。跨事件归因按契约关联规则验收；其他平台手工证据使用相同事件 id、平台及环境记录。

多轮报告、失败历史、补查复核和最终结论同步按 [evidence-review.md](references/evidence-review.md) 处理；账号条件和实际覆盖范围按 [evidence-management.md](references/evidence-management.md) 记录。SDK/请求是否作为必需阶段由契约决定。

## 更新

普通工作不运行或提及更新器，不读取更新状态或联系 GitHub。仅用户明确要求更新或检查此 skill 时读 [updating.md](references/updating.md)。

成功后的证据汇总、报告确认和会话清理按 [browser-verification.md](references/browser-verification.md) 的产物策略执行。
