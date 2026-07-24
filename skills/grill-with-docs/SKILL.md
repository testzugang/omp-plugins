---
name: grill-with-docs
description: Use when reviewing a plan against an existing project's domain model, CONTEXT.md, CONTEXT-MAP.md, or ADRs.
---

# Grill with Docs

Specialized grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (`CONTEXT.md`, ADRs) inline as decisions crystallize.

**Reference:** Based on the `grill-with-docs` skill from [mattpocock/skills](https://github.com/mattpocock/skills).

## Process

1. **Discover Documentation and Code Conditionally**:
   - Use `glob` to check whether `CONTEXT.md`, `CONTEXT-MAP.md`, and `docs/adr/` are present. Their absence is valid: do not create any of them merely because this skill is loaded.
   - Use `read` to examine each document that exists. If `CONTEXT-MAP.md` exists, use it to locate the relevant context before reading that context's glossary.
   - Use `grep` for targeted vocabulary, decision, and symbol searches across the discovered documentation and relevant code; use `glob` then `read` to inspect the matching code in context.
   - Only when independent read-only investigation would materially reduce uncertainty, dispatch exactly one `task` call with a single `tasks[]` batch. Every task MUST use `agent: "scout"` and its brief MUST forbid edits, implementation, tests, formatters, linters, and project-wide commands. Otherwise, investigate directly with `glob`, `read`, and `grep`.
2. **Interview Relentlessly**: Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
3. **Challenge against the Glossary**: If a term conflicts with an existing `CONTEXT.md`, call it out immediately.
4. **Sharpen Fuzzy Language**: Propose precise canonical terms (e.g., "Customer" vs "User").
5. **Cross-reference with Code**: Verify if the code agrees with the stated plan.
6. **Update Inline**: When a glossary or domain decision crystallizes, update the existing `CONTEXT.md` inline rather than deferring it. Only offer and create an ADR inline when it meets every ADR criterion below; never create `CONTEXT.md`, `CONTEXT-MAP.md`, or an ADR merely as discovery setup.

## Documentation Formats

- [ADR Format](ADR-FORMAT.md)
- [Context/Glossary Format](CONTEXT-FORMAT.md)

## ADR Criteria

Only offer to create an ADR when all three are true:

1.  **Hard to reverse** — high cost of changing later.
2.  **Surprising without context** — future readers will wonder "why?".
3.  **Real trade-off** — there were genuine alternatives.

## Red Flags

- "We can fix the terminology later" -> No, sharpen it now.
- "I'll update CONTEXT.md at the end" -> No, update it inline.
- Creating ADRs for obvious or easily reversible decisions.
