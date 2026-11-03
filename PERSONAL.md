# Notion block (Peng) 维护指南

这是 BCS1037/notion-block 的个人版本。官方功能保留，增加逐表格式化、标题行/列和可拖动列宽。
插件 ID 为 `notion-block-peng`，与官方 `notion-block` 分开管理。两者只启用一个。
原作者的 README 和 LICENSE 保留；官方用法见 [README.md](README.md)。

## 仓库和分支

- `upstream`：作者仓库，跟进正式发布。
- `origin`：个人 Fork，保存个人版本。
- `main`：个人稳定版；日常修改在 `codex/…` 分支进行。
- `.upstream.json`：已合入的作者版本与提交。
- `src/tableFormat.js`：表格功能源码。通过 `src/main.ts` 静态导入并打包，不依赖安装目录中的额外 JS 文件。
- `tests/table-format.test.mjs`：直接测试源码，覆盖空行、标题、转义、范围保护、列宽和块移动。

## 本地验证与部署

```sh
npm ci
npm run check
npm run deploy -- --vault /absolute/path/to/vault
```

也可在未跟踪的 `.deploy.local.json` 中保存 `{ "vault": "/absolute/path/to/vault" }`，之后直接运行 `npm run deploy`。
部署只覆盖个人版的 `main.js`、`manifest.json`、`styles.css`；首次从官方版复制设置，之后保留个人版 `data.json`。
每次覆盖现有个人版前，会在 `~/.codex/backups/obsidian/` 留下完整安装目录备份。
部署后用 Obsidian 重载个人版；首次迁移时停用官方版，再启用个人版。
安装目录作为构建产物管理，后续代码编辑在本源码仓库完成。

## 跟进作者更新

```sh
npm run upstream:check
# 将 1.7.3 替换为检查结果中实际存在、准备合入的版本。
git switch -c codex/sync-upstream-1.7.3
git fetch upstream tag 1.7.3
git merge 1.7.3
```

解决冲突时保留个人 ID、个人名称和表格扩展；作者对同一区域的修改需要人工检查。
更新 `.upstream.json`，记录实际合入的作者版本与提交。运行 `npm run check`，确认表格格式化、拖拽列宽、原有块菜单及跨笔记拖拽正常，再提交并合入个人 `main`。
最后运行部署、重载和实际界面检查。上游检查命令不会自动合并或部署。

## 发布与多设备安装

个人版本使用 `1.7.2-peng.1` 形式的版本号，避免与作者发布标签冲突。后续版本同时更新 manifest、package、lockfile 和 CHANGELOG。
GitHub Release 工作流会验证、构建并发布三个标准插件文件；表格模块已经包含在 `main.js` 内。
如启用 GitHub Actions，推送与 manifest 版本一致的个人标签即可触发发布。发布与 tag 推送是单独的操作。
需要多设备安装时，可以用 BRAT 跟踪个人 Fork 的 Release；它不会替你合并作者源码。

## 回退

个人版异常时，先停用 `notion-block-peng`，再启用保留的 `notion-block`。
若要恢复某个个人版本，切换到对应提交或标签，重新构建、部署并重载。现有 `data.json` 会保留。
个人设置、实际知识库路径和知识库内容不应提交到这个公开源码仓库。
