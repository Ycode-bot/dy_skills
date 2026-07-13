---
name: project-tracking-integrator
description: Scan a codebase to discover one or more analytics systems, including product analytics, GA4, Google Tag Manager, Google Ads, and their centralized wrappers, event schemas, routing rules, documentation, and validation; then design or implement single-target or multi-target tracking events from product or data-team specifications while preserving project conventions. Use when asked to add tracking, 埋点, analytics, GA/GA4/GTM/Google Tag events, Sensors Analytics events, exposure/click/conversion events, convert spreadsheet or screenshot definitions into code, audit duplicate or missing events, or bootstrap analytics in a project with no established system.
---

# Project Tracking Integrator

Scan before designing. Treat repository instructions and existing production patterns as the source of truth. Do not assume a framework, analytics vendor, event name, or directory layout.

## Operating contract

Return these sections unless the user requests another format:

1. `Scan Findings`
2. `Implementation Plan`
3. `Patch Draft`
4. `Verification Checklist`

Default to analysis and a patch draft. Modify project files only when the user explicitly asks to implement or integrate the tracking.

## Workflow

### 1. Read project instructions

Find and read applicable `AGENTS.md`, `CLAUDE.md`, repository docs, package manifests, framework configuration, lint rules, and contribution guidance. Obey the closest-scoped instructions.

### 2. Discover the tracking architecture

Search broadly, then follow imports and call sites. Inspect at least:

- Dependencies and SDK initialization: `analytics`, `track`, `telemetry`, `sensors`, `segment`, `mixpanel`, `amplitude`, `gtag`, `dataLayer`, `GTM-`, `AW-`, `matomo`, `posthog`.
- Global client/plugin/provider setup and authentication identity handling.
- Central event transport and business wrappers such as `trackXxx`.
- Event names, common fields, enums, page/source mapping, and user/device properties.
- Representative call sites for clicks, exposures, submissions, success/failure states, and route changes.
- Event catalogs, tracking maps, schemas, tests, lint scripts, and CI checks.

Read [references/discovery.md](references/discovery.md) when performing the scan or when signals conflict.

### 3. Classify the repository

Classify each discovered platform independently, then classify the repository as a whole:

- **Established**: SDK initialization, a usable transport, and repeatable event conventions exist. Reuse them. Do not install another SDK or create a parallel tracking layer.
- **Partial**: Some pieces exist but a required layer is missing. Extend the smallest missing layer and preserve compatibility.
- **Absent**: No credible tracking system exists. Propose an integration before changing files. Resolve vendor credentials, environment policy, consent/privacy requirements, identity semantics, and deployment target; never invent secrets or production endpoints.

Do not equate installation with event routing. A repository may contain both product analytics and GA/GTM while a specific event requires one target, both targets, or neither. Read [references/multi-platform-routing.md](references/multi-platform-routing.md) whenever more than one analytics platform exists or the requirement mentions GA, GTM, Google Ads, 神策, or dual reporting.

### 4. Normalize the data requirement

Accept requirements from text, tables, spreadsheets, screenshots, or documents. Convert every requested event into a contract:

| Field | Meaning |
|---|---|
| Trigger | Exact user action or business state transition |
| Targets | Per-platform status: `required`, `optional`, `disabled`, or `unknown` |
| Event | Per-target transport-level event name |
| Wrapper | Per-target project-level function name |
| Properties | Per-target name, type, requiredness, enum, mapping, and source |
| Timing | Before/after which operation; once or repeatable |
| Location | Page/component/composable/service that owns the trigger |
| Deduplication | Guard against rerender, remount, retries, or duplicate emits |
| Validation | How to observe and verify the payload |

Flag ambiguous spreadsheet labels instead of silently guessing. Preserve data-team field names when they are valid within the established schema.

Resolve `unknown` targets using explicit requirements first, then repository routing policy and analogous reachable events. If the target still cannot be established, report it as a blocking product/data decision; do not silently dual-report.

### 5. Validate event semantics

Prefer user intent and meaningful business state transitions. Reject or reroute framework noise, DOM measurements, render side effects, performance metrics, and errors unless the project's own analytics policy explicitly includes them.

For exposure events, define what “shown” means: mounted, visible in viewport, fully displayed, or viewed for a duration. For async flows, distinguish submit, result, and retry. For dialogs, distinguish explicit user close from automatic dismissal.

Check overlap with existing events. Reuse or extend an existing wrapper when semantics match; create a new wrapper only when the behavior or schema is genuinely distinct.

For multi-target events, keep one business trigger and map its shared context into separate platform payloads. Do not copy one vendor's schema directly into another vendor's event.

### 6. Design the patch

For established systems:

1. Add or update typed business wrappers in the existing tracking module.
2. Reuse the centralized transport and global properties.
3. Insert calls at the single source of truth closest to the real trigger.
4. Keep tracking failure from breaking the business flow, following repository precedent.
5. Update event catalogs, journey maps, schemas, tests, and indexes required by the repository.
6. When multiple targets are required, derive shared business context once and invoke each established platform wrapper from the same semantic trigger.

For absent systems, propose the smallest coherent architecture:

1. Client-only SDK initialization where applicable.
2. Environment-specific configuration without embedded secrets.
3. Consent and privacy handling.
4. Anonymous identity, login association, logout reset, and common properties.
5. A vendor-facing transport wrapper.
6. Typed business-event wrappers.
7. One representative integration and verification method.

Do not mass-instrument the repository until the foundation is accepted.

### 7. Verify

Run the narrowest relevant checks first, then repository lint/type checks when proportionate. Verify:

- Exact event and property names.
- Required properties and enum values.
- Client/SSR safety.
- Once-only and deduplication behavior.
- Login/logout identity behavior when affected.
- No duplicate or unreachable event paths.
- Exact target routing: required targets fire, optional/disabled targets do not, and no unresolved target is hidden.
- Multi-target payloads preserve platform-specific event names, required fields, units, and deduplication identifiers.
- A failure or absence in one analytics target does not block another target or the business action.
- Documentation/schema/index synchronization.
- Existing tracking validation scripts and tests.

When runtime access exists, inspect the emitted payload in SDK debug output or the browser network panel without exposing tokens or personal data.

## Patch rules

- Follow existing naming, module boundaries, types, formatting, and comments.
- Prefer a business wrapper over direct SDK calls at UI call sites.
- Do not hardcode credentials, personally identifiable information, or production endpoints.
- Do not add a dependency when an established SDK already satisfies the requirement.
- Do not infer dual reporting merely because two SDKs are installed.
- Do not merge vendor-specific payloads into a lowest-common-denominator schema.
- Do not modify shared infrastructure solely to fit one event when composition is sufficient.
- Do not claim an event is complete if its required documentation or validation contract remains stale.

## ImaStudio reference

When the target resembles ImaStudio or uses `@joyme/sensors-data`, `KEWLSensors`, `ima_function_click`, `dataLayer`, `gtag`, `lib/track`, or `docs/tracking-map`, read [references/imastudio-pattern.md](references/imastudio-pattern.md) and [references/multi-platform-routing.md](references/multi-platform-routing.md) before proposing changes.
