# V11 备份与恢复前置审计

## 1. 审计范围与结论摘要

1. 当前项目已经具备完整备份与恢复的基础：存档是一个本地目录，核心入口为 `project.json` + `world.db` + `assets/`，打开目录能力已存在。
2. 备份必须覆盖 `world.db` 以及 SQLite WAL/SHM 旁路文件，否则在 WAL 模式下可能备到过期数据库。
3. 当前素材引用总体采用 `assets.relative_path` + 业务表 asset id，而不是绝对路径，这是恢复后可搬迁的良好基础。
4. 最大路径风险是 `assets.relative_path` 由数据库保存，文件真实存在性只在读取时返回空 URL；缺失素材不会阻止打开，但会导致头像、立绘、地图底图丢失。
5. `asset:getUrl` 使用 `relativePath` 充当 asset id 注册协议 URL，和其他 `assetUrlForId` 调用不一致，未来若用于恢复校验或显示可能产生协议缓存/定位风险。
6. 新建存档预建 `assets/characters`、`assets/maps`、`assets/gallery`、`assets/drafts`，但真实导入图片写入 `assets/images`；备份逻辑不能只按预建目录白名单。
7. 当前导出能力只导出 Markdown 文本和地图 PNG 文件，不复制 Markdown 内图片，也不会把导出的 PNG 登记为存档资产。
8. 回收站不是独立目录或表，依赖各业务表的 `deleted_at` 字段；完整备份只要覆盖 `world.db` 就包含回收站状态。
9. 现有打开存档会自动运行 migration；恢复为新存档需要先解压和校验，再注册 recent，并避免打开时静默改写原备份内容。
10. 进入 V11-A 前需要补齐只读校验、SQLite 安全备份策略、ZIP 依赖或实现方案，以及备份包 manifest 设计。

## 2. 真实存档目录结构

以下结构只列当前代码确认的存档内文件和目录。

```text
<vault>/
├─ project.json
├─ world.db
├─ world.db-wal
├─ world.db-shm
├─ assets/
│  ├─ characters/
│  ├─ maps/
│  ├─ gallery/
│  ├─ drafts/
│  └─ images/
├─ exports/
└─ backups/
```

| 项 | 是否必须备份 | 当前由谁创建 | 代码位置 | 说明 |
|---|---:|---|---|---|
| `<vault>/` | 是 | `createVault(parentDir, name, description)` | `src/main/vault/vaultService.ts` | 目录名由 `safeFolderName` 得到；冲突时追加 `Date.now()`。 |
| `project.json` | 是 | `createVault` 写入，`readProject` 读取 | `src/main/vault/vaultService.ts` | 包含 `id/name/description/createdAt/updatedAt/appVersion`；不含 `path`，`path` 由读取时补入。 |
| `world.db` | 是 | `openDatabase(worldDbPath(vaultPath))` | `src/main/vault/vaultService.ts`, `src/main/db/connection.ts` | SQLite 主库文件；缺失时 `ensureVaultReady` 报错。 |
| `world.db-wal` | 是，如存在 | SQLite WAL 模式生成 | `src/main/db/connection.ts` | `PRAGMA journal_mode = WAL;` 已启用；备份时必须处理。 |
| `world.db-shm` | 是，如存在 | SQLite WAL 模式生成 | `src/main/db/connection.ts` | WAL 共享内存文件；离线复制时需与 WAL 策略一起处理。 |
| `assets/` | 是 | 多处按子目录创建 | `src/main/vault/vaultService.ts`, `src/main/ipc/assetIpc.ts` | 素材根目录；协议解析要求素材路径不能越出该目录。 |
| `assets/characters/` | 是/可空 | `createVault` | `src/main/vault/vaultService.ts` | 当前未确认有业务写入，但属于存档素材根的一部分。 |
| `assets/maps/` | 是/可空 | `createVault` | `src/main/vault/vaultService.ts` | 当前地图底图不写这里，而是复用 `assets/images`。 |
| `assets/gallery/` | 是/可空 | `createVault` | `src/main/vault/vaultService.ts` | 当前未确认有业务写入。 |
| `assets/drafts/` | 是/可空 | `createVault` | `src/main/vault/vaultService.ts` | 当前未确认有业务写入。 |
| `assets/images/` | 是 | `asset:importImage`, `asset:saveCroppedImage` 按需创建 | `src/main/ipc/assetIpc.ts` | 真实图片素材、头像/立绘裁剪结果、地图底图源文件都在这里。 |
| `exports/` | 建议备份但可作为用户导出产物分级处理 | `createVault`；导出默认路径使用 | `src/main/vault/vaultService.ts`, `src/main/ipc/exportIpc.ts` | Markdown 和地图 PNG 默认落点；用户也可选择存档外目录。 |
| `backups/` | 不建议包含当前备份自身；历史备份是否纳入未确认 | `createVault` | `src/main/vault/vaultService.ts` | 当前没有业务写入备份包；未来需避免备份套娃。 |

## 3. 数据库与 SQLite 风险

- 数据库文件实际位置：`worldDbPath(vaultPath)` 返回 `<vault>/world.db`，调用点包括 `ensureVaultReady`、数据 IPC、素材 IPC、导出 IPC。
- SQLite 打开方式：`openDatabase(dbPath)` 使用 `node:sqlite` 的 `DatabaseSync`，每次 `withDb` 打开、运行 migration、执行操作后 `db.close()`。
- WAL/SHM：`openDatabase` 每次执行 `PRAGMA journal_mode = WAL;`，因此运行后的存档可能存在 `world.db-wal` 和 `world.db-shm`。
- 备份风险：如果应用仍持有连接或 WAL 尚未 checkpoint，仅复制 `world.db` 可能缺失最近写入。V11-A 至少需要关闭/暂停写入后执行 checkpoint，或使用 SQLite backup API/一致性快照，并明确处理 `world.db-wal`、`world.db-shm`。
- migration 记录：`schema_migrations(version, name, applied_at)` 由 `runMigrations` 创建和维护，当前最高 migration 为 7。
- app version 记录：`project.json.appVersion` 在 `createVault` 中写死为 `APP_VERSION = '0.1.0'`；preload 暴露 `version: '0.0.1'`；`package.json.version` 为 `0.0.1`，三者当前不一致。
- 打开行为：`ensureVaultReady` 会读取 `project.json`、检查 `world.db` 存在，然后打开数据库并运行 migration。
- 回收站：没有独立回收站表。`listTrashItems` 从 `characters`、`character_versions`、`codex_items`、`events`、`locations`、`timelines`、`maps`、`manuscripts` 中读取 `deleted_at IS NOT NULL`。因此回收站状态包含在 `world.db` 内。

## 4. 资源与图片依赖表

| 资源类型 | 当前保存位置 | 数据库/JSON 引用字段 | 路径形式 | 完整备份是否必须包含 | 恢复后潜在断链风险 | 相关代码路径 |
|---|---|---|---|---:|---|---|
| 素材库原图 | `<vault>/assets/images/<date>_<uuid>_<original>` | `assets.relative_path`, `assets.original_name`, `assets.mime_type` | 相对路径，形如 `assets/images/...` | 是 | 若只备份预建的 `assets/gallery/maps/characters/drafts` 会漏掉真实素材；文件缺失时列表显示缺失或 URL 为空。 | `src/main/ipc/assetIpc.ts`, `src/main/assets/assetProtocol.ts` |
| 角色头像 | 原图或裁剪图均在 `<vault>/assets/images/` | `characters.avatar_asset_id` -> `assets.id` -> `assets.relative_path` | asset id + 相对路径 | 是 | `asset:deleteAsset` 会将头像字段置空；备份缺文件会显示占位，恢复后头像丢失。 | `src/main/db/migrations.ts`, `src/main/ipc/dataIpc.ts`, `src/renderer/src/pages/character/CharacterDetailView.tsx` |
| 角色立绘 | 原图或裁剪图均在 `<vault>/assets/images/` | `characters.full_body_asset_id` -> `assets.id` -> `assets.relative_path` | asset id + 相对路径 | 是 | 同头像；文件缺失时 URL 为空或图片加载失败。 | `src/main/db/migrations.ts`, `src/main/ipc/dataIpc.ts`, `src/renderer/src/pages/character/CharacterDetailView.tsx` |
| 裁剪结果 | `<vault>/assets/images/crop_avatar_*.png` 或 `crop_fullbody_*.png` | 新增 `assets` 行，再由角色草稿保存到 `characters.*_asset_id` | asset id + 相对路径 | 是 | 裁剪确认后即写文件和资产行；若用户未保存角色，可能出现未使用资产，但仍属于素材库。 | `src/main/ipc/assetIpc.ts`, `src/renderer/src/pages/character/CharacterDetailView.tsx` |
| 地图底图 | `<vault>/assets/images/` | `maps.background_asset_id` -> `assets.id` -> `assets.relative_path` | asset id + 相对路径 | 是 | 缺文件时 `backgroundAssetUrl` 为空，地图可打开但底图丢失；`asset:deleteAsset` 当前不会清空 `maps.background_asset_id`。 | `src/main/db/migrations.ts`, `src/main/ipc/dataIpc.ts`, `src/renderer/src/pages/location/LocationMapView.tsx` |
| 地图对象附件 | 未确认 | 未确认；`map_objects.properties_json` 目前保存标签文本等属性，未确认文件附件字段 | 未确认 | 未确认 | 目前未发现附件导入路径；未来若把文件路径放进 JSON，需要纳入校验。 | `src/main/ipc/dataIpc.ts`, `src/renderer/src/pages/location/LocationMapView.tsx` |
| 地图导出 PNG | 默认 `<vault>/exports/<map>.png`，也可选任意目录 | 无数据库登记 | 文件系统路径由用户选择；不进入 `assets` | 建议包含 `exports/`，但不作为恢复打开必要条件 | 若导出在存档外目录，完整备份不会自然包含；当前导出成果不是存档依赖。 | `src/main/ipc/exportIpc.ts`, `src/renderer/src/pages/ExportPage.tsx`, `src/renderer/src/services/mapPngRenderer.ts` |
| Markdown 导出文件 | 默认 `<vault>/exports/<project>_*.md`，也可选任意路径 | 无数据库登记 | 文件系统路径由用户选择 | 建议包含 `exports/`，但不作为恢复打开必要条件 | 当前 Markdown 只导出文本，不复制或引用图片；存档外导出不在备份范围内。 | `src/main/ipc/exportIpc.ts`, `src/renderer/src/pages/ExportPage.tsx` |
| 地点图片 | 未实现 | `locations` 表只有 `name/type/summary/body/export_enabled`，未发现图片字段 | 无 | 不适用 | 未来接入地点图片时需新增字段或复用 asset id，并迁入备份校验。 | `src/main/db/migrations.ts`, `src/main/ipc/dataIpc.ts`, `src/renderer/src/pages/location/LocationRecordsView.tsx` |

## 5. 当前可复用能力

| 能力 | 可复用点 | 文件路径与函数/模块名 | 备注 |
|---|---|---|---|
| IPC 注册 | 新增备份/恢复 IPC 可沿用主进程注册模式 | `src/main/index.ts` 的 `registerVaultIpc/registerDataIpc/registerExportIpc/registerAssetIpc` | 建议新增独立 `backupIpc.ts` 或扩展 `vaultIpc.ts`。 |
| preload 暴露 | 类型化暴露给渲染层 | `src/main/preload.ts` 的 `contextBridge.exposeInMainWorld` | 需同步更新 `src/renderer/src/types/electron.d.ts`。 |
| 打开目录对话框 | 选择存档目录、选择导出目录 | `src/main/ipc/vaultIpc.ts` 的 `vault:openDialog`, `vault:chooseDirectory`; `src/main/ipc/exportIpc.ts` 的 `showOpenDialog` | 恢复目标目录选择可复用。 |
| 保存文件对话框 | 选择 Markdown/PNG 输出文件 | `src/main/ipc/exportIpc.ts` 的 `export:markdown`, `export:mapPng` | V11-A 备份 ZIP 保存位置可复用模式。 |
| 目录创建 | 递归创建存档目录与素材目录 | `src/main/vault/vaultService.ts` 的 `createVault`; `src/main/ipc/assetIpc.ts` 的 `mkdirSync(imagesDir, { recursive: true })` | 恢复阶段需要更强的冲突检测和临时目录。 |
| 文件复制 | 导入图片复制到存档资产目录 | `src/main/ipc/assetIpc.ts` 的 `copyFileSync(sourcePath, targetPath)` | 当前只有单文件复制，无递归复制工具。 |
| 文件写入 | 写 `project.json`、裁剪 PNG、Markdown、地图 PNG | `vaultService.ts`, `assetIpc.ts`, `exportIpc.ts` | V11 需要安全写入和失败清理。 |
| 数据库打开/关闭 | 每次操作打开、migration、关闭 | `src/main/db/connection.ts` 的 `openDatabase`; 各 IPC 的 `withDb` | 可复用关闭纪律，但备份需要 checkpoint/一致性策略。 |
| migration | 版本表和事务应用 | `src/main/db/migrations.ts` 的 `runMigrations` | 恢复校验可读取 `schema_migrations`。 |
| 导出逻辑 | 内容导出、地图渲染 PNG | `src/main/ipc/exportIpc.ts`, `src/renderer/src/pages/ExportPage.tsx`, `src/renderer/src/services/mapPngRenderer.ts` | 可复用错误处理和对话框，不等同完整备份。 |
| 错误提示 | IPC 返回 `{ ok:false,error }`，renderer unwrap 抛错 | `vaultClient.ts`, `assetClient.ts`, `exportClient.ts`, `dataClient.ts` | 备份/恢复客户端应沿用。 |
| 存档打开和注册 | 打开目录、校验、加入最近列表 | `src/main/ipc/vaultIpc.ts`, `src/main/vault/vaultService.ts` 的 `ensureVaultReady`, `addRecentVault` | V11-B 恢复后注册可复用。 |
| 路径安全 | 素材相对路径越界防护 | `src/main/assets/assetProtocol.ts` 的 `resolveAssetPath` | 备份校验可复用该思路检查 asset path。 |

## 6. V11-A 完整备份 ZIP 的实现边界

### 备份包建议结构

```text
manuscript-atlas-backup.zip
├─ manifest.json
└─ vault/
   ├─ project.json
   ├─ world.db
   ├─ world.db-wal 或 checkpoint 后省略
   ├─ world.db-shm 或 checkpoint 后省略
   ├─ assets/
   ├─ exports/
   └─ backups/（建议默认排除，或只记录清单不递归打包）
```

### 必须包含

- `vault/project.json`
- `vault/world.db`
- SQLite 一致性所需内容：推荐 checkpoint 后复制 `world.db`；若不 checkpoint，则同时包含 `world.db-wal` 和 `world.db-shm`
- `vault/assets/**`，尤其是真实使用的 `assets/images/**`
- `manifest.json`：备份格式版本、生成时间、应用版本、存档 id/name、schema migration 最高版本、文件清单、校验和

### 必须排除或谨慎处理

- `node_modules/`、`out/`、`release/` 等工程目录不属于存档。
- `backups/` 默认应排除，避免备份包套备份包无限膨胀；如要保留历史备份，应作为显式选项。
- 当前正在生成的目标 ZIP 不能位于被递归打包目录中；若用户保存到 `<vault>/backups`，必须先写临时文件并排除目标文件。
- 系统临时文件、`Thumbs.db`、`.DS_Store` 可排除。

### 打包前应做的校验

- `ensureVaultReady(vaultPath)` 能通过。
- `project.json` 字段完整，并记录 `appVersion`。
- `schema_migrations` 可读取，最高版本不高于当前代码支持版本。
- `assets.relative_path` 均为相对路径，且通过类似 `resolveAssetPath` 的越界检查。
- 所有未删除且被引用的 `characters.avatar_asset_id`、`characters.full_body_asset_id`、`maps.background_asset_id` 均能找到未删除 `assets` 行和实体文件。
- 检查 `world.db-wal` 是否存在；存在时选择 checkpoint 或一并纳入备份。
- 检查目标 ZIP 路径不会覆盖现有存档核心文件。

### 需要新增或修改的文件列表

- 新增：`src/main/ipc/backupIpc.ts`，负责备份 IPC、ZIP 写入、manifest、校验、SQLite 安全快照。
- 修改：`src/main/index.ts`，注册备份 IPC。
- 修改：`src/main/preload.ts`，暴露 `backup.createFullBackup`。
- 修改：`src/renderer/src/types/electron.d.ts`，补充备份 IPC 类型。
- 新增：`src/renderer/src/services/backupClient.ts`，封装备份调用和错误处理。
- 修改：备份入口所在页面，可能是 `src/renderer/src/pages/SettingsPage.tsx` 或 `src/renderer/src/pages/ExportPage.tsx`，具体入口待 V11 UI 决策。
- 可选新增：`src/main/backup/backupService.ts`，将业务逻辑从 IPC 中拆出。

### 是否需要新增依赖

- 当前 `package.json` 没有直接可用的 ZIP 创建依赖。建议新增一个明确业务依赖，例如 `archiver` 或等价库；不要依赖 Electron/electron-builder 的间接 `extract-zip/unzipper`。
- 若选择 Node 原生能力，当前代码未见 ZIP 创建实现，仍需新增封装。

## 7. V11-B 恢复为新存档的实现边界

### 恢复流程

1. 用户选择备份 ZIP。
2. 主进程解压到临时目录，而不是直接解压到最终存档目录。
3. 读取并校验 `manifest.json` 与 `vault/project.json`。
4. 校验 `vault/world.db`、migration 版本、核心表、素材路径越界、关键素材文件存在性。
5. 用户选择恢复目标父目录和新存档名称。
6. 生成不冲突的新目录名；不得覆盖原存档或任意现有目录。
7. 将临时目录中的 `vault/` 内容复制到最终新目录。
8. 更新恢复后 `project.json`：至少 `id`、`name`、`updatedAt` 是否重写需要产品决策；若目标是“恢复为新存档”，建议生成新 id 并保留 `restoredFrom` 元信息，但当前 schema 不支持该字段，需设计。
9. 运行 `ensureVaultReady(newVaultPath)` 做打开校验。
10. 调用 `addRecentVault` 注册并返回给渲染层打开。
11. 清理临时目录；失败时不得留下半成品，或必须标记为可人工清理的 `.incomplete`。

### 路径冲突处理

- 目标父目录不存在时拒绝。
- 目标存档目录存在时不覆盖，使用 `safeFolderName(name)` 加时间戳或提示用户改名。
- 备份中若包含绝对路径字段，应拒绝或迁移；当前确认的素材引用字段为相对路径/asset id。
- 禁止恢复到当前打开存档目录内部，避免递归、覆盖和 recent 注册混乱。

### 如何保证不覆盖原存档

- 所有解压先进入系统临时目录。
- 最终写入目录必须是新建目录，创建前检查不存在，创建后再复制。
- 不允许用户选择现有存档根作为恢复目标。
- 不复用原 `vault.path`，recent 只注册新的 `path`。

### 解压、校验、注册、打开顺序

```text
选择 ZIP -> 临时解压 -> 校验 manifest/project/db/assets -> 选择目标父目录/名称 -> 创建新目录 -> 复制 vault 内容 -> 必要时重写 project.json -> ensureVaultReady -> addRecentVault -> 返回并打开 -> 清理临时目录
```

### 需要新增或修改的文件列表

- 新增或扩展：`src/main/ipc/backupIpc.ts`，增加 `backup:restoreAsNewVault`。
- 新增：`src/main/backup/restoreService.ts` 或同等模块，负责临时解压、校验、复制、清理。
- 修改：`src/main/index.ts`，注册恢复 IPC。
- 修改：`src/main/preload.ts` 和 `src/renderer/src/types/electron.d.ts`，暴露恢复 API。
- 新增：`src/renderer/src/services/backupClient.ts` 或扩展同文件。
- 修改：`src/renderer/src/pages/VaultSelectPage.tsx`，添加“从备份恢复为新存档”的入口更合理，因为恢复结果需要打开新存档。
- 可复用但可能需导出：`src/main/vault/vaultService.ts` 的 `safeFolderName` 当前是内部函数；恢复命名冲突策略需要同类逻辑。

## 8. 风险清单

### P0

| 风险 | 触发条件 | 当前证据 | 建议处理方式 |
|---|---|---|---|
| 只复制 `world.db` 导致恢复后数据缺失或打不开 | SQLite 处于 WAL 模式且最近写入仍在 `world.db-wal` | `openDatabase` 固定执行 `PRAGMA journal_mode = WAL;` | V11-A 必须实现 checkpoint/SQLite backup API 或同时复制 `world.db`、`world.db-wal`、`world.db-shm`，并在 manifest 中记录策略。 |
| 恢复直接写入现有目录导致原存档被覆盖 | 用户选择原存档目录或已有目录作为恢复目标 | 当前 `createVault` 有目录冲突改名，但恢复流程尚不存在；`openPath` 会直接打开给定路径 | V11-B 必须临时解压、校验后新建不冲突目录，拒绝覆盖现有目录。 |
| 备份漏掉 `assets/images` 导致头像、立绘、底图丢失 | 备份实现按新建存档预建目录白名单打包 | `createVault` 预建 `assets/characters/maps/gallery/drafts`，但 `assetIpc` 真实写入 `assets/images` | 备份必须递归包含整个 `assets/`，并用数据库引用校验文件存在性。 |

### P1

| 风险 | 触发条件 | 当前证据 | 建议处理方式 |
|---|---|---|---|
| 地图底图 asset 被删除后仍残留引用 | 用户从素材库删除正被地图使用的图片 | `asset:deleteAsset` 只清空 `characters.avatar_asset_id/full_body_asset_id`，未清空 `maps.background_asset_id` | 删除素材时统计并处理地图引用；备份前将 `maps.background_asset_id` 缺失列为阻断或强警告。 |
| app/schema 版本判断不可靠 | 备份由不同版本创建或恢复到旧版本应用 | `package.json.version` 和 preload `version` 为 `0.0.1`，`vaultService.APP_VERSION` 为 `0.1.0`，migration 当前最高 7 | V11 manifest 使用统一版本来源，并记录/校验 migration 最高版本。 |
| 打开存档会自动 migration，恢复校验可能改变备份内容 | 恢复后立即 `ensureVaultReady` 打开旧 schema 数据库 | `ensureVaultReady` 调用 `runMigrations(db)` | 恢复流程先在临时副本校验版本，再决定是否允许迁移最终新存档；不要直接修改解压源包。 |
| `asset:getUrl` 的 asset id 使用不一致 | 某处用 `assetClient.getUrl(vaultPath, relativePath)` 显示资源 | `assetIpc` 中 `asset:getUrl` 调用 `assetUrl(vaultPath, relativePath, relativePath)` | 统一协议注册用真实 `assets.id`；恢复校验不要依赖该接口判断资产完整性。 |
| 导出产物可能在存档外，完整备份语义不清 | 用户导出 Markdown/PNG 到任意目录 | `exportIpc` 使用 `showSaveDialog`/`showOpenDialog`，用户可选择任意路径 | V11-A 明确定义只备份存档目录内 `exports/`；存档外导出不属于完整存档。 |

### P2

| 风险 | 触发条件 | 当前证据 | 建议处理方式 |
|---|---|---|---|
| `backups/` 目录未来可能造成备份套娃 | 用户把备份 ZIP 存在 `<vault>/backups` | `createVault` 预建 `backups`，当前无业务写入 | 默认排除 `backups/` 或排除当前输出文件，并在文案中说明。 |
| 未使用素材也会进入完整备份导致包体膨胀 | 用户多次裁剪或导入但未绑定 | 裁剪确认会新增 assets 行，角色保存前可能未绑定 | 完整备份仍应包含所有未删除 assets；后续可做素材清理工具，不在 V11-A 阻断。 |
| 地点图片尚未实现，未来字段设计可能影响备份 | 后续给地点加图片 | `locations` 表没有图片字段，地点页未见图片导入 | V11-C/D 验收时补地点图片用例；若新增字段，优先复用 asset id。 |
| README 与真实实现过期 | 依据 README 判断项目仍为 mock | README 仍描述 V0 mock，代码已有真实 SQLite/地图/导出 | V11 文档应以代码为准；后续可单独更新 README，不属于本轮。 |

## 9. 给下一阶段的明确任务拆分

- V11-A：实现完整备份 ZIP。范围包括备份 IPC、ZIP 依赖/封装、SQLite 一致性快照、manifest、素材引用校验、目标保存对话框、错误提示与只读验收用例。
- V11-B：实现“恢复为新存档”。范围包括选择 ZIP、临时解压、manifest/db/assets 校验、目录冲突处理、复制到新目录、必要的 `project.json` 新身份策略、注册 recent、打开新存档、失败清理。
- V11-C：实现资料安全验收与断链检测。范围包括资产缺失检测、地图底图引用检测、回收站恢复/永久删除一致性检查、导出产物边界说明、版本兼容提示。
- V11-D：做全流程验收与文档收口。范围包括新建存档、导入素材、角色头像/立绘、地图底图、地图对象链接、回收站、Markdown/PNG 导出、完整备份、恢复为新存档的端到端人工验收清单。
