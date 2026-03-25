---
name: multi-repo-sync-guard
description: Analyze multiple repositories for duplicated modules and generate sync-risk reports with change propagation checklists.
---

# Multi Repo Sync Guard

Use this skill when teams maintain similar code across multiple repositories.

## Goals

- Detect same-path or near-identical modules across repos.
- Surface high-risk divergence before release.
- Generate sync checklists for safe propagation.

## Scan workflow

- Build per-repo file indexes for key directories.
- Detect overlaps by relative path and file fingerprint.
- Classify divergence:
  - exact duplicate
  - minor drift
  - incompatible drift
- Map likely sync impact zones (auth/i18n/SEO/shared components).

## Required output format

### Scan Findings
- Overlap statistics
- Divergence hotspots
- High-risk modules

### Implementation Plan
- Sync wave plan (repo order)
- Conflict handling strategy
- Ownership and review gates

### Patch Draft
- Candidate sync file list
- Notes for manual merge points

### Verification Checklist
- Cross-repo behavior parity
- Build/test pass per repo
- Key route and locale smoke tests

## Guardrails

- Do not overwrite repo-specific adaptations blindly.
- Mark uncertain matches as manual-review.
- Prioritize high-impact shared modules first.

## References

- `references/drift-classification.md`
- `references/release-checks.md`
