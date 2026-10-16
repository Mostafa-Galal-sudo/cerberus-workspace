import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Edit,
  History,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface WikiListItem {
  id: string;
  title: string;
  slug: string;
  category: string;
  visibility: string;
  currentVersion: number;
  updatedAt: number;
  authorName: string;
  excerpt: string;
}

interface WikiDetail {
  page: {
    id: string;
    title: string;
    slug: string;
    category: string;
    visibility: string;
    current_version: number;
    updated_at: number;
    contentMarkdown: string;
    changeSummary: string;
    authorName: string;
  };
  versions: Array<{
    version: number;
    changeSummary: string;
    createdAt: number;
    authorName: string;
  }>;
}

const CATEGORIES = ['All', 'Architecture', 'Hardware', 'Cybersecurity', 'Protocols', 'AI & Models', 'Evaluation'];

export function WikiPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // New Article Form
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newCategory, setNewCategory] = useState('Architecture');
  const [newContent, setNewContent] = useState('');
  const [newSummary, setNewSummary] = useState('Initial publication');

  // Edit Article Form
  const [editContent, setEditContent] = useState('');
  const [editSummary, setEditSummary] = useState('');

  const isSupervisor = user?.roles.includes('project_supervisor');

  const listQuery = useQuery({
    queryKey: ['wiki-list', search, selectedCategory],
    queryFn: () => {
      const cat = selectedCategory === 'All' ? '' : `&category=${encodeURIComponent(selectedCategory)}`;
      const s = search ? `&search=${encodeURIComponent(search)}` : '';
      return api<WikiListItem[]>(`/workspace/wiki?1=1${cat}${s}`);
    },
  });

  const detailQuery = useQuery({
    queryKey: ['wiki-detail', selectedSlug],
    queryFn: () => api<WikiDetail>(`/workspace/wiki/${selectedSlug}`),
    enabled: Boolean(selectedSlug),
  });

  const createArticle = useMutation({
    mutationFn: () =>
      api<{ id: string; slug: string }>('/workspace/wiki', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          slug: newSlug || newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          category: newCategory,
          contentMarkdown: newContent,
          changeSummary: newSummary,
          visibility: 'members',
        }),
      }),
    onSuccess: (data: { id: string; slug: string }) => {
      setIsCreateOpen(false);
      resetNewForm();
      setSelectedSlug(data.slug);
      setFeedback('Article published to workspace knowledge base.');
      void queryClient.invalidateQueries({ queryKey: ['wiki-list'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Publication failed'),
  });

  const createVersion = useMutation({
    mutationFn: (pageId: string) =>
      api(`/workspace/wiki/${pageId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          contentMarkdown: editContent,
          changeSummary: editSummary || 'Content revision',
        }),
      }),
    onSuccess: () => {
      setIsEditOpen(false);
      setFeedback('New revision version published.');
      void queryClient.invalidateQueries({ queryKey: ['wiki-detail', selectedSlug] });
      void queryClient.invalidateQueries({ queryKey: ['wiki-list'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Revision failed'),
  });

  const resetNewForm = () => {
    setNewTitle('');
    setNewSlug('');
    setNewCategory('Architecture');
    setNewContent('');
    setNewSummary('Initial publication');
  };

  const handleOpenEdit = () => {
    if (detailQuery.data?.page) {
      setEditContent(detailQuery.data.page.contentMarkdown);
      setEditSummary('');
      setIsEditOpen(true);
    }
  };

  return (
    <div className="page wiki-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Knowledge Base</span>
          <h1>System Documentation & Engineering Wiki</h1>
          <p>Versioned specifications, protocol diagrams, hardware datasheets, and security architecture.</p>
        </div>

        {!isSupervisor && (
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} /> New knowledge article
          </Button>
        )}
      </header>

      {feedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
        </div>
      )}

      {selectedSlug && detailQuery.data ? (
        /* Detailed Article Reader View */
        <div className="article-reader-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Button variant="ghost" size="sm" onClick={() => setSelectedSlug(null)} style={{ alignSelf: 'flex-start' }}>
            ← Back to knowledge directory
          </Button>

          <Panel style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--color-border)', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600, textTransform: 'uppercase' }}>
                  {detailQuery.data.page.category} · REVISION v{detailQuery.data.page.current_version}
                </span>
                <h1 style={{ margin: '4px 0 8px', fontSize: '1.75rem' }}>{detailQuery.data.page.title}</h1>
                <div style={{ display: 'flex', gap: '12px', color: 'var(--color-muted)', fontSize: '0.8rem' }}>
                  <span>Author: <strong>{detailQuery.data.page.authorName}</strong></span>
                  <span>Updated: {formatDate(detailQuery.data.page.updated_at)}</span>
                  <span>Slug: <code className="mono-data">{detailQuery.data.page.slug}</code></span>
                </div>
              </div>

              {!isSupervisor && (
                <Button variant="secondary" size="sm" onClick={handleOpenEdit}>
                  <Edit size={14} /> Revise article (v{detailQuery.data.page.current_version + 1})
                </Button>
              )}
            </div>

            {/* Markdown Body Rendering */}
            <div className="wiki-markdown-body" style={{ fontSize: '0.95rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--color-text)' }}>
              {detailQuery.data.page.contentMarkdown}
            </div>

            {/* Version History Drawer */}
            <div style={{ marginTop: '36px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <History size={16} style={{ color: 'var(--color-cyan-sentinel)' }} />
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Provenance & Revision History</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {detailQuery.data.versions.map((ver) => (
                  <div key={ver.version} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-surface-subtle)', borderRadius: '4px', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <strong>v{ver.version}</strong>
                      <span>{ver.changeSummary || 'Content update'}</span>
                    </div>
                    <div style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>
                      {ver.authorName} · {formatDate(ver.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      ) : (
        /* Knowledge Directory Browser */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Categories and Search */}
          <Panel style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {CATEGORIES.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '4px',
                    background: selectedCategory === cat ? 'var(--color-cyan-sentinel)' : 'var(--color-surface-subtle)',
                    color: selectedCategory === cat ? '#000' : 'inherit',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <label className="search-box" style={{ minWidth: '260px' }}>
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documentation..."
              />
            </label>
          </Panel>

          {/* Articles Grid */}
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : listQuery.data?.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
              {listQuery.data.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedSlug(item.slug)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '18px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', textTransform: 'uppercase', fontWeight: 600 }}>
                      {item.category}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                      v{item.currentVersion}
                    </span>
                  </div>

                  <strong style={{ fontSize: '1.05rem', lineHeight: 1.3 }}>{item.title}</strong>

                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.5 }}>
                    {item.excerpt}...
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: 'auto', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    <span>By {item.authorName}</span>
                    <span>{formatDate(item.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No documentation found"
              body="No wiki articles matched the selected category and search query. Publish an article to begin."
            />
          )}
        </div>
      )}

      {/* New Article Modal */}
      {isCreateOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '720px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Publish Documentation Article</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createArticle.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <label>
                  <small>Article Title *</small>
                  <input
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. SPI Bus Isolation and Ground Bounce Mitigation"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Category *</small>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <small>Content (Markdown) *</small>
                <textarea
                  rows={10}
                  required
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="# Technical Specification\n\nDocument architectural decisions, equations, schematics, and verification procedures..."
                  style={{ width: '100%', padding: '10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </label>

              <label>
                <small>Change Summary</small>
                <input
                  type="text"
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="e.g. Initial engineering specification"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={createArticle.isPending || !newTitle || !newContent}>
                  {createArticle.isPending ? 'Publishing...' : 'Publish Article'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Article Modal */}
      {isEditOpen && detailQuery.data && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '720px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Revise Article: {detailQuery.data.page.title}</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createVersion.mutate(detailQuery.data!.page.id); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Updated Content (Markdown) *</small>
                <textarea
                  rows={12}
                  required
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  style={{ width: '100%', padding: '10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </label>

              <label>
                <small>Summary of Revision Changes *</small>
                <input
                  type="text"
                  required
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  placeholder="e.g. Added section 4 on RF packet collision backoff"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={createVersion.isPending || !editContent || !editSummary}>
                  {createVersion.isPending ? 'Publishing revision...' : 'Record Revision'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
