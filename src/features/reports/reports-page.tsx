import { useQuery } from '@tanstack/react-query';
import {
  Cpu,
  Download,
  FileText,
  Layers,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import { CerberusLogo } from '../../components/cerberus-logo';
import { Button, PageSkeleton, Panel } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface RoadmapReportItem {
  id: string;
  name: string;
  specialization: string;
  domainName: string;
  totalTasks: number;
  approvedTasks: number;
  totalCheckpoints: number;
  approvedCheckpoints: number;
}

interface HardwareItem {
  id: string;
  name: string;
  model: string;
  serial_number: string;
  quantity: number;
  unit_cost: number | null;
  condition: string;
  currentHolder?: string | null;
}

interface BlockerItem {
  id: string;
  title: string;
  severity: string;
  status: string;
  description: string;
  resolution_notes?: string | null;
  reporterName: string;
  created_at: number;
}

export function ReportsPage() {
  const [reportType, setReportType] = useState<'progress' | 'hardware' | 'security'>('progress');
  const [reportTimestamp] = useState(() => Math.floor(Date.now() / 1000));

  const roadmapsQuery = useQuery({
    queryKey: ['report-roadmaps'],
    queryFn: () => api<RoadmapReportItem[]>('/users/roadmaps/all'),
  });

  const hardwareQuery = useQuery({
    queryKey: ['report-hardware'],
    queryFn: () => api<HardwareItem[]>('/workspace/hardware'),
  });

  const blockersQuery = useQuery({
    queryKey: ['report-blockers'],
    queryFn: () => api<BlockerItem[]>('/workspace/blockers'),
  });

  const handlePrint = () => {
    window.print();
  };

  const exportPath = reportType === 'progress'
    ? '/api/v1/reports/progress.csv'
    : reportType === 'hardware'
      ? '/api/v1/reports/hardware.csv'
      : '/api/v1/reports/blockers.csv';

  const pdfPath = reportType === 'progress'
    ? '/api/v1/reports/progress.pdf'
    : reportType === 'hardware'
      ? '/api/v1/reports/hardware.pdf'
      : '/api/v1/reports/blockers.pdf';

  return (
    <div className="page reports-page">
      {/* Screen Toolbar (hidden in print) */}
      <header className="page-header no-print">
        <div>
          <span className="breadcrumb">Executive Disclosures</span>
          <h1>System Reports & PDF Artifacts</h1>
          <p>Exportable, printable engineering progress disclosures, hardware asset ledgers, and operational audits.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            className="button inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors border border-steel bg-graphite text-slate-100 hover:bg-steel/60 h-8 px-3 text-xs"
            href={exportPath}
            download
          >
            <Download size={16} /> Export CSV
          </a>
          <a
            className="button inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors border border-steel bg-graphite text-slate-100 hover:bg-steel/60 h-8 px-3 text-xs"
            href={pdfPath}
            download
          >
            <FileText size={16} /> Download server PDF
          </a>
          <Button variant="primary" size="sm" onClick={handlePrint}>
            <Printer size={16} /> Print / Save as PDF
          </Button>
        </div>
      </header>

      {/* Report Switcher Tabs (hidden in print) */}
      <Panel className="task-toolbar no-print" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <Button
          variant={reportType === 'progress' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setReportType('progress')}
        >
          <Layers size={15} /> Discipline Progress Ledger
        </Button>
        <Button
          variant={reportType === 'hardware' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setReportType('hardware')}
        >
          <Cpu size={15} /> Hardware Asset Inventory
        </Button>
        <Button
          variant={reportType === 'security' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setReportType('security')}
        >
          <ShieldAlert size={15} /> Operational Security & Blockers
        </Button>
      </Panel>

      {/* Printable Report Canvas */}
      <div className="printable-report-canvas" style={{ background: '#0a0d14', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '36px', color: '#e2e8f0' }}>
        {/* Header Block */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--color-border)', paddingBottom: '20px', marginBottom: '24px' }}>
          <CerberusLogo size="md" showSubtitle={true} />
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>
              OFFICIAL VERIFICATION REPORT
            </span>
            <strong style={{ fontSize: '1.2rem', display: 'block' }}>
              {reportType === 'progress' ? 'Discipline Roadmap Progress Summary' : reportType === 'hardware' ? 'Hardware Asset & Testbed Ledger' : 'Blocker & Security Resolution Audit'}
            </strong>
            <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>
              Generated on {formatDate(reportTimestamp)} · Academic Graduation Project
            </small>
          </div>
        </div>

        {/* Report 1: Progress Summary */}
        {reportType === 'progress' && (
          <div>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '14px', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              Discipline Engineering Status (6 Autonomous Roadmaps)
            </h2>

            {roadmapsQuery.isLoading ? (
              <PageSkeleton />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-muted)' }}>
                    <th style={{ padding: '8px' }}>Discipline Lead</th>
                    <th style={{ padding: '8px' }}>Domain</th>
                    <th style={{ padding: '8px' }}>Tasks Completed</th>
                    <th style={{ padding: '8px' }}>Checkpoints Cleared</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {roadmapsQuery.data?.map((m) => {
                    const percent = m.totalTasks ? Math.round((m.approvedTasks / m.totalTasks) * 100) : 0;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid var(--color-surface-subtle)' }}>
                        <td style={{ padding: '10px 8px' }}>
                          <strong>{m.name}</strong>
                          <small style={{ display: 'block', color: 'var(--color-muted)' }}>{m.specialization}</small>
                        </td>
                        <td style={{ padding: '10px 8px' }}>{m.domainName ?? 'Core System'}</td>
                        <td style={{ padding: '10px 8px' }}>
                          <strong>{m.approvedTasks}</strong> / {m.totalTasks} approved
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <strong>{m.approvedCheckpoints}</strong> / {m.totalCheckpoints} verified
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          <strong>{percent}%</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Report 2: Hardware Asset Ledger */}
        {reportType === 'hardware' && (
          <div>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '14px', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              Hardware & Component Inventory Ledger
            </h2>

            {hardwareQuery.isLoading ? (
              <PageSkeleton />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-muted)' }}>
                    <th style={{ padding: '8px' }}>Component Name</th>
                    <th style={{ padding: '8px' }}>Model / Serial</th>
                    <th style={{ padding: '8px' }}>Quantity</th>
                    <th style={{ padding: '8px' }}>Condition</th>
                    <th style={{ padding: '8px' }}>Unit Cost</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {hardwareQuery.data?.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-surface-subtle)' }}>
                      <td style={{ padding: '10px 8px' }}><strong>{item.name}</strong></td>
                      <td style={{ padding: '10px 8px' }}>
                        <span>{item.model || '—'}</span>
                        {item.serial_number && <small style={{ display: 'block', color: 'var(--color-muted)' }}>{item.serial_number}</small>}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{item.quantity} units</td>
                      <td style={{ padding: '10px 8px', textTransform: 'capitalize' }}>{item.condition}</td>
                      <td style={{ padding: '10px 8px' }}>{item.unit_cost !== null ? `$${Number(item.unit_cost).toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        {item.currentHolder ? `Checked out: ${item.currentHolder}` : 'Lab Available'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Report 3: Security & Blocker Audit */}
        {reportType === 'security' && (
          <div>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '14px', borderBottom: '1px solid var(--color-border)', paddingBottom: '6px' }}>
              Critical Engineering Blockers & Operational Anomalies
            </h2>

            {blockersQuery.isLoading ? (
              <PageSkeleton />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {blockersQuery.data?.map((blocker) => (
                  <div key={blocker.id} style={{ padding: '14px', background: 'var(--color-surface-subtle)', borderRadius: '4px', borderLeft: `4px solid ${blocker.status === 'resolved' ? 'var(--color-status-approved)' : 'var(--color-status-blocked)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong>{blocker.title}</strong>
                      <span style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
                        {blocker.severity} · {blocker.status}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '0.85rem' }}>{blocker.description}</p>
                    {blocker.resolution_notes && (
                      <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--color-status-approved)' }}>
                        <strong>Resolution Verified: </strong>{blocker.resolution_notes}
                      </div>
                    )}
                    <small style={{ color: 'var(--color-muted)', display: 'block', marginTop: '6px' }}>
                      Reported by {blocker.reporterName} on {formatDate(blocker.created_at)}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '36px', borderTop: '1px solid var(--color-border)', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          <span>CERBERUS Autonomous IoT Cyber Defense Platform</span>
          <span>Verified Cryptographic Sentinel Record</span>
        </div>
      </div>
    </div>
  );
}
