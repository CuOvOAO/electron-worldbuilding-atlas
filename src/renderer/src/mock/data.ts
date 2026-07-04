import type { ModuleKey, RecentItem, Vault } from '../types/app';

export const vaults: Vault[] = [
  {
    id: 'north-archive',
    name: '北境旧卷',
    description: '围绕雪原王国、白塔城与失落血脉的长篇设定档案。',
    createdAt: '2026-06-12 22:10',
    updatedAt: '2026-06-12 22:10',
    appVersion: '0.1.0',
    path: '',
    coverTone: 'from-[#d9bc7f] to-[#8d6240]'
  },
  {
    id: 'floating-city',
    name: '浮城纪事',
    description: '空岛群、机械教团与航线传说的世界观草稿。',
    createdAt: '2026-06-09 18:42',
    updatedAt: '2026-06-09 18:42',
    appVersion: '0.1.0',
    path: '',
    coverTone: 'from-[#cfb58b] to-[#6f7b71]'
  },
  {
    id: 'mirror-au',
    name: '镜面 AU',
    description: '同一组角色在镜像都市中的 if 线版本整理。',
    createdAt: '2026-05-28 09:35',
    updatedAt: '2026-05-28 09:35',
    appVersion: '0.1.0',
    path: '',
    coverTone: 'from-[#ead8a6] to-[#79533b]'
  }
];

export const modules: Array<{ key: ModuleKey; label: string }> = [
  { key: 'home', label: '首页' },
  { key: 'characters', label: '角色' },
  { key: 'codex', label: '词条' },
  { key: 'events', label: '事件' },
  { key: 'locations', label: '地点' },
  { key: 'timeline', label: '时间线' },
  { key: 'manuscripts', label: '手稿箱' },
  { key: 'export', label: '导出' },
  { key: 'settings', label: '设置' },
  { key: 'trash', label: '回收站' }
];

export const recentItems: RecentItem[] = [
  { kind: '角色', title: '艾琳', detail: '更新了正史线版本的心理侧写' },
  { kind: '词条', title: '旧王族', detail: '补充了血脉继承段落' },
  { kind: '事件', title: '北境战争', detail: '调整了开始时间文本' },
  { kind: '地点', title: '白塔城', detail: '新增相关事件占位' },
  { kind: '手稿', title: '雪夜初遇', detail: '标记为可导出手稿' }
];

export const quickAdds = ['新建角色', '新建词条', '新建事件', '新建地点', '新建地图', '新建手稿'];

export const characters = [
  { name: '艾琳', line: '白塔城的年轻记录官，习惯把危险写进边注。' },
  { name: '洛岚', line: '旧王族旁支的继承者，身份始终保持模糊。' },
  { name: '赛文', line: '北境战争幸存者，负责连接主线与 if 线。' }
];

export const codexEntries = ['旧王族', '星轨历法', '白塔誓约', '无名卷宗'];
export const events = ['北境战争', '白塔失火', '旧王加冕', '雪夜初遇'];
export const locations = ['白塔城', '北境要塞', '灰港', '旧王陵'];
export const manuscripts = ['雪夜初遇', '加冕前夜', '灰港来信'];
