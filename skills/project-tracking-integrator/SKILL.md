---
name: project-tracking-integrator
description: Discover, bootstrap, extend, implement, and verify product analytics across Sensors Analytics, GA4, Google Tag Manager, Google Ads, Segment, Mixpanel, Amplitude, and PostHog. Use when Codex needs to scan a project for an existing 埋点体系, establish a tracking foundation, convert a data-team spreadsheet/screenshot/document into an event contract, create business tracking methods, instrument triggers, audit code, automate a browser journey to trigger events, validate local/QA/production 上报数据准确性, query 神策入库数据, compare required fields with actual platform data, enforce environment promotion gates, or produce an end-to-end acceptance report. Treat requests about 上报数据、数据准确性、字段值是否正确、是否有数据 as live data verification rather than source-code audit unless the user explicitly asks to inspect code.
---

# Project Tracking Integrator

Treat tracking as a set of composable capabilities, not a mandatory checklist. Run the full lifecycle only when the user explicitly requests end-to-end integration or acceptance:

`discover → classify → contract → build/extend → instrument → verify source → verify runtime → verify ingestion → report`

For narrower requests, stop as soon as the requested outcome is complete. Do not run downstream stages merely because the Skill supports them.

## 0. Check for Skill updates

At the beginning of every invocation, before scanning the target project, run one update command when Python 3 is available. For a normal request, use the cached check:

```bash
python3 <skill-dir>/scripts/self_update.py --dest <skill-dir>
```

When the user explicitly asks to update, refresh, check the latest version, or bypass the cache, run this command instead of the normal command:

```bash
python3 <skill-dir>/scripts/self_update.py --dest <skill-dir> --force
```

Do not run both commands in one invocation. If updating is the user's only request, report whether the Skill changed and stop. If the user also requested tracking work, continue after the update result.

Interpret the exit code as follows:

- `0`: already current, disabled, cached, or intentionally skipped; continue normally.
- `2`: the installed Skill changed, or `--check-only` found an update. After installation, re-read the updated `SKILL.md` and continue without running the updater again; after `--check-only`, report availability without claiming installation.
- `1`: the network or update failed; warn briefly and continue with the local version.

The updater stores non-secret timing and revision state in `.update-state.json`. Normal invocations use the cached result for 24 hours without contacting the network. When due, the updater first checks the latest Git commit that changed `skills/project-tracking-integrator`; it downloads the repository archive only when that revision differs or when no trusted local revision exists. Failed checks wait one hour before another automatic attempt. An explicit `--force` always bypasses the cache.

When a download is required, the updater validates the remote Skill, compares a complete file-tree digest, and replaces the installed directory atomically. It preserves local runtime directories, refuses to overwrite a Git working tree by default, and treats update failure as non-blocking.

Set `PROJECT_TRACKING_INTEGRATOR_AUTO_UPDATE=0` to disable one run. Configure the normal interval with `PROJECT_TRACKING_INTEGRATOR_UPDATE_INTERVAL_HOURS` and failed-check retry delay with `PROJECT_TRACKING_INTEGRATOR_UPDATE_RETRY_HOURS`. Set `PROJECT_TRACKING_INTEGRATOR_FORCE_UPDATE=1` as the environment-variable equivalent of `--force`. Override the trusted source or branch only when explicitly requested with `PROJECT_TRACKING_INTEGRATOR_SKILL_SOURCE=owner/repo@project-tracking-integrator` or `PROJECT_TRACKING_INTEGRATOR_UPDATE_REF=<ref>`.

## 1. Route by user intent before using project tools

Select one primary mode from the user's requested outcome before scanning files, spawning parallel work, modifying code, opening a browser, or querying an API. State the selected mode in one short sentence. Treat explicit scope words such as “只”, “仅”, “不要”, “不需要”, and “先” as binding constraints.

| Mode | Typical request | Execute | Stop before |
|---|---|---|---|
| `discover` | “看看有没有埋点体系”“盘点神策和 GA” | Repository discovery and classification | Contract generation, code changes, runtime/API verification |
| `contract` | “把这张埋点截图整理成契约” | Requirement transcription and Version 2 contract | Repository scan, code changes, API query |
| `generate-method` | “生成埋点方法”“增加 trackXxx wrapper” | Minimum architecture lookup, contract normalization, wrapper implementation, narrow static check | Business call-site instrumentation, browser validation, platform query |
| `instrument` | “给这个业务流程埋点” | Minimum architecture lookup, contract, wrapper and requested business call sites, narrow source checks | Live platform query and end-to-end report unless requested |
| `verify-source` | “检查代码实现”“审计 wrapper”“对照文档检查调用点” | Requirement contract plus relevant wrappers/call sites and static checks | Browser actions and platform query unless requested |
| `verify-runtime` | “检查抓到的请求对不对”“对比 Network payload” | Contract plus captured SDK/browser payload | Repository-wide scan, code changes, ingestion query |
| `verify-data` | “检测上报数据准确性”“字段值对不对”“检查我埋的数据”“神策有没有数据”“对比截图和神策入库” | Screenshot/document contract, direct read-only platform query, field/count comparison | Repository scan, GA/GTM inventory, wrapper/call-site audit, code changes |
| `browser-verify` | “浏览器自动操作后验证埋点”“自动触发事件再查神策”“跑一遍页面并对比上报” | Contract, authorized browser journey, UI outcome, optional SDK console evidence, environment-isolated platform query | Repository-wide scan, source audit, or code changes unless separately requested |
| `full-lifecycle` | “从零接入并完整验收”“实现后验证源码、发送和入库” | All explicitly relevant lifecycle stages | Nothing required by the agreed acceptance contract |

Use these routing rules:

1. Prefer the narrowest mode that fully satisfies the request.
2. If the user explicitly requests multiple outcomes, compose only those modes in dependency order; do not append unrequested modes.
3. Run repository discovery only when code architecture is a prerequisite. A screenshot-to-Sensors comparison does not require a project scan.
4. Query a live analytics API only in `verify-data`, `browser-verify`, or an explicitly requested `full-lifecycle`/combined mode.
5. Modify code only in `generate-method`, `instrument`, or an explicitly requested full implementation mode.
6. Inspect GA/GTM/Google Ads only when the request or contract includes those targets.
7. Generate the combined acceptance report only in `full-lifecycle` or when the user asks for that report.
8. Do not start parallel audit tracks for unrelated events or platforms in a narrow mode.

If the request is ambiguous, use data-vs-code nouns as the deciding signal:

- “上报数据”“数据准确性”“实际数据”“字段值是否正确”“有没有数据”“神策数据”“入库数据”“查询 API” select `verify-data`, especially when a requirement screenshot/table is attached.
- Only an explicit request about “代码实现”“wrapper”“方法定义”“调用点”“源码是否一致” selects `verify-source` or `generate-method`.

When both code and data language appear, prefer `verify-data` if the requested conclusion is about actual reported values. Ask one focused question only when the missing distinction materially changes the action.

### Mandatory evidence rule for `verify-data`

`verify-data` is not complete until a platform query was attempted. Apply these non-negotiable rules:

1. Call the configured read-only analytics API before drawing a conclusion.
2. Never substitute source files, wrapper reachability, Tracking Maps, or static checks for actual platform data.
3. Never return `INCOMPLETE` merely because source/runtime evidence was not collected; those layers are outside this mode.
4. If credentials, project, time range, or a safe filter are missing, return `BLOCKED` with only the minimum missing input. Do not switch to source audit.
5. If the API request fails, return `QUERY_FAILED`; if it succeeds with no rows, return `NOT_FOUND`.
6. Return `PASS`, `NOT_FOUND`, `COUNT_MISMATCH`, `DUPLICATED`, `CONTRACT_MISMATCH`, `BLOCKED`, or `QUERY_FAILED` for every requested event. A prose code review is not a valid result.
7. When one analytics project contains multiple deployment environments, require an environment filter before querying. Never mix local, QA, and production rows in one acceptance conclusion.
8. Query the platform by event, environment, and time window. Apply stable `match` fields locally to associate same-name business actions, then strictly compare only the properties and count rules declared by the data requirement; ignore additional platform-returned fields.

### Narrow-mode examples

- `$project-tracking-integrator [截图] 检查埋点数据对不对` → `verify-data`: transcribe the screenshot, query the specified platform, compare, and stop. Do not scan the repository.
- `$project-tracking-integrator [截图] 检测上报数据的准确性` → `verify-data`: query the configured Sensors project and compare actual ingested values. Do not run `verify-tracking-source.mjs`.
- `$project-tracking-integrator 根据这份文档生成对应的埋点方法` → `generate-method`: locate the existing transport and nearest wrapper pattern, add the method, run a narrow static check, and stop. Do not add business call sites or query Sensors.
- `$project-tracking-integrator 给支付成功流程加埋点` → `instrument`: implement the requested wrapper and call site, run source checks, and stop before live data verification.
- `$project-tracking-integrator 在 QA 自动点击领取按钮并验证神策数据` → `browser-verify`: execute only the supplied browser journey, verify its visible outcome, query QA ingestion, compare the contract, and stop. Do not scan or modify the repository.
- `$project-tracking-integrator 在本地 localhost:3000 自动点击领取按钮并验证神策数据` → `browser-verify`: derive `localhost:3000` from the browser URL, query candidates by environment, event, and the trigger time window, associate them with stable match fields locally, compare the contract, and stop.
- `$project-tracking-integrator 完成埋点后用浏览器跑一遍并验收` → compose `instrument → browser-verify`: implement first, then run only the agreed QA journey and ingestion comparison. Do not append unrelated platform audits.
- `$project-tracking-integrator 完整接入这些事件并验证神策入库` → `full-lifecycle`: run the relevant end-to-end stages.

## Authorization and safety

- Use read-only discovery and local static verification without asking for extra permission.
- Modify application files only when the user asks to implement, integrate, fix, or complete the tracking work.
- Query analytics platforms only with an already configured read-only credential and within the requested environment.
- Never invent a vendor, endpoint, project, credential, event name, property, identity rule, or target route.
- Never place secrets in source code, client-visible environment variables, CLI arguments, prompts, screenshots, or reports.
- Keep raw queried user events out of reports; return redacted differences only.

## Capability: Discover the repository

Read applicable repository instructions, manifests, framework configuration, and tracking documentation. Run the deterministic scanner first when local Node.js is available:

```bash
node <skill-dir>/scripts/scan-tracking-project.mjs \
  --root <project-root> \
  --format json \
  --out /tmp/tracking-scan.json
```

Then follow the reported evidence through imports and reachable call sites. Read [references/discovery.md](references/discovery.md) for search order, conflict handling, and false-positive risks.

Inventory platforms independently from event routing. Detect initialization, configuration, consent, identity, common properties, vendor transport, business wrappers, calls, documentation, and validation. Static scanner output is evidence, not proof; inspect ambiguous findings manually.

## Capability: Classify before designing

Classify every platform, then the repository:

- `established`: initialization, usable transport or wrapper, and a reachable production call pattern exist. Reuse them.
- `partial`: credible pieces exist but one or more required layers are missing. Add only the smallest missing layer.
- `absent`: no credible tracking foundation exists. Resolve the target vendor, environment, consent/privacy, identity, credentials, and deployment model before implementation.

When the user asks to implement an absent system, read [references/bootstrap-architecture.md](references/bootstrap-architecture.md) and build the smallest coherent foundation plus one representative event. Do not mass-instrument the repository before the foundation works.

When multiple platforms exist or the requirement mentions GA, GTM, Google Ads, 神策, or dual reporting, read [references/multi-platform-routing.md](references/multi-platform-routing.md). Never infer dual reporting from installed SDKs.

## Capability: Normalize the data requirement

Transcribe text, table, CSV, spreadsheet, screenshot, or document requirements into a Version 2 contract using:

- [references/tracking-contract.schema.json](references/tracking-contract.schema.json)
- [references/tracking-contract.example.json](references/tracking-contract.example.json)

Define for every business event:

- stable `id`, business meaning, exact trigger, owner, and timing
- per-platform target state: `required`, `optional`, `disabled`, or `unknown`
- per-target transport event, business wrapper, match selectors, property rules, and sources
- deduplication strategy and expected count
- runtime and ingestion evidence method
- local, QA, and production requirement state, required evidence, and production `smokeSafe` policy when multi-environment acceptance is requested

Preserve valid data-team names. Flag ambiguities instead of guessing. Resolve `unknown` from explicit requirements, repository routing policy, and reachable analogues; if it still changes implementation, report a blocking data/product decision.

For Sensors events that share a generic name such as `ima_function_click`, always add a stable `match` discriminator such as `btn_name`.

## Capability: Build or extend the implementation

For an established or partial system:

1. Reuse its SDK initialization, identity, common properties, and transport.
2. Add or update a typed business wrapper.
3. Insert the call at the source of truth for the user action or business state transition.
4. Keep tracking failures from blocking the business flow, following repository precedent.
5. Synchronize event catalogs, maps, schemas, indexes, tests, and CI checks.

For semantics:

- Distinguish click, submit, confirmed success, failure, and retry.
- Define exposure as mount, viewport visibility, full display, or duration; do not leave it implicit.
- Emit explicit-close events only from explicit close actions.
- Guard renders, watchers, remounts, retries, callbacks, and overlapping GTM/direct tags against duplication.
- For multiple required targets, derive shared context once and map separate vendor payloads from one business trigger.
- Do not send raw email, phone, token, free-form content, or other personal data without an explicit approved policy.

In `generate-method`, inspect only enough code to find the established transport and nearest analogous wrapper. If the system is established, implement the requested business method and stop after narrow static validation. Do not add its business call site unless the user also requests instrumentation. If no credible system exists, surface or build only the minimum missing foundation authorized by the user.

## Capability: Verify source evidence

After implementation, enrich each required target with its expected `wrapper`, then run:

```bash
node <skill-dir>/scripts/verify-tracking-source.mjs \
  --root <project-root> \
  --spec <contract.json> \
  --format json \
  --out /tmp/tracking-source.json
```

Inspect reported files. The script checks exact event/match/property literals and whether a declared wrapper has more than a definition reference. It does not perform control-flow analysis, so `PASS` still requires runtime evidence.

Also run the repository's narrow tests, tracking checks, lint, and type checks in proportion to the change.

## Capability: Verify runtime evidence

Trigger each event and capture the actual payload using the platform's supported debug surface:

- Sensors: SDK debug output or collection request.
- GA4: DebugView, Tag Assistant, or collection request.
- GTM: Preview mode with data-layer event, variables, triggers, and fired tags.
- Google Ads: conversion diagnostics and stable conversion identifier.

For a captured Sensors JSON/NDJSON payload, use the same contract offline:

```bash
node <skill-dir>/scripts/verify-sensors-events.mjs \
  --spec <contract.json> \
  --actual <captured-events.json-or-ndjson> \
  --format json \
  --out /tmp/tracking-runtime.json
```

For GA4, GTM, Google Ads, or another manually inspected target, record the evidence as a small JSON report that the final report generator can merge:

```json
{
  "results": [
    { "id": "contract-event-id", "platform": "ga4", "status": "PASS", "method": "ga4-debugview" }
  ]
}
```

Verify required targets independently and confirm disabled targets do not fire. Do not claim runtime success from source inspection alone.

## Capability: Automate a browser journey and verify ingestion

Use `browser-verify` only when the user asks Codex to operate the browser. Read [references/browser-verification.md](references/browser-verification.md) before taking browser actions and use [references/browser-journey.example.json](references/browser-journey.example.json) when a reusable test recipe is useful.

Before any browser action, require the Codex [@Browser](plugin://browser@openai-bundled) plugin and its `browser:control-in-app-browser` Skill. If the Browser Skill is not listed for the session, return `BLOCKED` and tell the user: “缺少 Browser 插件。请在 Codex 的插件面板安装或启用 Browser（OpenAI bundled），重新打开任务后再运行浏览器验收。” Do not silently fall back to standalone Playwright, Computer Use, or another browser automation package. If the Browser Skill exists but its packaged `scripts/browser-client.mjs` is missing, report that the Browser plugin installation is incomplete and ask the user to reinstall it from the Codex plugin panel.

The minimum acceptance loop is:

1. Normalize the supplied screenshot/document into a contract and resolve the target environment, start URL, and browser journey.
2. Reuse the signed-in in-app browser session. Inspect the live DOM and validate one unique locator immediately before each action; never guess selectors from source code or screenshots.
3. Wait for a stable route and interactive application state, record the start time, execute only the authorized steps, and verify the visible UI result after every trigger.
4. Read redacted SDK console output when the application exposes it. Treat this as optional runtime evidence because browser automation may execute JavaScript in an isolated world and the in-app browser does not expose general Network request interception.
5. After a bounded ingestion wait, query candidate rows with the event name, environment value, and trigger time window; apply stable match fields locally before strict contract comparison.
6. Compare event name, properties, values, types, and expected count. If the first query returns `NOT_FOUND`, permit at most one delayed re-query before concluding.

The platform query is mandatory in this mode. A successful click, UI transition, or console message does not prove ingestion. Conversely, do not claim that an outgoing request was captured unless an actual SDK log or captured payload was observed.

Never use `window.<sdk> === undefined` as proof that initialization or sending failed. First confirm the page route is stable and the application is interactive; then check the SDK only in the page's main execution world when the Browser surface supports it. An isolated-world or unavailable global handle is `NOT_AVAILABLE`, not `NOT_SENT`, and must not skip the platform query. Use `NOT_SENT` only when an actual captured request/debug payload proves the expected event was absent.

Return `BLOCKED` with only the missing input when the start URL, safe test journey, environment filter, contract, authentication state, or sufficiently narrow event/match filter is unavailable. A missing SDK global is not a blocker. Hand CAPTCHA, OTP, passkeys, and account login to the user; never inspect cookies or browser storage to recover credentials.

## Capability: Verify platform ingestion

In `verify-data` and the ingestion portion of `browser-verify`, do not begin with repository discovery. Follow this minimal path:

1. Transcribe only the requested events, match selectors, properties, expected values, and count constraints from the supplied screenshot/document into a temporary contract.
2. Use the specified platform and configured read-only credential. Do not infer additional targets.
3. Query candidate rows in the shortest practical time window using only the event name and environment.
4. Associate same-name candidates locally with stable `match` fields, then strictly compare expected and actual fields, types, values, enums, and counts.
5. Return a compact per-event result table plus any query limitation, then stop.

Resolve Sensors query configuration in this order without printing secrets:

1. Explicit credential path/profile from the user or current conversation.
2. `SENSORS_QUERY_CREDENTIALS_FILE` and the query environment variables.
3. The existing private file `~/.config/imastudio/sensors-credentials.json` when present.

The verifier discovers options 2 and 3 automatically. When any configured option is available, run the API query instead of asking the user to configure it again.

When the same Sensors project receives more than one application environment, add an environment filter to every live query. Read [references/environment-gates.md](references/environment-gates.md) for the three-stage evidence and promotion policy. For ImaStudio use the common URL property shown in Sensors:

| Verification stage | Required query condition | CLI option |
|---|---|---|
| Local acceptance before QA | `lmweb_url` contains the actual browser host such as `localhost:3000` | `--environment local --environment-value localhost:3000` |
| QA acceptance before release | `lmweb_url` contains `qa.imastudio.com` | `--environment qa --environment-value qa.imastudio.com` |
| Production smoke check after release | `lmweb_url` contains `www.imastudio.com` | `--environment production --environment-value www.imastudio.com` |

Use the environment value without protocol or path. Derive local values from `new URL(startUrl).host`, preserving the port. The default property is `lmweb_url`; override it only when the repository/data team confirms another common field with `--environment-property <name>`. The live SQL uses environment, event, and a time window covering the browser trigger. Stable action `match` fields are applied to the returned candidates locally so a platform-side column type mismatch becomes a contract result instead of a SQL failure. Any match field whose type or value must be accepted must also appear in `properties`.

If the query would be too broad because a generic event lacks a stable selector such as `btn_name` or `page`, ask only for that minimum business filter. Do not compensate by auditing wrappers, Tracking Maps, GA/GTM, or unrelated events.

When a required Sensors target must be checked for ingestion, read [references/sensors-verification.md](references/sensors-verification.md). Use the configured private Profile JSON or environment variables; never use the frontend `server_url` as a query endpoint.

Preview the redacted request first:

```bash
node <skill-dir>/scripts/verify-sensors-events.mjs \
  --spec <contract.json> \
  --query \
  --credentials <private-credentials.json> \
  --profile <profile> \
  --environment <local-or-qa-or-production> \
  --environment-value <host-or-host:port-without-protocol> \
  --dry-run
```

Then run the bounded read-only query and retain only the JSON difference report:

```bash
node <skill-dir>/scripts/verify-sensors-events.mjs \
  --spec <contract.json> \
  --query \
  --credentials <private-credentials.json> \
  --profile <profile> \
  --environment <local-or-qa-or-production> \
  --environment-value <host-or-host:port-without-protocol> \
  --since-minutes 30 \
  --format json \
  --out /tmp/tracking-ingestion.json
```

Represent every document-declared field through the normal property contract and ignore platform-returned fields that the document does not declare. Keep `QUERY_FAILED` distinct from `NOT_FOUND`. Check project, environment, time window, ingestion delay, credential, endpoint, and permission before concluding that an event is absent.

## Capability: Generate the final acceptance report

Combine all available evidence:

```bash
node <skill-dir>/scripts/generate-tracking-report.mjs \
  --spec <contract.json> \
  --scan /tmp/tracking-scan.json \
  --source /tmp/tracking-source.json \
  --browser /tmp/tracking-browser-local.json \
  --ingestion /tmp/tracking-ingestion-local.json \
  --browser /tmp/tracking-browser-qa.json \
  --ingestion /tmp/tracking-ingestion-qa.json \
  --browser /tmp/tracking-browser-production.json \
  --ingestion /tmp/tracking-ingestion-production.json \
  --out /tmp/tracking-acceptance.md
```

Interpret final states consistently:

- `PASS`: all required evidence for the target passed.
- `INCOMPLETE`: one or more evidence layers were not run.
- `BLOCKED`: a required routing or contract decision remains unknown.
- `MISSING_IMPLEMENTATION` / `UNREACHABLE`: static implementation is absent or not credibly called.
- `NOT_SENT`: an actual capture/debug surface was available and the expected runtime payload was absent; an unreadable SDK global is only `NOT_AVAILABLE`.
- `NOT_FOUND`: the query succeeded but no matching ingested event was found.
- `COUNT_MISMATCH` / `DUPLICATED` / `CONTRACT_MISMATCH`: count or schema differs.
- `QUERY_FAILED`: endpoint, credential, permission, timeout, or API execution failed.

## Delivery format

Return only the artifact required by the selected mode. Do not pad a narrow request with lifecycle sections the user did not request.

- `discover` → platform inventory, classification, evidence, and risks.
- `contract` → normalized contract and unresolved decisions.
- `generate-method` → wrapper change and narrow static result.
- `instrument` → wrapper/call-site changes and narrow source result.
- `verify-source` → source/document difference report.
- `verify-runtime` → captured-payload difference report.
- `verify-data` → platform query comparison and clear PASS/FAIL/QUERY_FAILED result.
- `browser-verify` → browser-step evidence, visible UI outcome, optional SDK console evidence, platform query comparison, and a clear final result.
- `full-lifecycle` → scan, contract, implementation, separate evidence layers, and combined acceptance report.

In full-lifecycle mode, do not declare completion until all required evidence layers agree. For multi-environment contracts, local must pass before QA becomes ready, QA must pass before production becomes ready, and production automation may run only for events marked `smokeSafe: true`. These are readiness gates, not authorization to deploy or release. Code presence does not prove a reachable trigger, a successful request does not prove ingestion, and a same-named ingested event does not prove the property contract.

For ImaStudio, `@joyme/sensors-data`, `KEWLSensors`, `ima_function_click`, `dataLayer`, `lib/track`, or `docs/tracking-map`, read [references/imastudio-pattern.md](references/imastudio-pattern.md) before modifying or validating the project.
