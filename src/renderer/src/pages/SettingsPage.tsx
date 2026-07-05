import { useState } from 'react';
import { Section } from '../components/Section';
import { integrityClient, type IntegrityReport } from '../services/integrityClient';
import type { Vault } from '../types/app';

interface SettingsPageProps {
  vault: Vault;
}

export function SettingsPage({ vault }: SettingsPageProps): JSX.Element {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState('');
  const rows = [
    ['存档信息', vault.name],
    ['数据位置', vault.path],
    ['自动保存', '已预留开关'],
    ['备份', '手动备份 / 自动备份占位'],
    ['UI 风格', '秋日旧纸'],
    ['关于软件', `Manuscript Atlas ${vault.appVersion}`]
  ];

  async function runIntegrityCheck(): Promise<void> {
    setChecking(true);
    setError('');
    try {
      setReport(await integrityClient.checkCurrentVault(vault));
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Section title="设置">
      <div className="mb-5 divide-y divide-sepia/15 rounded-md border border-sepia/20 bg-vellum">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-2 px-4 py-4 md:grid-cols-[180px_1fr]">
            <span className="font-medium text-ink">{label}</span>
            <span className="text-sepia">{value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-sepia/20 bg-vellum p-5">
        <div className="mb-4 flex flex-col gap-3 border-b border-sepia/15 pb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="ma-card-title text-ink">资料安全</h3>
            <p className="mt-2 text-sm leading-6 text-sepia">
              检查当前存档的数据库、项目资料与已关联素材是否完整。检查不会修改任何内容。
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={runIntegrityCheck} disabled={checking}>
            {checking ? '检查中...' : '检查当前存档完整性'}
          </button>
        </div>

        {error ? <div className="status-danger mb-4">{error}</div> : null}

        {report ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <SummaryItem label="总状态" value={statusLabel(report.summary.status)} tone={report.summary.status} />
              <SummaryItem label="本次检查时间" value={report.checkedAt} />
              <SummaryItem label="数据库状态" value={databaseStatusLabel(report)} />
              <SummaryItem label="已检查素材数量" value={String(report.summary.checkedAssetCount)} />
              <SummaryItem label="严重问题数量" value={String(report.summary.criticalCount)} tone={report.summary.criticalCount > 0 ? 'critical' : undefined} />
              <SummaryItem label="警告数量" value={String(report.summary.warningCount)} tone={report.summary.warningCount > 0 ? 'warning' : undefined} />
              <SummaryItem label="信息数量" value={String(report.summary.infoCount)} />
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold text-copper">问题列表</h4>
              {report.issues.length === 0 ? (
                <div className="rounded-md border border-sepia/15 bg-batter/35 p-4 text-sm text-sepia">未发现问题。</div>
              ) : (
                <div className="space-y-3">
                  {report.issues.map((issue) => (
                    <div key={issue.id} className="rounded-md border border-sepia/15 bg-batter/35 p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${severityClass(issue.severity)}`}>{severityLabel(issue.severity)}</span>
                        <span className="rounded bg-vellum px-2 py-1 text-xs text-copper">{categoryLabel(issue.category)}</span>
                      </div>
                      <p className="text-sm font-medium text-ink">{issue.message}</p>
                      {issue.entity ? <p className="mt-2 text-sm text-sepia">关联对象：{issue.entity.type} / {issue.entity.name}</p> : null}
                      {issue.relativePath ? <p className="mt-2 break-all text-sm text-sepia">相对路径：{issue.relativePath}</p> : null}
                      <p className="mt-2 text-sm text-sepia">建议处理方式：{issue.suggestion}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-sepia">尚未检查当前存档。</p>
        )}
      </div>
    </Section>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: IntegrityReport['summary']['status'] }): JSX.Element {
  return (
    <div className="rounded-md border border-sepia/15 bg-batter/35 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-copper">{label}</p>
      <p className={`mt-2 break-all text-sm font-medium ${toneClass(tone)}`}>{value}</p>
    </div>
  );
}

function statusLabel(status: IntegrityReport['summary']['status']): string {
  if (status === 'critical') return '发现严重问题';
  if (status === 'warning') return '需要注意';
  return '正常';
}

function databaseStatusLabel(report: IntegrityReport): string {
  return report.issues.some((issue) => issue.category === 'database' && issue.severity === 'critical') ? '异常' : '可读取';
}

function severityLabel(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return '严重问题';
  if (severity === 'warning') return '警告';
  return '信息';
}

function categoryLabel(category: 'project' | 'database' | 'schema' | 'asset' | 'reference'): string {
  const labels = {
    project: '项目资料',
    database: '数据库',
    schema: '结构版本',
    asset: '素材',
    reference: '资源引用'
  };
  return labels[category];
}

function toneClass(tone?: IntegrityReport['summary']['status']): string {
  if (tone === 'critical') return 'text-red-900';
  if (tone === 'warning') return 'text-copper';
  return 'text-ink';
}

function severityClass(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return 'bg-red-900 text-vellum';
  if (severity === 'warning') return 'bg-copper text-vellum';
  return 'bg-sepia/15 text-sepia';
}
