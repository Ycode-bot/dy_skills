# Script Safety Rules

1. Include `--dry-run` by default.
2. Support single-file mode before bulk mode.
3. Print summary counts: updated/skipped/errors.
4. Exit non-zero on parse errors.
5. Keep operation idempotent.
