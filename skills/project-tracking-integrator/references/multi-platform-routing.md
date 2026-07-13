# Multi-platform event routing

Use this reference whenever a repository contains multiple analytics or advertising platforms.

## Separate inventory from routing

Maintain two independent models:

1. **Platform inventory**: what SDKs, containers, transports, and wrappers are installed and reachable.
2. **Event routing**: which platforms a specific business event must reach.

Never infer event routing from installation alone.

## Target states

Assign every relevant platform one explicit state per business event:

- `required`: implement and verify the event for this platform.
- `optional`: supported or potentially useful, but not required by the current request.
- `disabled`: explicitly exclude this platform.
- `unknown`: requirement and project policy are insufficient; resolve before implementation when it materially changes the patch.

Example contract:

```yaml
business_event: subscription_purchase_success
trigger: confirmed_payment_success
targets:
  sensors: required
  ga4: required
  google_ads: optional
deduplication_key: order_id
```

## Resolution order

Resolve each target using:

1. Explicit product/data requirement.
2. Repository event-routing policy or event catalog.
3. Reachable analogous events in the same business funnel.
4. Platform role and documented business objective.
5. User clarification when ambiguity changes implementation.

Do not silently change `unknown` to `required`. In particular, do not dual-report only because Sensors and GA/GTM coexist.

## Routing matrix

| Installed systems | Event requirement | Action |
|---|---|---|
| Product analytics only | Unspecified | Use the established product-analytics path |
| GA/GTM only | Unspecified | Use the established Google path |
| Both | Explicit dual report | Implement both from one business trigger |
| Both | Product analytics only | Implement only product analytics |
| Both | GA/GTM only | Implement only GA/GTM |
| Both | Unspecified | Inspect policy and analogues; otherwise report `unknown` |
| Neither | Platform specified | Propose or build only the specified foundation |
| Neither | Platform unspecified | Do not choose a vendor; surface the decision |

## One trigger, separate payloads

For a multi-target event:

1. Identify one semantic business trigger.
2. Derive shared business context once.
3. Map that context into a platform-specific payload for each required target.
4. Invoke established platform wrappers from the same owner or an established orchestration wrapper.
5. Isolate analytics failures from the business action and from other targets.

Do not force all platforms into one lowest-common-denominator payload. The same purchase may map to an internal payment event for product analytics, GA4 `purchase`, and a separate Google Ads conversion. Preserve each contract's event names, required fields, units, and privacy policy.

## Google platform distinctions

Do not treat these as synonyms:

- **GA4**: analytics event model and reporting.
- **GTM**: tag orchestration; a `dataLayer` event may trigger GA4, Google Ads, or other tags.
- **Google Ads**: advertising conversion destination and attribution requirements.
- **gtag.js**: direct Google tag API that can configure or emit to one or more destinations.

Determine whether application code should push a neutral `dataLayer` event or call `gtag` directly by following the project's established architecture. Avoid emitting both when GTM already transforms the data-layer event into the same destination event.

## Deduplication

Check duplication at four levels:

- UI: repeated handlers, remounts, watchers, or double clicks.
- Business flow: retries, callbacks, polling, and duplicate success notifications.
- Application transport: both direct SDK call and orchestration wrapper.
- Tag configuration: one `dataLayer` event activating multiple overlapping tags.

Use stable business identifiers where supported, such as transaction/order IDs for purchases. Do not invent identifiers or rely only on timestamps for business conversions.

## Identity and privacy

Map identity per platform and consent policy. Do not send raw email, phone, access tokens, free-form user content, or other personal data merely because another platform already receives a user identifier. Respect opt-out/consent state consistently without assuming all SDKs share the same consent mechanism.

## Verification matrix

Verify every `required` target independently:

| Target | Typical evidence |
|---|---|
| Product analytics | SDK debug output or vendor network request |
| GA4 | DebugView, tag assistant, or GA collection request |
| GTM | Preview mode showing data-layer event, variables, triggers, and fired tags |
| Google Ads | Conversion tag diagnostics and stable conversion identifiers |

Also verify that `optional` and `disabled` targets do not fire unexpectedly. Report verification limitations rather than claiming successful dual reporting from source inspection alone.
