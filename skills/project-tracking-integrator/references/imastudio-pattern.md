# ImaStudio tracking pattern

Use this as a project-specific reference, not as a universal default.

## Established architecture

- Framework: Nuxt 3, Vue 3, TypeScript.
- SDK: `@joyme/sensors-data`.
- Initialization: `plugins/sensor.ts` initializes the SDK on the client, registers global properties, and handles login/logout identity.
- Global SDK handle: `window.KEWLSensors` and Nuxt injection.
- Transport: `lib/track/index.ts` exports `track(event, options)` with a client and SDK guard.
- Primary business event: `ima_function_click`; payment flows may use `ima_pay_event`.
- Required base properties: `f_page`, `btn_position`, `btn_name`.
- Business wrappers: exported `trackXxx` functions under `lib/track/*.ts`.
- Call sites: pages, components, composables, or stores owning the actual trigger.
- Google routing: GA/GTM events use dedicated wrappers such as `lib/track/gaPurchase.ts` and `lib/track/gaMidFunnel.ts`, which push platform-specific payloads to `window.dataLayer`; `lib/track/gtag.ts` reads GA identifiers when required.

Do not introduce direct `window.KEWLSensors.track` calls in feature code. Add or update a typed `trackXxx` wrapper and call it from the trigger owner.

Do not use an automation-side `window.KEWLSensors === undefined` result as proof that this client plugin failed. Browser extensions and automation surfaces may evaluate in an isolated JavaScript world that cannot see page-owned globals. After the app is interactive, treat an unreadable handle as `NOT_AVAILABLE`, continue the authorized trigger, and verify ingestion with the environment-isolated Sensors query. Do not require SDK identity discovery for this verification.

Do not assume every ImaStudio event is dual reported. Treat Sensors and Google targets independently. A business event may be Sensors-only, GA/GTM-only, or explicitly dual-targeted. For dual-target events, keep one business trigger, call the established wrappers for both targets, and preserve their distinct schemas.

## Semantic policy

Before adding or modifying an event, read `docs/tracking-map/protocols/positioning.md`.

Track:

- User-initiated clicks, input, drag, submit, navigation, and explicit close actions.
- Business-critical state transitions such as registration, payment, or task completion.
- Events that support a defined funnel, cohort, conversion, or documented business question.

Do not track through the business-event layer:

- DOM measurements, framework state changes, mounts, or rendering side effects.
- Performance and Web Vitals; use the project's performance tooling.
- Errors; use Sentry/logging.
- Automatic dialog dismissal unless a documented requirement overrides the policy.

If a new event overlaps an existing user path, read and update `docs/tracking-map/protocols/bridging.md`. Preserve cross-event join keys described by `docs/tracking-map/protocols/join-keys.md`.

## Implementation shape

Use typed property contracts and stable enum values. A typical wrapper follows this shape:

```ts
interface TrackDiscountPopupParams {
    f_page: 'community'
    btn_position: 'ai-creation' | 'canvas-editor'
    btn_name: 'discount_popup_show' | 'discount_popup_claim_click' | 'discount_popup_close_click'
}

export function trackDiscountPopup(params: TrackDiscountPopupParams) {
    track('ima_function_click', params)
}
```

Treat the example as illustrative. Reuse local naming and type patterns in the nearest related module. Derive `btn_position` from the actual page containing the dialog, as required by the data definition; do not freeze it at the dialog component name.

Place the call at the exact semantic trigger:

- `show`: after the dialog is genuinely open/visible, guarded against repeated reactive emissions.
- `claim_click`: in the enabled CTA handler, once per user click.
- `close_click`: only in the explicit top-right close handler, not generic teardown or programmatic close paths.

## Mandatory synchronization

The tracking map is a business-journey SSoT. When changing `lib/track/`:

1. New `trackXxx`: add a node row to the relevant `docs/tracking-map/pages`, `dialogs`, or `modules` file and update `modules/track-functions-index.md` when required by current repository rules.
2. Changed fields: update the corresponding node table and catalogs.
3. Deleted wrapper: search all map references and confirm no dependent business identifier remains.
4. New page/dialog: copy `docs/tracking-map/_template.md`.
5. Cross-event overlap: update `protocols/bridging.md`.
6. Keep any external event catalog synchronized when the repository links to one.

Run the repository commands currently defined in `package.json`, including the tracking-map check in strict mode when available, plus targeted lint/type checks. Read the current scripts rather than assuming command names.

For Google-targeted events, also verify the exact `dataLayer` payload or `gtag` call, guard against duplicate firing through GTM, and preserve GA-specific units such as major currency units and stable transaction identifiers. Do not infer that a Google event belongs in the Sensors tracking map unless repository rules explicitly require cross-platform documentation there.

## Review checklist

- The event represents user intent or a critical business transition.
- `f_page`, `btn_position`, and `btn_name` exactly match the agreed data schema.
- Dynamic page location is taken from a stable route/scene mapping.
- The wrapper is typed and uniquely named.
- The call site is reachable and owns the trigger.
- Exposure and close events have explicit deduplication semantics.
- Tracking failure cannot block the business action.
- Tracking map, function index, and catalogs agree with code.
- Existing tracking-map validation passes.
- Event routing states which targets are required and why.
- GA/GTM payloads use their own event contracts rather than Sensors field names.

## Sensors ingestion verification

ImaStudio's client configuration uses a Sensors `server_url` ending in `/sa?project=AiProduct`. Treat it only as the ingestion endpoint. Do not derive `/api/sql/query`, API_SECRET, or query permissions from it.

For post-release QA, read [sensors-verification.md](sensors-verification.md), normalize the relevant tracking-map row into a contract, and run `scripts/verify-sensors-events.mjs`. Because most business actions share `ima_function_click`, set `match.btn_name` for every contract. Add another stable selector only when the data requirement needs it.

Example for `trackDiscountOfferClaim`:

```json
{
  "version": 2,
  "events": [
    {
      "id": "discount-popup-claim-click",
      "trigger": "用户点击可用的优惠弹窗领取按钮",
      "deduplication": { "minCount": 1, "maxCount": 1 },
      "targets": {
        "sensors": {
          "status": "required",
          "event": "ima_function_click",
          "wrapper": "trackDiscountOfferClaim",
          "match": { "btn_name": "discount_popup_claim_click" },
          "properties": {
            "f_page": { "type": "string", "equals": "community" },
            "btn_position": { "type": "string", "oneOf": ["ai-creation", "canvas-editor"] },
            "btn_name": { "type": "string", "equals": "discount_popup_claim_click" }
          }
        }
      }
    }
  ]
}
```

Filter live verification with the event name, stable match fields, a short time window, and the test environment's confirmed Sensors query project. Use `distinct_id` only as an optional extra filter when the user explicitly requests a known identity. Update the tracking-map status only after the query succeeds and the returned event satisfies the contract. Record query failure separately from zero matching events.

Because ImaStudio local, QA, and production currently share the same Sensors project, every live verification query must also filter the common URL property. Use the actual browser host such as `localhost:3000` for local, `qa.imastudio.com` before release, and `www.imastudio.com` for the post-release smoke check. Query values never include protocol or path. The verifier maps this to `lmweb_url LIKE '%<host-or-host:port>%'`. Do not combine environments in one count.
