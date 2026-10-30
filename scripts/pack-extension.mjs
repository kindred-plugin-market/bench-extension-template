#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  constants,
  cpSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { build as viteBuild } from "vite";
import { validateExtensionId } from "./create-extension.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 4096;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const require = createRequire(import.meta.url);
const { ZipFile } = require("yazl");

function parseArgs(argv) {
  const result = {
    id: undefined,
    outDir: process.env.BENCH_EXT_ARTIFACTS_DIR
      ? resolve(process.env.BENCH_EXT_ARTIFACTS_DIR)
      : join(ROOT, ".artifacts"),
    devUnsigned: false,
  };
  const values = new Set([
    "--out",
    "--key",
    "--pubkey",
    "--minisign-bin",
    "--install-dir",
  ]);
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dev-unsigned") {
      result.devUnsigned = true;
      continue;
    }
    if (values.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value.`);
      if (arg === "--out") result.outDir = resolve(value);
      if (arg === "--key") result.keyPath = resolve(value);
      if (arg === "--pubkey") result.pubKeyPath = resolve(value);
      if (arg === "--minisign-bin") result.minisignBin = value;
      if (arg === "--install-dir") result.installDir = resolve(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    if (result.id)
      throw new Error("Only one extension id may be packed at a time.");
    result.id = arg;
  }
  return result;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

export function canonicalManifest(manifest) {
  const { signature: _signature, ...unsignedManifest } = manifest;
  return JSON.stringify(sortObject(unsignedManifest));
}

function requireObject(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains an unsupported field: ${key}`);
    }
  }
}

function validateDisplay(value, label) {
  requireObject(value, label, ["en", "zh"]);
  if (typeof value.en !== "string" || !value.en.trim()) {
    throw new Error(`${label}.en is required and must not be empty.`);
  }
  if (
    value.zh !== undefined &&
    (typeof value.zh !== "string" || !value.zh.trim())
  ) {
    throw new Error(`${label}.zh must be a non-empty string when present.`);
  }
}

export function validateManifest(manifest, id) {
  const allowed = new Set([
    "schemaVersion",
    "id",
    "version",
    "display",
    "description",
    "distribution",
    "entry",
    "files",
    "acl",
    "engines",
    "platforms",
    "expiresAt",
    "signature",
  ]);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest.json must contain an object.");
  }
  for (const key of Object.keys(manifest)) {
    if (!allowed.has(key))
      throw new Error(`manifest.json contains an unsupported field: ${key}`);
  }
  if (manifest.schemaVersion !== 2) {
    throw new Error("manifest schemaVersion must be 2.");
  }
  if (manifest.id !== id) throw new Error(`manifest id must equal ${id}.`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(
      "manifest version must use three numeric components, such as 1.0.0.",
    );
  }
  validateDisplay(manifest.display, "manifest.display");
  if (manifest.description !== undefined && manifest.description !== null) {
    validateDisplay(manifest.description, "manifest.description");
  }
  if (!new Set(["bundled", "market"]).has(manifest.distribution)) {
    throw new Error("manifest distribution must be bundled or market.");
  }
  requireObject(manifest.entry, "manifest.entry", ["index"]);
  if (
    typeof manifest.entry.index !== "string" ||
    !manifest.entry.index.endsWith(".html")
  ) {
    throw new Error("manifest entry.index must name an HTML file.");
  }
  if (
    manifest.entry.index.startsWith("/") ||
    manifest.entry.index.includes("\\") ||
    manifest.entry.index
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      "manifest entry.index must be a safe relative path using '/'.",
    );
  }
  requireObject(manifest.acl, "manifest.acl", ["commands"]);
  if (
    !Array.isArray(manifest.acl.commands) ||
    manifest.acl.commands.some(
      (command) => typeof command !== "string" || !command.trim(),
    )
  ) {
    throw new Error("manifest acl.commands must be an array.");
  }
  if (new Set(manifest.acl.commands).size !== manifest.acl.commands.length) {
    throw new Error("manifest acl.commands must not contain duplicates.");
  }
  requireObject(manifest.engines, "manifest.engines", ["bench"]);
  if (
    typeof manifest.engines.bench !== "string" ||
    !/^\*$|^>=\d+\.\d+\.\d+$/.test(manifest.engines.bench)
  ) {
    throw new Error("manifest engines.bench must be * or >=X.Y.Z.");
  }
  if (manifest.platforms !== undefined && manifest.platforms !== null) {
    if (
      !Array.isArray(manifest.platforms) ||
      manifest.platforms.length === 0 ||
      manifest.platforms.some(
        (platform) => !["macos", "windows"].includes(platform),
      ) ||
      new Set(manifest.platforms).size !== manifest.platforms.length
    ) {
      throw new Error(
        "manifest platforms must be a non-empty list of unique supported platforms.",
      );
    }
  }
  if (manifest.expiresAt !== undefined && manifest.expiresAt !== null) {
    const timestamp = manifest.expiresAt;
    const parsed = Date.parse(timestamp);
    if (
      typeof timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        timestamp,
      ) ||
      !Number.isFinite(parsed)
    ) {
      throw new Error("manifest expiresAt must be a valid RFC 3339 timestamp.");
    }
    if (parsed <= Date.now()) {
      throw new Error("manifest expiresAt must be in the future.");
    }
  }
}

export function findBundleFiles(root) {
  const result = [];
  let totalBytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink())
        throw new Error(
          `Symbolic links are not allowed in a plugin: ${absolutePath}`,
        );
      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!stats.isFile())
        throw new Error(`Unsupported bundle entry: ${absolutePath}`);
      const archivePath = relative(root, absolutePath).split(sep).join("/");
      if (archivePath === ".disabled") continue;
      if (
        !archivePath ||
        archivePath.startsWith("/") ||
        archivePath.split("/").includes("..")
      ) {
        throw new Error(`Unsafe bundle path: ${archivePath}`);
      }
      if (stats.size > MAX_FILE_BYTES)
        throw new Error(`${archivePath} exceeds the 64 MiB file limit.`);
      totalBytes += stats.size;
      result.push({ absolutePath, archivePath, size: stats.size });
      if (result.length > MAX_FILES)
        throw new Error(`Plugin exceeds the ${MAX_FILES} file limit.`);
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error("Plugin exceeds the 256 MiB total size limit.");
    }
  };
  walk(root);
  result.sort((a, b) => a.archivePath.localeCompare(b.archivePath, "en"));
  return result;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function generateFilesManifest(packageDir) {
  const files = findBundleFiles(packageDir).filter(
    (file) => file.archivePath !== "manifest.json",
  );
  if (files.length === 0)
    throw new Error("The built plugin contains no files.");
  const manifestFiles = [];
  for (const file of files) {
    manifestFiles.push({
      path: file.archivePath,
      sha256: await sha256File(file.absolutePath),
      size: file.size,
    });
  }
  return { files, manifestFiles };
}

function runMinisign(binary, args, { interactive = false } = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: [interactive ? "inherit" : "ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(
      `Could not run minisign (${result.error.message}). Install minisign and retry.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `minisign failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  return result.stdout || "";
}

function signManifest(manifest, tempDir, { keyPath, pubKeyPath, minisignBin }) {
  if (!keyPath || !existsSync(keyPath))
    throw new Error(
      "Provide an existing key with --key or BENCH_EXT_SIGNING_KEY.",
    );
  if (!pubKeyPath || !existsSync(pubKeyPath)) {
    throw new Error(
      "Provide the matching public key with --pubkey or BENCH_EXT_SIGNING_PUBKEY.",
    );
  }

  const canonicalPath = join(tempDir, "manifest.canonical.json");
  const signaturePath = join(tempDir, "manifest.minisig");
  writeFileSync(canonicalPath, canonicalManifest(manifest), { flag: "wx" });
  const trustedComment = `${manifest.id}@${manifest.version}`;

  runMinisign(
    minisignBin,
    [
      "-S",
      "-s",
      keyPath,
      "-m",
      canonicalPath,
      "-t",
      trustedComment,
      "-x",
      signaturePath,
    ],
    { interactive: true },
  );
  const verification = runMinisign(minisignBin, [
    "-V",
    "-m",
    canonicalPath,
    "-p",
    pubKeyPath,
    "-x",
    signaturePath,
  ]);
  const trustedLine = verification.match(/^Trusted comment: (.+)$/m)?.[1];
  if (trustedLine !== trustedComment) {
    throw new Error(
      `minisign trusted comment must be exactly ${trustedComment}.`,
    );
  }
  return readFileSync(signaturePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
}

export async function writeZip(
  files,
  destination,
  createWriteStreamFn = createWriteStream,
) {
  const archive = new ZipFile();
  for (const file of files)
    archive.addFile(file.absolutePath, file.archivePath);
  const output = createWriteStreamFn(destination, { flags: "wx" });
  let outputOpened = false;
  output.once("open", () => {
    outputOpened = true;
  });
  try {
    const write = pipeline(archive.outputStream, output);
    archive.end();
    await write;
  } catch (error) {
    if (outputOpened) rmSync(destination, { force: true });
    throw error;
  }
}

export async function packExtension({
  id,
  root = ROOT,
  outDir = join(root, ".artifacts"),
  keyPath = process.env.BENCH_EXT_SIGNING_KEY,
  pubKeyPath = process.env.BENCH_EXT_SIGNING_PUBKEY,
  minisignBin = process.env.MINISIGN_BIN || "minisign",
  devUnsigned = false,
  installDir,
} = {}) {
  validateExtensionId(id);
  if (devUnsigned && (keyPath || pubKeyPath)) {
    throw new Error("Do not combine --dev-unsigned with signing keys.");
  }
  const installPath = installDir ? resolve(installDir) : undefined;
  if (installPath && !devUnsigned) {
    throw new Error("--install-dir is available only with --dev-unsigned.");
  }
  if (installPath) {
    const relativeInstallPath = relative(resolve(root), installPath);
    if (
      basename(installPath) !== id ||
      relativeInstallPath === "" ||
      (!isAbsolute(relativeInstallPath) &&
        relativeInstallPath !== ".." &&
        !relativeInstallPath.startsWith(`..${sep}`))
    ) {
      throw new Error(
        "--install-dir must be an external directory named exactly after the extension id.",
      );
    }
    if (existsSync(installPath)) {
      throw new Error(
        `Development install target already exists; no files were changed: ${installPath}`,
      );
    }
  }

  const extensionDir = join(root, "extensions", id);
  const manifestPath = join(extensionDir, "manifest.json");
  if (!existsSync(manifestPath))
    throw new Error(`extensions/${id}/manifest.json was not found.`);
  const sourceManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateManifest(sourceManifest, id);
  if (
    !sourceManifest.entry.index
      .split(/[\\/]/)
      .every((part) => part && part !== "." && part !== "..")
  ) {
    throw new Error("manifest entry.index must be a safe relative path.");
  }

  const version = sourceManifest.version;
  const zipName = `bench-ext-${id}-v${version}.zip`;
  const metadataName = `${id}.meta.json`;
  mkdirSync(outDir, { recursive: true });
  const zipPath = join(outDir, zipName);
  const metadataPath = join(outDir, metadataName);
  if (existsSync(zipPath) || existsSync(metadataPath)) {
    throw new Error(
      `Output already exists in ${outDir}; choose a new --out directory.`,
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "bench-ext-pack-"));
  let archiveCreated = false;
  let installDirCreated = false;
  let completed = false;
  try {
    const buildDir = join(tempDir, "build");
    const packageDir = join(tempDir, "package");
    await viteBuild({
      configFile: join(extensionDir, "vite.config.ts"),
      build: { outDir: buildDir, emptyOutDir: true },
    });
    if (!existsSync(join(buildDir, sourceManifest.entry.index))) {
      throw new Error(
        `The build did not produce entry ${sourceManifest.entry.index}.`,
      );
    }
    cpSync(buildDir, packageDir, { recursive: true });

    const manifest = {
      ...sourceManifest,
      schemaVersion: 2,
      distribution: "market",
      files: [],
    };
    delete manifest.signature;
    const { files, manifestFiles } = await generateFilesManifest(packageDir);
    manifest.files = manifestFiles;
    if (!devUnsigned)
      manifest.signature = signManifest(manifest, tempDir, {
        keyPath,
        pubKeyPath,
        minisignBin,
      });
    writeFileSync(
      join(packageDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );

    const packageFiles = findBundleFiles(packageDir);
    if (installPath) {
      mkdirSync(dirname(installPath), { recursive: true });
      mkdirSync(installPath, { recursive: false });
      installDirCreated = true;
      try {
        for (const file of packageFiles) {
          const targetPath = join(installPath, ...file.archivePath.split("/"));
          mkdirSync(dirname(targetPath), { recursive: true });
          copyFileSync(file.absolutePath, targetPath, constants.COPYFILE_EXCL);
        }
      } catch (error) {
        rmSync(installPath, { recursive: true, force: true });
        installDirCreated = false;
        throw error;
      }
    }
    await writeZip(packageFiles, zipPath);
    archiveCreated = true;
    const zipSize = statSync(zipPath).size;
    const metadata = {
      id,
      version,
      file: zipName,
      sha256: await sha256File(zipPath),
      size: zipSize,
      fileCount: manifestFiles.length,
      unsignedDev: devUnsigned,
    };
    try {
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        flag: "wx",
      });
    } catch (error) {
      rmSync(zipPath, { force: true });
      archiveCreated = false;
      throw error;
    }
    completed = true;
    return {
      zipPath,
      metadataPath,
      metadata,
      signed: !devUnsigned,
      installedPath: installPath,
    };
  } finally {
    if (archiveCreated && !existsSync(metadataPath))
      rmSync(zipPath, { force: true });
    if (!completed && installDirCreated)
      rmSync(installPath, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.id)
    throw new Error(
      "Usage: pnpm run extensions:pack <id> [--key <file> --pubkey <file>] [--dev-unsigned --install-dir <extensions/<id>>]",
    );
  const result = await packExtension(options);
  const label = result.signed ? "signed" : "UNSIGNED DEV ONLY";
  console.log(
    `[extensions:pack] ${label}: ${result.metadata.file} (${result.metadata.size} bytes)`,
  );
  console.log(`[extensions:pack] metadata: ${result.metadataPath}`);
  if (result.installedPath)
    console.log(
      `[extensions:pack] local development copy: ${result.installedPath}`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv).catch((error) => {
    console.error(
      `[extensions:pack] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
