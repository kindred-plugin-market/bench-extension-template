import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createExtension, validateExtensionId } from "./create-extension.mjs";
import {
  canonicalManifest,
  findBundleFiles,
  packExtension,
  validateManifest,
} from "./pack-extension.mjs";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl");
const ROOT = resolve(import.meta.dirname, "..");

const tempDirs = new Set();

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirs)
    rmSync(directory, { recursive: true, force: true });
  tempDirs.clear();
});

function tempDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
}

function readZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const entries = [];
      const contents = new Map();
      let manifest;
      zip.on("error", reject);
      zip.on("end", () => resolve({ entries, contents, manifest }));
      zip.on("entry", (entry) => {
        entries.push(entry.fileName);
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            const content = Buffer.concat(chunks);
            contents.set(entry.fileName, content);
            if (entry.fileName === "manifest.json") {
              manifest = JSON.parse(content.toString("utf8"));
            }
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

describe("extension authoring tools", () => {
  it("accepts safe extension ids and rejects path syntax", () => {
    expect(validateExtensionId("quick-notes")).toBe("quick-notes");
    expect(() => validateExtensionId("../outside")).toThrow(/must match/);
    expect(() => validateExtensionId("QuickNotes")).toThrow(/must match/);
  });

  it("creates a localized starter without overwriting an existing plugin", () => {
    const root = tempDirectory("bench-ext-create-");
    mkdirSync(join(root, "extensions"), { recursive: true });
    cpSync(
      join(ROOT, "extensions", "example"),
      join(root, "extensions", "example"),
      {
        recursive: true,
        filter: (source) => !source.endsWith(`${join("assets")}`),
      },
    );

    const created = createExtension("quick-notes", { root });
    const manifest = JSON.parse(
      readFileSync(join(created, "manifest.json"), "utf8"),
    );
    const packageJson = JSON.parse(
      readFileSync(join(created, "package.json"), "utf8"),
    );
    const english = JSON.parse(
      readFileSync(join(created, "locales", "en.json"), "utf8"),
    );
    const chinese = JSON.parse(
      readFileSync(join(created, "locales", "zh.json"), "utf8"),
    );

    expect(manifest.id).toBe("quick-notes");
    expect(manifest.display).toEqual({
      en: "Quick Notes",
      zh: "新插件：quick-notes",
    });
    expect(packageJson.name).toBe("@bench/quick-notes");
    expect(english.title).toBe("Quick Notes");
    expect(chinese.title).toBe("新插件：quick-notes");
    expect(() => createExtension("quick-notes", { root })).toThrow(
      /already exists/,
    );
  });

  it("sorts canonical manifest keys and excludes the signature field", () => {
    const input = {
      z: 1,
      nested: { b: 2, a: 1 },
      signature: "not-signed",
      a: [3, 2],
    };
    expect(canonicalManifest(input)).toBe(
      '{"a":[3,2],"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("includes hidden bundle files while excluding the host marker", () => {
    const root = tempDirectory("bench-ext-files-");
    writeFileSync(join(root, ".well-known"), "discovery metadata");
    writeFileSync(join(root, ".disabled"), "host-owned marker");

    expect(findBundleFiles(root).map((file) => file.archivePath)).toEqual([
      ".well-known",
    ]);
  });

  it("rejects expired metadata and invalid platform declarations before signing", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(ROOT, "extensions", "example", "manifest.json"),
        "utf8",
      ),
    );
    expect(() =>
      validateManifest({ ...manifest, expiresAt: "not-a-date" }, "example"),
    ).toThrow(/RFC 3339/);
    expect(() =>
      validateManifest({ ...manifest, platforms: [] }, "example"),
    ).toThrow(/platforms/);
  });

  it("builds a portable ZIP and injects its complete files manifest", async () => {
    const outDir = tempDirectory("bench-ext-pack-out-");
    const result = await packExtension({
      id: "example",
      root: ROOT,
      outDir,
      devUnsigned: true,
    });
    const { entries, contents, manifest } = await readZip(result.zipPath);

    expect(result.signed).toBe(false);
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("index.html");
    expect(manifest.distribution).toBe("market");
    expect(manifest.signature).toBeUndefined();
    expect(manifest.files.map((file) => file.path)).toEqual(
      entries
        .filter((name) => name !== "manifest.json")
        .sort((a, b) => a.localeCompare(b, "en")),
    );
    expect(
      manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)),
    ).toBe(true);
    for (const file of manifest.files) {
      const content = contents.get(file.path);
      expect(content).toBeDefined();
      expect(content?.byteLength).toBe(file.size);
      expect(createHash("sha256").update(content).digest("hex")).toBe(
        file.sha256,
      );
    }
    expect(result.metadata.unsignedDev).toBe(true);
    await expect(
      packExtension({ id: "example", root: ROOT, outDir, devUnsigned: true }),
    ).rejects.toThrow(/already exists/);
  }, 60_000);

  it("installs an explicit unsigned development copy without replacing files", async () => {
    const root = tempDirectory("bench-ext-dev-root-");
    const outDir = tempDirectory("bench-ext-dev-out-");
    const installDir = join(root, "app-data", "extensions", "example");
    const result = await packExtension({
      id: "example",
      root: ROOT,
      outDir,
      devUnsigned: true,
      installDir,
    });
    const installedManifest = JSON.parse(
      readFileSync(join(installDir, "manifest.json"), "utf8"),
    );

    expect(result.installedPath).toBe(installDir);
    expect(installedManifest.distribution).toBe("market");
    expect(installedManifest.signature).toBeUndefined();
    expect(findBundleFiles(installDir).map((file) => file.archivePath)).toEqual(
      [
        "manifest.json",
        ...installedManifest.files.map((file) => file.path),
      ].sort((a, b) => a.localeCompare(b, "en")),
    );
    await expect(
      packExtension({
        id: "example",
        root: ROOT,
        outDir: tempDirectory("bench-ext-dev-retry-"),
        devUnsigned: true,
        installDir,
      }),
    ).rejects.toThrow(/already exists/);
    expect(existsSync(join(installDir, "manifest.json"))).toBe(true);
  }, 60_000);
});
