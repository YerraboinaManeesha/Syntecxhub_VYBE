import { FileSpreadsheet, FileText, File as FileIcon, Download, Play, Presentation } from 'lucide-react';
import { assetUrl } from '../../services/api.js';
import { formatBytes } from '../../utils/format.js';

export function DocIcon({ filename = '', size = 22 }) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename)?.[1] || '').toLowerCase();
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={size} aria-hidden="true" />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation size={size} aria-hidden="true" />;
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return <FileText size={size} aria-hidden="true" />;
  return <FileIcon size={size} aria-hidden="true" />;
}

const downloadHref = (url) => `${assetUrl(url)}${url.includes('?') ? '&' : '?'}download=1`;

/** The media part of a message: inline photo, video player, or a document download card. */
export default function AttachmentView({ attachment, onOpen }) {
  const url = assetUrl(attachment.url);
  if (attachment.kind === 'image') {
    const ratio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    return (
      <button type="button" className="att-image" onClick={() => onOpen?.(attachment)} aria-label={`Open photo ${attachment.filename}`} style={{ aspectRatio: ratio }}>
        <img src={url} alt={attachment.filename} loading="lazy" width={attachment.width || undefined} height={attachment.height || undefined} />
      </button>
    );
  }
  if (attachment.kind === 'video') {
    return <video className="att-video" src={url} controls preload="metadata" playsInline aria-label={attachment.filename} />;
  }
  return (
    <a className="att-doc" href={downloadHref(attachment.url)} download={attachment.filename} title={`Download ${attachment.filename}`}>
      <span className="att-doc-icon"><DocIcon filename={attachment.filename} /></span>
      <span className="att-doc-text">
        <strong>{attachment.filename}</strong>
        <span>{formatBytes(attachment.size)}</span>
      </span>
      <Download size={18} aria-hidden="true" />
    </a>
  );
}

export { downloadHref, Play };
