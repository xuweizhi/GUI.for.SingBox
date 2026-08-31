## ADDED Requirements

### Requirement: Users can manage global node groups
The application SHALL provide globally persisted node groups with stable IDs, editable names and icons, and either manual or dynamic membership.

#### Scenario: Create a manual node group
- **WHEN** a user creates a manual node group and selects nodes from one or more subscriptions
- **THEN** the application persists the selected subscription/node identities in that group and makes the group available to every profile

#### Scenario: Create a dynamic node group
- **WHEN** a user selects all or specific subscriptions and supplies include, exclude, or maximum-node conditions
- **THEN** the application persists the conditions and previews the currently matching enabled nodes in deterministic order

### Requirement: Manual membership survives subscription refresh
The application SHALL reconcile refreshed subscription nodes with prior GUI identities using stable configuration and endpoint information before falling back to names.

#### Scenario: Provider renames a node without changing its endpoint
- **WHEN** a subscription refresh changes a node name but retains a uniquely matching endpoint or configuration identity
- **THEN** the application retains the node's GUI ID and its manual node-group memberships

#### Scenario: A selected node can no longer be reconciled
- **WHEN** a manual node-group member is absent after subscription refresh
- **THEN** the application retains the unresolved member reference and shows it as unresolved instead of silently deleting it

### Requirement: Strategy outbounds can reference node groups
The application SHALL allow `selector` and `urltest` strategy outbounds to reference node groups as member sources.

#### Scenario: Generate a strategy containing a node group
- **WHEN** a strategy outbound references a non-empty node group
- **THEN** configuration generation expands the group to ordered leaf node tags, deduplicates overlaps, and emits no separate node-group runtime outbound

#### Scenario: A strategy expands to no members
- **WHEN** all of a strategy outbound's configured member sources resolve to no valid runtime outbound
- **THEN** configuration generation fails with an actionable validation error and does not silently route traffic directly

### Requirement: Users can choose a node group through outlet workflows
The application SHALL let users choose a node group from route and final-outlet workflows by selecting a manual or automatic strategy behavior.

#### Scenario: Choose automatic node-group outlet
- **WHEN** a user chooses a node group as an outlet and selects automatic behavior
- **THEN** the application creates or reuses a visible `urltest` strategy outbound referencing that node group and assigns the route to that strategy

#### Scenario: Choose manual node-group outlet
- **WHEN** a user chooses a node group as an outlet and selects manual behavior
- **THEN** the application creates or reuses a visible `selector` strategy outbound referencing that node group and assigns the route to that strategy

### Requirement: Node groups have a dedicated and dependency-aware UI
The application SHALL expose node groups separately from strategy groups and SHALL show their resolved membership and profile dependencies.

#### Scenario: Manage members from the node-group page
- **WHEN** a user opens a node group
- **THEN** the application provides searchable manual selection or dynamic filter controls, member preview, and unresolved-member diagnostics

#### Scenario: Delete a referenced node group
- **WHEN** a user attempts to delete a node group referenced by one or more strategy outbounds
- **THEN** the application lists affected profiles and strategies and requires explicit confirmation before removing those references

### Requirement: Home node selection can be organized by node group
The application SHALL use applicable node groups as view filters within the active primary strategy's selectable nodes.

#### Scenario: Filter the home node list by group
- **WHEN** a user chooses a node-group filter in the home node selector
- **THEN** the application displays the intersection of that group and the active strategy's nodes without changing the runtime route or current selected node

#### Scenario: Select a node from a filtered list
- **WHEN** a user selects a leaf node after applying a node-group filter
- **THEN** the application switches the existing primary selector to that node using the normal node-switch operation

### Requirement: Existing configurations remain compatible
The application SHALL preserve profiles that use built-in, whole-subscription, individual-node, nested strategy, and legacy include/exclude references.

#### Scenario: Start without node groups
- **WHEN** no node-group data file exists and existing profiles contain no node-group references
- **THEN** profile loading and generated Sing-Box configuration remain behaviorally unchanged

#### Scenario: Restore generated configuration
- **WHEN** configuration restoration can safely match generated leaf members to an original node-group reference
- **THEN** the application preserves the original group reference; otherwise it restores supported explicit subscription or node references without inventing a group
