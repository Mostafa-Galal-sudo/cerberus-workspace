import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarClock,
  ExternalLink,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { safeHttpUrl } from '../../../shared/url';
import { useAuth } from '../../app/auth-context';
import { Button, PageSkeleton, StatusBadge } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface HardwareItem {
  id: string;
  name: string;
  model: string;
  serial_number: string;
  quantity: number;
  unit_cost: number | null;
  condition: string;
  purchase_status: string;
  tracking_mode: string;
  min_quantity: number;
  checkedOutQuantity: number;
  availableQuantity: number;
  lowStock: boolean;
  datasheet_url: string;
  notes: string;
}

interface Assignment {
  id: string;
  holderId: string;
  holderName: string;
  quantity: number;
  notes: string;
  checkedOutAt: number;
  checkedInAt: number | null;
  conditionOnReturn: string | null;
  returnNotes: string;
  returnedByName: string | null;
  createdByName: string;
}

interface MaintenanceRecord {
  id: string;
  kind: string;
  performedAt: number;
  nextDueAt: number | null;
  notes: string;
  performedByName: string;
}

interface HardwareDetail {
  item: HardwareItem;
  assignments: Assignment[];
  maintenance: MaintenanceRecord[];
  maintenanceOverdue: boolean;
  canManage: boolean;
}

const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'retired'] as const;
type Condition = typeof CONDITIONS[number];

export function HardwareDetailPanel({ hardwareId, onClose }: { hardwareId: string; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnCondition, setReturnCondition] = useState<Condition>('good');
  const [returnNotes, setReturnNotes] = useState('');
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceKind, setMaintenanceKind] = useState<'maintenance' | 'calibration' | 'inspection'>('maintenance');
  const [performedDate, setPerformedDate] = useState(new Date().toISOString().slice(0, 10));
  const [nextDueDate, setNextDueDate] = useState('');
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

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

  const query = useQuery({
    queryKey: ['hardware', 'detail', hardwareId],
    queryFn: () => api<HardwareDetail>(`/workspace/hardware/${hardwareId}`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['hardware'] });
  };

  const returnItem = useMutation({
    mutationFn: () => api(`/workspace/hardware/assignments/${returningId}/return`, {
      method: 'POST',
      body: JSON.stringify({ condition: returnCondition, notes: returnNotes }),
    }),
    onSuccess: () => {
      setFeedback('Hardware returned with its condition recorded.');
      setReturningId(null);
      setReturnNotes('');
      refresh();
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : 'Return failed'),
  });

  const recordMaintenance = useMutation({
    mutationFn: () => api(`/workspace/hardware/${hardwareId}/maintenance`, {
      method: 'POST',
      body: JSON.stringify({
        kind: maintenanceKind,
        performedAt: performedDate
          ? Math.floor(new Date(`${performedDate}T12:00:00`).getTime() / 1000)
          : undefined,
        nextDueAt: nextDueDate
          ? Math.floor(new Date(`${nextDueDate}T12:00:00`).getTime() / 1000)
          : null,
        notes: maintenanceNotes,
      }),
    }),
    onSuccess: () => {
      setFeedback('Maintenance record saved.');
      setMaintenanceOpen(false);
      setMaintenanceNotes('');
      setNextDueDate('');
      refresh();
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : 'Maintenance record failed'),
  });

  const detail = query.data;
  const item = detail?.item;
  const activeAssignments = detail?.assignments.filter((assignment) => assignment.checkedInAt === null) ?? [];
  const latestMaintenance = detail?.maintenance[0];
  const maintenanceOverdue = detail?.maintenanceOverdue ?? false;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card hardware-ledger" role="dialog" aria-modal="true" aria-labelledby="hardware-ledger-title">
        <header className="experiment-explorer-header">
          <div>
            <span className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)' }}>Custody ledger</span>
            <h2 id="hardware-ledger-title">{item?.name ?? 'Hardware item'}</h2>
            <p>{item?.model || 'Hardware lifecycle, maintenance and accountability'}</p>
          </div>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose} aria-label="Close hardware ledger">
            <X size={18} />
          </Button>
        </header>

        {feedback && (
          <div className="experiment-feedback" role="status">
            <span>{feedback}</span>
            <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
          </div>
        )}

        {query.isLoading ? (
          <PageSkeleton />
        ) : query.isError || !detail || !item ? (
          <p className="palette-error">The hardware ledger could not be loaded.</p>
        ) : (
          <div className="hardware-ledger-body">
            <section className="hardware-summary" aria-label="Hardware summary">
              <div><span>Tracking</span><strong>{item.tracking_mode === 'serialized' ? 'Serialized unit' : 'Quantity lot'}</strong></div>
              <div><span>Available</span><strong>{item.availableQuantity} / {item.quantity}</strong></div>
              <div><span>Checked out</span><strong>{item.checkedOutQuantity}</strong></div>
              <div><span>Condition</span><StatusBadge status={item.condition} /></div>
              <div><span>Purchase</span><StatusBadge status={item.purchase_status} /></div>
              {item.serial_number && <div><span>Serial</span><code className="mono-data">{item.serial_number}</code></div>}
              {item.unit_cost !== null && <div><span>Unit cost</span><strong>${Number(item.unit_cost).toFixed(2)}</strong></div>}
            </section>

            {item.lowStock && (
              <div className="hardware-alert" role="status">
                <AlertTriangle size={16} />
                <span>
                  Low stock: {item.availableQuantity} available against a minimum of {item.min_quantity}.
                </span>
              </div>
            )}

            {latestMaintenance?.nextDueAt && (
              <div className={maintenanceOverdue ? 'hardware-alert is-danger' : 'hardware-alert'} role="status">
                <CalendarClock size={16} />
                <span>
                  Next {latestMaintenance.kind} due {formatDate(latestMaintenance.nextDueAt)}
                  {maintenanceOverdue ? ' — overdue.' : '.'}
                </span>
              </div>
            )}

            {item.notes && <p className="experiment-note">{item.notes}</p>}
            {safeHttpUrl(item.datasheet_url) && (
              <a
                href={safeHttpUrl(item.datasheet_url)!}
                target="_blank"
                rel="noreferrer noopener"
                className="hardware-datasheet-link"
              >
                Datasheet <ExternalLink size={12} />
              </a>
            )}

            <section aria-label="Active custody">
              <div className="experiment-section-heading">
                <h3><ArrowDownToLine size={16} /> Active custody ({activeAssignments.length})</h3>
              </div>
              {activeAssignments.length === 0 ? (
                <p className="experiment-hint">No units are checked out.</p>
              ) : (
                <div className="hardware-custody-list">
                  {activeAssignments.map((assignment) => {
                    const canReturn = detail.canManage || assignment.holderId === user?.id;
                    const isReturning = returningId === assignment.id;
                    return (
                      <div key={assignment.id} className="hardware-custody-row">
                        <div>
                          <strong>{assignment.holderName}</strong>
                          <small>{assignment.quantity} unit(s) · checked out {formatDate(assignment.checkedOutAt)}</small>
                          {assignment.notes && <small>{assignment.notes}</small>}
                        </div>
                        {canReturn && !isReturning && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setReturningId(assignment.id);
                              setReturnCondition('good');
                              setReturnNotes('');
                            }}
                          >
                            Return
                          </Button>
                        )}
                        {isReturning && (
                          <form
                            className="hardware-return-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              returnItem.mutate();
                            }}
                          >
                            <label className="field">
                              <span>Condition on return *</span>
                              <select
                                value={returnCondition}
                                onChange={(event) => setReturnCondition(event.target.value as Condition)}
                              >
                                {CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
                              </select>
                            </label>
                            <label className="field">
                              <span>Return notes</span>
                              <input
                                value={returnNotes}
                                onChange={(event) => setReturnNotes(event.target.value)}
                                placeholder="Cable damage, calibration state, missing adapter…"
                              />
                            </label>
                            <div className="hardware-return-actions">
                              <Button type="button" variant="ghost" size="sm" onClick={() => setReturningId(null)}>Cancel</Button>
                              <Button type="submit" variant="primary" size="sm" disabled={returnItem.isPending}>
                                {returnItem.isPending ? 'Returning…' : 'Confirm return'}
                              </Button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section aria-label="Custody history">
              <div className="experiment-section-heading">
                <h3><ArrowDownToLine size={16} /> Custody history</h3>
              </div>
              {detail.assignments.length === 0 ? (
                <p className="experiment-hint">No custody events recorded.</p>
              ) : (
                <div className="experiment-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Holder</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Checked out</th>
                        <th scope="col">Returned</th>
                        <th scope="col">Return condition</th>
                        <th scope="col">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.assignments.map((assignment) => (
                        <tr key={assignment.id}>
                          <td>{assignment.holderName}</td>
                          <td>{assignment.quantity}</td>
                          <td>{formatDate(assignment.checkedOutAt)}</td>
                          <td>{assignment.checkedInAt ? formatDate(assignment.checkedInAt) : 'Open'}</td>
                          <td>{assignment.conditionOnReturn ?? '—'}</td>
                          <td>{assignment.returnNotes || assignment.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-label="Maintenance log">
              <div className="experiment-section-heading">
                <h3><Wrench size={16} /> Maintenance and calibration</h3>
                {detail.canManage && (
                  <Button variant="secondary" size="sm" onClick={() => setMaintenanceOpen((current) => !current)}>
                    Log service
                  </Button>
                )}
              </div>

              {maintenanceOpen && detail.canManage && (
                <form
                  className="hardware-maintenance-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    recordMaintenance.mutate();
                  }}
                >
                  <label className="field">
                    <span>Kind *</span>
                    <select value={maintenanceKind} onChange={(event) => setMaintenanceKind(event.target.value as typeof maintenanceKind)}>
                      <option value="maintenance">Maintenance</option>
                      <option value="calibration">Calibration</option>
                      <option value="inspection">Inspection</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Performed</span>
                    <input type="date" value={performedDate} onChange={(event) => setPerformedDate(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Next due</span>
                    <input type="date" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} />
                  </label>
                  <label className="field" style={{ gridColumn: '1 / -1' }}>
                    <span>Notes *</span>
                    <textarea
                      rows={2}
                      required
                      value={maintenanceNotes}
                      onChange={(event) => setMaintenanceNotes(event.target.value)}
                      placeholder="What was checked, replaced or recalibrated?"
                    />
                  </label>
                  <div className="hardware-return-actions" style={{ gridColumn: '1 / -1' }}>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMaintenanceOpen(false)}>Cancel</Button>
                    <Button type="submit" variant="primary" size="sm" disabled={recordMaintenance.isPending || maintenanceNotes.trim().length < 3}>
                      {recordMaintenance.isPending ? 'Saving…' : 'Save record'}
                    </Button>
                  </div>
                </form>
              )}

              {detail.maintenance.length === 0 ? (
                <p className="experiment-hint">No maintenance events recorded.</p>
              ) : (
                <div className="experiment-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Kind</th>
                        <th scope="col">Performed</th>
                        <th scope="col">By</th>
                        <th scope="col">Next due</th>
                        <th scope="col">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.maintenance.map((record) => (
                        <tr key={record.id}>
                          <td>{record.kind}</td>
                          <td>{formatDate(record.performedAt)}</td>
                          <td>{record.performedByName}</td>
                          <td>{record.nextDueAt ? formatDate(record.nextDueAt) : '—'}</td>
                          <td>{record.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
