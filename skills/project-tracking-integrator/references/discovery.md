# Tracking discovery guide

Use this guide to build evidence before proposing tracking changes.

## Search sequence

1. Read repository instructions and manifests.
2. Search dependencies and configuration for analytics vendors.
3. Find every SDK initialization and global injection, not only the first match.
4. Find the lowest-level transport wrapper for each platform.
5. Enumerate platform-specific business wrappers and inspect representative payloads.
6. Trace single-target and multi-target events to real call sites.
7. Find event-routing policy, documentation, schemas, test fixtures, lint scripts, and CI commands.
8. Summarize installed platforms separately from required event targets.

Prefer fast repository search such as `rg`. Adapt these concepts to the available tools:

```text
analytics|telemetry|sensors|segment|mixpanel|amplitude|posthog|gtag|dataLayer
GTM-|AW-|googletagmanager|google-analytics|measurementId|conversion_id
track\(|capture\(|identify\(|registerGlobal|pageview|exposure|impression
track[A-Z]|eventName|event_name|properties|distinct_id|anonymous_id
tracking-map|event catalog|埋点|事件字典|数据字典
```

Exclude generated files, build output, vendored dependencies, lockfiles, and minified assets unless the implementation cannot otherwise be located.

## Evidence table

Record findings with file paths and representative symbols:

| Concern | Evidence | Confidence |
|---|---|---|
| SDK/vendor | Dependency and initialization file | High/medium/low |
| Platform role | Product analytics, acquisition, tag routing, ads conversion, or other | High/medium/low |
| Transport | Per-platform central wrapper or direct calls | High/medium/low |
| Identity | Anonymous, login, logout behavior | High/medium/low |
| Common fields | Registration or payload composition | High/medium/low |
| Business schema | Typed wrappers and representative events | High/medium/low |
| Documentation | Catalog/map/schema ownership | High/medium/low |
| Validation | Tests, lint, debug or network method | High/medium/low |
| Routing policy | Which event families target which platforms | High/medium/low |

Do not call a repository “established” based only on an installed package. Confirm initialization and at least one reachable production call path.

Do not call an event “dual reported” because both platforms appear in the repository. Confirm that the same business trigger intentionally reaches both transports.

## Conflict resolution

Use this priority order:

1. Applicable repository instructions.
2. Current executable code and reachable call paths.
3. Current schemas, catalogs, and validation scripts.
4. Recent examples in the same feature area.
5. Generic vendor documentation.

Report conflicts. Do not quietly copy a stale wrapper or dead code pattern.

## Requirement extraction from screenshots and tables

Transcribe visible values and distinguish facts from interpretation. For each row, capture:

- Event name and description.
- Property name, display label, type, requiredness, and allowed values.
- Page or component scope.
- Trigger wording such as show, click, close, submit, success, or failure.
- Notes that conditionally alter a property.

Ask for the source table or clarification only when missing content materially changes implementation. Otherwise proceed with an explicit assumption in the patch draft.

## Common hazards

- Direct SDK calls scattered through UI files.
- Two installed platforms incorrectly treated as a requirement to dual-report every event.
- The same vendor initialized twice through application code and a tag manager.
- A data-layer event and a direct `gtag` call producing duplicate GA4 or Ads conversions.
- Product-analytics property names copied unchanged into GA4 without event-specific mapping.
- Exposure events fired on every render or reactive update.
- Click events fired before confirming the action is enabled.
- Success events emitted on request submission rather than confirmed success.
- Close events also emitted for timeout, route teardown, or programmatic reset.
- Retry paths double-counting both initial and retry submissions.
- Dynamic fields sourced from labels that change with localization.
- User identifiers or free-form content leaking into properties.
- Server-side execution referencing `window`.
- Documentation describing wrappers that no longer exist.
