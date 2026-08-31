## Why

The application currently combines node organization with Sing-Box `selector` and `urltest` strategy outbounds, so reusable sets such as “Hong Kong nodes” must be rebuilt in every strategy group and are easy to confuse with routing policies. A first-class GUI node-group layer will let users organize subscription nodes once, reuse those groups across profiles, and choose a group as an outlet without hiding the required selection policy.

## What Changes

- Add global node groups with manual membership and dynamic subscription/filter membership.
- Preserve node-group membership across subscription refreshes with stable node identity reconciliation and visible unresolved-member diagnostics.
- Let profile strategy outbounds reference node groups; expand and deduplicate those references when generating Sing-Box configuration without emitting node groups as runtime outbounds.
- Add a dedicated node-group management page, per-node “add to node group” actions, member preview, dependency reporting, and safe deletion.
- Let users choose a node group from route/final-outlet workflows by creating or reusing an explicit `selector` or `urltest` strategy outbound.
- Organize the home node picker by node group while keeping group selection a view filter rather than a routing mutation.
- Preserve existing profiles, whole-subscription references, individual-node references, and legacy outbound include/exclude behavior.

## Capabilities

### New Capabilities

- `node-groups`: Global reusable node collections, stable membership resolution, strategy-outbound expansion, outlet shortcuts, management UI, and runtime node-picker organization.

### Modified Capabilities

None.

## Impact

- Frontend application types, Pinia stores, migrations, subscription refresh reconciliation, and data-file constants.
- Profile outbound editing, route policy editing, home node selection, routing overview, and navigation/localization.
- Sing-Box configuration generation and restoration logic.
- Unit, component, and integration tests for persistence, resolution, configuration generation, subscription refresh, and UI behavior.
- Adds `data/node-groups.yaml`; no Sing-Box core changes or new runtime dependencies are required.
