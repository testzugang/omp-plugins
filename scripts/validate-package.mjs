import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const skillsOnly = process.argv.includes("--skills-only");
const workspaceRoot = process.cwd();
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const forbiddenSkillReferences = [
  {
    pattern: /(?:^|[\s"'`(=\\/])(\.pi(?:[\\/][^\s"'`()]+)?)/im,
    label: "Pi reference",
  },
  {
    pattern: /\bpi\s+(?:install|update|plugin|reload)\b/i,
    label: "Pi command",
  },
  {
    pattern: /\/reload\b/i,
    label: "Pi command",
  },
  {
    pattern: /@earendil-works\//i,
    label: "Pi scope",
  },
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path, label) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(parsed)) {
      fail(`${label}: must contain a JSON object`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    fail(`${label}: invalid JSON${detail}`);
    return undefined;
  }
}

function isContained(base, target) {
  const path = relative(base, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function resolveRelativePath(base, entry, label) {
  if (typeof entry !== "string" || entry.trim() === "") {
    fail(`${label}: path must be a non-empty string`);
    return undefined;
  }

  const target = resolve(base, entry);
  if (!isContained(base, target)) {
    fail(`${label}: path must stay within its package: ${entry}`);
    return undefined;
  }
  return target;
}

function validateExtensionTargets(manifest, manifestPath, base, required) {
  if (!isPlainObject(manifest.omp)) {
    if (required) fail(`${manifestPath}: omp.extensions must be an array`);
    return;
  }

  const extensions = manifest.omp.extensions;
  if (extensions === undefined) {
    fail(`${manifestPath}: omp.extensions must be an array`);
    return;
  }
  if (!Array.isArray(extensions)) {
    fail(`${manifestPath}: omp.extensions must be an array`);
    return;
  }
  if (required && extensions.length === 0) {
    fail(`${manifestPath}: omp.extensions must not be empty`);
    return;
  }

  for (const entry of extensions) {
    const target = resolveRelativePath(base, entry, `${manifestPath}: omp.extensions`);
    if (target && !existsSync(target)) {
      fail(`${manifestPath}: omp.extensions target does not exist: ${entry}`);
    }
  }
}

function isForbiddenDependency(name) {
  return (
    name.startsWith("@earendil-works/") ||
    name === "typebox" ||
    name === "@sinclair/typebox" ||
    name.startsWith("@sinclair/typebox/")
  );
}

function isExternalTypeboxReference(value) {
  return (
    value === "typebox" ||
    value === "@sinclair/typebox" ||
    value.startsWith("@sinclair/typebox/") ||
    value.startsWith("npm:@sinclair/typebox@") ||
    value.startsWith("npm:typebox@")
  );
}

function validateManifestMigration(manifest, manifestPath) {
  if (Object.hasOwn(manifest, "pi")) {
    fail(`${manifestPath}: legacy 'pi' key is not allowed`);
  }

  if (Array.isArray(manifest.keywords) && manifest.keywords.includes("pi-package")) {
    fail(`${manifestPath}: legacy 'pi-package' keyword is not allowed`);
  }

  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (dependencies === undefined) continue;
    if (!isPlainObject(dependencies)) {
      fail(`${manifestPath}: ${section} must be an object`);
      continue;
    }

    for (const [name, specifier] of Object.entries(dependencies)) {
      if (name.startsWith("@earendil-works/")) {
        fail(`${manifestPath}: ${section} contains legacy Pi dependency '${name}'`);
      }
      if (typeof specifier === "string" && specifier.includes("@earendil-works/")) {
        fail(`${manifestPath}: ${section} contains legacy Pi dependency reference '${specifier}'`);
      }
      if (name === "typebox" || name === "@sinclair/typebox" || name.startsWith("@sinclair/typebox/")) {
        fail(`${manifestPath}: ${section} contains external TypeBox dependency '${name}'`);
      }
      if (typeof specifier === "string" && isExternalTypeboxReference(specifier)) {
        fail(`${manifestPath}: ${section} contains external TypeBox reference '${specifier}'`);
      }
    }
  }

  const imports = manifest.imports;
  if (isPlainObject(imports)) {
    for (const [alias, target] of Object.entries(imports)) {
      if (isForbiddenDependency(alias)) {
        fail(`${manifestPath}: imports contains forbidden external reference '${alias}'`);
      }
      if (typeof target === "string" && target.includes("@earendil-works/")) {
        fail(`${manifestPath}: imports contains legacy Pi import target '${target}'`);
      }
      if (typeof target === "string" && isExternalTypeboxReference(target)) {
        fail(`${manifestPath}: imports contains external TypeBox reference '${target}'`);
      }
    }
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;

  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/);
    if (!field) return undefined;

    let value = field[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          return undefined;
        }
      } else {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
    }
    values.set(field[1], value);
  }
  return values;
}

function findRelativeMarkdownReferences(content) {
  const references = [];
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

function validateSkill(skillPath, label) {
  let content;
  try {
    content = readFileSync(skillPath, "utf8");
  } catch {
    fail(`${label}: missing SKILL.md`);
    return;
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    fail(`${label}: missing or invalid YAML frontmatter`);
    return;
  }

  const directoryName = basename(dirname(skillPath));
  const name = frontmatter.get("name");
  const description = frontmatter.get("description");
  if (!name) fail(`${label}: missing name`);
  if (!description) fail(`${label}: missing description`);
  if (name && name !== directoryName) {
    fail(`${label}: name '${name}' does not match directory '${directoryName}'`);
  }
  if (name && !namePattern.test(name)) fail(`${label}: invalid skill name '${name}'`);
  if (description && description.length > 500) {
    fail(`${label}: description exceeds 500 characters`);
  }
  if (description && !description.startsWith("Use when ")) {
    fail(`${label}: description must begin with 'Use when '`);
  }
  if (description && /\b(?:i|me|my|we|our|you|your)\b/i.test(description)) {
    fail(`${label}: description must be third-person trigger-only`);
  }

  for (const reference of findRelativeMarkdownReferences(content)) {
    const target = resolveRelativePath(dirname(skillPath), reference, `${label}: relative reference`);
    if (target && !existsSync(target)) {
      fail(`${label}: relative reference does not exist: ${reference}`);
    }
  }

  for (const { pattern, label: kind } of forbiddenSkillReferences) {
    const match = content.match(pattern);
    if (match) {
      const reference = match[1] ?? match[0];
      fail(`${label}: forbidden ${kind} '${reference}'`);
    }
  }

  if (name && description) pass(`validated skill: ${label}`);
}

function childDirectories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((entry) => {
    const target = resolve(path, entry);
    return lstatSync(target).isDirectory();
  });
}

function validateSkills(root, prefix = "") {
  const skillsDirectory = resolve(root, "skills");
  for (const skillName of childDirectories(skillsDirectory)) {
    validateSkill(resolve(skillsDirectory, skillName, "SKILL.md"), `${prefix}skills/${skillName}/SKILL.md`);
  }
}

function collectFiles(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const target = resolve(directory, entry);
    const child = prefix ? `${prefix}/${entry}` : entry;
    const stats = lstatSync(target);
    if (stats.isDirectory()) files.push(...collectFiles(target, child));
    else if (stats.isFile()) files.push(child);
  }
  return files;
}

function normalizeFilesEntry(entry) {
  return entry.replace(/^\.\//, "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function filesEntryIncludes(entry, resource) {
  const normalized = normalizeFilesEntry(entry);
  if (normalized === resource) return true;
  if (normalized.endsWith("/**")) {
    const base = normalized.slice(0, -3);
    return resource === base || resource.startsWith(`${base}/`);
  }
  return resource.startsWith(`${normalized}/`);
}

function isTestOrCachePath(path) {
  return /(?:^|\/)(?:test|tests|__tests__|__pycache__|\.cache|node_modules)(?:\/|$)|(?:^|\/)test_[^/]+$|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|\.py[co]$/i.test(path);
}

function validatePublicPackageFiles(manifest, packageDirectory, packageName) {
  if (manifest.publishConfig?.access !== "public") return;

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(`${packageName}: public package files must be a non-empty allowlist`);
    return;
  }

  const files = [];
  for (const entry of manifest.files) {
    if (typeof entry !== "string" || entry.trim() === "") {
      fail(`${packageName}: files entries must be non-empty strings`);
      continue;
    }
    const normalized = normalizeFilesEntry(entry);
    if (isAbsolute(normalized) || normalized.startsWith("../") || normalized === "..") {
      fail(`${packageName}: files entry must stay within package: ${entry}`);
      continue;
    }
    if (isTestOrCachePath(normalized)) {
      fail(`${packageName}: files allowlist must exclude test/cache artifact: ${entry}`);
    }
    files.push(normalized);
  }

  const allResources = [];
  if (existsSync(resolve(packageDirectory, "README.md"))) allResources.push("README.md");
  for (const directory of ["extensions", "skills"]) {
    allResources.push(...collectFiles(resolve(packageDirectory, directory), directory));
  }

  for (const resource of allResources) {
    const included = files.some((entry) => filesEntryIncludes(entry, resource));
    if (isTestOrCachePath(resource)) {
      if (included) {
        fail(`${packageName}: files allowlist includes test/cache artifact: ${resource}`);
      }
      continue;
    }
    if (!included) {
      fail(`${packageName}: files allowlist omits shipped resource: ${resource}`);
    }
  }
}

const rootManifestPath = resolve(workspaceRoot, "package.json");
const rootManifest = readJson(rootManifestPath, "package.json");

if (rootManifest) {
  if (!skillsOnly) {
    validateManifestMigration(rootManifest, "package.json");
    validateExtensionTargets(rootManifest, "package.json", workspaceRoot, true);
  }
  validateSkills(workspaceRoot);
}

const packagesDirectory = resolve(workspaceRoot, "packages");
for (const packageEntry of childDirectories(packagesDirectory)) {
  const packageDirectory = resolve(packagesDirectory, packageEntry);
  const manifestPath = resolve(packageDirectory, "package.json");
  const label = `packages/${packageEntry}/package.json`;
  if (!existsSync(manifestPath)) {
    fail(`${label}: missing package.json`);
    continue;
  }

  const manifest = readJson(manifestPath, label);
  if (!manifest) continue;

  if (!skillsOnly) {
    validateManifestMigration(manifest, label);
    validateExtensionTargets(manifest, label, packageDirectory, false);
    validatePublicPackageFiles(manifest, packageDirectory, `packages/${packageEntry}`);
  }
  validateSkills(packageDirectory, `packages/${packageEntry}/`);
}

if (failed) process.exitCode = 1;
