---
name: incident-runbook-from-code
description: Generate production incident runbooks from repository evidence (scripts, docs, commits, and logs) with actionable triage and recovery steps.
---

# Incident Runbook From Code

Use this skill when users need a deployable incident runbook quickly.

## Goals

- Convert engineering evidence into an operations-ready runbook.
- Separate immediate mitigation from permanent fix.
- Provide clear validation and communication templates.

## Scan workflow

- Locate incident-related docs, scripts, and fix notes.
- Extract symptoms, impact, and likely root causes.
- Extract available mitigation and rollback actions.
- Build validation checklist and monitoring guidance.

## Required output format

### Scan Findings
- Incident context
- Evidence files and confidence
- Missing observability gaps

### Implementation Plan
- Triage path
- Mitigation path
- Permanent remediation path

### Patch Draft
- Runbook sections ready to paste into docs
- Optional script improvement drafts

### Verification Checklist
- Post-fix functional checks
- Monitoring thresholds
- Postmortem TODOs

## Guardrails

- Mark uncertain causes explicitly.
- Avoid absolute statements without evidence.
- Keep emergency path executable in under 5 minutes.

## References

- `references/runbook-template.md`
- `references/severity-matrix.md`
