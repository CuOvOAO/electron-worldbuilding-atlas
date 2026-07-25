# 手稿星图 Manuscript Atlas

手稿星图是一款本地优先的 Electron 世界观资料管理工具。每个存档由 `project.json`、SQLite `world.db` 与本地 `assets/` 组成，支持角色、词条、事件、地点、时间线、关系网、地图、回收站、Markdown/PNG 导出，以及完整备份和恢复。

## 开发命令

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run package
```

- `test`：运行服务层与资料安全回归测试。
- `build`：执行 TypeScript 检查并构建主进程、preload 和 renderer。
- `package`：生成 Windows 目录包到 `release/win-unpacked/`。

## 本地资料边界

- 应用不依赖账号、云同步或远程 AI 服务。
- 活动存档使用 SQLite WAL；完整性检查与备份会先取得一致性数据库状态。
- 完整备份是明文 ZIP，持有备份文件即能读取其中的世界观资料，请按敏感文件保管。
- 恢复始终创建新存档，不覆盖来源存档。

## 主要目录

- `src/main/`：Electron 主进程、SQLite、IPC、素材、备份恢复与完整性检查。
- `src/renderer/`：React 界面与编辑工作流。
- `tests/main/`：数据库安全、备份替换、关闭保护与事务保存测试。
- `docs/`：版本审计与验收资料。

## 发布提醒

正式发布前仍需配置应用图标、author、Windows 签名证书、发布通道与升级策略。
