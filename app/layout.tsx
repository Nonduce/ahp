import type { Metadata } from "next";
import "./globals.css";

const publicAssetPrefix = process.env.AHP_DEPLOY_TARGET === "github-pages"
  ? process.env.AHP_PAGES_BASE_PATH ?? ""
  : "";

export const metadata: Metadata = {
  title: "权衡 · AHP 决策助手",
  description: "用层次分析法整理偏好、检查一致性并比较备选方案。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: `${publicAssetPrefix}/favicon.svg`,
    shortcut: `${publicAssetPrefix}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
