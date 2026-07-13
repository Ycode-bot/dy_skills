---
name: project-seo-integrator
description: Scan a web codebase to discover its existing SEO architecture, metadata conventions, SSR or static-rendering behavior, canonical and hreflang handling, robots and sitemap configuration, social sharing metadata, and structured data; then audit, design, or implement SEO changes while preserving repository conventions. Use when asked to add or fix SEO, metadata, title or description, canonical URLs, Open Graph, Twitter cards, JSON-LD or Schema.org, robots.txt, sitemap.xml, hreflang, indexing controls, dynamic-page SEO, multilingual SEO, or to integrate SEO into a project that has no established system.
---

# Project SEO Integrator

Scan before changing. Treat repository instructions, rendered server output, and established project patterns as the source of truth. Do not assume a framework, rendering mode, SEO library, URL policy, locale strategy, or deployment origin.

## Operating contract

Return these sections unless the user requests another format:

1. `Scan Findings`
2. `Implementation Plan`
3. `Patch Draft`
4. `Verification Checklist`

Default to analysis and a patch draft. Modify project files only when the user explicitly asks to implement, integrate, fix, or update SEO.

## Workflow

### 1. Read project instructions

Find and read applicable `AGENTS.md`, `CLAUDE.md`, repository documentation, manifests, framework configuration, lint rules, and deployment notes. Obey the closest-scoped instructions.

### 2. Discover the SEO architecture

Search broadly, then trace imports and rendered behavior. Inspect at least:

- Framework, version, routing model, rendering mode, and deployment target.
- Global head configuration and page-level metadata APIs.
- Central SEO maps, composables, utilities, layouts, middleware, and content schemas.
- Title, description, canonical, robots, Open Graph, Twitter/X cards, and image URL handling.
- Locale routing, `lang`, canonical, alternate links, and `hreflang` behavior.
- Dynamic-page data fetching and whether metadata is available in initial server HTML.
- JSON-LD or Schema.org ownership and data sources.
- robots.txt, sitemap generation, route rules, redirects, and noindex policy.
- Tests, build checks, audits, documentation, and representative production pages.

Read [references/discovery.md](references/discovery.md) while scanning or when signals conflict.

### 3. Classify the repository

Choose exactly one path:

- **Established**: reusable metadata infrastructure, stable URL policy, and repeatable page patterns exist. Reuse them; do not create a parallel SEO layer.
- **Partial**: some SEO exists but a required layer is missing or inconsistent. Extend the smallest missing layer while preserving compatibility.
- **Absent**: no credible SEO foundation exists. Propose a minimal integration before modifying files. Resolve canonical origin, indexable environments, route scope, locale strategy, and content ownership rather than inventing them.

An installed SEO package alone does not prove integration. Confirm reachable usage and inspect initial rendered HTML where possible.

### 4. Build a page contract

For every affected page or route family, normalize the requirement:

| Field | Decision |
|---|---|
| Route | Static, parameterized, filtered, paginated, or localized |
| Search intent | What query and user need the page serves |
| Index policy | index/follow, noindex, canonicalized, redirected, or excluded |
| Title | Unique server-rendered value and fallback |
| Description | Unique concise summary and fallback |
| Canonical | Absolute normalized URL and query policy |
| Alternates | Locale URLs, `hreflang`, and `x-default` policy |
| Social | OG/Twitter type, title, description, image, and URL |
| Structured data | Applicable type, stable identifiers, and truthful fields |
| Data source | Static config, route data, CMS, API, or content file |
| Sitemap | Inclusion, change source, priority policy if the project uses one |
| Verification | Server HTML, crawler endpoints, validator, test, or audit |

Do not generate marketing copy without sufficient page context. Mark assumptions and request product input only when the missing choice materially changes search intent or canonical behavior.

### 5. Validate technical semantics

Check these invariants before designing the patch:

- Metadata needed by crawlers exists in initial HTML for indexable pages.
- Exactly one intended canonical URL is emitted and matches redirect/query policy.
- Indexable pages return meaningful status codes and content; missing entities do not masquerade as successful pages.
- Titles and descriptions are page-specific where the content is distinct.
- Social image and canonical URLs are absolute unless the established framework safely resolves them.
- Locale alternates are reciprocal and point to equivalent content.
- Structured data describes visible, real content and uses stable identifiers.
- robots directives and robots.txt do not contradict sitemap or environment policy.
- Facets, internal search, auth-only pages, previews, test pages, and duplicate route aliases have explicit indexing decisions.
- Client navigation does not leave stale metadata from the previous route.

Do not add obsolete or unsupported metadata merely to increase tag count. Follow current project and framework conventions.

### 6. Design the patch

For established systems:

1. Add or update the nearest central SEO definition or typed metadata source.
2. Reuse the existing formatter/composable and page ownership pattern.
3. Fetch dynamic SEO data in the repository's SSR-safe data path.
4. Add JSON-LD only when a truthful applicable schema and complete data exist.
5. Update robots, sitemap, locale alternates, redirects, and tests only when the route contract requires them.

For absent systems, propose the smallest coherent architecture:

1. Define the canonical site origin by environment.
2. Establish global defaults and per-page overrides.
3. Establish server-rendered metadata for dynamic routes.
4. Define canonical/query normalization and index/noindex policy.
5. Add social metadata and a default share image.
6. Add robots and sitemap handling appropriate to the framework and deployment.
7. Add locale alternates and structured data only when applicable.
8. Implement one representative static page and one representative dynamic page before broad rollout.

Do not install a dependency when the framework's existing head/SEO APIs already satisfy the requirement.

### 7. Verify rendered output

Run the narrowest relevant checks first, then repository lint, type, build, or route tests when proportionate. Verify:

- Initial server HTML contains the intended title, meta, links, and JSON-LD.
- Client navigation updates tags without duplicates or stale values.
- Canonical and alternate URLs are absolute, normalized, reciprocal, and environment-correct.
- robots.txt and sitemap.xml are reachable and consistent with index policy.
- Dynamic routes handle loading, missing data, errors, and fallback metadata correctly.
- JSON-LD parses and reflects visible content.
- Redirect aliases resolve to the canonical route.
- Preview/test environments are not accidentally indexable.

Prefer inspecting generated HTML or HTTP responses over trusting component source alone. Do not expose credentials, private URLs, or personal data in verification output.

## Patch rules

- Follow existing naming, types, module boundaries, formatting, and localization strategy.
- Prefer a centralized SEO source plus thin page integration over repeated literal tags.
- Keep metadata deterministic and server-safe; avoid browser-only sources for crawl-critical values.
- Do not hardcode a production origin when the repository has environment-aware site configuration.
- Do not add fake ratings, counts, dates, authors, or other structured-data fields.
- Do not index private, authenticated, internal-search, preview, or test content without explicit project policy.
- Do not claim completion until rendered output and crawler endpoints have been checked or the inability to check them is reported.

## Framework references

- For Nuxt projects, especially those using `useSeoMeta`, `useHead`, `@nuxtjs/i18n`, `@nuxtjs/robots`, `@nuxtjs/sitemap`, or `nuxt-jsonld`, read [references/nuxt-pattern.md](references/nuxt-pattern.md).
- Use [references/discovery.md](references/discovery.md) for framework-neutral scanning, requirement extraction, and audit hazards.
