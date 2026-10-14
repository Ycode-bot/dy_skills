# Business-impact review for tracking code changes

Use this review only when the current task modifies application code for `generate-method`, `instrument`, or an implementation/full-lifecycle request. A product spreadsheet, screenshot, or document can establish the tracking contract, but it does not authorize changes to existing business behavior. Read-only modes, including `verify-data`, do not enter this review.

## Review boundary and evidence

Before editing, record `git status --short` and the relevant staged, unstaged, and untracked file state. After editing, compare the affected files and hunks with that baseline. Review the changes introduced by this task, not the entire dirty worktree; preserve pre-existing user edits. If the task overlaps an existing hunk and attribution is unclear, inspect the original content and explicitly report the uncertainty rather than treating the whole diff as your change or restoring it wholesale.

For every added wrapper or call site, follow the surrounding control flow and check that tracking did not alter:

- business conditions, validation, return values, state transitions, or persistence;
- request payloads, API call order, navigation, rendering, and user-visible outcomes;
- success/failure/retry timing, exception propagation, or whether an analytics failure can block the business action;
- exposure or click frequency through watchers, remounts, callbacks, and duplicate triggers.

Run focused tests, lint, or type checks proportionate to the affected flow. Inspect actual failures and distinguish new failures from pre-existing ones. The tracking source verifier is additional evidence, not a substitute for this review. Do not infer unchanged behavior merely because tests pass or the event reached the analytics platform.

## Decision and correction

- **Low:** Only tracking-specific code or calls were added; the affected business flow is unchanged on review and relevant checks pass. State exactly what was inspected.
- **Medium:** No confirmed business change, but a bounded, non-material uncertainty remains (for example, a missing focused test or a limited performance/timing concern). Describe the gap and follow-up; do not label it risk-free.
- **High / needs developer confirmation:** A business branch, state, request, error behavior, or user-visible result changed unexpectedly, or a material effect cannot be ruled out. Do not mark the implementation or combined acceptance `PASS` or continue with browser/runtime/ingestion acceptance while this remains unresolved.

Correct unintended changes caused by this task when it is safe and in scope; review the corrected diff and rerun the affected checks. Do not reset or overwrite user-owned edits. If safe correction is impossible, report the concrete impact and evidence, stop, and hand the case to a developer for confirmation. A data or product user is not asked to approve a code-level business regression.

## Risk report to include in the delivery

Keep the report short and readable by product, data, and engineering colleagues:

| Item | Report |
|---|---|
| Scope | Files/flows and task-owned changes reviewed; note pre-existing edits separately |
| Business impact and risk | Low/medium/high, with the observed behavior or remaining uncertainty |
| Findings and correction | Unexpected changes, what was fixed, and what remains |
| Evidence | Relevant diff inspection and focused tests/checks with results |
| Decision | May proceed, or **needs developer confirmation** before acceptance |

Three calibration cases: a tracking-only call that cannot affect the business action and passes focused checks is low risk; moving a submit condition or making a tracking exception prevent submission is high until corrected and re-reviewed; an existing uncommitted business edit belongs to the baseline, not to this task, and unresolved overlap must be disclosed rather than silently reverted.
