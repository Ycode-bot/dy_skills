# 本地、QA 与生产环境验收门禁

## 1. 环境隔离

当三个环境写入同一个分析项目时，每一份浏览器和入库证据都必须携带环境名。结果键使用：

`event id + platform + environment`

ImaStudio 当前使用 `lmweb_url` 的包含条件：

| 环境 | 查询值 | 说明 |
|---|---|---|
| `local` | 实际浏览器 `URL.host`，例如 `localhost:3000` | 保留端口，不含 `http://`、路径、查询参数 |
| `qa` | `qa.imastudio.com` | 不含协议和路径 |
| `production` | `www.imastudio.com` | 不含协议和路径 |

本地也允许 `127.0.0.1:端口`、IPv6 loopback 和明确的 `.local` 域名。不要用宽泛的 `localhost` 替代已知的 `localhost:端口`。

## 2. 证据要求

推荐契约：

- `local`：`source + browser + ingestion`。
- `qa`：`browser + ingestion`。
- `production`：`browser + ingestion`，并要求事件标记 `smokeSafe: true`。
- `runtime`：只有实际 SDK debug 日志或捕获 payload 时才要求；不要把普通页面成功当作发送证据。

每个环境查询都使用环境值、事件名、稳定 match、短时间窗和测试 `distinct_id`。当环境或事件声明 `identityRequired/testIdentityRequired` 但浏览器隔离上下文无法读取 ID 时，可以使用受限身份发现：每个契约查询最多 10 分钟、20 条结果，并且只能命中一个 `distinct_id`。多个身份或缺少身份才返回 `BLOCKED`；SDK 全局对象不可见本身不构成门禁失败。

## 3. 晋级规则

按顺序计算门禁，但不要擅自部署或发布：

1. `local=PASS` → `LOCAL_READY`，表示可以由用户进入 QA 部署流程。
2. `qa=PASS` 且 local 已通过 → `QA_READY`，表示可以由用户进入发布流程。
3. `production=PASS` 且 QA 已通过 → `PRODUCTION_VERIFIED`，表示三环境闭环完成。

后续环境即使已有历史 PASS，也不能绕过前一环境本次验收失败。报告保留每个环境的真实证据状态，并单独显示晋级门禁的 `PASS/BLOCKED`。

## 4. 本地浏览器服务

在 local 浏览器验收前检查 `startUrl` 是否可访问。若不可访问且用户请求执行自动验收：

1. 读取仓库说明和 package scripts，选择明确的标准开发命令。
2. 启动服务并记录进程或会话。
3. 等待健康响应后再打开浏览器。
4. 只关闭本次由 Codex 启动的服务；不要停止用户已有进程。

浏览器旅程从完整 `startUrl` 导航，但神策查询只使用 `new URL(startUrl).host`。

## 5. 生产安全

生产环境只执行无支付、无删除、无发布、无外部消息、无不可逆数据变化的最小旅程。事件未显式声明 `smokeSafe: true` 时，报告返回 `BLOCKED`，不能自动执行该旅程。
