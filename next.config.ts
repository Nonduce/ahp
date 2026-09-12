import type { NextConfig } from "next";

const isGitHubPages = process.env.AHP_DEPLOY_TARGET === "github-pages";

// Keep the existing Sites/Worker build unchanged. GitHub Pages serves only
// static files, so the separate build:github command enables static export.
const nextConfig: NextConfig = isGitHubPages
  ? {
      output: "export",
      basePath: process.env.AHP_PAGES_BASE_PATH ?? "",
      trailingSlash: true,
    }
  : {};

export default nextConfig;
