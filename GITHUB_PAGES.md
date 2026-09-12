# 发布到 GitHub Pages

这个应用可以作为纯静态网页发布，无需服务器、数据库或 API 密钥。
现有 ChatGPT Sites 构建保持不变；GitHub 版本使用独立的静态导出命令。

## 最简单的发布步骤

1. 在 GitHub 新建一个仓库，例如 `ahp-decision-workbench`。免费个人账户通常使用公开仓库；公开仓库中的源码也会对所有人可见。
2. 将源码包解压后的**文件内容**上传到仓库根目录，不要只上传 ZIP 文件，也不要多套一层文件夹。务必包含 `.github/workflows/github-pages.yml`。
3. 打开仓库 **Settings → Pages**，将 **Build and deployment → Source** 设为 **GitHub Actions**。
4. 打开 **Actions → Publish AHP to GitHub Pages → Run workflow**，选择 `main`。成功后，在 Pages 页面点击 **Visit site**。

通常访问入口为 `https://你的用户名.github.io/仓库名/`。
如果仓库名是 `你的用户名.github.io`，或已设置自定义域名，入口不同；请以 Pages 页面显示的网址为准。
自动发布流程会读取实际网址，自动处理仓库子路径，不需要手工修改资源路径。
以后推送到 `main` 的更新会触发重新发布。

### 用 GitHub 网页手动上传

1. 新建仓库时可勾选 **Add a README file**，这样会直接生成 `main` 分支。
2. 在仓库 **Code → Add file → Upload files** 页面，拖入解压后文件夹里的文件和子文件夹，而不是最外层文件夹。点击 **Commit changes**，提交到 `main`。
3. 网页每批最多上传 100 个文件，文件较多时分批提交。上传后，仓库首页必须直接看到 `package.json`、`package-lock.json`、`app`、`components`、`lib`、`public`、`scripts` 和 `.github`，不能藏在另一个同名项目文件夹中。
4. 按上面的步骤启用 **GitHub Actions** 并手动运行一次发布。首次上传时未启用 Pages 导致的失败，可以在设置完成后重新运行；无需重新上传。

公开仓库会公开源码，请勿上传自己的决策备份、密码或 API 密钥。
本源码包已包含发布流程，不需要另外复制 GitHub 推荐的工作流模板。

如果 macOS 没有显示 `.github` 文件夹，在 Finder 按 `Command + Shift + .` 显示隐藏文件。
如果用网页上传后没有这个文件，可在 GitHub 点 **Add file → Create new file**，文件名填 `.github/workflows/github-pages.yml`，复制源码包中的同名文件内容。

## 普通用户如何使用

打开发布后的网址，填写决策目标、评价准则和备选方案；通过逐题比较或完整矩阵填写判断，复核一致性提示，最后查看排名。需要备份时导出 JSON。

网站是公开的，但用户填写的决策只保存在各自的浏览器，不会上传到 GitHub，也不会互相看到。
旧 ChatGPT Sites 网址中的记录不会自动迁移到 GitHub 网址：先在旧网址导出 JSON，再到新网址导入。
清除浏览器数据、更换浏览器或设备前也应导出备份。

## 本地构建（供维护者使用）

需要 Node.js 22.13 或更高版本。

```bash
npm ci --include=dev --include=optional
npm run build:github -- --base-path /ahp-decision-workbench
```

这里的 `/ahp-decision-workbench` 必须换成实际仓库路径。根域名或自定义域名使用：

```bash
npm run build:github
```

生成的 `out/` 只包含网页静态文件。部署时发布其中的文件内容，而不是源工程、`dist/server` 或压缩包本身。它需要 HTTP(S) 托管，不保证用 `file://` 双击 HTML 可以运行。

重新生成源码包需要在 Git 工作区中运行（先克隆或初始化仓库），且系统已安装 `zip` 命令。自动发布和普通用户访问不需要此步骤。

打包会排除开发依赖、缓存、私有 Sites 项目标识、常见密钥文件和决策 JSON 备份，并检查常见凭据格式。但自动检查不能识别所有敏感内容，公开前仍需人工审查文件。

```bash
npm run package:github
```

## 官方说明

- [GitHub Pages 发布设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Next.js 静态导出](https://nextjs.org/docs/app/guides/static-exports)
