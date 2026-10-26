// Client-side checks that mirror the server rules, so people get instant, friendly feedback.
// The server re-checks everything from the file's real bytes; this is convenience, not security.
const MB = 1024 * 1024;

export const LIMITS = { image: 5 * MB, video: 25 * MB, document: 10 * MB };
export const LIMIT_LABEL = { image: '5 MB', video: '25 MB', document: '10 MB' };

export const ACCEPT = {
  image: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
  video: '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv',
};
const EXT = {
  image: ['jpg', 'jpeg', 'png', 'webp'],
  video: ['mp4', 'webm', 'mov'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
};
const NAMES = { image: 'Photos', video: 'Videos', document: 'Documents' };
const ALLOWED_TEXT = {
  image: 'JPG, PNG or WebP',
  video: 'MP4, WebM or MOV',
  document: 'PDF, Word, Excel, PowerPoint, TXT or CSV',
};

const ext = (name) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

/** Returns an error message, or '' when the file is acceptable for the chosen menu item. */
export function checkFile(file, kind) {
  if (!file) return 'Choose a file first.';
  if (file.size === 0) return 'That file is empty.';
  if (!EXT[kind].includes(ext(file.name))) return `${NAMES[kind]} must be ${ALLOWED_TEXT[kind]}.`;
  if (file.size > LIMITS[kind]) return `${NAMES[kind]} can be at most ${LIMIT_LABEL[kind]}.`;
  return '';
}

export function checkAvatar(file) {
  return checkFile(file, 'image').replace('Photos', 'Profile photos');
}
