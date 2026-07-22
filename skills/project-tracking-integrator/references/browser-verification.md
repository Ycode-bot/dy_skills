# 浏览器自动触发与入库验收

## 1. 适用范围

`browser-verify` 用于用户明确要求“让浏览器执行测试步骤并验证埋点”的场景。它连接两类证据：

1. 浏览器确实完成了指定业务操作，页面出现了预期结果。
2. 分析平台按同一事件、环境和触发时间返回候选数据，本地稳定字段关联后的入库事件满足契约。

这个模式不自动扫描仓库、不修改源码，也不补做 GA/GTM 等无关平台审计。若用户同时要求实现和自动验收，按 `instrument → browser-verify` 组合执行。

## 2. 开始前的最小输入

需要确认以下信息；已能从上下文或页面安全读取时不要重复询问：

- 数据需求截图、表格或 Version 2 埋点契约。
- local、QA 或 production 环境名和起始 URL。
- 可安全执行的浏览器步骤和每一步的可见预期结果。
- 环境过滤值，例如 `localhost:3000` 或 `qa.imastudio.com`，不含协议和路径。
- 精确事件名、环境和覆盖浏览器触发时刻的短时间窗；稳定 match 字段用于本地候选关联。
- 已登录的测试会话；登录、OTP、验证码或 Passkey 由用户完成。

对购买、支付、发布、删除、发消息、提交订单、修改线上数据等有明显外部副作用的动作，在执行前确认本次动作已获用户明确授权。优先使用 QA、沙箱和测试账号。

## 3. 可复用浏览器旅程

需要重复执行时，按 [browser-journey.schema.json](browser-journey.schema.json) 保存 Version 2 旅程。可从 [browser-journey.example.json](browser-journey.example.json) 复制；Version 1 继续兼容。

旅程文件只描述业务意图和稳定定位信息，不保存账号密码、Cookie、Token、API Key、支付信息或个人数据。敏感输入由用户在浏览器中完成。

执行前先做确定性校验：

```bash
node <skill-dir>/scripts/validate-browser-journey.mjs \
  --journey <browser-journey.json> \
  --out /tmp/browser-journey-validation.json
```

校验不代替浏览器中的 DOM 唯一性检查；它只保证旅程结构、目标环境和查询次数边界有效。

允许的最小动作集：

- `goto`：打开同一测试范围内的 URL。
- `click`：点击一个唯一元素。
- `fill`：填写非敏感测试值。
- `select`：选择一个选项。
- `press`：发送明确的键盘按键。
- `expect-visible`：确认元素或文本可见。
- `expect-url`：确认地址符合预期。

一个动作只能表达一个明确步骤。对于动态页面，在动作前重新读取 DOM；不能沿用已经失效的元素引用。

## 4. 浏览器执行规则

必须使用 Codex 的 in-app Browser 能力及其现有登录会话。开始浏览器操作前先读取对应 Browser Skill 的完整说明。

local 旅程开始前先检查 `startUrl` 是否可访问。不可访问时，按仓库说明启动标准开发服务并记录进程；验收结束后只关闭本次启动的服务。完整规则见 [environment-gates.md](environment-gates.md)。

每一步按以下顺序执行：

1. 读取当前页面的 DOM 或可访问性快照。
2. 根据快照选择稳定 locator，并验证只匹配一个元素。
3. 执行动作。
4. 立即验证预期 UI 状态、URL 或反馈消息。
5. 再进入下一步。

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

不要根据截图坐标、源码中猜测的 selector 或视觉位置盲点。页面重渲染、跳转或弹窗变化后重新获取 DOM。

## 5. 证据边界

in-app Browser 可以执行 UI 操作、读取 DOM、确认页面结果并读取浏览器控制台日志，但不提供通用 Network 请求拦截。因此：

- 页面成功：证明业务旅程完成，不证明埋点发送或入库。
- SDK 控制台日志：仅在日志真实存在时作为可选发送证据，并对用户标识和属性值脱敏；读取不到页面全局对象时标记 `NOT_AVAILABLE`。
- 神策 API 查询结果：是 `browser-verify` 的必需入库证据。

如果团队需要验证精确的发送请求体，优先让应用在 QA 环境为统一 track wrapper 增加可关闭、脱敏的 debug 输出，或由用户提供 DevTools/代理捕获的 JSON。不能把普通控制台消息描述成 Network 抓包。

## 6. 时间和环境关联

在第一个触发动作前记录 `startedAt`。完成旅程后使用：

- 相同的事件契约；
- local、QA 或 production 环境名；
- 从浏览器 URL 提取的 `URL.host`，例如 `localhost:3000`；
- 稳定 match 字段；
- 覆盖 `startedAt` 的最短可行时间窗；
- 事件期望次数；

查询平台。环境值不能包含协议或路径。ImaStudio 使用：local `lmweb_url LIKE '%localhost:端口%'`、QA `LIKE '%qa.imastudio.com%'`、production `LIKE '%www.imastudio.com%'`。

环境、精确事件名和触发时间窗负责从平台获取本次旅程的候选数据；稳定 match 在本地关联同名业务动作。平台返回但埋点契约没有声明的字段不参与验收；契约声明的字段统一按普通属性规则严格比较。

完成操作后等待一个有界的入库延迟再查询。第一次为 `NOT_FOUND` 时至多延迟重查一次；不要高频轮询神策。第二次仍无数据则保持 `NOT_FOUND`，并报告环境、时间窗和 match 条件，不转去做源码审计。

把浏览器证据保存为可合并的环境报告：

```json
{
  "environment": "local",
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

## 7. 结果输出

按步骤和事件分别报告，避免把多层证据混成一个“成功”：

| 项目 | 结果 | 证据 |
|---|---|---|
| 浏览器步骤 | `PASS` / `BLOCKED` / `FAILED` | 环境名、URL、控件语义和可见结果，不附敏感页面内容 |
| SDK 发送日志 | `PASS` / `NOT_AVAILABLE` / `NOT_SENT` / `CONTRACT_MISMATCH` | 全局对象不可见为 `NOT_AVAILABLE`；只有真实捕获面存在但缺少事件才是 `NOT_SENT` |
| 平台入库 | `PASS` / `NOT_FOUND` / `COUNT_MISMATCH` / `DUPLICATED` / `CONTRACT_MISMATCH` / `QUERY_FAILED` | 按环境、事件和触发时间查询候选，本地应用稳定 match，再与契约字段和次数比较 |

只有浏览器旅程达到预期且平台入库契约通过时，`browser-verify` 才能返回最终 `PASS`。控制台日志未提供时可标记 `NOT_AVAILABLE`，但不能因此跳过平台查询。
