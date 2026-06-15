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
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g
```

Install all at once:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g && \
npx skills add Ycode-bot/dy_skills@framework-page-standardizer -y -g && \
npx skills add Ycode-bot/dy_skills@incident-runbook-from-code -y -g && \
npx skills add Ycode-bot/dy_skills@content-pipeline-migrator -y -g && \
npx skills add Ycode-bot/dy_skills@multi-repo-sync-guard -y -g && \
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g && \
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g
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
- `activity-cms-psd`: Converts annotated activity PSDs into activityincms import JSON, sliced assets, theme notes, and UI/operator handoff docs.
- `workplace-viral-copywriter`: Generates viral Chinese workplace copy for a capybara IP WeChat account, including topic judgment, titles, 5-6 paired two-line image groups, cover hooks, interaction questions, and hashtags.

## Skill Dependencies

`activity-cms-psd` requires Python and PSD parsing dependencies:

```bash
python3 -m pip install -r skills/activity-cms-psd/requirements.txt
```

It uses `Pillow` and `psd-tools[composite]`. Adobe Photoshop is not required.

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
