import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const omittedDistributionArtifacts = [
  "browser-tools",
  "pi-tui-hud",
  "bash-approval-manager",
  "pi-approval-recorder",
];

function childDirectories(path: string): string[] {
  if (!existsSync(path)) return [];

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function relativeMarkdownReferences(content: string): string[] {
  const references: string[] = [];
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

  for (const match of content.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/[ \t]+/, 1)[0].split(/[?#]/, 1)[0];

    if (
      target === "" ||
      target.startsWith("#") ||
      target.startsWith("//") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
    ) {
      continue;
    }

    references.push(target);
  }

  return references;
}

function frontmatterField(content: string, fieldName: string): string | undefined {
  const frontmatter = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return undefined;

  const field = frontmatter[1].match(
    new RegExp(`^${fieldName}:[ \\t]*(.*)$`, "m"),
  );
  if (!field) return undefined;

  const value = field[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function collectShippedSkillFiles(repositoryRoot: string): string[] {
  const roots = [resolve(repositoryRoot, "skills")];
  const packagesDirectory = resolve(repositoryRoot, "packages");
  for (const packageName of childDirectories(packagesDirectory)) {
    roots.push(resolve(packagesDirectory, packageName, "skills"));
  }

  return roots
    .flatMap((skillsDirectory) =>
      childDirectories(skillsDirectory).map((skillName) =>
        resolve(skillsDirectory, skillName, "SKILL.md"),
      ),
    )
    .sort();
}

export function validateSkillDocument(skillPath: string, content: string): string[] {
  const violations: string[] = [];
  const name = frontmatterField(content, "name");
  const description = frontmatterField(content, "description");
  const skillDirectory = dirname(skillPath);

  if (!name) violations.push("missing name");
  if (!description) violations.push("missing description");
  if (name && name !== basename(skillDirectory)) {
    violations.push("name must match directory");
  }
  if (description && !description.startsWith("Use when ")) {
    violations.push("description must begin with 'Use when '");
  }
  if (
    description &&
    /\b(?:i|me|my|we|our|you|your)\b/i.test(
      description.replace(/@oh-my-pi\/pi-[a-z0-9-]+/gi, ""),
    )
  ) {
    violations.push("description must be third-person trigger-only");
  }

  for (const reference of relativeMarkdownReferences(content)) {
    if (!existsSync(resolve(skillDirectory, reference))) {
      violations.push(`relative reference does not resolve: ${reference}`);
    }
  }

  const piCommand = content.match(/\bpi\s+(?:install|update|plugin|reload)\b|\/reload\b/i);
  if (piCommand) violations.push(`forbidden Pi command: ${piCommand[0]}`);

  const piPath = content.match(/(?:^|[\\/])(\.pi(?:[\\/][^\s"'`()\]]+)?)\b/im);
  if (piPath) violations.push(`forbidden Pi path: ${piPath[1]}`);

  if (/@earendil-works\//i.test(content)) {
    violations.push("forbidden Pi dependency scope: @earendil-works/");
  }

  for (const artifact of omittedDistributionArtifacts) {
    if (new RegExp(`\\b${artifact}\\b`, "i").test(content)) {
      violations.push(`forbidden omitted distribution artifact: ${artifact}`);
    }
  }

  return violations;
}
