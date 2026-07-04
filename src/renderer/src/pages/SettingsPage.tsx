import { Section } from '../components/Section';
import type { Vault } from '../types/app';

interface SettingsPageProps {
  vault: Vault;
}

export function SettingsPage({ vault }: SettingsPageProps): JSX.Element {
  const rows = [
    ['存档信息', vault.name],
    ['数据位置', vault.path],
    ['自动保存', '已预留开关'],
    ['备份', '手动备份 / 自动备份占位'],
    ['UI 风格', '秋日旧纸'],
    ['关于软件', `Manuscript Atlas ${vault.appVersion}`]
  ];

  return (
    <Section title="设置">
      <div className="divide-y divide-sepia/15 rounded-md border border-sepia/20 bg-vellum">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-2 px-4 py-4 md:grid-cols-[180px_1fr]">
            <span className="font-medium text-ink">{label}</span>
            <span className="text-sepia">{value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
