/**
 * hub.js — landing page interactions.
 *
 * Responsibilities:
 *   - Render the Decks / Templates / Trash tabs from /api/catalog/
 *   - Pin / unpin, reclassify, rename, soft- and hard-delete
 *   - Bulk-select cards and act on them as a group
 *   - Toast notifications + custom confirm/input modal
 */
(async () => {
  const catalogEl       = document.getElementById('catalog');
  const searchEl        = document.getElementById('search');
  const tpl             = document.getElementById('card-template');
  const trashTpl        = document.getElementById('trash-template');
  const pinnedTpl       = document.getElementById('pinned-template');
  const tabsEl          = document.querySelector('.hub-tabs');
  const trashCountEl    = document.getElementById('trash-count');
  const pinnedTplListEl = document.getElementById('pinned-templates');
  const pinnedDeckListEl= document.getElementById('pinned-decks');
  const pinnedEmptyEl   = document.getElementById('pinned-empty');
  const bulkBar         = document.getElementById('bulk-bar');
  const bulkCount       = document.getElementById('bulk-count');
  const bulkActions     = document.getElementById('bulk-actions');

  let pieces = [];
  let tombstones = [];
  let seedTemplates = [];
  const selected = new Set();

  try {
    const [cat, seeds] = await Promise.all([
      fetch('/api/catalog/', { cache: 'no-store' }).then(r => r.json()),
      fetch('/_framework/v1/templates/index.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { templates: [] })
        .catch(() => ({ templates: [] })),
    ]);
    pieces = (cat.pieces || []).slice().sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    tombstones = cat.tombstones || [];
    seedTemplates = seeds.templates || [];
  } catch (err) {
    catalogEl.textContent = 'Could not load catalog.';
    return;
  }

  const initial = new URLSearchParams(location.search).get('tab');
  let activeTab = ['templates', 'trash'].includes(initial) ? initial : 'decks';
  setActiveTab(activeTab, /* skipUrl */ true);

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    setActiveTab(btn.dataset.tab);
  });

  function setActiveTab(name, skipUrl) {
    activeTab = name;
    tabsEl.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!skipUrl) {
      const u = new URL(location.href);
      if (name === 'decks') u.searchParams.delete('tab');
      else u.searchParams.set('tab', name);
      history.replaceState(null, '', u);
    }
    selected.clear();
    render(searchEl.value);
  }

  function isDeleted(p) { return !!p.deleted_at; }

  function entries() {
    if (activeTab === 'trash') {
      return pieces.filter(isDeleted).sort((a, b) =>
        (b.deleted_at || '').localeCompare(a.deleted_at || '')
      );
    }
    if (activeTab === 'templates') {
      const userTpls = pieces
        .filter(p => !isDeleted(p) && p.kind === 'template')
        .map(p => ({ ...p, _seed: false }));
      const seeds = seedTemplates.map(t => ({
        slug: t.name,
        title: t.title,
        description: t.description || '',
        date: '',
        tags: t.tags || [],
        pinned: !!t.pinned,
        _seed: true,
      }));
      return userTpls.concat(seeds);
    }
    return pieces.filter(p => !isDeleted(p) && (p.kind || 'deck') === 'deck');
  }

  function render(query) {
    renderPinned();
    catalogEl.innerHTML = '';
    const q = (query || '').trim().toLowerCase();
    const all = entries();
    const matched = q
      ? all.filter(p => {
          const hay = [p.title, p.description, p.slug, ...(p.tags || [])]
            .filter(Boolean).join(' ').toLowerCase();
          return hay.includes(q);
        })
      : all;

    const trashCount = pieces.filter(isDeleted).length;
    if (trashCount > 0) {
      trashCountEl.textContent = trashCount;
      trashCountEl.hidden = false;
    } else {
      trashCountEl.hidden = true;
    }

    if (matched.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hub-empty';
      empty.textContent = ({
        trash: 'Trash is empty.',
        templates: 'No templates yet. Upload one.',
        decks: 'No decks matched.',
      })[activeTab];
      catalogEl.appendChild(empty);
      refreshBulkBar();
      return;
    }

    for (const p of matched) {
      const node = (activeTab === 'trash' ? trashTpl : tpl).content.cloneNode(true);
      const row = node.querySelector('.hub-card-row');
      row.dataset.slug = p.slug;
      row.dataset.kind = p._seed ? 'template' : (p.kind || 'deck');
      if (p.pinned) row.dataset.pinned = '';

      const a = node.querySelector('.hub-card');
      const sel = node.querySelector('.hub-card-select');

      if (activeTab === 'trash') {
        a.href = '/' + p.slug + '/';
        sel.checked = selected.has(p.slug);
        if (selected.has(p.slug)) row.dataset.selected = '';
        node.querySelector('.hub-card-deleted').textContent =
          'Deleted ' + (p.deleted_at || '').slice(0, 10);
      } else {
        const dl  = node.querySelector('.hub-card-download');
        const pin = node.querySelector('.hub-card-pin');
        const rc  = node.querySelector('.hub-card-reclassify');
        const rn  = node.querySelector('.hub-card-rename');
        const del = node.querySelector('.hub-card-delete');

        if (p._seed) {
          a.href = '/api/export-template?name=' + encodeURIComponent(p.slug);
          a.setAttribute('download', '');
          sel.remove();
          dl.remove();
          pin.remove();
          rc.remove();
          rn.remove();
          del.remove();
        } else {
          a.href = '/' + p.slug + '/';
          dl.href = '/api/export-piece?slug=' + encodeURIComponent(p.slug);
          pin.setAttribute('aria-pressed', p.pinned ? 'true' : 'false');
          pin.title = p.pinned ? 'Unpin from sidebar' : 'Pin to sidebar';
          pin.setAttribute('aria-label', pin.title);
          const otherKind = (p.kind || 'deck') === 'deck' ? 'template' : 'deck';
          rc.title = 'Convert to ' + otherKind;
          rc.setAttribute('aria-label', rc.title);
          rc.dataset.to = otherKind;
          sel.checked = selected.has(p.slug);
          if (selected.has(p.slug)) row.dataset.selected = '';
        }
      }

      const titleTextEl = node.querySelector('.hub-card-title-text');
      if (titleTextEl) titleTextEl.textContent = p.title;
      else node.querySelector('.hub-card-title').textContent = p.title;

      // Source chip: git for disk-managed pieces, blob for uploaded ones.
      // Seed templates (framework-owned) don't have a source.
      const sourceEl = node.querySelector('.hub-card-source');
      if (sourceEl && !p._seed && p.source) {
        sourceEl.textContent = p.source === 'disk' ? 'git' : 'blob';
        sourceEl.dataset.source = p.source;
        sourceEl.hidden = false;
      } else if (sourceEl) {
        sourceEl.remove();
      }

      const desc = node.querySelector('.hub-card-description');
      if (p.description) desc.textContent = p.description; else desc.remove();
      const dateEl = node.querySelector('.hub-card-date');
      if (dateEl) dateEl.textContent = p.date || '';
      const tagsEl = node.querySelector('.hub-card-tags');
      if (tagsEl) tagsEl.textContent = (p.tags || []).join(' · ');

      const parentEl = node.querySelector('.hub-card-parent');
      if (parentEl && p.parent_template) {
        parentEl.textContent = 'from ' + p.parent_template;
        parentEl.hidden = false;
      }

      catalogEl.appendChild(node);
    }
    refreshBulkBar();
  }

  function renderPinned() {
    pinnedTplListEl.innerHTML = '';
    pinnedDeckListEl.innerHTML = '';

    const pinnedSeeds = seedTemplates
      .filter(t => t.pinned)
      .map(t => ({
        slug: t.name, title: t.title, kind: 'template', _seed: true,
        href: '/api/export-template?name=' + encodeURIComponent(t.name),
        download: true,
      }));
    const pinnedUserTpls = pieces
      .filter(p => !isDeleted(p) && p.pinned && p.kind === 'template')
      .map(p => ({
        slug: p.slug, title: p.title, kind: 'template', _seed: false,
        href: '/api/export-piece?slug=' + encodeURIComponent(p.slug),
        download: true,
      }));
    const pinnedDecks = pieces
      .filter(p => !isDeleted(p) && p.pinned && (p.kind || 'deck') === 'deck')
      .map(p => ({
        slug: p.slug, title: p.title, kind: 'deck', _seed: false,
        href: '/' + p.slug + '/',
        download: false,
      }));

    const tpls = pinnedSeeds.concat(pinnedUserTpls);
    for (const item of tpls) appendPinned(pinnedTplListEl, item);
    for (const item of pinnedDecks) appendPinned(pinnedDeckListEl, item);

    const empty = tpls.length === 0 && pinnedDecks.length === 0;
    pinnedEmptyEl.hidden = !empty;
    pinnedTplListEl.parentElement.hidden = tpls.length === 0;
    pinnedDeckListEl.parentElement.hidden = pinnedDecks.length === 0;
  }

  function appendPinned(listEl, item) {
    const node = pinnedTpl.content.cloneNode(true);
    const link = node.querySelector('.hub-pinned-link');
    const unpin = node.querySelector('.hub-pinned-unpin');
    link.href = item.href;
    link.textContent = item.title;
    if (item.download) link.setAttribute('download', '');
    if (item._seed) {
      unpin.remove();
    } else {
      unpin.dataset.slug = item.slug;
    }
    listEl.appendChild(node);
  }

  // ----- mutations -----
  catalogEl.addEventListener('click', async (e) => {
    const sel = e.target.closest('.hub-card-select');
    if (sel) {
      const row = e.target.closest('.hub-card-row');
      const slug = row?.dataset.slug;
      if (!slug) return;
      if (sel.checked) selected.add(slug); else selected.delete(slug);
      if (sel.checked) row.dataset.selected = ''; else delete row.dataset.selected;
      refreshBulkBar();
      return;
    }

    const pinBtn   = e.target.closest('.hub-card-pin');
    const rcBtn    = e.target.closest('.hub-card-reclassify');
    const rnBtn    = e.target.closest('.hub-card-rename');
    const delBtn   = e.target.closest('.hub-card-delete');
    const restBtn  = e.target.closest('.hub-card-restore');
    const purgeBtn = e.target.closest('.hub-card-purge');
    if (!pinBtn && !rcBtn && !rnBtn && !delBtn && !restBtn && !purgeBtn) return;
    e.preventDefault();
    const row = e.target.closest('.hub-card-row');
    const slug = row?.dataset.slug;
    if (!slug) return;

    if (pinBtn) {
      const next = pinBtn.getAttribute('aria-pressed') !== 'true';
      await applyMutation(row, { slug, pinned: next });
    } else if (rcBtn) {
      await applyMutation(row, { slug, kind: rcBtn.dataset.to });
    } else if (rnBtn) {
      const next = await openInputModal({
        title: 'Rename piece',
        body: `Choose a new slug for "${slug}". Lowercase letters, digits, and hyphens.`,
        initial: slug,
        confirm: 'Rename',
        validate: (v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v),
        validateMessage: 'Must be kebab-case (a-z, 0-9, -).',
      });
      if (!next || next === slug) return;
      await applyRename(row, slug, next);
    } else if (delBtn) {
      await applyDelete(row, slug, false);
    } else if (restBtn) {
      await applyRestore(row, slug);
    } else if (purgeBtn) {
      const title = row.querySelector('.hub-card-title')?.textContent || slug;
      const ok = await openConfirmModal({
        title: 'Delete permanently?',
        body: `"${title}" will be wiped from storage. This can't be undone.`,
        confirm: 'Delete permanently',
        danger: true,
      });
      if (!ok) return;
      await applyDelete(row, slug, true);
    }
  });

  document.querySelector('.hub-pinned').addEventListener('click', async (e) => {
    const btn = e.target.closest('.hub-pinned-unpin');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.dataset.slug;
    if (!slug) return;
    await applyMutation(null, { slug, pinned: false });
  });

  // ----- bulk actions -----
  function refreshBulkBar() {
    // Drop any selected slugs that aren't currently visible (tab change, etc.)
    const visible = new Set(
      Array.from(catalogEl.querySelectorAll('.hub-card-row[data-slug]'))
        .map(r => r.dataset.slug)
    );
    for (const s of [...selected]) if (!visible.has(s)) selected.delete(s);

    bulkCount.textContent = selected.size;
    bulkBar.hidden = selected.size === 0;
    bulkActions.innerHTML = '';
    if (selected.size === 0) return;

    if (activeTab === 'trash') {
      addBulk('Restore', 'restore');
      addBulk('Delete permanently', 'purge', true);
    } else {
      addBulk('Move to trash', 'delete', true);
      addBulk('→ Templates', 'kind-template');
      addBulk('→ Decks', 'kind-deck');
    }
  }
  function addBulk(label, action, danger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hub-bulk-btn' + (danger ? ' hub-bulk-btn-danger' : '');
    btn.dataset.action = action;
    btn.textContent = label;
    bulkActions.appendChild(btn);
  }
  bulkBar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-bulk], button[data-action]');
    if (!btn) return;
    if (btn.dataset.bulk === 'clear') {
      selected.clear();
      render(searchEl.value);
      return;
    }
    const slugs = [...selected];
    if (slugs.length === 0) return;
    const action = btn.dataset.action;

    if (action === 'purge') {
      const ok = await openConfirmModal({
        title: 'Delete permanently?',
        body: `${slugs.length} piece(s) will be wiped from storage. This can't be undone.`,
        confirm: 'Delete permanently',
        danger: true,
      });
      if (!ok) return;
    }

    const fn = {
      delete:        (s) => fetchJSON('/api/item-delete',  { slug: s }),
      purge:         (s) => fetchJSON('/api/item-delete',  { slug: s, hard: true }),
      restore:       (s) => fetchJSON('/api/item-restore', { slug: s }),
      'kind-deck':   (s) => fetchJSON('/api/item-update',  { slug: s, kind: 'deck' }),
      'kind-template': (s) => fetchJSON('/api/item-update', { slug: s, kind: 'template' }),
    }[action];
    if (!fn) return;

    const results = await Promise.allSettled(slugs.map(fn));
    let okCount = 0, failCount = 0;
    results.forEach((r, i) => {
      const slug = slugs[i];
      if (r.status === 'fulfilled' && r.value?.ok) {
        okCount++;
        applyLocalState(action, slug, r.value);
      } else {
        failCount++;
      }
    });
    selected.clear();
    render(searchEl.value);
    if (failCount === 0) {
      toast('ok', `${okCount} piece${okCount === 1 ? '' : 's'} updated.`);
    } else {
      toast('error', `${okCount} updated, ${failCount} failed.`);
    }
  });

  function applyLocalState(action, slug, data) {
    const idx = pieces.findIndex(p => p.slug === slug);
    if (action === 'purge') {
      if (idx >= 0) pieces.splice(idx, 1);
      return;
    }
    if (action === 'delete') {
      if (idx >= 0) pieces[idx].deleted_at = data.deleted_at || new Date().toISOString();
      return;
    }
    if (action === 'restore') {
      if (idx >= 0) delete pieces[idx].deleted_at;
      return;
    }
    if (action === 'kind-deck' || action === 'kind-template') {
      if (idx >= 0) pieces[idx].kind = (action === 'kind-deck') ? 'deck' : 'template';
      return;
    }
  }

  async function fetchJSON(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ...data, _status: res.status };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async function applyMutation(row, body) {
    if (row) row.dataset.busy = '';
    const data = await fetchJSON('/api/item-update', body);
    if (!data.ok) {
      toast('error', 'Update failed: ' + (data.message || data._status));
    } else {
      const idx = pieces.findIndex(p => p.slug === data.slug);
      if (idx >= 0) pieces[idx] = { ...pieces[idx], kind: data.kind, pinned: !!data.pinned };
      render(searchEl.value);
    }
    if (row) delete row.dataset.busy;
  }

  async function applyDelete(row, slug, hard) {
    if (row) row.dataset.busy = '';
    const data = await fetchJSON('/api/item-delete', { slug, hard });
    if (!data.ok) {
      toast('error', 'Delete failed: ' + (data.message || data._status));
    } else if (hard) {
      pieces = pieces.filter(p => p.slug !== slug);
      toast('ok', `"${slug}" wiped.`);
      render(searchEl.value);
    } else {
      const idx = pieces.findIndex(p => p.slug === slug);
      if (idx >= 0) pieces[idx].deleted_at = data.deleted_at;
      toast('ok', `"${slug}" moved to trash.`);
      render(searchEl.value);
    }
    if (row) delete row.dataset.busy;
  }

  async function applyRestore(row, slug) {
    if (row) row.dataset.busy = '';
    const data = await fetchJSON('/api/item-restore', { slug });
    if (!data.ok) {
      toast('error', 'Restore failed: ' + (data.message || data._status));
    } else {
      const idx = pieces.findIndex(p => p.slug === slug);
      if (idx >= 0) delete pieces[idx].deleted_at;
      toast('ok', `"${slug}" restored.`);
      render(searchEl.value);
    }
    if (row) delete row.dataset.busy;
  }

  async function applyRename(row, slug, new_slug) {
    if (row) row.dataset.busy = '';
    const data = await fetchJSON('/api/item-rename', { slug, new_slug });
    if (!data.ok) {
      toast('error', 'Rename failed: ' + (data.message || data._status));
    } else {
      const idx = pieces.findIndex(p => p.slug === slug);
      if (idx >= 0) pieces[idx].slug = data.slug;
      toast('ok', `Renamed to "${data.slug}".`);
      render(searchEl.value);
    }
    if (row) delete row.dataset.busy;
  }

  // ----- toasts -----
  const toastsEl = document.getElementById('toasts');
  function toast(kind, message, ttl = 3500) {
    const node = document.createElement('div');
    node.className = 'toast toast-' + kind;
    node.textContent = message;
    toastsEl.appendChild(node);
    requestAnimationFrame(() => node.dataset.visible = '');
    setTimeout(() => {
      delete node.dataset.visible;
      setTimeout(() => node.remove(), 240);
    }, ttl);
  }

  // ----- modal -----
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle   = document.getElementById('modal-title');
  const modalBody    = document.getElementById('modal-body');
  const modalIn      = document.getElementById('modal-input');
  const modalInWrap  = document.getElementById('modal-input-wrap');
  const modalInHint  = document.getElementById('modal-input-hint');
  const modalCancel  = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  let modalResolver = null;
  function closeModal(value) {
    modalOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    if (modalResolver) {
      const fn = modalResolver;
      modalResolver = null;
      fn(value);
    }
  }
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal(null);
  });
  modalCancel.addEventListener('click', () => closeModal(null));
  document.addEventListener('keydown', (e) => {
    if (modalOverlay.hidden) return;
    if (e.key === 'Escape') closeModal(null);
  });

  function openConfirmModal({ title, body, confirm = 'OK', danger = false }) {
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modalInWrap.hidden = true;
    modalConfirm.textContent = confirm;
    modalConfirm.classList.toggle('modal-confirm-danger', !!danger);
    modalConfirm.onclick = () => closeModal(true);
    modalOverlay.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => modalConfirm.focus(), 0);
    return new Promise((res) => (modalResolver = res)).then(v => !!v);
  }

  function openInputModal({ title, body, initial = '', confirm = 'OK', validate, validateMessage = '' }) {
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modalInWrap.hidden = false;
    modalIn.value = initial;
    modalInHint.textContent = '';
    modalConfirm.textContent = confirm;
    modalConfirm.classList.remove('modal-confirm-danger');
    const submit = () => {
      const v = modalIn.value.trim();
      if (validate && !validate(v)) { modalInHint.textContent = validateMessage; return; }
      closeModal(v);
    };
    modalConfirm.onclick = submit;
    modalIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    modalOverlay.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => { modalIn.focus(); modalIn.select(); }, 0);
    return new Promise((res) => (modalResolver = res));
  }

  render('');
  searchEl.addEventListener('input', e => render(e.target.value));
})();
