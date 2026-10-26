import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, Play } from 'lucide-react';
import { ErrorState } from '../common/Common.jsx';
import Lightbox from './Lightbox.jsx';
import { DocIcon, downloadHref } from './AttachmentView.jsx';
import { conversationsApi, assetUrl } from '../../services/api.js';
import { formatBytes, formatDate } from '../../utils/format.js';

const TABS = [
  { id: 'media', label: 'Media', icon: ImageIcon, empty: 'No photos or videos shared yet.' },
  { id: 'documents', label: 'Documents', icon: FileText, empty: 'No documents shared yet.' },
];

function useShared(conversationId, group) {
  const [state, setState] = useState({ items: [], hasMore: false, status: 'loading', error: '', loadingMore: false });
  const request = useRef(0);

  const load = useCallback(
    async (before) => {
      const id = ++request.current;
      setState((s) => (before ? { ...s, loadingMore: true } : { items: [], hasMore: false, status: 'loading', error: '', loadingMore: false }));
      try {
        const data = await conversationsApi.shared(conversationId, { group, before, limit: 30 });
        if (id !== request.current) return;
        setState((s) => ({
          items: before ? [...s.items, ...data.items] : data.items,
          hasMore: data.hasMore,
          status: 'ready',
          error: '',
          loadingMore: false,
        }));
      } catch (error) {
        if (id !== request.current) return;
        setState((s) => ({ ...s, status: before ? s.status : 'error', error: error.message, loadingMore: false }));
      }
    },
    [conversationId, group]
  );

  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: () => load(), more: () => state.items.length && load(state.items[state.items.length - 1].id) };
}

/** Shared photos/videos and documents for one conversation, newest first. */
export default function SharedFiles({ conversationId, refreshKey = 0 }) {
  const [tab, setTab] = useState('media');
  const [viewer, setViewer] = useState(null);
  const shared = useShared(conversationId, tab);
  const { reload } = shared;

  // A new attachment arrived in this conversation while the panel is open.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const current = TABS.find((t) => t.id === tab);
  const mediaItems = useMemo(() => shared.items, [shared.items]);

  return (
    <section className="shared" aria-label="Shared files">
      <div className="tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={current.label}>
        {shared.status === 'loading' && <div className="state"><Loader2 className="spin" size={20} aria-hidden="true" /><p>Loading…</p></div>}
        {shared.status === 'error' && <ErrorState message={shared.error} onRetry={shared.reload} />}
        {shared.status === 'ready' && shared.items.length === 0 && <p className="shared-empty">{current.empty}</p>}

        {shared.status === 'ready' && tab === 'media' && shared.items.length > 0 && (
          <ul className="media-grid">
            {shared.items.map((item, index) => (
              <li key={item.id}>
                <button type="button" className="media-tile" onClick={() => setViewer(index)} aria-label={`Open ${item.kind} ${item.filename}, ${formatDate(item.sentAt)}`}>
                  {item.kind === 'image' ? (
                    <img src={assetUrl(item.url)} alt="" loading="lazy" />
                  ) : (
                    <>
                      <video src={`${assetUrl(item.url)}#t=0.1`} preload="metadata" muted playsInline />
                      <span className="media-play"><Play size={18} aria-hidden="true" /></span>
                    </>
                  )}
                  <time className="media-date">{formatDate(item.sentAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}

        {shared.status === 'ready' && tab === 'documents' && shared.items.length > 0 && (
          <ul className="doc-list">
            {shared.items.map((item) => (
              <li key={item.id} className="doc-row">
                <span className="att-doc-icon"><DocIcon filename={item.filename} /></span>
                <span className="doc-text">
                  <strong title={item.filename}>{item.filename}</strong>
                  <span>{formatBytes(item.size)} · {formatDate(item.sentAt)}</span>
                </span>
                <a className="icon-btn" href={downloadHref(item.url)} download={item.filename} aria-label={`Download ${item.filename}`} title="Download">
                  <Download size={18} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {shared.hasMore && (
          <button type="button" className="btn btn-ghost btn-sm btn-block shared-more" disabled={shared.loadingMore} onClick={shared.more}>
            {shared.loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>

      {viewer !== null && <Lightbox items={mediaItems} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
