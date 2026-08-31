## 1. Node-group foundation

- [x] 1.1 Add node-group application types, data-file constant, defaults, and public exports
- [x] 1.2 Add pure node-group resolution and dependency utilities with manual, filter, ordering, deduplication, and unresolved-member unit tests
- [x] 1.3 Add the node-group Pinia store with missing-file compatibility, validation, persistence, rename propagation, and dependency-aware deletion tests

## 2. Stable subscription identities

- [x] 2.1 Add focused tests for retaining node IDs across exact config, renamed endpoint, and unique-name subscription refresh cases
- [x] 2.2 Implement layered subscription-node identity reconciliation without silently mutating node-group membership

## 3. Strategy and configuration integration

- [x] 3.1 Add failing generator tests for node-group expansion, overlap deduplication, legacy filters, and empty expansion
- [x] 3.2 Expand `NodeGroup` strategy members during config generation and emit actionable validation errors without runtime node-group outbounds
- [x] 3.3 Preserve safe original node-group references during configuration restoration and add restoration tests
- [x] 3.4 Extend outbound graph validation, display labels, and reference cleanup for missing node groups

## 4. Node-group management UI

- [x] 4.1 Add navigation, localization, and a dedicated node-group list page with create, edit, preview, unresolved, and dependency states
- [x] 4.2 Add searchable manual member selection and dynamic source/filter controls with component tests
- [x] 4.3 Add explicit dependency-aware deletion confirmation and cascade cleanup across profiles
- [x] 4.4 Add per-node “add to node group” actions from subscription node views
- [x] 4.5 Expose node groups as a distinct member source in the strategy-outbound editor

## 5. Outlet and runtime experience

- [x] 5.1 Add a reusable helper that creates or reuses visible selector/urltest strategies for node-group outlet shortcuts, with unit tests
- [x] 5.2 Add node-group outlet choices to final-route and route-rule workflows with explicit manual/automatic behavior
- [x] 5.3 Add applicable node-group and ungrouped view filters to the home node selector without changing runtime selection, with component tests

## 6. Verification

- [x] 6.1 Run focused and full unit/component test suites and resolve regressions
- [x] 6.2 Run TypeScript checking, linting, production build, and OpenSpec validation
