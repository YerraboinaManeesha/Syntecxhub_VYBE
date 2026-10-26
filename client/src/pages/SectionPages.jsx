import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Loader2, LogOut, Plus, Trash2, UsersRound } from 'lucide-react';
import UserSearch from '../components/contacts/UserSearch.jsx';
import { NewGroupModal } from '../components/chat/GroupParts.jsx';
import { ConversationItem } from '../components/chat/ConversationList.jsx';
import { Avatar, EmptyState, ErrorState, LoadingState, Modal } from '../components/common/Common.jsx';
import { Field } from '../components/auth/AuthParts.jsx';
import ProfileView from '../components/media/ProfileView.jsx';
import { usersApi } from '../services/api.js';
import { ACCEPT, checkAvatar } from '../utils/files.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';
import { validateName } from '../utils/validators.js';

// ---- Crop window for profile photos (kept in this file so no extra files are needed) ----
// The picture stays fixed. A square crop box sits on it: drag inside to move it, drag any corner or side
// handle to resize it, or use the Size slider. Profile photos are square everywhere in the app.
const CROP_CSS = `
.cropper { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); }
.crop-stage { position: relative; margin: 14px; user-select: none; touch-action: none; }
.crop-clip { position: absolute; inset: 0; overflow: hidden; border-radius: 6px; background: #000; }
.crop-img { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.crop-shade { position: absolute; pointer-events: none; box-shadow: 0 0 0 4000px rgba(20, 6, 18, 0.62); }
.crop-box { position: absolute; cursor: move; outline: none; border: 1px solid rgba(255, 240, 246, 0.95);
  background:
    linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,.4) calc(33.33% - 0.5px), rgba(255,255,255,.4) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,.4) calc(66.66% - 0.5px), rgba(255,255,255,.4) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),
    linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,.4) calc(33.33% - 0.5px), rgba(255,255,255,.4) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,.4) calc(66.66% - 0.5px), rgba(255,255,255,.4) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)); }
.crop-box:focus-visible { box-shadow: 0 0 0 3px var(--color-accent); }
.crop-handle { position: absolute; width: 34px; height: 34px; transform: translate(-50%, -50%); touch-action: none; }
.crop-handle::before { content: ''; position: absolute; background: transparent; border: 0 solid #fff; }
.crop-handle.h-nw { cursor: nwse-resize; } .crop-handle.h-se { cursor: nwse-resize; }
.crop-handle.h-ne { cursor: nesw-resize; } .crop-handle.h-sw { cursor: nesw-resize; }
.crop-handle.h-n, .crop-handle.h-s { cursor: ns-resize; } .crop-handle.h-e, .crop-handle.h-w { cursor: ew-resize; }
.crop-handle.h-nw::before { width: 20px; height: 20px; left: calc(50% - 3px); top: calc(50% - 3px); border-top-width: 3px; border-left-width: 3px; }
.crop-handle.h-ne::before { width: 20px; height: 20px; right: calc(50% - 3px); top: calc(50% - 3px); border-top-width: 3px; border-right-width: 3px; }
.crop-handle.h-sw::before { width: 20px; height: 20px; left: calc(50% - 3px); bottom: calc(50% - 3px); border-bottom-width: 3px; border-left-width: 3px; }
.crop-handle.h-se::before { width: 20px; height: 20px; right: calc(50% - 3px); bottom: calc(50% - 3px); border-bottom-width: 3px; border-right-width: 3px; }
.crop-handle.h-n::before, .crop-handle.h-s::before { width: 26px; height: 0; left: 50%; top: 50%; margin: -2px 0 0 -13px; border-top-width: 4px; border-radius: 2px; }
.crop-handle.h-e::before, .crop-handle.h-w::before { width: 0; height: 26px; left: 50%; top: 50%; margin: -13px 0 0 -2px; border-left-width: 4px; border-radius: 2px; }
.modal-footer { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--color-border); }
`;

const CROP_OUTPUT = 512; // the saved photo is at most 512 x 512
const CROP_HANDLES = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function AvatarCropper({ file, onCancel, onConfirm }) {
  const [url, setUrl] = useState('');
  const [dims, setDims] = useState(null); // { nw, nh, s, W, H }: picture size, show-scale, shown size
  const [box, setBox] = useState(null); // { x, y, size } in shown pixels
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const drag = useRef(null);

  // Created and released in an effect (not during render), so React's double-run in development cannot revoke it early.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function onLoad(event) {
    const nw = event.currentTarget.naturalWidth;
    const nh = event.currentTarget.naturalHeight;
    const maxW = Math.max(200, Math.min(360, window.innerWidth - 96));
    const maxH = Math.max(200, Math.min(360, window.innerHeight * 0.5));
    const s = Math.min(maxW / nw, maxH / nh);
    const W = Math.round(nw * s);
    const H = Math.round(nh * s);
    const size = Math.min(W, H);
    setDims({ nw, nh, s, W, H });
    setBox({ x: (W - size) / 2, y: (H - size) / 2, size }); // start with the biggest centred square
  }

  const minSize = dims ? Math.min(Math.min(dims.W, dims.H), Math.ceil(Math.max(36, 64 * dims.s))) : 36;

  // Resizing keeps the box square. A corner keeps the opposite corner fixed; a side keeps the opposite side
  // fixed and the box centred on the other axis.
  function resized(handle, p, start) {
    const { W, H } = dims;
    const [fx, fy] = CROP_HANDLES[handle];
    const cx = start.x + start.size / 2;
    const cy = start.y + start.size / 2;
    let size;
    let x;
    let y;
    if (fx !== 0.5 && fy !== 0.5) {
      const sx = fx === 1 ? 1 : -1;
      const sy = fy === 1 ? 1 : -1;
      const ax = sx > 0 ? start.x : start.x + start.size;
      const ay = sy > 0 ? start.y : start.y + start.size;
      const raw = Math.max((p.x - ax) * sx, (p.y - ay) * sy);
      const max = Math.min(sx > 0 ? W - ax : ax, sy > 0 ? H - ay : ay);
      size = clampNum(raw, minSize, Math.max(minSize, max));
      x = sx > 0 ? ax : ax - size;
      y = sy > 0 ? ay : ay - size;
    } else if (fy === 0.5) {
      const east = fx === 1;
      const ax = east ? start.x : start.x + start.size;
      const raw = east ? p.x - ax : ax - p.x;
      const max = Math.min(east ? W - ax : ax, 2 * Math.min(cy, H - cy));
      size = clampNum(raw, minSize, Math.max(minSize, max));
      x = east ? ax : ax - size;
      y = cy - size / 2;
    } else {
      const south = fy === 1;
      const ay = south ? start.y : start.y + start.size;
      const raw = south ? p.y - ay : ay - p.y;
      const max = Math.min(south ? H - ay : ay, 2 * Math.min(cx, W - cx));
      size = clampNum(raw, minSize, Math.max(minSize, max));
      y = south ? ay : ay - size;
      x = cx - size / 2;
    }
    return { x: clampNum(x, 0, W - size), y: clampNum(y, 0, H - size), size };
  }

  function point(event) {
    const r = stageRef.current.getBoundingClientRect();
    return { x: clampNum(event.clientX - r.left, 0, dims.W), y: clampNum(event.clientY - r.top, 0, dims.H) };
  }
  function begin(event, mode) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, start: box, from: { x: event.clientX, y: event.clientY }, pointer: point(event) };
  }
  function onMove(event) {
    const d = drag.current;
    if (!d || !dims) return;
    if (d.mode === 'move') {
      setBox({
        ...d.start,
        x: clampNum(d.start.x + event.clientX - d.from.x, 0, dims.W - d.start.size),
        y: clampNum(d.start.y + event.clientY - d.from.y, 0, dims.H - d.start.size),
      });
    } else {
      setBox(resized(d.mode, point(event), d.start));
    }
  }
  function onUp() {
    drag.current = null;
  }

  function setSize(next) {
    const size = clampNum(next, minSize, Math.min(dims.W, dims.H));
    const cx = box.x + box.size / 2;
    const cy = box.y + box.size / 2;
    setBox({ size, x: clampNum(cx - size / 2, 0, dims.W - size), y: clampNum(cy - size / 2, 0, dims.H - size) });
  }
  function onKeyDown(event) {
    const step = 6;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      setBox((b) => ({ ...b, x: clampNum(b.x + moves[event.key][0], 0, dims.W - b.size), y: clampNum(b.y + moves[event.key][1], 0, dims.H - b.size) }));
    } else if (event.key === '+' || event.key === '=') setSize(box.size + 12);
    else if (event.key === '-') setSize(box.size - 12);
  }

  async function confirm() {
    if (!dims || !box || !imgRef.current) return;
    setBusy(true);
    try {
      const sx = box.x / dims.s;
      const sy = box.y / dims.s;
      const side = box.size / dims.s; // the chosen square, in the picture's own pixels
      const size = Math.min(CROP_OUTPUT, Math.round(side)); // never upscale a small picture
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgRef.current, sx, sy, Math.min(side, dims.nw - sx), Math.min(side, dims.nh - sy), 0, 0, size, size);
      const jpeg = file.type === 'image/jpeg';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      if (!blob) throw new Error('Could not crop this image');
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
      onConfirm(new File([blob], `${baseName}-cropped.${jpeg ? 'jpg' : 'png'}`, { type: blob.type }));
    } catch (err) {
      setError(err.message || 'Could not crop this image');
      setBusy(false);
    }
  }

  return (
    <>
      <style>{CROP_CSS}</style>
      <Modal
        title="Crop your photo"
        onClose={onCancel}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={!box || busy}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Use photo
            </button>
          </>
        }
      >
        <div className="cropper">
          {error ? (
            <div className="form-alert" role="alert">{error}</div>
          ) : (
            <>
              <div
                ref={stageRef}
                className="crop-stage"
                style={dims ? { width: dims.W, height: dims.H } : { width: 200, height: 200 }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                data-testid="crop-stage"
              >
                <div className="crop-clip">
                  {url && (
                    <img
                      ref={imgRef}
                      src={url}
                      alt=""
                      draggable={false}
                      className="crop-img"
                      style={{ opacity: dims ? 1 : 0 }}
                      onLoad={onLoad}
                      onError={() => setError('This image could not be opened. Try another photo.')}
                    />
                  )}
                  {box && <div className="crop-shade" style={{ left: box.x, top: box.y, width: box.size, height: box.size }} />}
                </div>
                {box && (
                  <>
                    <div
                      className="crop-box"
                      style={{ left: box.x, top: box.y, width: box.size, height: box.size }}
                      onPointerDown={(e) => begin(e, 'move')}
                      onKeyDown={onKeyDown}
                      tabIndex={0}
                      role="group"
                      aria-label="Crop box. Drag to move it, drag the corners or sides to resize it, or use the arrow keys to move and plus and minus to resize."
                      data-testid="crop-box"
                    />
                    {Object.entries(CROP_HANDLES).map(([name, [fx, fy]]) => (
                      <span
                        key={name}
                        className={`crop-handle h-${name}`}
                        style={{ left: box.x + fx * box.size, top: box.y + fy * box.size }}
                        onPointerDown={(e) => begin(e, name)}
                        data-testid={`crop-handle-${name}`}
                        aria-hidden="true"
                      />
                    ))}
                  </>
                )}
              </div>
              <p className="field-hint">Drag the box to move it. Drag a corner or a side to resize. The square is what people will see.</p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

export function ContactsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { startPrivate, conversations } = useChat();
  const [busyId, setBusyId] = useState(null);
  const [profile, setProfile] = useState(null);
  // Shared files come from an existing private conversation, if there is one.
  const existing = profile
    ? conversations.find((c) => c.type === 'private' && c.participants.some((p) => p.id === profile.id))
    : null;

  async function open(person) {
    setBusyId(person.id);
    try {
      // Reuses the existing private conversation if there is one, never creates a duplicate.
      const conversation = await startPrivate(person.id);
      navigate(`/app/c/${conversation.id}`);
    } catch (error) {
      toast.error(error.message);
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Contacts</h1>
        <p>Find people on VYBE and start a conversation.</p>
      </header>
      <UserSearch onOpen={open} onProfile={setProfile} busyId={busyId} />
      {profile && (
        <ProfileView
          person={profile}
          conversationId={existing?.id}
          backLabel="Back to contacts"
          onClose={() => setProfile(null)}
          onMessage={() => open(profile)}
          messaging={busyId === profile.id}
        />
      )}
    </div>
  );
}

export function GroupsPage() {
  const navigate = useNavigate();
  const { conversations, convStatus, convError, loadConversations } = useChat();
  const [creating, setCreating] = useState(false);
  const groups = conversations.filter((c) => c.type === 'group');

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Groups</h1>
          <p>Conversations with several people.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden="true" /> New group
        </button>
      </header>
      {convStatus === 'loading' && <LoadingState />}
      {convStatus === 'error' && <ErrorState message={convError} onRetry={loadConversations} />}
      {convStatus === 'ready' && groups.length === 0 && (
        <EmptyState icon={UsersRound} title="No group chats" text="Create a group to chat with several people at once." />
      )}
      {groups.length > 0 && (
        <ul className="conv-list page-list">
          {groups.map((g) => <ConversationItem key={g.id} conversation={g} active={false} />)}
        </ul>
      )}
      {creating && (
        <NewGroupModal
          onClose={() => setCreating(false)}
          onCreated={(conversation) => navigate(`/app/c/${conversation.id}`)}
        />
      )}
    </div>
  );
}

export function ProfilePage() {
  const { user, updateProfile, applyUser, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState({ busy: false, progress: 0, error: '', preview: '' });
  const [cropFile, setCropFile] = useState(null); // picked photo waiting to be cropped
  const photoInput = useRef(null);
  const uploadRef = useRef(null);
  const dirty = form.name.trim() !== user.name;

  // Step 1: validate the picked file, then let the person crop it.
  function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = checkAvatar(file);
    if (problem) {
      setPhoto((p) => ({ ...p, error: problem }));
      return;
    }
    setPhoto((p) => ({ ...p, error: '' }));
    setCropFile(file);
  }

  // Step 2: upload the cropped square.
  async function uploadPhoto(file) {
    setCropFile(null);
    const preview = URL.createObjectURL(file);
    setPhoto({ busy: true, progress: 0, error: '', preview });
    const upload = usersApi.uploadAvatar(file, (progress) => setPhoto((p) => ({ ...p, progress })));
    uploadRef.current = upload;
    try {
      const data = await upload.promise;
      applyUser(data.user);
      toast.success('Profile photo updated');
      setPhoto({ busy: false, progress: 0, error: '', preview: '' });
    } catch (error) {
      setPhoto({ busy: false, progress: 0, error: error.code === 'aborted' ? '' : error.message, preview: '' });
    } finally {
      URL.revokeObjectURL(preview);
      uploadRef.current = null;
    }
  }

  async function removePhoto() {
    setPhoto({ busy: true, progress: 0, error: '', preview: '' });
    try {
      const data = await usersApi.removeAvatar();
      applyUser(data.user);
      toast.success('Profile photo removed');
      setPhoto({ busy: false, progress: 0, error: '', preview: '' });
    } catch (error) {
      setPhoto({ busy: false, progress: 0, error: error.message, preview: '' });
    }
  }

  async function save(event) {
    event.preventDefault();
    const next = {};
    const nameError = validateName(form.name);
    if (nameError) next.name = nameError;
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const updated = await updateProfile({ name: form.name.trim() });
      setForm({ name: updated.name });
      toast.success('Profile updated');
    } catch (error) {
      if (error.fields) setErrors(error.fields);
      else if (error.field) setErrors({ [error.field]: error.message });
      else toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page page-narrow">
      <header className="page-header">
        <h1>Profile and settings</h1>
      </header>
      <div className="profile-hero">
        <div className="hero-avatar">
          {photo.preview ? (
            <span className="avatar has-photo" style={{ width: 96, height: 96 }}><img src={photo.preview} alt="" /></span>
          ) : (
            <Avatar name={user.name} id={user.id} src={user.avatarUrl} size={96} />
          )}
          {photo.busy && (
            <span className="hero-busy" role="status" aria-label="Updating photo">
              <Loader2 size={22} className="spin" aria-hidden="true" />
              {photo.progress > 0 && photo.progress < 100 && <small>{photo.progress}%</small>}
            </span>
          )}
        </div>
        <div className="hero-text">
          <strong>{user.name}</strong>
          <div className="hero-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => photoInput.current?.click()} disabled={photo.busy}>
              <Camera size={15} aria-hidden="true" /> {user.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {photo.busy && photo.progress > 0 && photo.progress < 100 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => uploadRef.current?.abort()}>Cancel</button>
            )}
            {user.avatarUrl && !photo.busy && (
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={removePhoto}>
                <Trash2 size={15} aria-hidden="true" /> Remove
              </button>
            )}
          </div>
          <input ref={photoInput} type="file" hidden accept={ACCEPT.image} onChange={pickPhoto} data-testid="avatar-input" />
        </div>
      </div>
      {photo.error && <div className="form-alert" role="alert">{photo.error}</div>}
      <p className="field-hint hero-hint">JPG, PNG or WebP, up to 5 MB. Your photo is visible to people you chat with.</p>

      <form onSubmit={save} className="auth-form card" noValidate>
        <Field label="Display name" id="p-name" error={errors.name}>
          <input id="p-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'p-name-error' : undefined} />
        </Field>
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
            {saving && <Loader2 size={16} className="spin" aria-hidden="true" />} Save changes
          </button>
        </div>
      </form>

      <section className="card account-card">
        <h2>Account</h2>
        <dl>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Member since</dt><dd>{formatDate(user.createdAt)}</dd></div>
        </dl>
        <p className="field-hint">Email and password changes are not available yet.</p>
      </section>

      <button type="button" className="btn btn-danger-ghost" onClick={logout}>
        <LogOut size={16} aria-hidden="true" /> Sign out
      </button>
      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={uploadPhoto} />}
      <p className="page-foot"><Link to="/">Back to the VYBE home page</Link></p>
    </div>
  );
}