import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectShippedSkillFiles,
  validateSkillDocument,
} from "./skill-contract";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const expectedSkillFiles = [
  "packages/omp-audit-agents-md/skills/audit-agents-md/SKILL.md",
  "packages/omp-commit/skills/commit/SKILL.md",
  "packages/omp-dependency-audit/skills/dependency-audit/SKILL.md",
  "packages/omp-migrate-to-agents-md/skills/migrate-to-agents-md/SKILL.md",
  "packages/omp-pr-findings/skills/pr-findings/SKILL.md",
  "skills/grill-with-docs/SKILL.md",
  "skills/handoff/SKILL.md",
  "skills/improve-codebase-architecture/SKILL.md",
];

function skillDocument(name: string, description = "Use when a condition triggers this skill.", body = "") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}

describe("OMP shipped skill contract", () => {
  it("discovers every root and package-local skill using OMP's conventional skills layout", () => {
    const shippedFiles = collectShippedSkillFiles(repositoryRoot).map((path) =>
      relative(repositoryRoot, path),
    );

    expect(shippedFiles).toEqual(expectedSkillFiles);
  });

  it("accepts every checked-in shipped skill", () => {
    const violations = collectShippedSkillFiles(repositoryRoot).flatMap((skillPath) =>
      validateSkillDocument(skillPath, readFileSync(skillPath, "utf8")),
    );

    expect(violations).toEqual([]);
  });

  it("allows canonical OMP SDK references and generic PR approval language", () => {
    const content = skillDocument(
      "pr-findings",
      "Use when reviewing pull-request approval status with @oh-my-pi/pi-coding-agent.",
      "Use @oh-my-pi/pi-coding-agent to inspect generic PR approval language.\n",
    );

    expect(validateSkillDocument("/fixture/skills/pr-findings/SKILL.md", content)).toEqual([]);
  });

  it.each([
    [
      "a name that does not match its directory",
      "/fixture/skills/example/SKILL.md",
      skillDocument("other"),
      "name must match directory",
    ],
    [
      "a non-trigger description",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", "Assess code architecture."),
      "description must begin with 'Use when '",
    ],
    [
      "a first- or second-person description",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", "Use when you need this skill."),
      "description must be third-person trigger-only",
    ],
    [
      "a missing relative reference",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Read [details](MISSING.md).\n"),
      "relative reference does not resolve: MISSING.md",
    ],
    [
      "a legacy Pi command",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Run pi install example.\n"),
      "forbidden Pi command: pi install",
    ],
    [
      "a legacy Pi path",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Read config/.pi/settings.json.\n"),
      "forbidden Pi path: .pi/settings.json",
    ],
    [
      "a legacy Pi dependency scope",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Install @earendil-works/pi-coding-agent.\n"),
      "forbidden Pi dependency scope: @earendil-works/",
    ],
    [
      "an omitted browser distribution artifact",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Load browser-tools before continuing.\n"),
      "forbidden omitted distribution artifact: browser-tools",
    ],
    [
      "an omitted HUD distribution artifact",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Load pi-tui-hud before continuing.\n"),
      "forbidden omitted distribution artifact: pi-tui-hud",
    ],
    [
      "an omitted approval-recorder distribution artifact",
      "/fixture/skills/example/SKILL.md",
      skillDocument("example", undefined, "Load pi-approval-recorder before continuing.\n"),
      "forbidden omitted distribution artifact: pi-approval-recorder",
    ],
  ])("rejects %s", (_caseName, skillPath, content, expectedViolation) => {
    expect(validateSkillDocument(skillPath, content)).toContain(expectedViolation);
  });
});
