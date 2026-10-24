import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Check,
  Download,
  FlaskConical,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, PageSkeleton } from '../../components/ui';
import { api, apiWithMeta, formatDate, type PageMeta } from '../../lib/api';

interface Metric {
  name: string;
  value: number | null;
  text: string | null;
  unit: string | null;
  observed: boolean;
}

interface ExperimentRun {
  id: string;
  runNumber: number;
  actualResults: string;
  validationNotes: string;
  performedAt: number;
  performedByName: string;
  taskId: string | null;
  taskTitle: string | null;
  checkpointId: string | null;
  checkpointTitle: string | null;
  inputParameters: Record<string, unknown>;
  metrics: Metric[];
}

interface ExperimentSummary {
  id: string;
  experiment_code: string;
  title: string;
}

interface TaskOption {
  id: string;
  title: string;
}

interface CheckpointOption {
  id: string;
  title: string;
}

interface MetricDraft {
  name: string;
  value: string;
  text: string;
  unit: string;
}

const PAGE_SIZE = 10;

export function ExperimentRunsPanel({
  experiment,
  canRecord,
  onClose,
}: {
  experiment: ExperimentSummary;
  canRecord: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(1);
  const [metricName, setMetricName] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [actualResults, setActualResults] = useState('');
  const [validationNotes, setValidationNotes] = useState('');
  const [taskId, setTaskId] = useState('');
  const [checkpointId, setCheckpointId] = useState('');
  const [metrics, setMetrics] = useState<MetricDraft[]>([{ name: '', value: '', text: '', unit: '' }]);

  useEffect(() => {
    closeRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const runsQuery = useQuery({
    queryKey: ['experiment-runs', experiment.id, page],
    queryFn: () => apiWithMeta<ExperimentRun[], PageMeta>(
      `/workspace/experiments/${experiment.id}/runs?page=${page}&limit=${PAGE_SIZE}`,
    ),
  });

  const allRunsQuery = useQuery({
    queryKey: ['experiment-runs', experiment.id, 'all'],
    queryFn: () => apiWithMeta<ExperimentRun[], PageMeta>(
      `/workspace/experiments/${experiment.id}/runs?page=1&limit=100`,
    ),
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'experiment-link'],
    queryFn: () => api<TaskOption[]>('/tasks?limit=100'),
    enabled: formOpen,
  });

  const checkpointsQuery = useQuery({
    queryKey: ['checkpoints', 'experiment-link'],
    queryFn: () => api<CheckpointOption[]>('/tasks/checkpoints'),
    enabled: formOpen,
  });

  const recordRun = useMutation({
    mutationFn: () => api<{ runNumber: number }>(`/workspace/experiments/${experiment.id}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        inputParameters: {},
        actualResults,
        validationNotes,
        taskId: taskId || null,
        checkpointId: checkpointId || null,
        metrics: metrics
          .filter((metric) => metric.name.trim() && (metric.value !== '' || metric.text.trim()))
          .map((metric) => ({
            name: metric.name,
            value: metric.value === '' ? null : Number(metric.value),
            text: metric.text.trim() || null,
            unit: metric.unit,
            observed: true,
          })),
      }),
    }),
    onSuccess: (data) => {
      setFeedback(`Run #${data.runNumber} recorded.`);
      setFormOpen(false);
      setActualResults('');
      setValidationNotes('');
      setTaskId('');
      setCheckpointId('');
      setMetrics([{ name: '', value: '', text: '', unit: '' }]);
      void queryClient.invalidateQueries({ queryKey: ['experiment-runs', experiment.id] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : 'Run could not be recorded'),
  });

  const runs = runsQuery.data?.data ?? [];
  const allRuns = allRunsQuery.data?.data ?? [];
  const meta = runsQuery.data?.meta;
  const total = meta?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const numericMetrics = new Map<string, string>();
  for (const run of allRuns) {
    for (const metric of run.metrics) {
      if (metric.value !== null && !numericMetrics.has(metric.name)) {
        numericMetrics.set(metric.name, metric.unit ?? '');
      }
    }
  }
  const activeMetric = metricName && numericMetrics.has(metricName) ? metricName : [...numericMetrics.keys()][0] ?? '';
  const chartData = [...allRuns].reverse().flatMap((run) => {
    const metric = run.metrics.find((candidate) => candidate.name === activeMetric);
    return metric && metric.value !== null
      ? [{ label: `#${run.runNumber}`, value: metric.value }]
      : [];
  });

  const selectedRuns = selectedRunIds
    .map((id) => allRuns.find((run) => run.id === id))
    .filter((run): run is ExperimentRun => Boolean(run));

  const comparisonNames = [...new Set(selectedRuns.flatMap((run) => run.metrics.map((metric) => metric.name)))];

  const toggleRun = (runId: string) => {
    setSelectedRunIds((current) => {
      if (current.includes(runId)) return current.filter((id) => id !== runId);
      if (current.length >= 2) return [current[1], runId];
      return [...current, runId];
    });
  };

  const updateMetric = (index: number, patch: Partial<MetricDraft>) => {
    setMetrics((current) => current.map((metric, position) => position === index ? { ...metric, ...patch } : metric));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card experiment-explorer" role="dialog" aria-modal="true" aria-labelledby="experiment-explorer-title">
        <header className="experiment-explorer-header">
          <div>
            <span className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)' }}>{experiment.experiment_code}</span>
            <h2 id="experiment-explorer-title">{experiment.title}</h2>
            <p>Run history, metric trends and side-by-side validation evidence.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              className="button inline-flex h-8 items-center justify-center gap-2 rounded-md border border-steel bg-graphite px-3 text-xs font-semibold text-slate-100 transition-colors hover:bg-steel/60"
              href={`/api/v1/workspace/experiments/${experiment.id}/runs/export`}
              download
            >
              <Download size={14} /> Export CSV
            </a>
            {canRecord && (
              <Button variant="primary" size="sm" onClick={() => setFormOpen((current) => !current)}>
                <Plus size={14} /> Record run
              </Button>
            )}
            <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose} aria-label="Close run explorer">
              <X size={18} />
            </Button>
          </div>
        </header>

        {feedback && (
          <div className="experiment-feedback" role="status">
            <span>{feedback}</span>
            <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
          </div>
        )}

        {formOpen && canRecord && (
          <form
            className="experiment-run-form"
            onSubmit={(event) => {
              event.preventDefault();
              recordRun.mutate();
            }}
          >
            <h3>Record a verified run</h3>
            <div className="experiment-run-grid">
              <label className="field">
                <span>Observed results *</span>
                <textarea
                  rows={3}
                  required
                  value={actualResults}
                  onChange={(event) => setActualResults(event.target.value)}
                  placeholder="Quantitative and qualitative behaviour observed during execution."
                />
              </label>
              <label className="field">
                <span>Validation notes</span>
                <textarea
                  rows={3}
                  value={validationNotes}
                  onChange={(event) => setValidationNotes(event.target.value)}
                  placeholder="Calibration drift, anomalies or exclusions."
                />
              </label>
            </div>

            <div className="experiment-run-grid">
              <label className="field">
                <span>Supporting task</span>
                <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
                  <option value="">No task link</option>
                  {tasksQuery.data?.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Supporting checkpoint</span>
                <select value={checkpointId} onChange={(event) => setCheckpointId(event.target.value)}>
                  <option value="">No checkpoint link</option>
                  {checkpointsQuery.data?.map((checkpoint) => (
                    <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.title}</option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="experiment-metrics-editor">
              <legend>Metrics</legend>
              {metrics.map((metric, index) => (
                <div className="experiment-metric-row" key={index}>
                  <input
                    aria-label={`Metric ${index + 1} name`}
                    placeholder="Metric name"
                    value={metric.name}
                    onChange={(event) => updateMetric(index, { name: event.target.value })}
                  />
                  <input
                    aria-label={`Metric ${index + 1} numeric value`}
                    type="number"
                    step="any"
                    placeholder="Value"
                    value={metric.value}
                    onChange={(event) => updateMetric(index, { value: event.target.value })}
                  />
                  <input
                    aria-label={`Metric ${index + 1} unit`}
                    placeholder="Unit"
                    value={metric.unit}
                    onChange={(event) => updateMetric(index, { unit: event.target.value })}
                  />
                  <input
                    aria-label={`Metric ${index + 1} text value`}
                    placeholder="Text fallback"
                    value={metric.text}
                    onChange={(event) => updateMetric(index, { text: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove metric ${index + 1}`}
                    disabled={metrics.length === 1}
                    onClick={() => setMetrics((current) => current.filter((_, position) => position !== index))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMetrics((current) => [...current, { name: '', value: '', text: '', unit: '' }])}
              >
                <Plus size={14} /> Add metric
              </Button>
            </fieldset>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" disabled={recordRun.isPending || !actualResults.trim()}>
                {recordRun.isPending ? 'Recording…' : 'Commit run'}
              </Button>
            </div>
          </form>
        )}

        <div className="experiment-explorer-body">
          {runsQuery.isLoading ? (
            <PageSkeleton />
          ) : runsQuery.isError ? (
            <p className="palette-error">Run history could not be loaded.</p>
          ) : runs.length === 0 ? (
            <div className="experiment-empty">
              <FlaskConical size={28} />
              <h3>No runs recorded</h3>
              <p>Record the first verified run to start the telemetry history.</p>
            </div>
          ) : (
            <>
              <section className="experiment-chart" aria-label="Metric trend">
                <div className="experiment-section-heading">
                  <h3><BarChart3 size={16} /> Metric trend</h3>
                  {numericMetrics.size > 0 && (
                    <label className="select-box">
                      <span className="sr-only">Chart metric</span>
                      <select value={activeMetric} onChange={(event) => setMetricName(event.target.value)} aria-label="Chart metric">
                        {[...numericMetrics.keys()].map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" stroke="var(--color-muted)" />
                      <YAxis stroke="var(--color-muted)" width={54} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                        formatter={(value) => [`${value} ${numericMetrics.get(activeMetric) ?? ''}`.trim(), activeMetric]}
                      />
                      <Line type="monotone" dataKey="value" stroke="var(--color-cyan-sentinel)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="experiment-hint">At least two numeric runs are needed to draw a trend.</p>
                )}
              </section>

              {selectedRuns.length === 2 && (
                <section className="experiment-comparison" aria-label="Run comparison">
                  <div className="experiment-section-heading">
                    <h3><BarChart3 size={16} /> Compare runs #{selectedRuns[0].runNumber} and #{selectedRuns[1].runNumber}</h3>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedRunIds([])}>Clear</Button>
                  </div>
                  <div className="experiment-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Metric</th>
                          <th scope="col">Run #{selectedRuns[0].runNumber}</th>
                          <th scope="col">Run #{selectedRuns[1].runNumber}</th>
                          <th scope="col">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonNames.map((name) => {
                          const first = selectedRuns[0].metrics.find((metric) => metric.name === name);
                          const second = selectedRuns[1].metrics.find((metric) => metric.name === name);
                          const delta = first?.value !== null && first?.value !== undefined
                            && second?.value !== null && second?.value !== undefined
                            ? second.value - first.value
                            : null;
                          return (
                            <tr key={name}>
                              <th scope="row">{name}</th>
                              <td>{first ? `${first.value ?? first.text ?? '—'} ${first.unit ?? ''}`.trim() : '—'}</td>
                              <td>{second ? `${second.value ?? second.text ?? '—'} ${second.unit ?? ''}`.trim() : '—'}</td>
                              <td>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(3)}`}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <div className="experiment-run-list">
                {runs.map((run) => {
                  const selected = selectedRunIds.includes(run.id);
                  return (
                    <article key={run.id} className={selected ? 'experiment-run-card is-selected' : 'experiment-run-card'}>
                      <header>
                        <div>
                          <strong>Run #{run.runNumber}</strong>
                          <small>{run.performedByName} · {formatDate(run.performedAt)}</small>
                        </div>
                        <label className="experiment-compare-toggle">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRun(run.id)}
                            aria-label={`Compare run ${run.runNumber}`}
                          />
                          Compare
                        </label>
                      </header>

                      <p>{run.actualResults}</p>
                      {run.validationNotes && <p className="experiment-note">Validation: {run.validationNotes}</p>}

                      <div className="experiment-meta">
                        {run.taskId && run.taskTitle && (
                          <Link to={`/tasks/${run.taskId}`}><Link2 size={12} /> {run.taskTitle}</Link>
                        )}
                        {run.checkpointTitle && <span><Check size={12} /> {run.checkpointTitle}</span>}
                      </div>

                      {run.metrics.length > 0 && (
                        <div className="experiment-metric-chips">
                          {run.metrics.map((metric) => (
                            <span key={metric.name}>
                              <strong>{metric.name}</strong>: {metric.value ?? metric.text ?? '—'}{metric.unit ? ` ${metric.unit}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <footer className="experiment-pagination">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                <span>Page {page} of {pageCount} · {total} runs</span>
                <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
