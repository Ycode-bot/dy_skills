# 神策埋点端到端验收

## 目录

1. 验收边界
2. 凭证与环境变量
3. 事件契约
4. 离线验证
5. 神策查询 API 验证
6. 结果状态
7. 安全规则
8. 常见问题

## 1. 验收边界

把一次埋点交付拆成四份独立证据：

1. 数据需求文档定义了什么。
2. 项目代码实现了什么。
3. 浏览器或 SDK 实际发送了什么。
4. 神策最终入库了什么。

只有四者一致时才判定完成。代码存在不代表调用路径可达；浏览器请求成功也不代表事件已经入库；神策存在同名事件也不代表字段、类型、枚举、身份和触发次数正确。

先把表格、截图或文字需求转换为 [tracking-contract.example.json](tracking-contract.example.json) 的 Version 2 多平台结构，再运行确定性脚本。神策验证器只读取其中 `targets.sensors.status` 为 `required` 的目标。不要让脚本直接猜测模糊的数据口径。

## 2. 凭证与环境变量

神策前端 `server_url` 是数据接收地址，不是查询地址。查询 API 的基础地址、项目英文名和认证方式必须由神策管理员或数据团队确认。

传统查询 API 使用 `API_SECRET + project`：

```bash
export SENSORS_QUERY_BASE_URL="https://your-sensors-host.example.com"
export SENSORS_QUERY_PROJECT="your_project"
read -s "SENSORS_QUERY_API_SECRET?请输入神策只读 API_SECRET: "
export SENSORS_QUERY_API_SECRET
echo
```

如果部署方明确要求 Bearer 或自定义 API-Key Header，则改用：

```bash
export SENSORS_QUERY_API_KEY="your-api-key"
```

检查变量是否存在，不打印值：

```bash
test -n "$SENSORS_QUERY_BASE_URL" && echo "查询地址已配置"
test -n "$SENSORS_QUERY_PROJECT" && echo "项目已配置"
test -n "$SENSORS_QUERY_API_SECRET" && echo "API_SECRET 已配置"
```

不要把凭证写入前端 `.env`、`VITE_*`、`runtimeConfig.public`、Git、Prompt、截图或报告。

也可以使用 Profile JSON，适合在 prod/test 等环境间切换：

```json
{
  "default_profile": "prod",
  "profiles": {
    "prod": {
      "hosts": [
        "https://primary-sensors-host.example.com",
        "https://fallback-sensors-host.example.com"
      ],
      "project": "your_project",
      "api_key": "replace_with_read_only_secret",
      "description": "production read-only query"
    }
  }
}
```

把真实文件保存在仓库外并限制权限：

```bash
chmod 600 /path/to/sensors-credentials.json
```

调用时指定配置文件；未传 `--profile` 时使用 `default_profile`：

```bash
node scripts/verify-sensors-events.mjs \
  --spec references/tracking-contract.example.json \
  --query \
  --credentials /path/to/sensors-credentials.json \
  --profile prod \
  --distinct-id "test-user-id" \
  --dry-run
```

Profile 会根据凭证自动选择协议：以 `#K-` 开头的 35 字符 API Key 使用 `openapi`，请求 `/api/v3/analytics/v1/model/sql/query`，并发送 `api-key` 与 `sensorsdata-project` Header；其他值默认作为旧查询 API 的 token/API_SECRET，使用 `token-query`。也可显式配置 `auth_mode`。多个 `hosts` 会按顺序尝试；认证失败不会盲目切换 Host。

不要直接用带占位符的 `credentials.example.json` 发起真实查询。复制为私有文件并替换 `hosts`、`project`、`api_key`；脚本会拒绝占位符和权限过宽的真实凭证文件。

## 3. 事件契约

契约根对象包含 `events` 数组。每个业务事件在 `targets.sensors` 中声明神策契约：

| 字段 | 含义 |
|---|---|
| 事件级 `id` | 跨源码、运行时和入库报告使用的稳定标识 |
| 事件级 `trigger` | 数据文档中的真实触发条件 |
| 事件级 `deduplication` | 一次测试的最少/最多次数和去重策略 |
| `targets.sensors.status` | 只有 `required` 才进入神策验收 |
| `targets.sensors.event` | 神策传输层事件名 |
| `targets.sensors.wrapper` | 项目级业务埋点方法，用于源码可达性检查 |
| `targets.sensors.match` | 从同名事件中筛选业务动作的稳定字段，如 `btn_name` |
| `targets.sensors.distinctId` | 可选测试身份；更推荐运行时传 `--distinct-id` |
| `targets.sensors.sinceMinutes` | 可选查询时间窗 |
| `targets.sensors.properties` | 神策属性契约 |

属性规则支持：

- `required`: 默认 `true`。
- `type`: `string`、`number`、`integer`、`boolean`、`array` 或 `object`。
- `equals`: 精确值。
- `oneOf`: 允许枚举。
- `pattern`: 字符串正则。

不要把神策自动公共属性全部写进业务契约。只验证数据文档明确要求、项目规范要求或业务判断真正依赖的属性。

多个业务动作共用 `ima_function_click` 等事件名时，必须用 `targets.sensors.match` 指定稳定的业务区分字段，否则同一测试用户在时间窗内的其他点击会被误判为重复上报。`match` 只接受字符串、有限数字或布尔值。

验证器继续兼容原有 Version 1 神策单平台契约，但新需求统一使用 Version 2，避免多平台路由信息丢失。

## 4. 离线验证

先用浏览器 Network、SDK Debug 或测试代理捕获实际事件，保存为 JSON、JSON 数组或 NDJSON。文件可使用平铺的神策查询结果，也可使用带 `properties` 的 SDK 事件：

```bash
node scripts/verify-sensors-events.mjs \
  --spec references/tracking-contract.example.json \
  --actual /path/to/captured-events.ndjson \
  --format markdown \
  --out /tmp/sensors-verification.md
```

离线验证不需要查询凭证，适合先确认事件名、字段、类型、枚举和重复次数。

## 5. 神策查询 API 验证

脚本支持两套官方查询协议：

- API_SECRET：`POST /api/sql/query`，SQL 放在表单参数 `q`，使用 `token + project`。
- `#K-` API Key：`POST /api/v3/analytics/v1/model/sql/query`，使用 JSON 请求体和 `api-key + sensorsdata-project` Header。

两种模式都生成短日期范围、单事件、可选 `distinct_id` 和小结果集 SQL。

先预览，不调用 API：

```bash
node scripts/verify-sensors-events.mjs \
  --spec references/tracking-contract.example.json \
  --query \
  --distinct-id "test-user-id" \
  --dry-run
```

确认 SQL 后查询：

```bash
node scripts/verify-sensors-events.mjs \
  --spec references/tracking-contract.example.json \
  --query \
  --distinct-id "test-user-id" \
  --since-minutes 30 \
  --out /tmp/sensors-verification.md
```

部署方明确使用 Bearer 时：

```bash
node scripts/verify-sensors-events.mjs --spec contract.json --query --auth-mode bearer
```

部署方明确使用自定义 Header 时：

```bash
node scripts/verify-sensors-events.mjs \
  --spec contract.json \
  --query \
  --auth-mode header \
  --api-key-header X-API-Key
```

官方说明查询 API 适合低频调用。保持分钟级调用、短时间窗、单次不超过一万条、并发不超过十个。本脚本串行查询，单事件默认最多返回 100 条，硬上限 1000 条。

参考：

- [神策查询 API](https://manual.sensorsdata.cn/sa/docs/tech_super_api_query/v0204)
- [神策查询 OpenAPI](https://manual.sensorsdata.cn/sa/docs/queries_doc/v0300)
- [神策 OpenAPI 认证](https://manual.sensorsdata.cn/sa/docs/open_api_authentication)
- [神策功能 API 与 API_SECRET](https://manual.sensorsdata.cn/sa/docs/api/v0203)
- [神策 OpenAPI 认证和查询限制](https://manual.sensorsdata.cn/openapi?path=focus_4.5.1_ExpressAudienceMeta&suite=sfn4.5.1&type=sf)

## 6. 结果状态

| 状态 | 含义 |
|---|---|
| `PASS` | 找到期望数量且至少一条完全满足属性契约 |
| `NOT_FOUND` | 未找到对应事件和测试身份 |
| `COUNT_MISMATCH` | 数量少于要求 |
| `DUPLICATED` | 数量超过允许上限 |
| `CONTRACT_MISMATCH` | 事件存在，但属性缺失、类型、枚举或取值不一致 |

API 超时、HTTP 错误、凭证或权限错误属于查询失败，不能伪装成事件未入库。

## 7. 安全规则

- 只使用只读、最小权限凭证。
- 优先验证测试环境和测试账号。
- 使用 `distinct_id + 短时间窗 + event` 缩小查询范围。
- 不在报告中保存原始事件；脚本只输出差异摘要。
- 对 Token、Secret、Cookie、邮箱、手机号、账号和用户信息自动脱敏。
- 不为测试擅自新增数据文档未定义的生产事件属性。
- 不把真实用户的自由输入内容作为定位条件。

## 8. 常见问题

### 前端已经返回 200，为什么仍然查询不到？

数据接收成功不等于立即可查询。先确认项目、环境、测试身份和时间窗，再确认是否存在入库延迟。不要无限重试或扩大到全量查询。

### 为什么不直接用 `server_url` 查询？

`/sa?project=...` 是 SDK 数据接收端点。查询使用神策 Web 服务对应的 `/api/sql/query`，域名和权限可能不同，必须由管理员确认。

### 为什么事件存在仍然失败？

同名事件可能来自旧版本、其他入口或重复触发。验收必须同时核对测试身份、时间窗、属性契约和数量约束。

### 能否把 API_SECRET 放进命令行？

不能。命令行会进入 Shell 历史和进程列表。脚本只从环境变量读取凭证，也不会打印完整请求 URL。
