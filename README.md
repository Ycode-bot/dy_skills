# dy_skills

Reusable, repo-aware AI skills for engineering workflows.

These skills are designed to **scan a codebase first**, then produce:
1. Findings
2. Action plan
3. Patch draft
4. Verification checklist

## Install

Use the exact repo path:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g
npx skills add Ycode-bot/dy_skills@framework-page-standardizer -y -g
npx skills add Ycode-bot/dy_skills@incident-runbook-from-code -y -g
npx skills add Ycode-bot/dy_skills@content-pipeline-migrator -y -g
npx skills add Ycode-bot/dy_skills@multi-repo-sync-guard -y -g
```

Install all at once:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g && \
npx skills add Ycode-bot/dy_skills@framework-page-standardizer -y -g && \
npx skills add Ycode-bot/dy_skills@incident-runbook-from-code -y -g && \
npx skills add Ycode-bot/dy_skills@content-pipeline-migrator -y -g && \
npx skills add Ycode-bot/dy_skills@multi-repo-sync-guard -y -g
```

Verify installation:

```bash
ls ~/.agents/skills
```

## Included Skills

- `i18n-structure-refactor`: Detects i18n patterns and generates migration/refactor plans.
- `framework-page-standardizer`: Standardizes page-level patterns (routing metadata, SEO, i18n, data-loading shape).
- `incident-runbook-from-code`: Produces production runbooks from code/logs/docs.
- `content-pipeline-migrator`: Scans Markdown/content pipelines and proposes batch migrations.
- `multi-repo-sync-guard`: Detects cross-repo duplicated modules and generates sync checklists.

## Skill Contract

All skills in this repo should return these sections:

- `Scan Findings`
- `Implementation Plan`
- `Patch Draft`
- `Verification Checklist`

Default behavior is **analysis + patch draft only**. Do not mutate files unless explicitly requested.

## Versioning

- Start at `v0.1.0` as a public beta.
- Keep changes backward-compatible when possible.

## License

MIT
