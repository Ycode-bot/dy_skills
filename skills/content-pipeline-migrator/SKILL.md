---
name: content-pipeline-migrator
description: Scan Markdown/content repositories and generate safe batch migration plans for frontmatter normalization, embed insertion, and bilingual content consistency.
---

# Content Pipeline Migrator

Use this skill for content-heavy repos where repeated Markdown edits should be automated.

## Goals

- Detect repeatable transformation opportunities in content files.
- Design safe batch migration with dry-run-first strategy.
- Produce migration patch drafts and rollback plan.

## Scan workflow

- Detect content roots (`content/`, `blog/`, `docs/`).
- Sample frontmatter patterns and language naming conventions.
- Detect existing embeds/shortcodes and missing sections.
- Group files by transformation strategy.

## Required output format

### Scan Findings
- File inventory and pattern clusters
- Risky files and edge cases

### Implementation Plan
- Dry-run strategy
- Batch migration sequence
- Rollback strategy

### Patch Draft
- Example script skeleton
- Before/after snippets

### Verification Checklist
- Content renders
- Frontmatter parsable
- No duplicate insertion
- Language parity check

## Guardrails

- Prefer idempotent transformations.
- Never assume all files share one schema.
- Keep migrations resumable.

## References

- `references/migration-checklist.md`
- `references/script-safety.md`
