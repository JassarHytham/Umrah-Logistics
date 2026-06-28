import crypto from "node:crypto";
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
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`));
    });
  });

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const copyDir = async (sourceDir, targetDir) => {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name === "test") continue;
    if (entry.name === "manifest.base.json") continue;
    if (entry.name === "manifest.prod.json") continue;
    if (entry.name === "manifest.staging.json") continue;
    if (entry.name === "manifest.json") continue;
    if (entry.name === "package.json") continue;
    if (entry.name === "SERVER_ENDPOINT.ts") continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
};

const mergeManifest = async (sourceDir, channel) => {
  const baseManifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.base.json"), "utf8"));
  const overlayName = channel === "staging" ? "manifest.staging.json" : "manifest.prod.json";
  const overlayManifest = JSON.parse(await fs.readFile(path.join(sourceDir, overlayName), "utf8"));
  return { ...baseManifest, ...overlayManifest };
};

const normalizeBaseUrl = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "");

const extensionIdFromPem = async (pemPath) => {
  const pem = await fs.readFile(pemPath, "utf8");
  const privateKey = crypto.createPrivateKey(pem);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const hash = crypto.createHash("sha256").update(publicKeyDer).digest();
  const alphabet = "abcdefghijklmnop";
  let extensionId = "";

  for (const byte of hash.subarray(0, 16)) {
    extensionId += alphabet[(byte >> 4) & 0x0f];
    extensionId += alphabet[byte & 0x0f];
  }

  return extensionId;
};

const xmlForUpdate = ({ extensionId, codebase, version }) => `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="${codebase}" version="${version}" />
  </app>
</gupdate>
`;

const findChromeBinary = async (override) => {
  const candidates = [
    override,
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await run(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("No Chrome/Chromium binary found. Set CHROME_BIN to a browser that supports --pack-extension.");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const envArg = args.env || "prod";
  const channel = envArg === "staging" ? "staging" : "prod";
  const sourceDir = path.resolve(args.source || path.join(repoRoot, "chrome extention", "umrah-extension"));
  const outputDir = path.resolve(args.out || path.join(repoRoot, "public", "extensions", channel));
  const pemPath = path.resolve(args.pem || "");
  const baseUrl = normalizeBaseUrl(args["base-url"]);
  const chromeBinary = await findChromeBinary(args["chrome-bin"]);

  if (!baseUrl) {
    throw new Error("--base-url is required, for example https://app.example.com");
  }
  if (!pemPath || !(await fileExists(pemPath))) {
    throw new Error(`Signing key not found at ${pemPath}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "umrah-extension-"));
  const bundleDir = path.join(tempRoot, "umrah-extension");
  const manifest = await mergeManifest(sourceDir, channel);
  const extensionId = await extensionIdFromPem(pemPath);
  const codebase = `${baseUrl}/extensions/${channel}/umrah-extension.crx`;
  const updatesUrl = `${baseUrl}/extensions/${channel}/updates.xml`;
  manifest.update_url = updatesUrl;

  await copyDir(sourceDir, bundleDir);
  await fs.writeFile(path.join(bundleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.mkdir(outputDir, { recursive: true });

  const zipPath = path.join(outputDir, "umrah-extension.zip");
  await run("zip", ["-qr", zipPath, "."], { cwd: bundleDir });

  await run(chromeBinary, ["--no-sandbox", `--pack-extension=${bundleDir}`, `--pack-extension-key=${pemPath}`], { cwd: tempRoot });

  const generatedCrxPath = `${bundleDir}.crx`;
  const outputCrxPath = path.join(outputDir, "umrah-extension.crx");
  await fs.copyFile(generatedCrxPath, outputCrxPath);
  await fs.writeFile(path.join(outputDir, "updates.xml"), xmlForUpdate({
    extensionId,
    codebase,
    version: manifest.version,
  }));
  await fs.writeFile(path.join(outputDir, "metadata.json"), `${JSON.stringify({
    channel,
    extensionId,
    version: manifest.version,
    codebase,
    updateUrl: updatesUrl,
  }, null, 2)}\n`);

  console.log(`Packaged ${channel} extension ${manifest.version} (${extensionId}) -> ${outputDir}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
