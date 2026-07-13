# SEO discovery and audit guide

Use this guide to gather evidence before proposing changes.

## Search sequence

1. Read repository instructions and manifests.
2. Identify framework, router, rendering mode, hosting, and environment configuration.
3. Find global head/site configuration.
4. Find page metadata APIs and centralized SEO abstractions.
5. Trace static and dynamic route examples to their data sources.
6. Find canonical, locale alternate, robots, sitemap, redirect, and JSON-LD ownership.
7. Inspect generated or server-rendered output when runnable.
8. Summarize coverage, conflicts, and missing decisions.

Prefer fast repository search such as `rg`. Adapt these concepts to the available tools:

```text
useSeoMeta|useServerSeoMeta|useHead|generateMetadata|metadata|Helmet
canonical|hreflang|alternate|x-default|og:|ogTitle|twitterCard
robots|sitemap|noindex|nofollow|routeRules|redirect
application/ld+json|schema.org|JSON-LD|useJsonld|structured data
siteUrl|siteURL|baseUrl|publicUrl|origin
```

Exclude generated output, vendored dependencies, lockfiles, and minified assets unless runtime implementation cannot otherwise be found.

## Evidence table

| Concern | Evidence | Confidence |
|---|---|---|
| Framework/rendering | Manifest, config, route behavior | High/medium/low |
| Global defaults | App/layout/head config | High/medium/low |
| Page metadata | Central source and representative pages | High/medium/low |
| Dynamic SSR | Server data path and initial HTML | High/medium/low |
| Canonical policy | Utility/config plus redirect behavior | High/medium/low |
| Locale alternates | i18n config and rendered links | High/medium/low |
| Robots/sitemap | Config and generated endpoints | High/medium/low |
| Structured data | Builder and representative output | High/medium/low |
| Verification | Tests, build, HTML inspection, audit | High/medium/low |

## Conflict priority

Resolve conflicts in this order:

1. Applicable repository instructions.
2. Actual server-rendered output and HTTP behavior.
3. Current executable source and reachable routes.
4. Current project schemas, content models, and tests.
5. Recent patterns in the same route family.
6. Framework and vendor documentation.

Report conflicts explicitly. Do not copy stale metadata from unreachable pages.

## Indexability inventory

Group routes instead of auditing isolated files:

- Marketing and landing pages.
- Content lists and detail pages.
- User-generated public profiles.
- Parameterized tools or templates.
- Pagination, sorting, filtering, facets, and internal search.
- Authenticated/private pages.
- Legal/static documents.
- Preview, demo, test, staging, and error pages.
- Legacy aliases and redirects.

For each group, document index policy, canonical policy, sitemap inclusion, data freshness, and fallback behavior.

## Common hazards

- Global defaults overwrite dynamic page metadata during navigation.
- Metadata is populated only after client mount.
- Canonical retains tracking, filter, or session query parameters.
- Canonical points to a different locale or non-equivalent page.
- Localized pages emit incomplete or non-reciprocal alternate links.
- Dynamic pages return HTTP 200 with generic fallback content for missing entities.
- Sitemap contains redirected, noindex, private, or nonexistent routes.
- robots.txt blocks resources or pages needed for intended crawling.
- Development or preview hosts emit production canonicals incorrectly, or production accidentally emits preview URLs.
- Open Graph images are relative, inaccessible, or have mismatched MIME/dimensions.
- JSON-LD contains placeholder dates, counts, identities, or URLs.
- Multiple components emit competing canonical or JSON-LD entries.
- Route aliases remain indexable instead of redirecting or canonicalizing consistently.

## Verification methods

Use the methods available in the repository:

- Inspect raw SSR HTML or prerendered HTML, not only the live DOM.
- Request robots.txt and sitemap.xml from the relevant environment.
- Navigate between pages and check tag replacement/deduplication.
- Test representative static, dynamic, localized, missing, and redirected URLs.
- Run framework build/type/lint checks and any SEO-specific tests.
- Use structured-data or rich-result validators when network/tool access is authorized.

Record what was actually verified and what remains an assumption.
