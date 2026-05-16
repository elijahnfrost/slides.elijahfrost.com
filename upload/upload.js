/**
 * upload.js — the /upload page client.
 *
 * Flow:
 *   1. User drops or picks an .html file.
 *   2. Client extracts <deck-meta> for a preview (locally — purely cosmetic).
 *   3. User clicks Publish. We POST the raw bytes to /api/upload.
 *   4. Render server response.
 *
 * Validation is the server's job. The client just shows a friendly preview.
 */
const els = {
  drop:         document.getElementById('drop'),
  file:         document.getElementById('file'),
  browse:       document.getElementById('browse'),
  preview:      document.getElementById('preview'),
  pvSlug:       document.getElementById('pv-slug'),
  pvTitle:      document.getElementById('pv-title'),
  pvDesc:       document.getElementById('pv-description'),
  pvTags:       document.getElementById('pv-tags'),
  pvDate:       document.getElementById('pv-date'),
  pvVers:       document.getElementById('pv-versions'),
  pvCounts:     document.getElementById('pv-counts'),
  pvTypes:      document.getElementById('pv-types'),
  kindRadios:   document.querySelectorAll('input[name="kind"]'),
  publish:      document.getElementById('publish'),
  cancel:       document.getElementById('cancel'),
  status:       document.getElementById('status'),
  statusHead:   document.getElementById('status-head'),
  statusBody:   document.getElementById('status-body'),
  statusDetail: document.getElementById('status-detail'),
  statusLink:   document.getElementById('status-link'),
};

const PENDING_KEY = 'slides.pendingUpload';

// ----- file selection -----
let currentFile = null;
let currentText = null;

els.browse.addEventListener('click', () => els.file.click());
els.drop.addEventListener('click', (e) => {
  if (e.target === els.browse) return;
  els.file.click();
});
els.file.addEventListener('change', () => {
  if (els.file.files && els.file.files[0]) handleFile(els.file.files[0]);
});

els.drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.drop.dataset.dragging = '';
});
els.drop.addEventListener('dragleave', () => {
  delete els.drop.dataset.dragging;
});
els.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  delete els.drop.dataset.dragging;
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  currentFile = file;
  currentText = await file.text();
  showPreview(currentText);
  hideStatus();
}

function showPreview(html) {
  // Parse <deck-meta> client-side for a friendly preview. The server is
  // the source of truth — this is purely cosmetic.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const metaTag = doc.getElementById('deck-meta');
  let meta = null;
  if (metaTag) {
    try { meta = JSON.parse(metaTag.textContent); } catch (e) { /* keep null */ }
  }
  const deck = doc.querySelector('deck-stage');
  const sections = deck ? deck.querySelectorAll(':scope > section') : [];
  const notesTag = doc.getElementById('speaker-notes');
  let notesLen = 0;
  try { notesLen = JSON.parse(notesTag?.textContent || '[]').length; } catch {}

  els.pvSlug.textContent     = meta?.slug || '—';
  setKind(meta?.kind === 'template' ? 'template' : 'deck');
  els.pvTitle.textContent    = meta?.title || '—';
  els.pvDesc.textContent     = meta?.description || '—';
  els.pvTags.textContent     = (meta?.tags || []).join(' · ') || '—';
  els.pvDate.textContent     = meta?.date || '—';
  els.pvVers.textContent     = `${meta?.schema || '?'} · ${meta?.framework || '?'}`;
  els.pvCounts.textContent   = `${sections.length} sections / ${notesLen} notes`;
  els.pvTypes.textContent    = (meta?.slide_types_used || []).join(', ') || '—';

  els.preview.hidden = false;
}

els.cancel.addEventListener('click', () => {
  currentFile = null;
  currentText = null;
  els.preview.hidden = true;
  els.file.value = '';
});

els.publish.addEventListener('click', async () => {
  if (!currentText) return;
  await upload(currentText, getKind());
});

function getKind() {
  for (const r of els.kindRadios) if (r.checked) return r.value;
  return 'deck';
}

function setKind(value) {
  for (const r of els.kindRadios) r.checked = (r.value === value);
}

async function upload(text, kind) {
  // Stash for retry if the network breaks mid-flight
  try { localStorage.setItem(PENDING_KEY, text); } catch {}

  showStatus('working', 'Publishing…', 'Validating and storing to Vercel Blob.');

  let res;
  try {
    res = await fetch('/api/upload?kind=' + encodeURIComponent(kind), {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: text,
    });
  } catch (e) {
    showStatus('error', 'Network error', e.message);
    return;
  }

  let body;
  try { body = await res.json(); } catch (e) { body = { ok: false, code: 'E_PARSE_RESPONSE', message: 'Could not parse server response' }; }

  if (res.ok && body.ok) {
    try { localStorage.removeItem(PENDING_KEY); } catch {}
    showStatus('success',
      'Published',
      `Slug: ${body.slug} · version_id: ${body.version_id}. Stored to Vercel Blob — live now.`,
      null,
      body.deploy_url
    );
    return;
  }

  const detail = JSON.stringify(body, null, 2);
  showStatus('error', body.code || ('HTTP ' + res.status), body.message || 'Upload failed', detail);
}

function showStatus(state, head, body, detail, link) {
  els.status.hidden = false;
  els.status.dataset.state = state;
  els.statusHead.textContent = head;
  els.statusBody.textContent = body || '';
  if (detail) { els.statusDetail.hidden = false; els.statusDetail.textContent = detail; }
  else { els.statusDetail.hidden = true; els.statusDetail.textContent = ''; }
  if (link) { els.statusLink.hidden = false; els.statusLink.href = link; els.statusLink.textContent = 'Open piece →'; }
  else { els.statusLink.hidden = true; }
}

function hideStatus() {
  els.status.hidden = true;
  els.status.dataset.state = '';
}

// ----- pending-upload retry -----
const pending = (() => { try { return localStorage.getItem(PENDING_KEY); } catch { return null; } })();
if (pending) {
  showStatus('working', 'Pending upload',
    'A previous upload was interrupted. Click Publish to retry.');
  // Show preview from the pending text
  showPreview(pending);
  currentText = pending;
  els.publish.textContent = 'Retry publish';
}
