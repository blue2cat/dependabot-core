/* PNPM-LOCK.YAML PARSER
 *
 * Inputs:
 *  - directory containing a pnpm-lock.yaml file
 *
 * Outputs:
 *  - JSON formatted information of dependencies (name, version, dependency-type)
 */

import {
  readWantedLockfile,
  type CatalogSnapshots,
  type PackageSnapshot,
  type ProjectSnapshot,
} from "@pnpm/lockfile-file";
import * as dependencyPath from "@pnpm/dependency-path";
import { readLockfile as readLockfileWithPnpm } from "@pnpm/napi";
import { readFile } from "node:fs/promises";
import path from "node:path";

const YAML_DOCUMENT_SEPARATOR = "\n---\n";

// The lockfile majors pnpm's own engine reads. Older lockfiles (5.4, 6.x) are
// only readable by @pnpm/lockfile-file.
const PNPM_ENGINE_LOCKFILE_MAJORS = new Set([9, 12, 13]);

interface ParsedLockfile {
  importers: Record<string, ProjectSnapshot>;
  packages?: Record<string, PackageSnapshot>;
  catalogs?: CatalogSnapshots;
}

interface ImporterDependency {
  specifier: string;
  version: string;
}

type ImporterDependencies = Record<string, ImporterDependency>;

interface LockfileFileImporter {
  dependencies?: ImporterDependencies;
  devDependencies?: ImporterDependencies;
  optionalDependencies?: ImporterDependencies;
  [key: string]: unknown;
}

// The shape @pnpm/napi's readLockfile returns: pnpm-lock.yaml's v9 sections,
// whatever format the file is written in.
interface LockfileFile {
  importers?: Record<string, LockfileFileImporter>;
  packages?: Record<string, Record<string, unknown>>;
  snapshots?: Record<string, Record<string, unknown>>;
  catalogs?: CatalogSnapshots;
}

interface PnpmDependency {
  name: string;
  version: string;
  resolved: string | undefined;
  dev: boolean;
  specifiers: string[];
  aliased: boolean;
}

export async function parse(directory: string): Promise<PnpmDependency[]> {
  const lockfile = await readLockfile(directory);

  if (!lockfile) {
    return [];
  }

  return Object.entries(lockfile.packages ?? {})
    .filter(([depPath]) => {
      const dp = dependencyPath.parse(depPath);
      return dp && dp.name; // null or undefined checked for dependency path (dp) and empty name dps are filtered.
    })
    .map(([depPath, pkgSnapshot]: [string, PackageSnapshot]) =>
      nameVerDevFromPkgSnapshot(
        depPath,
        pkgSnapshot,
        Object.values(lockfile.importers),
        lockfile.catalogs
      )
    );
}

async function readLockfile(
  directory: string
): Promise<ParsedLockfile | null> {
  const content = await readLockfileContent(directory);
  if (content === null) {
    return null;
  }

  const major = lockfileMajor(content);
  if (major !== null && !PNPM_ENGINE_LOCKFILE_MAJORS.has(major)) {
    return readWantedLockfile(directory, { ignoreIncompatible: true });
  }

  // pnpm's engine splits off a leading environment lockfile document and
  // converts the v13 format to the v9 sections itself.
  const lockfile = (await readLockfileWithPnpm({
    dir: directory,
  })) as LockfileFile | null;

  return lockfile === null ? null : toParsedLockfile(lockfile);
}

function lockfileMajor(content: string): number | null {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const documents = normalized.split(YAML_DOCUMENT_SEPARATOR);
  const mainDocument = documents[documents.length - 1];

  // The v13 format is written as JSON, which is also valid YAML.
  const match = mainDocument.trimStart().startsWith("{")
    ? mainDocument.match(/"lockfileVersion"\s*:\s*"?(\d+)/)
    : mainDocument.match(/^["']?lockfileVersion["']?\s*:\s*["']?(\d+)/m);

  return match ? Number(match[1]) : null;
}

// Joins each snapshot with its package metadata and splits importer
// dependencies into specifiers and versions, as @pnpm/lockfile-file does for
// the v9 format, so both readers feed the same mapping below.
function toParsedLockfile(lockfile: LockfileFile): ParsedLockfile {
  const packages: Record<string, PackageSnapshot> = {};
  for (const depPath of Object.keys(lockfile.snapshots ?? {}).sort()) {
    const pkgId = dependencyPath.removeSuffix(depPath);
    packages[depPath] = {
      ...lockfile.snapshots?.[depPath],
      ...lockfile.packages?.[pkgId],
    } as unknown as PackageSnapshot;
  }

  const importers: Record<string, ProjectSnapshot> = {};
  for (const [importerId, importer] of Object.entries(
    lockfile.importers ?? {}
  )) {
    importers[importerId] = toProjectSnapshot(importer);
  }

  return { importers, packages, catalogs: lockfile.catalogs };
}

function toProjectSnapshot(importer: LockfileFileImporter): ProjectSnapshot {
  const specifiers: Record<string, string> = {};

  function versionsOf(dependencies: ImporterDependencies | undefined) {
    if (dependencies === undefined) {
      return undefined;
    }

    const versions: Record<string, string> = {};
    for (const [name, { specifier, version }] of Object.entries(
      dependencies
    )) {
      specifiers[name] = specifier;
      versions[name] = version;
    }
    return versions;
  }

  return {
    ...importer,
    dependencies: versionsOf(importer.dependencies),
    devDependencies: versionsOf(importer.devDependencies),
    optionalDependencies: versionsOf(importer.optionalDependencies),
    specifiers,
  } as ProjectSnapshot;
}

async function readLockfileContent(directory: string): Promise<string | null> {
  try {
    return await readFile(path.join(directory, "pnpm-lock.yaml"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function nameVerDevFromPkgSnapshot(
  depPath: string,
  pkgSnapshot: PackageSnapshot,
  projectSnapshots: ProjectSnapshot[],
  catalogs: CatalogSnapshots | undefined
): PnpmDependency {
  let name: string;
  let version: string;

  if (!pkgSnapshot.name) {
    const pkgInfo = dependencyPath.parse(depPath);
    name = pkgInfo.name ?? depPath;
    version = pkgInfo.version ?? "";
  } else {
    name = pkgSnapshot.name;
    version = pkgSnapshot.version ?? "";
  }

  const specifiers: string[] = [];
  let aliased = false;

  projectSnapshots.every((projectSnapshot) => {
    const projectSpecifiers = projectSnapshot.specifiers;

    if (
      Object.values(projectSpecifiers).some(
        (specifier) =>
          specifier.startsWith(`npm:${name}@`) || specifier == `npm:${name}`
      )
    ) {
      aliased = true;
      return false;
    }

    const currentSpecifier = projectSpecifiers[name];

    if (!currentSpecifier) {
      return true;
    }

    const specifierVersion =
      projectSnapshot.dependencies?.[name] ||
      projectSnapshot.devDependencies?.[name] ||
      projectSnapshot.optionalDependencies?.[name];

    if (
      specifierVersion &&
      (specifierVersion == version ||
        specifierVersion.startsWith(`${version}_`) || // lockfileVersion 5.4
        specifierVersion.startsWith(`${version}(`)) // lockfileVersion 6.0
    ) {
      specifiers.push(currentSpecifier);
    }

    return true;
  });

  // An importer that takes a dependency from a catalog records its specifier as
  // the literal "catalog:" (or "catalog:<name>"), never the version range the
  // catalog resolves to. That range lives in the lockfile's own `catalogs` block,
  // and it is also the form a pnpm-workspace.yaml catalog entry is read as, so
  // collect it here too. Without it a catalogued package is only ever matched by
  // a caller that already knows to ask for "catalog:".
  if (!aliased) {
    for (const catalog of Object.values(catalogs ?? {})) {
      const entry = catalog[name];

      if (entry?.version === version && !specifiers.includes(entry.specifier)) {
        specifiers.push(entry.specifier);
      }
    }
  }

  return {
    name: name,
    version: version,
    resolved:
      pkgSnapshot.resolution && "tarball" in pkgSnapshot.resolution
        ? pkgSnapshot.resolution.tarball
        : undefined,
    dev: "dev" in pkgSnapshot && pkgSnapshot.dev === true,
    specifiers: specifiers,
    aliased: aliased,
  };
}
