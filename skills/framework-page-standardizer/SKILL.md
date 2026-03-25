---
name: framework-page-standardizer
description: Scan page-layer implementation patterns in Vue/React frameworks and generate standardization plans for metadata, SEO, i18n hooks, and data-fetching structure.
---

# Framework Page Standardizer

Use this skill to standardize page implementations across a codebase.

## Goals

- Normalize route/page metadata patterns.
- Normalize SEO metadata usage.
- Normalize i18n setup per page.
- Normalize async data loading shape.

## Scan workflow

- Detect framework and routing conventions.
- Detect page files and collect common patterns:
  - metadata hooks (`definePageMeta`, route meta, etc.)
  - SEO hooks (`useHead`, `useSeoMeta`, `Head` usage)
  - i18n initialization (`useI18n`, locale namespaces)
  - data fetching (`useFetch`, `useAsyncData`, loader methods)
- Identify outliers and missing conventions.

## Required output format

### Scan Findings
- Existing pattern families
- Missing conventions
- Inconsistent page implementations

### Implementation Plan
- Define target page contract
- Migration order by risk
- Backward compatibility notes

### Patch Draft
- Example standardized page skeleton
- Per-file refactor suggestions

### Verification Checklist
- Route works
- SEO tags present and correct
- i18n keys resolve
- Data loading and hydration stable

## Guardrails

- Do not force one framework API onto another.
- Preserve runtime behavior while normalizing structure.
- Keep high-risk pages (auth/payment) for late migration.

## References

- `references/page-contract.md`
- `references/verification-checks.md`
