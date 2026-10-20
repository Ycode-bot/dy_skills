# 补查复核与最终结论

适用：首次未找到后查到、原观测窗口提前结束、静态解析未覆盖间接封装、业务修复后重新验证。最终状态反映已经解决的问题；历史反映曾经发生的失败。两者分开保存。

## 何时采纳补查

- 确认是本次业务操作：相同事件、平台、精确环境，结合已观测步骤、账号条件及订单或 exposure_id 等真实关联依据。仅出现同名事件不足以通过。
- 新报告必须通过字段、类型、次数检查；有跨事件契约时，同一补查报告必须包含所有参与事件及通过的关联断言。
- 原窗口提前结束时，补查边界来自实际观测的完成时刻或可追溯截图。查询窗口必须与原操作窗口重叠，且在记录的已观测区间内；窗口变化需要说明原因和关联证据。
- 入库延迟仅需原窗口有限重查。窗口修正独立记录，不修改原 bundle，不将补查冒充 runner 的原窗口重试；针对有依据的修正执行一次查询，失败则保留诊断，禁止反复扩大范围直到找到。
- 真正的字段不符、事件关联歧义、错误环境、截断、查询失败不能靠“人工确认”改成通过。先解决具体原因并取得新证据。代码有变化则重新触发，不把旧版本证据用于新版本验收。

## 输入复核记录

汇总器新增 `--review review.json`。索引为对应阶段命令行输入顺序，从 0 开始；同一阶段无关事件报告不必列入 supersedes。每一项选择一份已通过的新报告，明确列出同一场景其余报告索引。更改输入顺序时同步更新索引。

```json
{
  "version": 1,
  "resolutions": [{
    "id": "purchase-success",
    "platform": "sensors",
    "environment": "local",
    "stage": "ingestion",
    "reportIndex": 1,
    "supersedes": [0],
    "reason": "原记录结束过早；补查已找到本次支付成功事件",
    "evidence": ["payment-query-2.json 的字段和关联断言通过", "payment-success.png 的业务完成状态"],
    "windowReview": {
      "triggerWindow": {"startedAt": "2026-10-20T08:38:16.390Z", "finishedAt": "2026-10-20T08:40:38.016Z"},
      "queryWindow": {"startedAt": "2026-10-20T08:38:16.390Z", "finishedAt": "2026-10-20T08:40:43.000Z"},
      "observedWindow": {"startedAt": "2026-10-20T08:38:16.390Z", "finishedAt": "2026-10-20T08:40:43.000Z"},
      "reason": "结束边界采用已保存的付款成功截图时刻",
      "association": "本次首充操作，支付三事件按 exposure_id 唯一关联且归因一致",
      "evidence": ["payment-success.png 与对应时间记录", "payment-query-2.json 中 payment-attribution 通过"]
    }
  }]
}
```

示例时间和关联字段仅说明格式，必须替换为真实证据。`triggerWindow`、`queryWindow` 原样填写所选浏览器报告与入库结果中的窗口。`observedWindow` 不能为了适配查询范围而编造。不要在复核记录中复制凭证、用户隐私或原始订单标识。

`stage` 支持 source/browser/runtime/ingestion；源码人工补查报告仍需 `method: agent-review`、具体 `evidence`，完整开发还需 integration 范围。窗口相同可省略 windowReview；窗口不同不提供它，汇总器继续标记需确认。无法证明同次操作时保持待确认，不要求为纯记录问题一律重复付款。

```bash
node scripts/generate-tracking-report.mjs --spec contract.json --mode full-lifecycle \
  --development development.json --source source.json --browser browser.json \
  --ingestion payment-query-1.json --ingestion payment-query-2.json \
  --review review.json --out report.md
```

复核记录不接受直接指定最终状态。汇总器验证被选择的阶段证据，重新计算总体结果；其他必需阶段未完成仍阻塞。无明确复核时，多轮冲突保持保守处理。原始报告不变，输出的 reviewHistory 保存采用依据与被替代的结果、问题和窗口。

## 交付同步

复核后统一更新最终报告、业务埋点地图及交付说明。写“本次已执行 9/9 场景通过，首次未找到，补查确认”，不要同时显示旧的“尚未完成”作为当前结论。尚未测试的其他分组另列；不能为了通过修改必需契约或把原要求的未执行场景移出统计。

SDK/请求仅在契约要求该阶段时展示独立列。未捕获但非必需时合并为一条说明，入库证据不冒充请求抓包。保留原失败过程、修复及补查依据，清理临时文件前确认最终报告已保存必要结论。
