# Curve Model Contract

This documents current behavior and invariants. It is not a feature spec.

- Curve time is normalized to `[0, 1]`.
- Editor point moves currently clamp values to `[0, 2]`.
- Non-empty channels should have one start edge owner and one end edge owner.
- Boundary points are not deletable.
- Derived, imported, and procedural points may be materialized before authoring.
- Selected UI state must not persist into document state.
- Document state and UX state are distinct.
