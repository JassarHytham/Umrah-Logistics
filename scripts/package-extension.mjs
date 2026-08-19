/**
 * Packages the Chrome extension into a single store-ready zip.
 *
 * This used to build two signed CRX bundles (prod + staging), each with its own
 * manifest overlay, signing key and updates.xml feed served from /extensions/.
 * The Chrome Web Store rejects any package carrying an `update_url` — it manages
 * updates itself — so the self-hosted pipeline and the store submission were
 * permanently at odds. There is now one extension, one manifest, no update_url,
 * and the store is the only distribution channel.
 *
 * Usage: node scripts/package-extension.mjs [--out <dir>] [--source <dir>]
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? next : "true";
    if (args[key] === next) i += 1;
  }
  return args;
};

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe", ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`));
    });
  });

// Everything the extension does not need at runtime stays out of the upload —
// the store counts unused files against the package and reviewers ask about them.
const EXCLUDED = new Set(["test", "package.json", "SERVER_ENDPOINT.ts", "README.md"]);

const copyDir = async (sourceDir, targetDir) => {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source || path.join(repoRoot, "chrome extention", "umrah-extension"));
  const outputDir = path.resolve(args.out || path.join(repoRoot, "public", "extensions"));

  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));

  // Guard the one thing that gets this rejected at submission. Catching it here
  // beats finding out from a review rejection days later.
  if (manifest.update_url) {
    throw new Error("manifest.json must not contain update_url — the Chrome Web Store rejects packages that self-host updates.");
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "umrah-extension-"));
  const bundleDir = path.join(tempRoot, "umrah-extension");

  await copyDir(sourceDir, bundleDir);
  await fs.mkdir(outputDir, { recursive: true });

  const zipPath = path.join(outputDir, "umrah-extension.zip");
  await fs.rm(zipPath, { force: true });
  await run("zip", ["-qr", zipPath, "."], { cwd: bundleDir });

  await fs.writeFile(path.join(outputDir, "metadata.json"), `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    packagedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  await fs.rm(tempRoot, { recursive: true, force: true });

  console.log(`Packaged ${manifest.name} ${manifest.version} -> ${zipPath}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
