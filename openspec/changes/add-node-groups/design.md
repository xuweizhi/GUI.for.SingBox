## Context

GUI.for.SingBox already models Sing-Box `selector` and `urltest` outbounds as profile-scoped strategy groups. Those outbounds can reference a whole subscription, a specific subscription node, a built-in target, or another strategy group. Subscription nodes are global resources, but reusable node collections do not exist; each strategy group repeats its own membership and filtering rules.

The reference implementations use groups as runtime outbounds. v2rayA stores manually selected members per outbound and turns multi-member groups into balancers. SingBoxHeadless stores manual or filtered members together with a `selector`/`urltest` type and emits the group directly. Copying either model would duplicate this project's existing strategy-outbound layer, so the new layer must remain an organizational resource that is expanded before runtime configuration is emitted.

## Goals / Non-Goals

**Goals:**

- Provide global node groups reusable by multiple profiles and strategy outbounds.
- Support explicit manual membership and dynamic subscription/filter membership.
- Keep manual memberships stable across subscription refreshes and expose unresolved members.
- Allow strategy outbounds to consume node groups without emitting a separate node-group runtime outbound.
- Make choosing a node group as an outlet convenient while retaining an explicit, manageable selection policy.
- Organize the home node picker with node-group filters without changing routing merely by changing a filter.
- Preserve all existing profile and subscription behavior when no node groups are configured.

**Non-Goals:**

- Node-group nesting.
- Treating node groups as direct Sing-Box routing targets.
- Persisted health-based membership or automatically removing temporarily failed nodes.
- Inferring node groups from imported plain Sing-Box configuration.
- Replacing existing whole-subscription, specific-node, or strategy-group references.

## Decisions

### Store node groups globally

Node groups are stored in `data/node-groups.yaml` and managed by a dedicated Pinia store. They are global because subscriptions and their node identities are global, and the primary value is reuse across profiles. A profile references a group by stable group ID.

Embedding groups inside profiles was rejected because it would duplicate the same organizational set in every profile and make subscription-node actions dependent on the active profile.

### Keep node groups as pure collections

A node group contains identity, presentation, and membership rules only. It has no `selector`/`urltest` type, selected node, test URL, or routing role. Strategy behavior remains in `App.Outbound`.

The model is:

```ts
type NodeGroupMember = {
  subscription_id: string
  node_id: string
  last_known_tag: string
}

type NodeGroup = {
  id: string
  name: string
  icon: string
  mode: 'manual' | 'filter'
  members: NodeGroupMember[]
  source_scope: 'all' | 'selected'
  subscription_ids: string[]
  include: string
  exclude: string
  max_nodes: number
}
```

Groups cannot reference other groups. This prevents a second dependency graph and keeps cycle handling confined to strategy outbounds.

### Add an explicit strategy-member reference

The existing `App.Proxy` representation gains `type: 'NodeGroup'`, with `id` holding the group ID and `tag` holding the last known group name for display. Existing serialized member shapes remain valid.

A central asynchronous resolver returns ordered resolved nodes and issues. Configuration generation expands each node-group member at its position, applies the strategy outbound's existing include/exclude filter as a final compatibility filter, registers leaf outbounds once, and deduplicates runtime tags while preserving first occurrence order. No node-group object is emitted to Sing-Box.

Restoration preserves an original node-group reference when its resolved runtime members are still represented; otherwise it falls back to existing subscription or individual-node restoration.

### Reconcile subscription identities before resolving memberships

Subscription metadata IDs are currently retained primarily by matching tags. Refresh reconciliation will prefer, in order:

1. an existing deterministic/exact identity match;
2. a canonical outbound fingerprint excluding mutable presentation fields such as `tag`;
3. a unique protocol/server/port endpoint match;
4. a unique tag match.

Reused identities retain the old GUI node ID. A manual node-group member that still cannot resolve remains serialized and is reported as unresolved rather than silently removed. Explicit subscription deletion performs dependency-aware cleanup only after user confirmation.

### Make outlet selection an explicit strategy shortcut

Routes and the final outlet cannot point directly to a collection because Sing-Box needs a single outbound. The UI offers node groups alongside normal outlet choices as a shortcut. Selecting one requires `selector` or `urltest`; the application creates or reuses a visible strategy outbound containing exactly that node-group reference and then assigns the route/final outlet to the strategy outbound ID.

Generated strategy outbounds receive a stable GUI role of `custom`, a source marker linking them to the group, and a user-visible label such as `<group name> · 自动选择`. They remain editable and are never hidden.

### Give node groups a dedicated management surface

The navigation gains a `/node-groups` page after subscriptions. It provides cards, manual member selection, dynamic source/filter controls, live resolution preview, unresolved-member warnings, dependency counts, and safe deletion. Subscription node views expose “加入节点组” for fast manual membership.

Strategy editing lists node groups as a distinct member source rather than mixing them into subscriptions. Renames update display snapshots but references rely only on IDs.

### Use node groups as home-picker filters only

The home node selector intersects resolved node-group runtime tags with the active primary strategy group's runtime members. It exposes `全部`, applicable node groups, and `未分组`. Changing this filter does not call the Clash API or change the active strategy. Choosing a leaf node continues to switch the existing primary selector.

### Validate dependencies and empty expansion

Group IDs must be unique; names need not be. Filters must compile, selected source subscriptions must exist, and `max_nodes` cannot be negative. Duplicate resolved members are removed deterministically.

Deleting a referenced node group is blocked until the user explicitly confirms removal from all affected strategy outbounds. A strategy whose members expand to zero remains invalid and prevents config generation/startup; it never falls back to `direct`.

## Risks / Trade-offs

- **[Node identity is not intrinsically stable across arbitrary provider rewrites]** → Layer fingerprint, endpoint, and unique-name matching; retain unresolved references for manual repair.
- **[Global groups can reference subscriptions absent on another installation]** → Surface unresolved sources and include node groups in data-directory backup; plain profile export keeps explicit dependency warnings.
- **[Large dynamic groups require reading subscription files]** → Cache each subscription parse for one resolution/generation pass and operate on lightweight subscription metadata for ordinary previews when possible.
- **[Legacy outbound filters can further narrow node-group membership]** → Preserve this for compatibility and label outbound filters as an advanced final filter.
- **[Automatic outlet creation can produce redundant strategies]** → Reuse a strategy with the same generated source marker and selection type; keep it visible so users can understand and edit the result.
- **[Source restoration cannot infer lost organizational intent]** → Preserve original references only when safely matched; otherwise degrade to explicit leaf/subscription references without inventing groups.

## Migration Plan

1. Missing `data/node-groups.yaml` is treated as an empty group list and is not an error.
2. Existing profiles load unchanged. `NodeGroup` member references are additive and require no rewrite of older members.
3. Subscription refresh begins using enhanced ID reconciliation; existing IDs remain preferred and are not regenerated unnecessarily.
4. Existing outbound `include`/`exclude` fields and subscription references remain supported.
5. Rollback consists of removing node-group references from profiles or restoring the data directory. Older builds will not understand `NodeGroup` members, so the implementation must not write such references until the user explicitly adds a group to a strategy.
