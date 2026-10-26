import { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { assetUrl } from '../../services/api.js';
import { formatFull } from '../../utils/format.js';

/** Full-screen viewer for photos and videos. items: attachments; index: the one being shown. */
export default function Lightbox({ items, index, onIndex, onClose }) {
  const item = items[index];
  const ref = useRef(null);
  const prev = useCallback(() => index > 0 && onIndex(index - 1), [index, onIndex]);
  const next = useCallback(() => index < items.length - 1 && onIndex(index + 1), [index, items.length, onIndex]);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    // Capture phase + stopPropagation: Escape closes only the preview, not the panel or dialog behind it.
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'ArrowLeft') prev();
      if (event.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose, prev, next]);

  if (!item) return null;
  const url = assetUrl(item.url);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.filename} tabIndex={-1} ref={ref} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className="lightbox-bar">
        <div className="lightbox-title">
          <strong>{item.filename}</strong>
          {item.sentAt && <span>{formatFull(item.sentAt)}</span>}
        </div>
        <a className="icon-btn" href={`${url}${url.includes('?') ? '&' : '?'}download=1`} download={item.filename} aria-label="Download" title="Download">
          <Download size={20} aria-hidden="true" />
        </a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preview" title="Close">
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="lightbox-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button type="button" className="lightbox-nav left" onClick={prev} aria-label="Previous">
            <ChevronLeft size={26} aria-hidden="true" />
          </button>
        )}
        {item.kind === 'video' ? (
          <video key={item.id} src={url} controls autoPlay playsInline className="lightbox-media" />
        ) : (
          <img key={item.id} src={url} alt={item.filename} className="lightbox-media" />
        )}
        {index < items.length - 1 && (
          <button type="button" className="lightbox-nav right" onClick={next} aria-label="Next">
            <ChevronRight size={26} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
