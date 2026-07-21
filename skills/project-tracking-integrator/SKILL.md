---
name: project-tracking-integrator
description: Discover, bootstrap, extend, implement, and verify product analytics across Sensors Analytics, GA4, Google Tag Manager, Google Ads, Segment, Mixpanel, Amplitude, and PostHog. Use when Codex needs to scan a project for an existing 埋点体系, establish the smallest coherent tracking foundation when none exists, convert a data-team spreadsheet/screenshot/document into a multi-platform event contract, create typed business tracking methods, instrument real business triggers, audit missing or duplicate events, capture browser/SDK payloads, query 神策入库数据 with read-only credentials, or produce an end-to-end tracking acceptance report.
---

# Project Tracking Integrator

Treat tracking as a lifecycle, not a single code edit:

`discover → classify → contract → build/extend → instrument → verify source → verify runtime → verify ingestion → report`

Do not declare completion until the required evidence layers agree. Code presence does not prove a reachable trigger, a successful request does not prove ingestion, and a same-named ingested event does not prove the property contract.

## 0. Check for Skill updates

At the beginning of every invocation, before scanning the target project, run this check exactly once when Python 3 is available:

```bash
python3 <skill-dir>/scripts/self_update.py --dest <skill-dir>
```

Interpret the exit code as follows:

- `0`: already current, disabled, or intentionally skipped; continue normally.
- `2`: the installed Skill changed; re-read the updated `SKILL.md` and continue this invocation with the new files without running the updater again.
- `1`: the network or update failed; warn briefly and continue with the local version.

The updater downloads `Ycode-bot/dy_skills@project-tracking-integrator` from the `main` branch, validates the remote Skill, compares a complete file-tree digest, and replaces the installed directory atomically. It preserves local runtime directories, refuses to overwrite a Git working tree by default, and treats update failure as non-blocking.

Set `PROJECT_TRACKING_INTEGRATOR_AUTO_UPDATE=0` to disable one run. Override the trusted source or branch only when explicitly requested with `PROJECT_TRACKING_INTEGRATOR_SKILL_SOURCE=owner/repo@project-tracking-integrator` or `PROJECT_TRACKING_INTEGRATOR_UPDATE_REF=<ref>`.

## Authorization and safety

- Use read-only discovery and local static verification without asking for extra permission.
- Modify application files only when the user asks to implement, integrate, fix, or complete the tracking work.
- Query analytics platforms only with an already configured read-only credential and within the requested environment.
- Never invent a vendor, endpoint, project, credential, event name, property, identity rule, or target route.
- Never place secrets in source code, client-visible environment variables, CLI arguments, prompts, screenshots, or reports.
- Keep raw queried user events out of reports; return redacted differences only.

## 1. Discover the repository

Read applicable repository instructions, manifests, framework configuration, and tracking documentation. Run the deterministic scanner first when local Node.js is available:

```bash
node <skill-dir>/scripts/scan-tracking-project.mjs \
  --root <project-root> \
  --format json \
  --out /tmp/tracking-scan.json
```

Then follow the reported evidence through imports and reachable call sites. Read [references/discovery.md](references/discovery.md) for search order, conflict handling, and false-positive risks.

Inventory platforms independently from event routing. Detect initialization, configuration, consent, identity, common properties, vendor transport, business wrappers, calls, documentation, and validation. Static scanner output is evidence, not proof; inspect ambiguous findings manually.

## 2. Classify before designing

Classify every platform, then the repository:

- `established`: initialization, usable transport or wrapper, and a reachable production call pattern exist. Reuse them.
- `partial`: credible pieces exist but one or more required layers are missing. Add only the smallest missing layer.
- `absent`: no credible tracking foundation exists. Resolve the target vendor, environment, consent/privacy, identity, credentials, and deployment model before implementation.

When the user asks to implement an absent system, read [references/bootstrap-architecture.md](references/bootstrap-architecture.md) and build the smallest coherent foundation plus one representative event. Do not mass-instrument the repository before the foundation works.

When multiple platforms exist or the requirement mentions GA, GTM, Google Ads, 神策, or dual reporting, read [references/multi-platform-routing.md](references/multi-platform-routing.md). Never infer dual reporting from installed SDKs.

## 3. Normalize the data requirement

Transcribe text, table, CSV, spreadsheet, screenshot, or document requirements into a Version 2 contract using:

- [references/tracking-contract.schema.json](references/tracking-contract.schema.json)
- [references/tracking-contract.example.json](references/tracking-contract.example.json)

Define for every business event:

- stable `id`, business meaning, exact trigger, owner, and timing
- per-platform target state: `required`, `optional`, `disabled`, or `unknown`
- per-target transport event, business wrapper, match selectors, property rules, and sources
- deduplication strategy and expected count
- runtime and ingestion evidence method

Preserve valid data-team names. Flag ambiguities instead of guessing. Resolve `unknown` from explicit requirements, repository routing policy, and reachable analogues; if it still changes implementation, report a blocking data/product decision.

For Sensors events that share a generic name such as `ima_function_click`, always add a stable `match` discriminator such as `btn_name`.

## 4. Build or extend the implementation

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

## 5. Verify source evidence

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

## 6. Verify runtime evidence

Trigger each event with a test identity and capture the actual payload using the platform's supported debug surface:

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

## 7. Verify Sensors ingestion

When a required Sensors target must be checked for ingestion, read [references/sensors-verification.md](references/sensors-verification.md). Use the configured private Profile JSON or environment variables; never use the frontend `server_url` as a query endpoint.

Preview the redacted request first:

```bash
node <skill-dir>/scripts/verify-sensors-events.mjs \
  --spec <contract.json> \
  --query \
  --credentials <private-credentials.json> \
  --profile <profile> \
  --distinct-id <test-identity> \
  --dry-run
```

Then run the bounded read-only query and retain only the JSON difference report:

```bash
node <skill-dir>/scripts/verify-sensors-events.mjs \
  --spec <contract.json> \
  --query \
  --credentials <private-credentials.json> \
  --profile <profile> \
  --distinct-id <test-identity> \
  --since-minutes 30 \
  --format json \
  --out /tmp/tracking-ingestion.json
```

Keep `QUERY_FAILED` distinct from `NOT_FOUND`. Check project, environment, identity, time window, ingestion delay, credential, endpoint, and permission before concluding that an event is absent.

## 8. Generate the final acceptance report

Combine all available evidence:

```bash
node <skill-dir>/scripts/generate-tracking-report.mjs \
  --spec <contract.json> \
  --scan /tmp/tracking-scan.json \
  --source /tmp/tracking-source.json \
  --runtime /tmp/tracking-runtime.json \
  --ingestion /tmp/tracking-ingestion.json \
  --out /tmp/tracking-acceptance.md
```

Interpret final states consistently:

- `PASS`: all required evidence for the target passed.
- `INCOMPLETE`: one or more evidence layers were not run.
- `BLOCKED`: a required routing or contract decision remains unknown.
- `MISSING_IMPLEMENTATION` / `UNREACHABLE`: static implementation is absent or not credibly called.
- `NOT_SENT`: runtime payload was not observed.
- `NOT_FOUND`: the query succeeded but no matching ingested event was found.
- `COUNT_MISMATCH` / `DUPLICATED` / `CONTRACT_MISMATCH`: count or schema differs.
- `QUERY_FAILED`: endpoint, credential, permission, timeout, or API execution failed.

## Delivery format

Return or create these artifacts when the scope permits:

1. `Scan Findings`: platforms, classification, evidence, risks, and missing foundation.
2. `Tracking Contract`: normalized Version 2 JSON and unresolved decisions.
3. `Implementation`: changed wrappers, call sites, infrastructure, documentation, and tests.
4. `Verification Evidence`: source, runtime, and ingestion results kept separate.
5. `Acceptance Report`: per-event and per-platform matrix with remaining actions.

For ImaStudio, `@joyme/sensors-data`, `KEWLSensors`, `ima_function_click`, `dataLayer`, `lib/track`, or `docs/tracking-map`, read [references/imastudio-pattern.md](references/imastudio-pattern.md) before modifying or validating the project.
