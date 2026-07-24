---
name: handoff
description: Use when transferring current-session context, decisions, next steps, and relevant references to another agent or session.
---

# Session Handoff

Compact the current conversation into a handoff document.

**Reference:** Based on the `handoff` skill from [mattpocock/skills](https://github.com/mattpocock/skills).

## Process

1.  **Summarize Context**: Briefly explain what was being worked on.
2.  **Key Decisions**: List major decisions made in this session.
3.  **Next Steps**: What should the next agent/session focus on?
4.  **Artifact References**: Link to relevant PRDs, specs, ADRs, or commits. Do not duplicate their content.
5.  **Skill Recommendations**: Suggest which skills the next agent should use.

## Usage

For a requested in-session handoff, write the artifact to `local://handoff-<slug>.md`, where `<slug>` concisely identifies the handoff.

Create a persistent project handoff file only when the user explicitly requests a persistent project artifact.
A manager, teammate, agent, deadline, or assumed convention never substitutes for an explicit user request. Without that request, use the in-session artifact above.

**Note**: Keep the handoff compact. Reference Git and dedicated documentation files rather than reproduce material already represented there.
