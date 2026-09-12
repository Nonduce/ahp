import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
let basePath = process.env.AHP_PAGES_BASE_PATH ?? "";

if (args.length) {
  if (args.length !== 2 || args[0] !== "--base-path") {
    throw new Error("Usage: npm run build:github -- --base-path /repository-name");
  }
  basePath = args[1];
}

if (basePath === "/") basePath = "";
else basePath = basePath.replace(/\/$/, "");
if (basePath && !/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(basePath)) {
  throw new Error("Base path must be empty or a URL path such as /ahp-decision-workbench.");
}
if (basePath.split("/").some((part) => part === "." || part === "..")) {
  throw new Error("Base path must not contain dot segments.");
}

// Next generates these files during builds. Restore their exact previous
// contents so a GitHub export cannot alter the existing Vinext/Sites setup.
const generatedInputs = ["next-env.d.ts", "tsconfig.json"].map((name) => {
  const filename = path.join(projectRoot, name);
  return { filename, previous: existsSync(filename) ? readFileSync(filename) : null };
});

let built;
try {
  built = spawnSync(
    process.execPath,
    [path.join(projectRoot, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        AHP_DEPLOY_TARGET: "github-pages",
        AHP_PAGES_BASE_PATH: basePath,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
} finally {
  for (const { filename, previous } of generatedInputs) {
    if (previous) writeFileSync(filename, previous);
    else if (existsSync(filename)) unlinkSync(filename);
  }
}
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);

const outputRoot = path.join(projectRoot, "out");
if (!existsSync(path.join(outputRoot, "index.html"))) {
  throw new Error("Static export did not produce out/index.html.");
}
writeFileSync(path.join(outputRoot, ".nojekyll"), "");

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(filename) : entry.name.endsWith(".html") ? [filename] : [];
  });
}

// Check each real script/link/image reference under the Pages mount. This
// catches the common /repository/ prefix mistake before anything is uploaded.
let assetCount = 0;
for (const filename of htmlFiles(outputRoot)) {
  const html = readFileSync(filename, "utf8");
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const reference = match[1].replaceAll("&amp;", "&");
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) continue;
    const pathname = new URL(reference, `https://pages-check.invalid${basePath}/`).pathname;
    if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
      throw new Error(`Asset is missing the Pages base path: ${reference}`);
    }
    const localPath = decodeURIComponent(pathname.slice(basePath.length)).replace(/^\//, "");
    let asset = path.resolve(outputRoot, localPath);
    if (asset !== outputRoot && !asset.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error(`Asset escaped the output directory: ${reference}`);
    }
    if (existsSync(asset) && statSync(asset).isDirectory()) asset = path.join(asset, "index.html");
    if (!existsSync(asset)) throw new Error(`Missing exported asset: ${reference}`);
    assetCount += 1;
  }
}
console.log(`GitHub Pages export ready: out/ (${assetCount} checked references, base path: ${basePath || "/"}).`);
