---
name: i18n-structure-refactor
description: Scan a repository to detect i18n architecture, key usage patterns, missing keys, naming inconsistencies, and locale asymmetry; then generate a migration/refactor plan with patch drafts.
---

# i18n Structure Refactor

Use this skill when users ask to improve i18n structure, migrate locale format, or find i18n inconsistencies.

## What this skill does

1. Scans framework and i18n conventions in the repo.
2. Detects locale files and key usage points in code.
3. Produces mismatch findings:
- key exists in code but not locale
- key exists in locale but unused
- inconsistent namespaces
- locale asymmetry (e.g., `en` has keys missing in `zh`)
4. Proposes a migration/refactor plan.
5. Outputs patch drafts (no direct file mutation by default).

## Scan workflow

- Detect framework: Nuxt/Next/React/Vue from config and directory shape.
- Detect i18n entrypoints: `i18n/`, `locales/`, `messages/`, framework i18n config.
- Collect key references from source files:
  - `t('...')`, `$t('...')`, `useI18n(...)`, `i18n.t(...)`
- Flatten locale JSON keys for comparison.

## Required output format

### Scan Findings
- Project i18n topology
- Key mismatch summary
- High-risk inconsistencies

### Implementation Plan
- Ordered migration steps (low-risk to high-risk)
- Scope boundaries and fallback strategy

### Patch Draft
- File-by-file patch suggestions
- Example key insertions/renames

### Verification Checklist
- Locale symmetry checks
- Runtime checks for missing-key rendering
- Build/lint/test checks

## Guardrails

- Do not write files unless user explicitly asks.
- Do not invent translations; mark unknown text as TODO.
- Keep namespace changes backward-compatible where possible.

## References

- `references/detection-patterns.md`
- `references/output-template.md`
