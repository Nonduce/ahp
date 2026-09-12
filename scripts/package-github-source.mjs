import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = path.join(projectRoot, "outputs");
mkdirSync(outputDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = path.join(outputDirectory, `ahp-github-pages-source-${stamp}.zip`);
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ahp-github-source-"));
const stagingRoot = path.join(temporaryDirectory, "source");
mkdirSync(stagingRoot);

const rootFiles = new Set([
  ".gitignore", "README.md", "GITHUB_PAGES.md", "package.json", "package-lock.json",
  "next.config.ts", "vite.config.ts", "postcss.config.mjs", "tsconfig.json", "eslint.config.mjs",
  "components.json", "cloudflare-env.d.ts", "drizzle.config.ts",
]);
const sourceDirectories = new Set(["app", "components", "lib", "hooks", "public", "scripts", "build", "db", "vendor", ".github"]);

try {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new Error("Cannot list project source files.");

  const files = listed.stdout.split("\0").filter(Boolean).filter((filename) => {
    const segments = filename.split("/");
    if (segments.some((segment) => segment === ".DS_Store" || segment.startsWith(".env"))) return false;
    if (/\.(?:pem|key|p12|pfx|keystore|jks|sqlite|sqlite3|db|log)$/i.test(filename)) return false;
    if (/(?:^|\/)(?:credentials|secrets|decision-backup)(?:[._-]|$)/i.test(filename)) return false;
    return rootFiles.has(filename) || sourceDirectories.has(segments[0]);
  });
  for (const filename of new Set(files)) {
    const source = path.join(projectRoot, filename);
    if (!existsSync(source)) continue;
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${filename}`);
    if (!lstatSync(source).isFile()) continue;
    if (!realpathSync(source).startsWith(`${realpathSync(projectRoot)}${path.sep}`)) {
      throw new Error(`Source resolved outside the project: ${filename}`);
    }
    const contents = readFileSync(source, "utf8");
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|_authToken\s*=/m.test(contents)) {
      throw new Error(`Possible credential found; inspect before publishing: ${filename}`);
    }
    if (filename.endsWith(".json")) {
      try {
        const data = JSON.parse(contents);
        if (data?.schemaVersion === 1 && data?.judgments && data?.alternatives) {
          throw new Error(`Decision backup must not be published: ${filename}`);
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    const target = path.join(stagingRoot, filename);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
  }

  // npm configuration may contain registry credentials. Generate only these
  // known non-secret settings rather than copying the developer's .npmrc.
  writeFileSync(path.join(stagingRoot, ".npmrc"), "audit=false\nfund=false\nupdate-notifier=false\n");

  // Do not distribute the private Sites project identity. GitHub's Next export
  // does not use this manifest; retain an unregistered, credential-free template.
  mkdirSync(path.join(stagingRoot, ".openai"));
  writeFileSync(path.join(stagingRoot, ".openai/hosting.json"), JSON.stringify({ d1: null, r2: null }, null, 2) + "\n");
  for (const required of ["package-lock.json", ".github/workflows/github-pages.yml", "GITHUB_PAGES.md"]) {
    if (!existsSync(path.join(stagingRoot, required))) throw new Error(`Missing required source file: ${required}`);
  }
  const zipped = spawnSync("zip", ["-rq", archive, "."], { cwd: stagingRoot, stdio: "inherit" });
  if (zipped.error) throw zipped.error;
  if (zipped.status !== 0) throw new Error("Could not create the source ZIP (zip is required).");
  console.log(archive);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
