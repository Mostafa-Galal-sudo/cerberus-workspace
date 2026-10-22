import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  ExternalLink,
  Plus,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { safeHttpUrl } from '../../../shared/url';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface HardwareItem {
  id: string;
  name: string;
  model: string;
  serial_number: string;
  quantity: number;
  unit_cost: number | null;
  condition: string;
  purchase_status: string;
  datasheet_url: string;
  notes: string;
  currentHolder?: string | null;
}

interface MemberOption {
  id: string;
  name: string;
}

export function HardwarePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<HardwareItem | null>(null);
  const [checkoutHolderId, setCheckoutHolderId] = useState('');
  const [checkoutQuantity, setCheckoutQuantity] = useState(1);
  const [checkoutNotes, setCheckoutNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  // New Item State
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [condition, setCondition] = useState<'new' | 'good' | 'fair' | 'damaged' | 'retired'>('good');
  const [purchaseStatus, setPurchaseStatus] = useState<'requested' | 'ordered' | 'available' | 'unavailable'>('available');
  const [datasheetUrl, setDatasheetUrl] = useState('');
  const [notes, setNotes] = useState('');

  const isAdmin = user?.roles.includes('super_admin');

  const query = useQuery({
    queryKey: ['hardware'],
    queryFn: () => api<HardwareItem[]>('/workspace/hardware'),
  });

  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: Boolean(checkoutTarget),
  });

  const addItem = useMutation({
    mutationFn: () =>
      api('/workspace/hardware', {
        method: 'POST',
        body: JSON.stringify({
          name,
          model,
          serialNumber,
          quantity,
          unitCost: unitCost === '' ? null : Number(unitCost),
          condition,
          purchaseStatus,
          datasheetUrl,
          notes,
        }),
      }),
    onSuccess: () => {
      setIsAddOpen(false);
      resetAddForm();
      setFeedback('Hardware component registered in inventory.');
      void queryClient.invalidateQueries({ queryKey: ['hardware'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Registration failed'),
  });

  const checkoutItem = useMutation({
    mutationFn: () =>
      api(`/workspace/hardware/${checkoutTarget?.id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          holderId: checkoutHolderId,
          quantity: checkoutQuantity,
          notes: checkoutNotes,
        }),
      }),
    onSuccess: () => {
      setCheckoutTarget(null);
      setFeedback('Hardware allocated to engineer.');
      void queryClient.invalidateQueries({ queryKey: ['hardware'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Checkout failed'),
  });

  const resetAddForm = () => {
    setName('');
    setModel('');
    setSerialNumber('');
    setQuantity(1);
    setUnitCost('');
    setCondition('good');
    setPurchaseStatus('available');
    setDatasheetUrl('');
    setNotes('');
  };

  const filteredItems = (query.data ?? []).filter((item) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return item.name.toLowerCase().includes(term) || item.model?.toLowerCase().includes(term) || item.serial_number?.toLowerCase().includes(term);
  });

  return (
    <div className="page hardware-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Physical Assets</span>
          <h1>Hardware Inventory & Testbed Ledger</h1>
          <p>Microcontrollers, SDRs, RF transceivers, logic analyzers, and lab test fixtures.</p>
        </div>

        {isAdmin && (
          <Button variant="primary" size="sm" onClick={() => setIsAddOpen(true)}>
            <Plus size={16} /> Register hardware item
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
            placeholder="Search by name, model, serial..."
          />
        </label>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          {filteredItems.length} components tracked
        </span>
      </Panel>

      {query.isLoading ? (
        <PageSkeleton />
      ) : filteredItems.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredItems.map((item) => (
            <Panel key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Cpu size={20} style={{ color: 'var(--color-cyan-sentinel)' }} />
                  <div>
                    <strong style={{ fontSize: '1rem', display: 'block' }}>{item.name}</strong>
                    <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>{item.model || 'Standard model'}</small>
                  </div>
                </div>
                <StatusBadge status={item.condition} />
              </div>

              <div style={{ background: 'var(--color-surface-subtle)', padding: '10px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-muted)' }}>Quantity in Stock:</span>
                  <strong>{item.quantity} units</strong>
                </div>
                {item.serial_number && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Serial Number:</span>
                    <code className="mono-data" style={{ fontSize: '0.75rem' }}>{item.serial_number}</code>
                  </div>
                )}
                {item.unit_cost !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Unit Cost:</span>
                    <strong>${Number(item.unit_cost).toFixed(2)}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-muted)' }}>Allocation:</span>
                  <strong style={{ color: item.currentHolder ? 'var(--color-cyan-sentinel)' : 'var(--color-status-approved)' }}>
                    {item.currentHolder ? `Checked out to ${item.currentHolder}` : 'Lab Available'}
                  </strong>
                </div>
              </div>

              {item.notes && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                  {item.notes}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--color-border)' }}>
                {safeHttpUrl(item.datasheet_url) ? (
                  <a
                    href={safeHttpUrl(item.datasheet_url)!}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                  >
                    Datasheet <ExternalLink size={12} />
                  </a>
                ) : <span />}

                {isAdmin && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCheckoutTarget(item);
                      setCheckoutQuantity(1);
                      setCheckoutNotes('');
                    }}
                  >
                    <UserCheck size={14} /> Allocate unit
                  </Button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No hardware items found" body="Register laboratory hardware components to track distribution." />
      )}

      {/* Add Hardware Modal */}
      {isAddOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '580px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Register Hardware Component</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsAddOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); addItem.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Component Name *</small>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ESP32-S3-WROOM-1 Development Board"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Model / Chipset</small>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="ESP32-S3-DevKitC-1"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Serial / Batch Number</small>
                  <input
                    type="text"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    placeholder="SN-ESP-2026-04"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Quantity *</small>
                  <input
                    type="number"
                    min={1}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Unit Cost (USD)</small>
                  <input
                    type="number"
                    step="0.01"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="12.50"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Condition</small>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as 'new' | 'good' | 'fair' | 'damaged' | 'retired')}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    <option value="new">New (Factory)</option>
                    <option value="good">Good (Operational)</option>
                    <option value="fair">Fair (Bench used)</option>
                    <option value="damaged">Damaged (Faulty)</option>
                    <option value="retired">Retired</option>
                  </select>
                </label>
              </div>

              <label>
                <small>Datasheet or Manual URL</small>
                <input
                  type="url"
                  value={datasheetUrl}
                  onChange={(e) => setDatasheetUrl(e.target.value)}
                  placeholder="https://..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Bench Notes & Pinout Constraints</small>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Flashed with ESP-IDF v5.2, antenna connector on U.FL..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={addItem.isPending || !name}>
                  {addItem.isPending ? 'Registering...' : 'Register Item'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {checkoutTarget && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '480px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Allocate: {checkoutTarget.name}</h3>
              <Button variant="ghost" size="sm" onClick={() => setCheckoutTarget(null)}><X size={16} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); checkoutItem.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Assign to Discipline Engineer *</small>
                <select
                  required
                  value={checkoutHolderId}
                  onChange={(e) => setCheckoutHolderId(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                >
                  <option value="">Select recipient...</option>
                  {membersQuery.data?.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <small>Quantity Allocated</small>
                <input
                  type="number"
                  min={1}
                  max={checkoutTarget.quantity}
                  value={checkoutQuantity}
                  onChange={(e) => setCheckoutQuantity(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Allocation Notes & Intended Work</small>
                <textarea
                  rows={2}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  placeholder="e.g. For RF CSI feature extraction experiments"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setCheckoutTarget(null)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={checkoutItem.isPending || !checkoutHolderId}>
                  {checkoutItem.isPending ? 'Allocating...' : 'Confirm Allocation'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
