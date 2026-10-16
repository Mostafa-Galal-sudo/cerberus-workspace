import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface Experiment {
  id: string;
  experiment_code: string;
  title: string;
  objective: string;
  hypothesis: string;
  environment: string;
  procedure: string;
  expected_results: string;
  reproducibility: string;
  owner_id: string;
  ownerName: string;
  status: string;
  runCount: number;
  updated_at: number;
}

export function ExperimentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedExp, setSelectedExp] = useState<Experiment | null>(null);
  const [isDesignOpen, setIsDesignOpen] = useState(false);
  const [isRunOpen, setIsRunOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Design Form State
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [environment, setEnvironment] = useState('');
  const [procedure, setProcedure] = useState('');
  const [expectedResults, setExpectedResults] = useState('');
  const [reproducibility, setReproducibility] = useState('');

  // Run Form State
  const [actualResults, setActualResults] = useState('');
  const [validationNotes, setValidationNotes] = useState('');
  const [metricName, setMetricName] = useState('Detection Latency');
  const [metricValue, setMetricValue] = useState<number | ''>(42);
  const [metricUnit, setMetricUnit] = useState('ms');

  const isSupervisor = user?.roles.includes('project_supervisor');

  const query = useQuery({
    queryKey: ['experiments'],
    queryFn: () => api<Experiment[]>('/workspace/experiments'),
  });

  const designExperiment = useMutation({
    mutationFn: () =>
      api('/workspace/experiments', {
        method: 'POST',
        body: JSON.stringify({
          experimentCode: code,
          title,
          objective,
          hypothesis,
          environment,
          procedure,
          expectedResults,
          reproducibility,
        }),
      }),
    onSuccess: () => {
      setIsDesignOpen(false);
      resetDesignForm();
      setFeedback('Scientific experiment protocol registered.');
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Registration failed'),
  });

  const recordRun = useMutation({
    mutationFn: () =>
      api<{ runNumber: number }>(`/workspace/experiments/${selectedExp?.id}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          actualResults,
          validationNotes,
          metrics: [
            {
              name: metricName,
              value: metricValue === '' ? undefined : Number(metricValue),
              unit: metricUnit,
              observed: true,
            },
          ],
        }),
      }),
    onSuccess: (data: { runNumber: number }) => {
      setIsRunOpen(false);
      setActualResults('');
      setValidationNotes('');
      setFeedback(`Experiment run #${data.runNumber} recorded with telemetry verification.`);
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Run recording failed'),
  });

  const resetDesignForm = () => {
    setCode('');
    setTitle('');
    setObjective('');
    setHypothesis('');
    setEnvironment('');
    setProcedure('');
    setExpectedResults('');
    setReproducibility('');
  };

  const filtered = (query.data ?? []).filter((exp) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return exp.experiment_code.toLowerCase().includes(term) || exp.title.toLowerCase().includes(term);
  });

  return (
    <div className="page experiments-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Empirical Validation</span>
          <h1>Engineering Experiments & Scientific Runs</h1>
          <p>Controlled testbeds, machine-learning IDS benchmarks, Wi-Fi CSI validation, and RF jamming resilience.</p>
        </div>

        {!isSupervisor && (
          <Button variant="primary" size="sm" onClick={() => setIsDesignOpen(true)}>
            <Plus size={16} /> Design new protocol
          </Button>
        )}
      </header>

      {feedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
        </div>
      )}

      <Panel className="task-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <label className="search-box" style={{ maxWidth: '360px' }}>
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search experiment code or title..."
          />
        </label>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          {filtered.length} protocols established
        </span>
      </Panel>

      {query.isLoading ? (
        <PageSkeleton />
      ) : filtered.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filtered.map((exp) => (
            <Panel key={exp.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)' }}>
                    {exp.experiment_code}
                  </span>
                  <h3 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>{exp.title}</h3>
                </div>
                <span style={{ fontSize: '0.75rem', background: 'var(--color-surface-subtle)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                  {exp.runCount} runs
                </span>
              </div>

              <div style={{ background: 'var(--color-surface-subtle)', padding: '10px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div>
                  <strong style={{ color: 'var(--color-muted)' }}>Hypothesis: </strong>
                  <span>{exp.hypothesis}</span>
                </div>
                <div>
                  <strong style={{ color: 'var(--color-muted)' }}>Environment: </strong>
                  <span>{exp.environment}</span>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {exp.objective}
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  Lead: <strong>{exp.ownerName}</strong>
                </span>

                {(!isSupervisor || exp.owner_id === user?.id) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedExp(exp);
                      setIsRunOpen(true);
                    }}
                  >
                    <Play size={14} /> Execute run
                  </Button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No experiment protocols" body="Design empirical test protocols to validate system hypotheses." />
      )}

      {/* Design Protocol Modal */}
      {isDesignOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Design Scientific Experiment Protocol</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsDesignOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); designExperiment.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                <label>
                  <small>Code *</small>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="EXP-AI-01"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Protocol Title *</small>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Wi-Fi CSI Amplitude Feature Variance Under Jamming"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>
              </div>

              <label>
                <small>Objective * (Minimum 10 characters)</small>
                <textarea
                  rows={2}
                  required
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Quantify the detection sensitivity of the ML pipeline..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Hypothesis *</small>
                <textarea
                  rows={2}
                  required
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                  placeholder="Subcarrier amplitude variance drops below threshold within 50ms of jamming..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Testbed Environment *</small>
                <input
                  type="text"
                  required
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="Anechoic chamber / 2.4GHz SDR transceiver at 1 meter separation"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Step-by-Step Procedure * (Minimum 10 characters)</small>
                <textarea
                  rows={3}
                  required
                  value={procedure}
                  onChange={(e) => setProcedure(e.target.value)}
                  placeholder="1. Initiate CSI packet injection at 100Hz\n2. Introduce jamming signal at 2412MHz\n3. Capture 10,000 frames..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsDesignOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={designExperiment.isPending || !code || !title || objective.length < 10 || procedure.length < 10}>
                  {designExperiment.isPending ? 'Establishing...' : 'Establish Protocol'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Test Run Modal */}
      {isRunOpen && selectedExp && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '540px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Execute Run: {selectedExp.experiment_code}</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsRunOpen(false)}><X size={16} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); recordRun.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Observed Results *</small>
                <textarea
                  rows={3}
                  required
                  value={actualResults}
                  onChange={(e) => setActualResults(e.target.value)}
                  placeholder="Detailed quantitative and qualitative behavior observed during execution..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Validation Notes</small>
                <textarea
                  rows={2}
                  value={validationNotes}
                  onChange={(e) => setValidationNotes(e.target.value)}
                  placeholder="Environmental anomalies, calibration adjustments, or baseline drift..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Key Telemetry Metric</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                  <input
                    type="text"
                    value={metricName}
                    onChange={(e) => setMetricName(e.target.value)}
                    placeholder="Metric Name"
                    style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                  <input
                    type="number"
                    step="any"
                    value={metricValue}
                    onChange={(e) => setMetricValue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Value"
                    style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                  <input
                    type="text"
                    value={metricUnit}
                    onChange={(e) => setMetricUnit(e.target.value)}
                    placeholder="Unit (ms, %, dBm)"
                    style={{ padding: '6px', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsRunOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={recordRun.isPending || !actualResults.trim()}>
                  {recordRun.isPending ? 'Logging run...' : 'Commit Run Record'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
