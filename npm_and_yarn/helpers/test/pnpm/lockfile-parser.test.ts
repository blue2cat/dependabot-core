import {
  parseLockfile,
  readLockfileDocument,
} from "../../lib/pnpm/index.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("generates an updated pnpm lock for the original file", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(os.tmpdir() + path.sep);
  });
  afterEach(() => fs.rm(tempDir, { recursive: true }, () => {}));

  function copyDependencies(
    sourceDir: string,
    destDir: string,
    transform: (content: string) => string = (content) => content
  ) {
    const srcPnpmYaml = path.join(
      __dirname,
      `fixtures/parser/${sourceDir}/pnpm-lock.yaml`
    );
    const content = fs.readFileSync(srcPnpmYaml, "utf8");
    fs.writeFileSync(`${destDir}/pnpm-lock.yaml`, transform(content), "utf8");
  }

  it("that contains duplicate dependencies", async () => {
    copyDependencies("no_lockfile_change", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result.length).toEqual(398);
  });

  it("that contains only dev dependencies but no (prod) dependencies", async () => {
    copyDependencies("only_dev_dependencies", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result).toEqual([
      {
        name: "etag",
        version: "1.8.0",
        resolved: undefined,
        dev: true,
        specifiers: ["^1.0.0"],
        aliased: false,
      },
    ]);
  });

  it("that contains dependencies which locked to versions with peer disambiguation suffix", async () => {
    copyDependencies("peer_disambiguation", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result.length).toEqual(122);
  });

  it("that contains an environment lockfile document", async () => {
    copyDependencies("multi_document", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result).toEqual([
      {
        name: "etag",
        version: "1.8.0",
        resolved: undefined,
        dev: false,
        specifiers: ["^1.0.0"],
        aliased: false,
      },
    ]);
  });

  it.each([
    ["a byte order mark", (content: string) => `\uFEFF${content}`],
    ["CRLF line endings", (content: string) => content.replace(/\n/g, "\r\n")],
  ])(
    "that contains an environment lockfile document with %s",
    async (_description, transform) => {
      copyDependencies("multi_document", tempDir, transform);
      const result = await parseLockfile(tempDir);

      expect(result).toEqual([
        {
          name: "etag",
          version: "1.8.0",
          resolved: undefined,
          dev: false,
          specifiers: ["^1.0.0"],
          aliased: false,
        },
      ]);
    }
  );

  // A catalogued dependency's importer specifier is the literal "catalog:", so the
  // version range it resolves to is only recoverable from the lockfile's own
  // `catalogs` block. Without it a consumer matching on the range cannot tell the
  // catalogued resolution apart from an older transitive one of the same name.
  it("that contains a catalogued dependency with a second transitive version", async () => {
    copyDependencies("catalog_duplicate_versions", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result).toEqual([
      {
        name: "@eslint/eslintrc",
        version: "3.3.6",
        resolved: undefined,
        dev: false,
        specifiers: ["^3.3.6"],
        aliased: false,
      },
      {
        name: "globals",
        version: "14.0.0",
        resolved: undefined,
        dev: false,
        specifiers: [],
        aliased: false,
      },
      {
        name: "globals",
        version: "17.11.0",
        resolved: undefined,
        dev: false,
        specifiers: ["catalog:", "^17.11.0"],
        aliased: false,
      },
    ]);
  });

  // Should have the version in the lock file.
  it("that contains dependencies with an empty version", async () => {
    copyDependencies("empty_version", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result.length).toEqual(9);
  });

  // pnpm writes the experimental `lockfile.format: v13` as tab-indented JSON
  // with one `packages` entry per version and no `snapshots` section. An
  // importer dependency whose specifier is an exact version is written as
  // the specifier alone.
  it("that is written in the v13 lockfile format", async () => {
    copyDependencies("lockfile_v13", tempDir);
    const result = await parseLockfile(tempDir);

    expect(result).toEqual([
      {
        name: "debug",
        version: "4.3.4",
        resolved: undefined,
        dev: false,
        specifiers: ["4.3.4"],
        aliased: false,
      },
      {
        name: "etag",
        version: "1.8.0",
        resolved: undefined,
        dev: false,
        specifiers: ["^1.0.0"],
        aliased: false,
      },
      {
        name: "ms",
        version: "2.1.2",
        resolved: undefined,
        dev: false,
        specifiers: [],
        aliased: false,
      },
    ]);
  });

  it("that is written in the v13 lockfile format with CRLF line endings", async () => {
    copyDependencies("lockfile_v13", tempDir, (content) =>
      content.replace(/\n/g, "\r\n")
    );
    const result = await parseLockfile(tempDir);

    expect(result.map(({ name, version }) => `${name}@${version}`)).toEqual([
      "debug@4.3.4",
      "etag@1.8.0",
      "ms@2.1.2",
    ]);
  });
});

describe("reads the v9 sections of a pnpm lockfile", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(os.tmpdir() + path.sep);
  });
  afterEach(() => fs.rm(tempDir, { recursive: true }, () => {}));

  function copyFixture(fixture: string) {
    fs.copyFileSync(
      path.join(__dirname, `fixtures/parser/${fixture}/pnpm-lock.yaml`),
      path.join(tempDir, "pnpm-lock.yaml")
    );
  }

  it("of the project document after an environment lockfile document", async () => {
    copyFixture("multi_document");
    const document = await readLockfileDocument(tempDir);

    expect(document?.importers?.["."]?.dependencies).toEqual({
      etag: { specifier: "^1.0.0", version: "1.8.0" },
    });
    expect(Object.keys(document?.snapshots ?? {})).toEqual(["etag@1.8.0"]);
  });

  it("of a lockfile written in the v13 format", async () => {
    copyFixture("lockfile_v13");
    const document = await readLockfileDocument(tempDir);

    expect(document?.importers?.["."]?.dependencies).toEqual({
      etag: { specifier: "^1.0.0", version: "1.8.0" },
    });
    expect(document?.importers?.["."]?.devDependencies).toEqual({
      debug: { specifier: "4.3.4", version: "4.3.4" },
    });
    expect(Object.keys(document?.snapshots ?? {}).sort()).toEqual([
      "debug@4.3.4",
      "etag@1.8.0",
      "ms@2.1.2",
    ]);
    expect(document?.snapshots?.["debug@4.3.4"]?.dependencies).toEqual({
      ms: "2.1.2",
    });
  });

  it("of no lockfile", async () => {
    expect(await readLockfileDocument(tempDir)).toBeNull();
  });
});
