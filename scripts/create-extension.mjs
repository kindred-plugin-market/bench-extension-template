#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateExtensionId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error("Extension id must match ^[a-z][a-z0-9-]*$.");
  }
  return id;
}

function displayName(id) {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function copyTemplate(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if ([".git", ".DS_Store", "assets", "node_modules"].includes(entry.name))
      continue;
    if (
      entry.name.startsWith(".env") &&
      ![".env.example", ".env.sample"].includes(entry.name)
    ) {
      continue;
    }
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: false });
      copyTemplate(sourcePath, targetPath);
    } else if (entry.isFile()) cpSync(sourcePath, targetPath);
    else
      throw new Error(
        `Template contains an unsupported file type: ${entry.name}`,
      );
  }
}

export function createExtension(id, { root = ROOT } = {}) {
  validateExtensionId(id);
  const extensionDir = join(root, "extensions", id);
  const templateDir = join(root, "extensions", "example");
  if (id === "example")
    throw new Error('The reserved starter id "example" cannot be generated.');
  if (!existsSync(templateDir))
    throw new Error("The example extension template is missing.");
  if (existsSync(extensionDir))
    throw new Error(`extensions/${id} already exists; no files were changed.`);

  mkdirSync(dirname(extensionDir), { recursive: true });
  mkdirSync(extensionDir, { recursive: false });
  try {
    copyTemplate(templateDir, extensionDir);

    const title = displayName(id);
    const manifestPath = join(extensionDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.id = id;
    manifest.display = { en: title, zh: `新插件：${id}` };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const packagePath = join(extensionDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.name = `@bench/${id}`;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const englishPath = join(extensionDir, "locales", "en.json");
    const english = JSON.parse(readFileSync(englishPath, "utf8"));
    english.title = title;
    writeFileSync(englishPath, `${JSON.stringify(english, null, 2)}\n`);

    const chinesePath = join(extensionDir, "locales", "zh.json");
    const chinese = JSON.parse(readFileSync(chinesePath, "utf8"));
    chinese.title = `新插件：${id}`;
    writeFileSync(chinesePath, `${JSON.stringify(chinese, null, 2)}\n`);

    const htmlPath = join(extensionDir, "index.html");
    const html = readFileSync(htmlPath, "utf8").replace(
      "<title>Bench Extension Example</title>",
      `<title>${title}</title>`,
    );
    writeFileSync(htmlPath, html);

    return extensionDir;
  } catch (error) {
    rmSync(extensionDir, { recursive: true, force: true });
    throw error;
  }
}

function main(argv) {
  const id = argv[2];
  if (!id || id.startsWith("--")) {
    throw new Error("Usage: pnpm run extensions:create <id>");
  }
  const result = createExtension(id);
  console.log(`Created ${result}`);
  console.log(
    "Next: pnpm install, edit src/ and locales/, then run extensions:pack.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(
      `[extensions:create] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
