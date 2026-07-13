# Nuxt SEO pattern

Read current project code and installed module versions before applying this pattern. Prefer established project abstractions over introducing new Nuxt SEO modules.

## Discovery map

Inspect:

- `nuxt.config.*`: `ssr`, `app.head`, `site`, modules, route rules, runtime config, robots, sitemap, and i18n.
- `app.vue` and layouts: global `useHead`, `useSeoMeta`, locale head, canonical, and alternate links.
- `pages/` and route middleware: page-specific and dynamic metadata.
- `composables/`, `utils/`, `seo/`, or content config: reusable SEO definitions.
- Server/API/content data paths: whether dynamic metadata is ready during SSR.
- Generated robots and sitemap endpoints.

## Implementation hierarchy

Use the narrowest existing layer:

1. Global immutable defaults in Nuxt app/head or the established site config.
2. Central typed SEO definitions for reusable static routes.
3. `useSeoMeta` or the project's wrapper for reactive page metadata.
4. `useHead` for canonical/alternate links, HTML attributes, or head entries not covered by the wrapper.
5. SSR-capable route data for dynamic titles, descriptions, images, and JSON-LD.
6. Existing robots/sitemap/i18n/JSON-LD modules for crawler endpoints and structured data.

Avoid adding metadata in `onMounted`; crawl-critical values should be available during server rendering. When dynamic API data is required, use the repository's SSR-safe data-fetching pattern and define honest fallbacks for errors or missing entities.

## Reactive metadata

Prefer passing computed/getter values through the project's accepted pattern. Ensure route navigation replaces prior tags instead of accumulating duplicates. When the project maintains a route whitelist or exception mechanism for dynamic pages, update that mechanism rather than letting global defaults overwrite page-owned metadata.

## Canonical and locale links

Derive links from the project's canonical site origin and route locale strategy. Normalize query parameters according to an explicit policy. Do not automatically drop every query: pagination or other parameters may identify intentionally distinct pages.

When using locale-head helpers:

- Preserve generated language and alternate semantics.
- Confirm locale URLs are absolute and reciprocal.
- Avoid post-processing URLs unless the project intentionally removes queries or normalizes aliases.
- Confirm canonical and `hreflang` point to equivalent content.

## Dynamic pages

For a dynamic detail/profile/collection page:

1. Fetch public SEO data during SSR.
2. Compute title, description, share image, canonical URL, and appropriate type from that data.
3. Handle missing entities with the repository's error/status behavior.
4. Emit JSON-LD only from real fields.
5. Ensure stale metadata is cleared when navigating between IDs.
6. Decide whether the route belongs in the sitemap and how URLs are supplied.

## Robots and sitemap

Reuse installed modules and current configuration. Keep these policies consistent:

- Production versus preview/test indexability.
- Disallowed routes versus meta robots directives.
- Sitemap inclusion versus redirects/noindex/private routes.
- Static URLs versus dynamically discovered content URLs.
- Canonical host and protocol.

Do not add timestamps generated at every build unless they truthfully represent content modification under the project's policy.

## JSON-LD

Use the established JSON-LD integration or head API. Select a schema matching visible content. Prefer stable canonical URLs as identifiers. Do not fabricate engagement counts, dates, authors, ratings, or actions. Validate the serialized output and ensure only one owner emits each logical entity.

## ImaStudio reference pattern

ImaStudio demonstrates an established Nuxt architecture:

- Nuxt 3 SSR with central definitions under `seo/`.
- `composables/usePageSeo.ts` maps route names to typed metadata and formats Open Graph/Twitter values.
- `app.vue` applies global route metadata and locale-head output, with an exception mechanism for dynamic page-owned SEO.
- Dynamic pages use SSR-capable data fetching and reactive page metadata.
- Profile pages add JSON-LD through `nuxt-jsonld`.
- `@nuxtjs/i18n`, `@nuxtjs/robots`, and `@nuxtjs/sitemap` own locale links and crawler endpoints.

When working in ImaStudio specifically:

1. Extend `seo/` and `usePageSeo` for reusable static route metadata.
2. Keep dynamic entity metadata near its SSR data owner and respect the global exception/whitelist mechanism.
3. Use the configured canonical site origin and absolute share images.
4. Review robots and sitemap configuration when adding public routes.
5. Verify locale links emitted from `useLocaleHead` and prevent global metadata from overwriting dynamic values.
6. Follow project i18n and TypeScript conventions; do not create a second SEO composable without a distinct need.

Treat these as discovered patterns, not proof that every current implementation is correct. Audit rendered output and flag stale placeholders, inconsistent canonical fields, or fabricated structured-data values instead of copying them.
