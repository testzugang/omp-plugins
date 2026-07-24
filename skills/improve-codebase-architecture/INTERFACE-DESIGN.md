# Interface Design

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this parallel task pattern. Based on "Design It Twice" (Ousterhout) — your first idea is unlikely to be the best.

Uses the vocabulary in [LANGUAGE.md](LANGUAGE.md) — **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before dispatching design tasks, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints — not a proposal, just a way to make the constraints concrete

Show this to the user, then immediately proceed to Step 2. The user reads and thinks while the design tasks work in parallel.

### 2. Dispatch independent designs

Dispatch 3+ independent conceptual design tasks together in one `task` call containing a `tasks[]` batch. Each task must produce a **radically different** interface for the deepened module. For every conceptual design item, omit the `agent` field so OMP uses its default general-purpose task executor; these are design tasks, not read-only scouts.

Prompt each task with a separate technical brief (file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1. Give each task a different design constraint:

- Design 1: "Minimize the interface — aim for 1–3 entry points max. Maximise leverage per entry point."
- Design 2: "Maximise flexibility — support many use cases and extension."
- Design 3: "Optimise for the most common caller — make the default case trivial."
- Design 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Use `agent: "scout"` only for supplemental read-only research, never for conceptual interface design. If a scout is needed, dispatch it as an independent item in the same `tasks[]` batch and require its brief to name the target and questions, report observations only, and explicitly prohibit edits, implementation, tests, formatters, linters, and project-wide commands.

Include both [LANGUAGE.md](LANGUAGE.md) vocabulary and CONTEXT.md vocabulary in every design-task brief so each design names things consistently with the architecture language and the project's domain language.

**Clean Code Alignment**: Direct the design tasks to adhere to the "Deep Modules vs. Classic Clean Code" synthesis in [LANGUAGE.md](LANGUAGE.md). Specifically, they must design interfaces that eliminate temporal coupling and provide absolute clarity on mutability and side effects.

Each design task outputs:

1. Interface (types, methods, params — plus invariants, ordering, error modes, and temporal coupling prevention)
2. Usage example showing how callers use it (asserting clean, self-documenting code at the call site)
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs — where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated — the user wants a strong read, not a menu.
