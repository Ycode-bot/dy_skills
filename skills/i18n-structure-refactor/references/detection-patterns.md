# Detection Patterns

## Key usage patterns
- `t('namespace.key')`
- `$t('namespace.key')`
- `i18n.t('namespace.key')`
- template calls using i18n helpers

## Locale file candidates
- `i18n/locales/**/*.json`
- `locales/**/*.json`
- `messages/**/*.json`

## Mismatch categories
- Missing in locale
- Unused locale key
- Namespace drift
- Locale asymmetry
