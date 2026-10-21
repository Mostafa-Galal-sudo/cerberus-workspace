import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuth } from '../app/auth-context';
import { Button } from './ui';
import { api, ApiError, formatDate } from '../lib/api';

interface AttachmentItem {
  id: string;
  label: string;
  storageType: string;
  mimeType?: string | null;
  byteSize?: number | null;
  checksumSha256?: string | null;
  createdAt: number;
  ownerId: string;
  ownerName: string;
  url: string;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AttachmentPanel({ resourceType, resourceId, canUpload }: {
  resourceType: string;
  resourceId: string;
  canUpload: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const query = useQuery({
    queryKey: ['attachments', resourceType, resourceId],
    queryFn: () => api<AttachmentItem[]>(`/attachments?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`),
    enabled: Boolean(resourceId),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const file = fileInput.current?.files?.[0];
      if (!file) throw new Error('Choose a file to upload');
      const form = new FormData();
      form.append('file', file);
      form.append('resourceType', resourceType);
      form.append('resourceId', resourceId);
      if (label.trim()) form.append('label', label.trim());
      return api<{ id: string; checksumSha256: string }>('/attachments', { method: 'POST', body: form });
    },
    onSuccess: () => {
      setLabel('');
      setError('');
      setNotice('Evidence file stored with a SHA-256 checksum.');
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['attachments', resourceType, resourceId] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Upload failed'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setNotice('Attachment archived. The audit record remains.');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['attachments', resourceType, resourceId] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Attachment removal failed'),
  });

  const items = query.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          <Paperclip size={14} /> {items.length} private attachment{items.length === 1 ? '' : 's'}
        </span>
        <small style={{ color: 'var(--color-muted)', fontSize: '0.72rem' }}>Max 10 MB · R2 private object · checksum verified</small>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="status-notice" style={{ padding: '8px 12px', fontSize: '0.8rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>{notice}</div>}

      {items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</strong>
                <small style={{ color: 'var(--color-muted)', fontSize: '0.72rem' }}>
                  {formatBytes(item.byteSize)} · {item.ownerName} · {formatDate(item.createdAt)}
                  {item.checksumSha256 ? ` · sha256:${item.checksumSha256.slice(0, 12)}…` : ''}
                </small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <a
                  href={item.url}
                  download
                  className="button button-secondary button-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '4px', textDecoration: 'none', color: 'inherit' }}
                >
                  <Download size={13} /> Download
                </a>
                {(item.ownerId === user?.id || user?.roles.includes('super_admin')) && (
                  <button
                    type="button"
                    title="Archive attachment"
                    onClick={() => archive.mutate(item.id)}
                    disabled={archive.isPending}
                    style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: '4px' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : query.isLoading ? (
        <small style={{ color: 'var(--color-muted)' }}>Loading attachments…</small>
      ) : (
        <small style={{ color: 'var(--color-muted)' }}>No evidence files attached yet.</small>
      )}

      {canUpload && (
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              ref={fileInput}
              type="file"
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.md,.json,.csv,.zip,.pcap,.pcapng,.bin"
              style={{ flex: '1 1 220px', padding: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
            />
            <input
              type="text"
              value={label}
              maxLength={180}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional evidence label"
              style={{ flex: '1 1 180px', padding: '6px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
            />
            <Button type="button" variant="secondary" size="sm" disabled={upload.isPending} onClick={() => upload.mutate()}>
              <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Attach evidence'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
