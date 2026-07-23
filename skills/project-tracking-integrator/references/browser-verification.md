# 浏览器自动触发与入库验收

## 目录

1. 适用范围
2. 开始前的最小输入
3. 可复用浏览器旅程
4. 浏览器执行规则
5. 证据边界
6. 时间和环境关联
7. 结果输出

## 1. 适用范围

`browser-verify` 用于用户明确要求“让浏览器执行测试步骤并验证埋点”的场景。它连接两类证据：

1. 浏览器确实完成了指定业务操作，页面出现了预期结果。
2. 分析平台按同一事件、环境和触发时间返回候选数据，本地稳定字段关联后的入库事件满足契约。

这个模式不自动扫描仓库、不修改源码，也不补做 GA/GTM 等无关平台审计。若用户同时要求实现和自动验收，按 `instrument → browser-verify` 组合执行。

## 2. 开始前的最小输入

### Browser 插件依赖

浏览器自动验收依赖 Codex 的 [@Browser](plugin://browser@openai-bundled) 插件，以及它提供的 `browser:control-in-app-browser` Skill。开始前先检查本次会话的可用 Skill：

- 已列出 `browser:control-in-app-browser`：完整读取其 `SKILL.md`，按插件规范建立浏览器连接。
- 未列出：返回 `BLOCKED`，明确提示“缺少 Browser 插件。请在 Codex 的插件面板安装或启用 Browser（OpenAI bundled），重新打开任务后再运行浏览器验收。”
- Skill 已列出但插件内缺少 `scripts/browser-client.mjs`：提示 Browser 插件安装不完整，请从 Codex 插件面板重新安装。

不要因为插件缺失而静默切换到独立 Playwright、Computer Use、外部浏览器 MCP 或其他自动化实现。安装或启用插件属于用户操作；Skill 只诊断并给出明确步骤，不自行修改 Codex 插件状态。

### 业务验收输入

需要确认以下信息；已能从上下文或页面安全读取时不要重复询问：

- 数据需求截图、表格或 Version 2 埋点契约。
- local、QA 或 production 环境名和起始 URL。
- 可安全执行的浏览器步骤和每一步的可见预期结果。
- 环境过滤值，例如 `localhost:3000` 或 `qa.imastudio.com`，不含协议和路径。
- 精确事件名、环境和浏览器报告中的固定触发区间；稳定 match 字段用于本地候选关联。
- 已登录的测试会话；登录、OTP、验证码或 Passkey 由用户完成。

对购买、支付、发布、删除、发消息、提交订单、修改线上数据等有明显外部副作用的动作，在执行前确认本次动作已获用户明确授权。优先使用 QA、沙箱和测试账号。

## 3. 可复用浏览器旅程

需要重复执行时，按 [browser-journey.schema.json](browser-journey.schema.json) 保存 Version 3 旅程。可从 [browser-journey.example.json](browser-journey.example.json) 复制；Version 1/2 只用于兼容旧文件。

旅程文件只描述业务意图和稳定定位信息，不保存账号密码、Cookie、Token、API Key、支付信息或个人数据。敏感输入由用户在浏览器中完成。

默认先创建一个 marker-owned 临时会话。它只暴露一个可编辑的 `verification-bundle.json`，其中包含契约、旅程和浏览器报告；不要再分别创建 `contract.json`、`journey.json`、`browser-report.json` 等用户可见文件：

```bash
node <skill-dir>/scripts/run-browser-ingestion-verification.mjs --prepare
```

填好 bundle 中的 `contract` 和 `journey` 后，在任何浏览器动作前直接校验 bundle：

```bash
node <skill-dir>/scripts/validate-browser-journey.mjs \
  --bundle <verification-bundle.json>
```

校验必须在任何浏览器导航、点击或输入之前完成。它会拒绝未知字段、非法后置断言、重复 step id、位置型 CSS 和越界等待配置。production 旅程还会读取 bundle 中的契约，校验生产 origin，并要求拥有任意 required 平台目标的事件以及 Journey 实际 `covers` 的每个事件显式声明 `smokeSafe: true`。校验未通过时返回 `BLOCKED`，不执行任何浏览器动作。

允许的最小动作集：

- `goto`：打开同一测试范围内的 URL。
- `click`：点击一个唯一元素。
- `fill`：填写非敏感测试值。
- `select`：选择一个选项。
- `press`：发送明确的键盘按键。
- `hover`：悬停一个唯一元素，例如先显示隐藏的 TRY 按钮。
- `scroll-into-view`：把指定元素滚入其真实滚动容器视口，用于触发区块曝光。
- `expect-visible`：确认元素或文本可见。
- `expect-url`：确认地址符合预期。

一个动作只能表达一个明确步骤。Version 3 的每一步都要有唯一 `id`；触发埋点的步骤用 `covers` 关联契约事件 id；`click` 和 `hover` 必须声明 `expect`。对于动态页面，在每个动作前重新读取 DOM，不能沿用已经失效的元素引用。`href` 和 URL 后置条件必须解析到 `startUrl` 同源，禁止 `javascript:`、`data:` 与跨域跳转。

## 4. 浏览器执行规则

必须使用 Codex 的 in-app Browser 能力及其现有登录会话。开始浏览器操作前先读取对应 Browser Skill 的完整说明。

local 旅程开始前先检查 `startUrl` 是否可访问。不可访问时，按仓库说明启动标准开发服务并记录进程；验收结束后只关闭本次启动的服务。完整规则见 [environment-gates.md](environment-gates.md)。

每一步按以下顺序执行：

1. 读取当前页面的 DOM 或可访问性快照。
2. 根据快照选择稳定 locator，并验证只匹配一个元素。
3. 执行动作。
4. 立即验证预期 UI 状态、URL 或反馈消息。
5. 再进入下一步。

把每一步的实际证据写入 bundle 的 `browserReport.steps`：`id`、`action`、`status`，以及动作和后置断言完成后的 `executedAt`。locator 步骤还要记录实际使用的 `locator`、`matchCount`、本次重新解析时间 `resolvedAt`、命中元素的 role/name/href/scope，以及完整后置断言结果；下一步的 `resolvedAt` 不得早于上一步 `executedAt`。每个带 `covers` 的步骤，其 `resolvedAt`（如有）与 `executedAt` 都必须落在固定 `triggerWindow` 内。每个 locator 动作只有在 `matchCount === 1` 时才能记为 `PASS`；不得使用 `.first()` 绕过多匹配。`click`/`hover` 的 expectation 必须通过，locator/attribute/value 都要与 Journey 完全一致。报告结构见 [browser-report.schema.json](browser-report.schema.json)。

页面可交互后再判断 SDK 可观测性。浏览器自动化或扩展可能在 isolated world 中执行脚本，该上下文读取不到页面主世界挂载的 `window.KEWLSensors` 等自定义全局变量。遵守以下判定：

1. 等待路由、弹窗和页面主体稳定，避免在导航、刷新或 HMR 期间检查旧 `window`。
2. 只有 Browser 能明确在页面主执行环境求值时，才把全局 SDK handle 作为证据。
3. 全局 handle 为 `undefined`、求值能力不可用或上下文不明确时，记录 `NOT_AVAILABLE`；不能据此写成“SDK 未初始化”或 `NOT_SENT`。
4. 只有捕获面确实存在，且实际请求/SDK debug payload 中缺少目标事件时，才使用 `NOT_SENT`。
5. SDK 可观测性不影响后续浏览器动作和神策 API 查询。

locator 优先级：

1. `testId` 或明确的 `data-*` 测试标识。
2. 稳定的 `href`、控件 role 与可访问名称。
3. 表单 `label` 或 `placeholder`。
4. 在稳定父容器内限定的文字。
5. 最后才使用经当前 DOM 验证的 CSS selector。

同一页面有重复文本或重复控件时，用 locator 的递归 `scope` 限定稳定父容器，并用 `exact: true` 表达精确可访问名称。禁止 `:nth-child`、`:nth-of-type`、`:first-*`、`:last-*`、`:eq()` 以及运行时 `.first()` 等位置型兜底。不要根据截图坐标、源码中猜测的 selector 或视觉位置盲点。页面重渲染、跳转或弹窗变化后重新获取 DOM。

## 5. 证据边界

in-app Browser 可以执行 UI 操作、读取 DOM、确认页面结果并读取浏览器控制台日志，但不提供通用 Network 请求拦截。因此：

- 页面成功：证明业务旅程完成，不证明埋点发送或入库。
- SDK 控制台日志：仅在日志真实存在时作为可选发送证据，并对用户标识和属性值脱敏；读取不到页面全局对象时标记 `NOT_AVAILABLE`。
- 神策 API 查询结果：是 `browser-verify` 的必需入库证据。

如果团队需要验证精确的发送请求体，优先让应用在 QA 环境为统一 track wrapper 增加可关闭、脱敏的 debug 输出，或由用户提供 DevTools/代理捕获的 JSON。不能把普通控制台消息描述成 Network 抓包。

## 6. 时间和环境关联

在第一个触发动作前记录 `triggerWindow.startedAt`，最后一个可见结果确认后记录 `triggerWindow.finishedAt`。完成旅程后使用：

- 相同的事件契约；
- local、QA 或 production 环境名；
- 从浏览器 URL 提取的 `URL.host`，例如 `localhost:3000`；
- 稳定 match 字段；
- 浏览器报告中的固定 `startedAt`—`finishedAt` 触发区间；
- 事件期望次数；

查询平台。环境值不能包含协议或路径。ImaStudio 使用：local `lmweb_url LIKE '%localhost:端口%'`、QA `LIKE '%qa.imastudio.com%'`、production `LIKE '%www.imastudio.com%'`。

把上述字段和逐步执行证据写入 bundle 的 `browserReport`，先做强校验：

```bash
node <skill-dir>/scripts/validate-browser-report.mjs \
  --bundle <verification-bundle.json>
```

校验通过后让统一 runner 执行等待、查询、条件重查和产物清理：

```bash
node <skill-dir>/scripts/run-browser-ingestion-verification.mjs \
  --session <prepared-session-directory>
```

runner 内部把 bundle 临时物化后调用神策验证器。两次查询始终读取同一份浏览器报告快照；`triggerWindow.startedAt`—`finishedAt` 会生成固定 SQL 时间边界。入库等待不会改变事件发生时间，所以禁止在重查时改用“最近 N 分钟”，也禁止重新点击页面。若修正了浏览器动作并重新触发，必须建立新的 browser report 和新的触发窗口。

统一 runner 当前只对 `targets.sensors.status=required` 的目标给出入库结论，Journey 的每个 `covers` 也必须指向所选环境中 required 的神策目标。所选环境若还存在 GA4、GTM 或 Google Ads 等其他 required target，或 `covers` 指向会被神策验证器跳过的目标，runner 必须返回 `BLOCKED`，交由对应平台验证器处理，不能用神策查询结果代表全平台通过。

环境、精确事件名和触发时间窗负责从平台获取本次旅程的候选数据；只有需求明确的固定业务标识、本次测试用例值或与被点击元素直接关联的稳定标识才能作为本地 `match`。文档“属性值示例”不得作为 `match` 或精确预期值。平台返回但埋点契约没有声明的字段不参与验收；仅有示例值的字段只验证必填性和声明类型，明确的固定值、枚举或映射规则才做取值比较。

默认在旅程完成后等待 240 秒进行第一次查询。只有结果中至少一个事件为 `NOT_FOUND`，且其余事件全部为 `PASS`/`NOT_FOUND` 时，才再等待配置的 `retryWaitSeconds` 并重查一次；`CONTRACT_MISMATCH`、`DUPLICATED`、`COUNT_MISMATCH`、`QUERY_FAILED` 均立即停止。等待最大 1800 秒、查询最多两次，禁止高频轮询。第二次仍无数据则保持 `NOT_FOUND`，并报告环境、固定时间区间、API 返回条数和 match 后候选条数，不转去做源码审计。若结果达到查询行数上限，返回 `QUERY_FAILED/RESULT_TRUNCATED`，缩短时间窗或安全提高限制后重新开始一次独立验收；不能把失败或截断结果判为 `NOT_FOUND` 或 `PASS`。

次数只按契约明确声明的边界判断：`minCount` 缺省为 1，`maxCount` 未声明时表示不限制上界。不要因为一次页面旅程包含多个区块曝光而擅自补 `maxCount: 1`；只有“一次用户动作必须且只能上报一次”等明确去重规则才设置最大值。

Version 3 浏览器报告至少包含逐步定位证据和可合并的事件结果：

```json
{
  "version": 3,
  "journeyName": "local-example",
  "environment": "local",
  "environmentProperty": "lmweb_url",
  "environmentValue": "localhost:3000",
  "triggerWindow": {
    "startedAt": "2026-07-23T04:45:17.656Z",
    "finishedAt": "2026-07-23T04:45:36.349Z"
  },
  "steps": [
    {
      "id": "click-example",
      "action": "click",
      "status": "PASS",
      "locator": { "type": "testId", "value": "example" },
      "matchCount": 1,
      "resolvedAt": "2026-07-23T04:45:20.000Z",
      "executedAt": "2026-07-23T04:45:21.000Z",
      "resolvedElement": { "role": "button", "name": "Example" },
      "expectation": { "type": "visibleText", "status": "PASS", "value": "完成" }
    }
  ],
  "results": [
    {
      "id": "contract-event-id",
      "platform": "sensors",
      "status": "PASS",
      "method": "in-app-browser"
    }
  ]
}
```

产物策略由 runner 统一处理：它只在 canonical marker-owned session 内原子写入，遇到 session、父目录或产物文件软链时立即拒绝，不跟随链接写到目录外。验收 `PASS` 时删除自己创建的临时 session；失败时只保留 `final-report.md` 与 `debug-bundle.json`；只有用户明确要求调试时才传 `--keep-artifacts` 保留全部中间文件。不要把每次运行产生的契约、旅程、浏览器报告和每次查询结果作为用户可见交付物。

## 7. 结果输出

按步骤和事件分别报告，避免把多层证据混成一个“成功”：

| 项目 | 结果 | 证据 |
|---|---|---|
| 浏览器步骤 | `PASS` / `BLOCKED` / `FAILED` | 环境名、URL、控件语义和可见结果，不附敏感页面内容 |
| SDK 发送日志 | `PASS` / `NOT_AVAILABLE` / `NOT_SENT` / `CONTRACT_MISMATCH` | 全局对象不可见为 `NOT_AVAILABLE`；只有真实捕获面存在但缺少事件才是 `NOT_SENT` |
| 平台入库 | `PASS` / `NOT_FOUND` / `COUNT_MISMATCH` / `DUPLICATED` / `CONTRACT_MISMATCH` / `QUERY_FAILED` | 按环境、事件和触发时间查询候选，本地应用稳定 match，再与契约字段和次数比较 |

只有浏览器旅程达到预期且平台入库契约通过时，`browser-verify` 才能返回最终 `PASS`。控制台日志未提供时可标记 `NOT_AVAILABLE`，但不能因此跳过平台查询。
