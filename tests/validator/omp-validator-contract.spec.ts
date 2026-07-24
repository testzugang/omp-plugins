import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const validatorPath = join(repositoryRoot, "scripts/validate-package.mjs");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createFixture(packageJson: object = {
  name: "fixture",
  omp: { extensions: ["./extensions/example"] },
}): string {
  const root = mkdtempSync(join(tmpdir(), "omp-validator-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  mkdirSync(join(root, "extensions", "example"), { recursive: true });
  return root;
}

function createSkill(root: string, name: string, content: string) {
  const skillDirectory = join(root, "skills", name);
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(join(skillDirectory, "SKILL.md"), content);
}

function createPublicPackage(root: string, files: string[]) {
  const packageDirectory = join(root, "packages", "example");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/package",
        files,
        publishConfig: { access: "public" },
      },
      null,
      2,
    )}\n`,
  );
  return packageDirectory;
}

function runValidator(root: string, skillsOnly = false) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [validatorPath, ...(skillsOnly ? ["--skills-only"] : [])],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { exitCode: 0, output: stdout };
  } catch (error: unknown) {
    if (error && typeof error === "object") {
      const status =
        "status" in error && typeof error.status === "number" ? error.status : 1;
      const stdout =
        "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr =
        "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      return { exitCode: status, output: `${stdout}${stderr}` };
    }
    return { exitCode: 1, output: "" };
  }
}

describe("OMP static artifact validator", () => {
  it("accepts the checked-in workspace in normal and skills-only modes", () => {
    expect(runValidator(repositoryRoot)).toMatchObject({ exitCode: 0 });
    expect(runValidator(repositoryRoot, true)).toMatchObject({ exitCode: 0 });
  });

  it("rejects a legacy pi manifest key", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      pi: { extensions: ["./extensions/example"] },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("package.json: legacy 'pi' key is not allowed");
  });

  it("rejects a missing OMP extension target", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/missing"] },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: omp.extensions target does not exist: ./extensions/missing",
    );
  });

  it("rejects the legacy pi-package keyword", () => {
    const root = createFixture({
      name: "fixture",
      keywords: ["pi-package"],
      omp: { extensions: ["./extensions/example"] },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("package.json: legacy 'pi-package' keyword is not allowed");
  });

  it("rejects a legacy dependency scope key", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      dependencies: { "@earendil-works/pi-coding-agent": "^1.0.0" },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: dependencies contains legacy Pi dependency '@earendil-works/pi-coding-agent'",
    );
  });

  it("rejects a legacy dependency scope in an npm alias specifier", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      dependencies: { codingAgent: "npm:@earendil-works/pi-coding-agent@^1.0.0" },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: dependencies contains legacy Pi dependency reference 'npm:@earendil-works/pi-coding-agent@^1.0.0'",
    );
  });

  it("rejects a legacy Pi scope import target", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      imports: { "#coding-agent": "@earendil-works/pi-coding-agent" },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: imports contains legacy Pi import target '@earendil-works/pi-coding-agent'",
    );
  });

  it("rejects an external TypeBox dependency key", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      dependencies: { "@sinclair/typebox": "^0.34.0" },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: dependencies contains external TypeBox dependency '@sinclair/typebox'",
    );
  });

  it("rejects an external TypeBox npm alias specifier", () => {
    const root = createFixture({
      name: "fixture",
      omp: { extensions: ["./extensions/example"] },
      dependencies: { typebox: "npm:@sinclair/typebox@^0.34.0" },
    });

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "package.json: dependencies contains external TypeBox reference 'npm:@sinclair/typebox@^0.34.0'",
    );
  });

  it("rejects invalid skill metadata", () => {
    const root = createFixture();
    createSkill(
      root,
      "example",
      "---\nname: other\ndescription: Use when a metadata contract is invalid.\n---\n",
    );

    const result = runValidator(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "skills/example/SKILL.md: name 'other' does not match directory 'example'",
    );
  });

  it("rejects a missing relative skill link target", () => {
    const root = createFixture();
    createSkill(
      root,
      "example",
      "---\nname: example\ndescription: Use when a relative reference must resolve.\n---\n[More](MISSING.md)\n",
    );

    const result = runValidator(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "skills/example/SKILL.md: relative reference does not exist: MISSING.md",
    );
  });

  it("rejects a .pi reference in a shipped skill", () => {
    const root = createFixture();
    createSkill(
      root,
      "example",
      "---\nname: example\ndescription: Use when it needs an OMP-aware example.\n---\nRead .pi/settings.json before proceeding.\n",
    );

    const result = runValidator(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("skills/example/SKILL.md: forbidden Pi reference '.pi/settings.json'");
  });

  it("rejects .pi as a nested path component in a shipped skill", () => {
    const root = createFixture();
    createSkill(
      root,
      "example",
      "---\nname: example\ndescription: Use when nested paths need OMP-aware examples.\n---\nRead config/.pi/settings.json before proceeding.\n",
    );

    const result = runValidator(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("skills/example/SKILL.md: forbidden Pi reference '.pi/settings.json'");
  });

  it("rejects .pi as an absolute path component in a shipped skill", () => {
    const root = createFixture();
    createSkill(
      root,
      "example",
      "---\nname: example\ndescription: Use when absolute paths need OMP-aware examples.\n---\nRead /project/.pi/settings.json before proceeding.\n",
    );

    const result = runValidator(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("skills/example/SKILL.md: forbidden Pi reference '.pi/settings.json'");
  });

  it("rejects a public files allowlist that omits a shipped resource", () => {
    const root = createFixture();
    const packageDirectory = createPublicPackage(root, ["README.md"]);
    mkdirSync(join(packageDirectory, "extensions"), { recursive: true });
    writeFileSync(join(packageDirectory, "extensions", "index.ts"), "export {};\n");

    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "packages/example: files allowlist omits shipped resource: extensions/index.ts",
    );
  });

  it("rejects test and cache paths in a public files allowlist", () => {
    const root = createFixture();
    const packageDirectory = createPublicPackage(root, ["extensions", "tests", ".cache"]);
    mkdirSync(join(packageDirectory, "extensions"), { recursive: true });
    mkdirSync(join(packageDirectory, "tests"), { recursive: true });
    mkdirSync(join(packageDirectory, ".cache"), { recursive: true });
    writeFileSync(join(packageDirectory, "extensions", "index.ts"), "export {};\n");
    writeFileSync(join(packageDirectory, "tests", "example.spec.ts"), "");
    writeFileSync(join(packageDirectory, ".cache", "state"), "");
    writeFileSync(join(packageDirectory, "extensions", "test_validator.py"), "");


    const result = runValidator(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(
      "packages/example: files allowlist must exclude test/cache artifact: tests",
    );
    expect(result.output).toContain(
      "packages/example: files allowlist must exclude test/cache artifact: .cache",
    );
    expect(result.output).toContain(
      "packages/example: files allowlist includes test/cache artifact: extensions/test_validator.py",
    );
  });
});
