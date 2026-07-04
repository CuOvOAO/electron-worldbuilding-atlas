# 手稿星图 Manuscript Atlas

V0 可点击骨架原型。目标是验证本地桌面应用的信息架构、模块切换和视觉方向，不实现真实数据库、地图编辑、关系网算法或导出业务。

## 运行

```bash
npm.cmd install
npm.cmd run dev
```

如果使用 PowerShell 时 `npm` 被执行策略拦截，请使用 `npm.cmd`。

## 构建与目录包

```bash
npm.cmd run build
npm.cmd run package
```

`build` 会输出到 `out/`，`package` 会生成 Windows 目录包到 `release/win-unpacked/`。

## V0 页面

- 存档选择页
- 存档内部主工作区
- 首页
- 角色
- 词条
- 事件
- 地点
- 时间线
- 关系网
- 地图
- 草稿箱
- 导出
- 设置

## Mock 数据

所有存档、最近编辑、角色、词条、事件、地点和草稿数据都来自 `src/renderer/src/mock/data.ts`。当前按钮只负责静态展示和页面切换，不创建文件、不写数据库、不保存状态。

## 预留位置

- SQLite：`src/main/database.ts`
- Cytoscape.js：`src/renderer/src/pages/RelationGraphPage.tsx`
- Konva.js：`src/renderer/src/pages/MapEditorPage.tsx`
- Markdown 编辑器：`src/renderer/src/pages/DraftPage.tsx`

## 已知依赖风险

`npm audit` 当前报告 Electron 与 Vite/esbuild 链路存在 high severity advisories。`npm audit fix --force` 会引入破坏性版本变更，V0 未自动执行。正式开发前建议单独做依赖升级验证，并锁定可通过安全审计的 Electron / electron-vite / Vite 组合。

`electron-builder` 还提示当前使用默认 Electron 图标，`package.json` 未配置 author。正式发布前需要补应用图标、签名、发布配置和元数据。
