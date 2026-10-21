/* ================================================================
   شجرة عائلة بن خادم — Application
   Owner-protected editing · View modes · Welcome tour · Deep links
   ================================================================ */
(() => {
  'use strict';

  /* ==============================================================
     Constants & state
     ============================================================== */
  const DATA_URL = 'data/family.json';
  const LS_THEME = 'bkh-theme';
  const LS_HINT = 'bkh-hint-dismissed';
  const LS_DATA = 'bkh-family-data';
  const LS_COLLAPSED = 'bkh-collapsed';
  const LS_OWNER = 'bkh-owner-session';     // "1" means this browser has unlocked
  const LS_VIEWER_SEEN = 'bkh-viewer-seen';  // viewer strip dismissed
  const LS_WELCOME = 'bkh-welcome-seen';
  const LS_VIEW_MODE = 'bkh-view-mode';
  const LS_DEPTH = 'bkh-depth';

  const VALID_VIEW_MODES = ['outline', 'compact', 'cards'];

  const state = {
    data: null,
    originalData: null,
    peopleArr: [],
    searchIndex: [],
    collapsed: new Set(),
    isDirty: false,
    isOwner: false,              // unlocked edit mode in this browser
    editingPersonId: null,
    editingSpouseIds: [],
    toastTimer: null,
    confirmResolver: null,
    viewMode: 'outline',
    depth: 'all',
  };

  /* ==============================================================
     Bootstrap
     ============================================================== */
  async function init() {
    initTheme();
    const loaded = await loadData();
    if (!loaded) return;

    rebuildIndexes();
    applyMetadata(state.data.metadata);
    loadCollapsed();
    loadViewPrefs();

    // Owner session: persisted per browser. Only honor it if this file has a
    // hash set (otherwise anyone could "unlock" by flipping a flag).
    const hasHash = !!(state.data.metadata && state.data.metadata.ownerHash);
    const owner = localStorage.getItem(LS_OWNER) === '1';
    if (!hasHash) {
      // No passphrase set yet. For the local, no-hash case, we treat
      // this browser as owner by default so a new tree isn't locked
      // out — the first export can set a passphrase via Setup flow.
      state.isOwner = owner !== false; // default: true for a fresh tree
    } else {
      state.isOwner = owner;
    }
    applyOwnerUIState();

    renderTree();
    setupSearch();
    setupToolbar();
    setupModals();
    setupEditForm();
    setupImportExport();
    setupKeyboard();
    setupHintDismiss();
    setupLock();
    setupWelcome();
    setupDeepLink();

    hideLoading();
  }

  async function loadData() {
    let fileData = null;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (res.ok) fileData = await res.json();
    } catch (_) { /* file:// or offline */ }

    let storedData = null;
    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) storedData = JSON.parse(raw);
    } catch (_) { /* ignore */ }

    if (!fileData && !storedData) {
      showLoadError(new Error('لم يتم العثور على ملف البيانات. شغّل التطبيق عبر خادم محلي أو استورد ملفاً.'));
      return false;
    }

    state.data = storedData || deepClone(fileData);
    state.originalData = fileData || deepClone(storedData);
    state.isDirty = !!storedData && !dataEqual(storedData, state.originalData);
    updateDirtyIndicator();
    return true;
  }

  function rebuildIndexes() {
    state.peopleArr = Object.values(state.data.people);
    state.searchIndex = state.peopleArr.map(p => ({
      id: p.id,
      person: p,
      normalized: normalizeArabic([p.name, p.displayName, p.notes].filter(Boolean).join(' ')),
    }));
  }

  function applyMetadata(meta) {
    if (!meta) return;
    document.title = meta.title || document.title;
    setText('app-title', meta.title);
    setText('app-subtitle', meta.subtitle);
    setText('researcher-credit', meta.researcher);
    setText('research-date', meta.researchDate ? `تاريخ البحث: ${meta.researchDate}` : '');
    setText('stat-people', `عدد الأفراد: ${state.peopleArr.length}`);
  }

  /* ==============================================================
     Persistence
     ============================================================== */
  function saveData() {
    try {
      localStorage.setItem(LS_DATA, JSON.stringify(state.data));
      state.isDirty = !dataEqual(state.data, state.originalData);
      updateDirtyIndicator();
    } catch (err) {
      toast('تعذّر الحفظ في المتصفح.', 'error');
    }
  }

  function loadCollapsed() {
    try {
      const raw = localStorage.getItem(LS_COLLAPSED);
      if (raw) state.collapsed = new Set(JSON.parse(raw));
    } catch (_) { state.collapsed = new Set(); }
  }
  function saveCollapsed() {
    try { localStorage.setItem(LS_COLLAPSED, JSON.stringify([...state.collapsed])); } catch (_) {}
  }

  function loadViewPrefs() {
    try {
      const vm = localStorage.getItem(LS_VIEW_MODE);
      if (vm && VALID_VIEW_MODES.includes(vm)) state.viewMode = vm;
      const d = localStorage.getItem(LS_DEPTH);
      if (d) state.depth = d;
    } catch (_) {}
    const depthSel = document.getElementById('depth-select');
    if (depthSel) depthSel.value = state.depth;
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.view === state.viewMode);
    });
    updateDepthControlsVisibility();
  }
  function saveViewPrefs() {
    try {
      localStorage.setItem(LS_VIEW_MODE, state.viewMode);
      localStorage.setItem(LS_DEPTH, String(state.depth));
    } catch (_) {}
  }
  function updateDepthControlsVisibility() {
    const dc = document.getElementById('depth-controls');
    if (!dc) return;
    dc.classList.toggle('depth-controls--hidden', state.viewMode === 'cards');
  }

  function updateDirtyIndicator() {
    const el = document.getElementById('dirty-indicator');
    if (!el) return;
    // Only show the indicator to the owner
    el.hidden = !(state.isDirty && state.isOwner);
  }

  function revertToOriginal() {
    if (!state.originalData) {
      toast('لا توجد نسخة أصلية للاستعادة.', 'error');
      return;
    }
    state.data = deepClone(state.originalData);
    localStorage.removeItem(LS_DATA);
    state.isDirty = false;
    rebuildIndexes();
    applyMetadata(state.data.metadata);
    renderTree();
    updateDirtyIndicator();
    toast('تمت استعادة البيانات الأصلية.', 'success');
  }

  /* ==============================================================
     Owner lock
     ============================================================== */
  function applyOwnerUIState() {
    document.body.classList.toggle('is-edit-mode', state.isOwner);
    document.getElementById('edit-banner').hidden = !state.isOwner;
    const viewer = document.getElementById('viewer-strip');
    const viewerSeen = localStorage.getItem(LS_VIEWER_SEEN) === '1';
    viewer.hidden = state.isOwner || viewerSeen;
    // Lock button icon
    const locked = document.getElementById('icon-locked');
    const unlocked = document.getElementById('icon-unlocked');
    const lockBtn = document.getElementById('btn-lock');
    if (state.isOwner) {
      locked.style.display = 'none';
      unlocked.style.display = '';
      lockBtn.classList.add('is-unlocked');
      lockBtn.title = 'إقفال التحرير';
    } else {
      locked.style.display = '';
      unlocked.style.display = 'none';
      lockBtn.classList.remove('is-unlocked');
      lockBtn.title = 'فتح التحرير (للمالك)';
    }
    const profileEdit = document.getElementById('profile-edit-btn');
    if (profileEdit) profileEdit.hidden = !state.isOwner;
    updateDirtyIndicator();
  }

  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function setupLock() {
    const lockBtn = document.getElementById('btn-lock');
    const unlockModal = document.getElementById('unlock-modal');
    const unlockForm = document.getElementById('unlock-form');
    const setupBlock = document.getElementById('unlock-setup');
    const setupForm = document.getElementById('setup-form');
    const cancelBtn = document.getElementById('unlock-cancel');
    const skipBtn = document.getElementById('setup-skip');
    const errEl = document.getElementById('unlock-error');
    const setupErr = document.getElementById('setup-error');
    const doneBtn = document.getElementById('btn-lock-done');

    lockBtn.addEventListener('click', () => {
      if (state.isOwner) {
        // Lock it back
        state.isOwner = false;
        localStorage.removeItem(LS_OWNER);
        applyOwnerUIState();
        toast('تم إقفال وضع التحرير.', 'default');
        return;
      }
      openUnlockModal();
    });
    doneBtn.addEventListener('click', () => {
      state.isOwner = false;
      localStorage.removeItem(LS_OWNER);
      applyOwnerUIState();
    });

    function openUnlockModal() {
      errEl.hidden = true;
      setupErr.hidden = true;
      const hasHash = !!(state.data.metadata && state.data.metadata.ownerHash);
      // Show setup block only if there's no hash yet
      setupBlock.hidden = hasHash;
      unlockForm.hidden = !hasHash;
      // Update prompt text accordingly
      const subEl = document.getElementById('unlock-sub');
      if (hasHash) {
        subEl.textContent = 'أدخل كلمة المرور الخاصة بمالك الشجرة للسماح بالتعديل والحفظ.';
      } else {
        subEl.textContent = 'لم يتم تعيين كلمة مرور بعد لهذه الشجرة.';
      }
      unlockModal.hidden = false;
      setTimeout(() => {
        const first = hasHash
          ? document.getElementById('unlock-passphrase')
          : document.getElementById('setup-passphrase1');
        if (first) first.focus();
      }, 60);
    }
    function closeUnlockModal() {
      unlockModal.hidden = true;
      unlockForm.reset();
      setupForm.reset();
      errEl.hidden = true;
      setupErr.hidden = true;
    }
    cancelBtn.addEventListener('click', closeUnlockModal);
    unlockModal.querySelector('[data-close]').addEventListener('click', closeUnlockModal);

    unlockForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pw = document.getElementById('unlock-passphrase').value;
      const expectedHash = state.data.metadata.ownerHash;
      const actualHash = await sha256(pw);
      if (actualHash === expectedHash) {
        state.isOwner = true;
        try { localStorage.setItem(LS_OWNER, '1'); } catch (_) {}
        applyOwnerUIState();
        closeUnlockModal();
        toast('تم فتح وضع التحرير. ستُحفظ تغييراتك محلياً — لا تنس التصدير.', 'success');
      } else {
        errEl.hidden = false;
      }
    });

    setupForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const p1 = document.getElementById('setup-passphrase1').value;
      const p2 = document.getElementById('setup-passphrase2').value;
      if (p1.length < 4) {
        setupErr.textContent = 'كلمة المرور قصيرة جداً (4 أحرف على الأقل).';
        setupErr.hidden = false;
        return;
      }
      if (p1 !== p2) {
        setupErr.textContent = 'كلمتا المرور غير متطابقتين.';
        setupErr.hidden = false;
        return;
      }
      const hash = await sha256(p1);
      state.data.metadata = state.data.metadata || {};
      state.data.metadata.ownerHash = hash;
      state.isOwner = true;
      try { localStorage.setItem(LS_OWNER, '1'); } catch (_) {}
      saveData();
      applyOwnerUIState();
      closeUnlockModal();
      toast('تم تعيين كلمة المرور وفتح التحرير. صدّر الملف لحفظها خارج المتصفح.', 'success');
    });

    skipBtn.addEventListener('click', () => {
      // Allow editing without setting a hash (local-only / testing)
      state.isOwner = true;
      try { localStorage.setItem(LS_OWNER, '1'); } catch (_) {}
      applyOwnerUIState();
      closeUnlockModal();
      toast('وضع التحرير مفعّل بدون كلمة مرور (محلياً فقط).', 'default');
    });
  }

  /* ==============================================================
     Welcome tour
     ============================================================== */
  function setupWelcome() {
    const modal = document.getElementById('welcome-modal');
    const seen = localStorage.getItem(LS_WELCOME) === '1';
    const closeBtn = document.getElementById('welcome-close');
    const startBtn = document.getElementById('welcome-start');
    const dontShow = document.getElementById('welcome-dont-show');

    // Show only to viewers (not owners), only first time, and skip if deep-link present
    if (!seen && !state.isOwner && !window.location.hash) {
      setTimeout(() => { modal.hidden = false; }, 600);
    }

    const close = () => {
      modal.hidden = true;
      if (dontShow.checked) {
        try { localStorage.setItem(LS_WELCOME, '1'); } catch (_) {}
      }
    };
    closeBtn.addEventListener('click', close);
    startBtn.addEventListener('click', close);
    modal.querySelector('[data-close]').addEventListener('click', close);
  }

  /* ==============================================================
     Deep links
     ============================================================== */
  function setupDeepLink() {
    const openFromHash = () => {
      const h = window.location.hash;
      if (!h || h.length < 2) return;
      const id = decodeURIComponent(h.slice(1));
      if (state.data.people[id]) {
        revealPerson(id);
        setTimeout(() => openProfile(id), 450);
      }
    };
    // On load
    if (window.location.hash) setTimeout(openFromHash, 200);
    // On future hash changes
    window.addEventListener('hashchange', openFromHash);
  }

  /* ==============================================================
     Tree rendering
     ============================================================== */
  function renderTree() {
    const container = document.getElementById('tree-container');
    container.innerHTML = '';
    container.className = 'tree';
    if (state.viewMode === 'cards') {
      container.classList.add('cards-view');
      renderCardsView(container);
    } else {
      if (state.viewMode === 'compact') container.classList.add('tree--compact');
      renderOutlineTree(container);
    }
  }

  function renderOutlineTree(container) {
    const rootId = state.data.metadata.rootPersonId;
    if (!rootId || !state.data.people[rootId]) {
      container.innerHTML = '<p style="text-align:center; color: var(--ink-muted); padding: 2rem;">لا يوجد جذر محدد.</p>';
      return;
    }
    const visited = new Set();
    const rootBranch = buildBranch(rootId, 0, visited);
    if (rootBranch) container.appendChild(rootBranch);
  }

  function buildBranch(personId, generation, visited) {
    if (visited.has(personId)) return null;
    visited.add(personId);
    const person = state.data.people[personId];
    if (!person) return null;

    const branch = document.createElement('div');
    branch.className = `branch branch--gen-${generation}`;
    branch.dataset.id = person.id;

    const row = createPersonRow(person);
    branch.appendChild(row);

    const childrenToShow = visibleChildrenIds(person).filter(cid => !visited.has(cid));

    if (childrenToShow.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.className = 'branch__children';
      if (state.collapsed.has(person.id)) childContainer.classList.add('is-collapsed');

      for (const cid of childrenToShow) {
        const childBranch = buildBranch(cid, generation + 1, visited);
        if (childBranch) childContainer.appendChild(childBranch);
      }
      branch.appendChild(childContainer);

      const toggle = row.querySelector('.toggle');
      toggle.classList.remove('is-leaf');
      const isOpen = !state.collapsed.has(person.id);
      toggle.classList.add(isOpen ? 'is-open' : 'is-closed');
      toggle.textContent = isOpen ? '▾' : '◂';
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.title = 'انقر للطي/التوسيع · انقر مزدوجاً لكل الفروع';
      toggle.onclick = (ev) => {
        ev.stopPropagation();
        toggleCollapse(person.id, toggle, childContainer);
      };
      toggle.ondblclick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        toggleSubtree(person.id);
      };

      const countBadge = document.createElement('span');
      countBadge.className = 'child-count';
      countBadge.textContent = `${childrenToShow.length} ${childrenToShow.length === 1 ? 'ابن/ابنة' : 'من الأبناء'}`;
      row.querySelector('.person-row__meta').appendChild(countBadge);
    } else {
      row.querySelector('.toggle').classList.add('is-leaf');
    }
    return branch;
  }

  function visibleChildrenIds(person) {
    return (person.childrenIds || []).filter(cid => {
      const child = state.data.people[cid];
      if (!child) return false;
      const father = child.fatherId ? state.data.people[child.fatherId] : null;
      const fatherInFamily = father && !father.external;
      if (child.fatherId === person.id) return true;
      if (!fatherInFamily && child.motherId === person.id) return true;
      return false;
    });
  }

  function createPersonRow(person) {
    const row = document.createElement('div');
    row.className = `person-row ${personRowClasses(person)}`;
    row.dataset.id = person.id;
    row.setAttribute('role', 'treeitem');

    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'طي/توسيع');
    row.appendChild(toggle);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    if (person.photoUrl) {
      avatar.innerHTML = `<img src="${escapeAttr(person.photoUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('${escapeAttr(firstLetter(person.name))}'))" />`;
    } else {
      avatar.textContent = firstLetter(person.name);
    }
    row.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'person-row__info';
    info.tabIndex = 0;
    info.setAttribute('role', 'button');
    info.setAttribute('aria-label', person.displayName || person.name);

    const nameEl = document.createElement('div');
    nameEl.className = 'person-row__name';
    const nameText = document.createElement('span');
    nameText.textContent = person.name || '—';
    nameEl.appendChild(nameText);

    if (person.uncertain) {
      const q = document.createElement('span');
      q.className = 'person-row__icon';
      q.textContent = '؟';
      q.title = 'معلومة غير مؤكدة';
      nameEl.appendChild(q);
    }

    (person.spouseIds || []).forEach(sid => {
      const spouse = state.data.people[sid];
      if (!spouse) return;
      const chip = document.createElement('span');
      chip.className = 'spouse-chip';
      chip.textContent = shortNameForChip(spouse);
      chip.title = spouse.displayName || spouse.name;
      chip.style.cursor = 'pointer';
      chip.onclick = (ev) => { ev.stopPropagation(); openProfile(sid); };
      nameEl.appendChild(chip);
    });

    info.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'person-row__meta';
    const subParts = [];
    if (person.birthDate || person.deathDate) {
      const b = person.birthDate || '؟';
      const d = person.deathDate || '';
      subParts.push(d ? `${b} — ${d}` : `مولود: ${b}`);
    }
    if (person.external) subParts.push('مصاهرة');
    if (person.researcher) subParts.push('الباحث');
    subParts.forEach(text => {
      const s = document.createElement('span');
      s.textContent = text;
      meta.appendChild(s);
    });
    info.appendChild(meta);

    info.onclick = () => openProfile(person.id);
    info.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openProfile(person.id); }
    };
    row.appendChild(info);

    // Action buttons (hidden by CSS unless in edit mode)
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.appendChild(makeActionBtn('add', 'إضافة ابن', '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2"/>', (ev) => {
      ev.stopPropagation(); openEditForm({ mode: 'add-child', parentId: person.id });
    }));
    actions.appendChild(makeActionBtn('edit', 'تحرير', '<path d="M3 17v4h4l12-12-4-4L3 17z" fill="none" stroke="currentColor" stroke-width="2"/>', (ev) => {
      ev.stopPropagation(); openEditForm({ mode: 'edit', personId: person.id });
    }));
    actions.appendChild(makeActionBtn('delete', 'حذف', '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" fill="none" stroke="currentColor" stroke-width="2"/>', (ev) => {
      ev.stopPropagation(); requestDeletePerson(person.id);
    }));
    row.appendChild(actions);

    return row;
  }

  function makeActionBtn(kind, title, svgInner, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `row-action row-action--${kind}`;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14">${svgInner}</svg>`;
    btn.onclick = handler;
    return btn;
  }

  function personRowClasses(p) {
    const cls = [];
    if (p.gender === 'female') cls.push('person-row--female');
    if (p.external) cls.push('person-row--external');
    if (p.uncertain) cls.push('person-row--uncertain');
    if (p.researcher) cls.push('person-row--researcher');
    return cls.join(' ');
  }

  function shortNameForChip(spouse) {
    if (!spouse) return '';
    let n = spouse.name || '';
    n = n.replace(/^(الشيخ(ة)?|الحاج(ة)?)\s+/, '').trim();
    return n.length > 25 ? n.slice(0, 24) + '…' : n;
  }

  function toggleCollapse(id, toggleEl, childContainer) {
    const isCollapsed = state.collapsed.has(id);
    if (isCollapsed) {
      state.collapsed.delete(id);
      childContainer.classList.remove('is-collapsed');
      toggleEl.classList.remove('is-closed'); toggleEl.classList.add('is-open');
      toggleEl.textContent = '▾';
      toggleEl.setAttribute('aria-expanded', 'true');
    } else {
      state.collapsed.add(id);
      childContainer.classList.add('is-collapsed');
      toggleEl.classList.remove('is-open'); toggleEl.classList.add('is-closed');
      toggleEl.textContent = '◂';
      toggleEl.setAttribute('aria-expanded', 'false');
    }
    saveCollapsed();
  }

  function expandAll() {
    state.collapsed.clear();
    state.depth = 'all';
    const sel = document.getElementById('depth-select');
    if (sel) sel.value = 'all';
    saveCollapsed(); saveViewPrefs();
    renderTree();
  }

  function collapseAll() {
    state.collapsed.clear();
    for (const p of state.peopleArr) {
      if (visibleChildrenIds(p).length > 0) state.collapsed.add(p.id);
    }
    state.collapsed.delete(state.data.metadata.rootPersonId);
    state.depth = '1';
    const sel = document.getElementById('depth-select');
    if (sel) sel.value = '1';
    saveCollapsed(); saveViewPrefs();
    renderTree();
  }

  function toggleSubtree(rootId) {
    const descendants = collectDescendants(rootId);
    if (!descendants.length) return;
    if (state.collapsed.has(rootId)) {
      state.collapsed.delete(rootId);
    } else {
      const anyExpanded = descendants.some(id =>
        !state.collapsed.has(id) && hasVisibleChildren(id)
      );
      if (anyExpanded) {
        for (const id of descendants) {
          if (hasVisibleChildren(id)) state.collapsed.add(id);
        }
      } else {
        for (const id of descendants) state.collapsed.delete(id);
      }
    }
    saveCollapsed();
    renderTree();
  }

  function collectDescendants(rootId) {
    const out = [];
    const seen = new Set();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      const p = state.data.people[id];
      if (!p) continue;
      for (const cid of visibleChildrenIds(p)) stack.push(cid);
    }
    return out;
  }

  function hasVisibleChildren(id) {
    const p = state.data.people[id];
    return p ? visibleChildrenIds(p).length > 0 : false;
  }

  function setDepth(value) {
    state.depth = value;
    saveViewPrefs();
    if (value === 'all') {
      state.collapsed.clear();
    } else {
      const n = parseInt(value, 10);
      const gens = computeGenerations();
      state.collapsed.clear();
      for (const [id, g] of gens.entries()) {
        if (g >= n - 1 && hasVisibleChildren(id)) state.collapsed.add(id);
      }
    }
    saveCollapsed();
    renderTree();
  }

  /* ==============================================================
     Cards view
     ============================================================== */
  function renderCardsView(container) {
    const gens = computeGenerations();
    const byGen = {};
    for (const p of state.peopleArr) {
      if (p.external) continue;
      const g = gens.get(p.id);
      if (g == null) continue;
      (byGen[g] ||= []).push(p);
    }
    for (const p of state.peopleArr) {
      if (!p.external) continue;
      const partnerGen = (p.spouseIds || []).map(sid => gens.get(sid)).find(g => g != null);
      if (partnerGen == null) continue;
      (byGen[partnerGen] ||= []).push(p);
    }
    for (const g of Object.keys(byGen)) {
      byGen[g].sort((a, b) => {
        if (a.external !== b.external) return a.external ? 1 : -1;
        return (a.name || '').localeCompare(b.name || '', 'ar');
      });
    }
    const sortedGens = Object.keys(byGen).map(Number).sort((a, b) => a - b);
    if (!sortedGens.length) {
      container.innerHTML = '<p style="text-align:center; color: var(--ink-muted); padding: 2rem;">لا توجد بيانات.</p>';
      return;
    }
    for (const g of sortedGens) {
      const section = document.createElement('section');
      section.className = 'gen-section';
      const header = document.createElement('div');
      header.className = 'gen-section__header';
      const title = document.createElement('h2');
      title.className = 'gen-section__title';
      title.textContent = `الجيل ${toArabicOrdinal(g + 1)}`;
      header.appendChild(title);
      const count = document.createElement('span');
      count.className = 'gen-section__count';
      count.textContent = `${byGen[g].length} شخص`;
      header.appendChild(count);
      section.appendChild(header);
      const grid = document.createElement('div');
      grid.className = 'cards-grid';
      for (const p of byGen[g]) grid.appendChild(createPersonCard(p));
      section.appendChild(grid);
      container.appendChild(section);
    }
  }

  function createPersonCard(p) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = p.id;
    if (p.gender === 'female') card.classList.add('card--female');
    if (p.external) card.classList.add('card--external');
    if (p.uncertain) card.classList.add('card--uncertain');
    if (p.researcher) card.classList.add('card--researcher');

    const avatar = document.createElement('div');
    avatar.className = 'card__avatar';
    if (p.photoUrl) {
      avatar.innerHTML = `<img src="${escapeAttr(p.photoUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('${escapeAttr(firstLetter(p.name))}'))" />`;
    } else {
      avatar.textContent = firstLetter(p.name);
    }
    card.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'card__body';
    const name = document.createElement('div');
    name.className = 'card__name';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name || '—';
    name.appendChild(nameSpan);
    if (p.uncertain) {
      const q = document.createElement('span');
      q.className = 'card__uncertain';
      q.textContent = '؟';
      q.title = 'غير مؤكد';
      name.appendChild(q);
    }
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    const parts = [];
    if (p.birthDate || p.deathDate) {
      const b = p.birthDate || '؟';
      const d = p.deathDate || '';
      parts.push(d ? `${b} — ${d}` : b);
    }
    if (p.external) parts.push('مصاهرة');
    const childCount = (p.childrenIds || []).length;
    if (childCount > 0) parts.push(`${childCount} ${childCount === 1 ? 'ابن/ابنة' : 'من الأبناء'}`);
    const spouseCount = (p.spouseIds || []).length;
    if (spouseCount > 1) parts.push(`${spouseCount} أزواج`);
    parts.forEach(text => {
      const s = document.createElement('span');
      s.textContent = text;
      meta.appendChild(s);
    });
    body.appendChild(meta);
    card.appendChild(body);
    card.onclick = () => openProfile(p.id);
    return card;
  }

  function computeGenerations() {
    const gens = new Map();
    const rootId = state.data.metadata.rootPersonId;
    if (!rootId) return gens;
    const queue = [[rootId, 0]];
    while (queue.length) {
      const [id, g] = queue.shift();
      if (gens.has(id)) continue;
      gens.set(id, g);
      const person = state.data.people[id];
      if (!person) continue;
      for (const cid of (person.childrenIds || [])) {
        const c = state.data.people[cid];
        if (!c || c.external) continue;
        if (!gens.has(cid)) queue.push([cid, g + 1]);
      }
    }
    return gens;
  }

  const ARABIC_ORDINALS = [
    'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
    'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر',
  ];
  function toArabicOrdinal(n) { return ARABIC_ORDINALS[n - 1] || `${n}`; }

  /* ==============================================================
     Reveal / scroll
     ============================================================== */
  function revealPerson(id) {
    if (state.viewMode === 'cards') setViewMode('outline');
    let cur = state.data.people[id];
    const toOpen = [];
    while (cur) {
      let parentId = null;
      if (cur.fatherId && state.data.people[cur.fatherId] && !state.data.people[cur.fatherId].external) {
        parentId = cur.fatherId;
      } else if (cur.motherId && state.data.people[cur.motherId]) {
        parentId = cur.motherId;
      }
      if (!parentId) break;
      if (state.collapsed.has(parentId)) toOpen.push(parentId);
      cur = state.data.people[parentId];
    }
    toOpen.forEach(pid => state.collapsed.delete(pid));
    saveCollapsed();
    renderTree();
    requestAnimationFrame(() => {
      const row = document.querySelector(`.person-row[data-id="${CSS.escape(id)}"]`);
      if (row) {
        document.querySelectorAll('.person-row.is-focused').forEach(el => el.classList.remove('is-focused'));
        row.classList.add('is-focused');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => row.classList.remove('is-focused'), 2200);
      }
    });
  }

  /* ==============================================================
     Profile modal
     ============================================================== */
  function openProfile(id) {
    const p = state.data.people[id];
    if (!p) return;
    const modal = document.getElementById('profile-modal');

    setText('modal-name', p.displayName || p.name);
    const fullEl = document.getElementById('profile-full');
    if (p.displayName && p.name && p.displayName !== p.name) {
      fullEl.textContent = p.name;
      fullEl.style.display = '';
    } else {
      fullEl.style.display = 'none';
    }

    const photoEl = document.getElementById('profile-photo');
    if (p.photoUrl) {
      photoEl.innerHTML = `<img src="${escapeAttr(p.photoUrl)}" alt="${escapeAttr(p.name)}" />`;
    } else {
      photoEl.innerHTML = `<span>${escapeHtml(firstLetter(p.displayName || p.name))}</span>`;
    }

    renderBadges(p);
    renderFacts(p);
    renderRelations(p);
    renderLineage(p);

    const notesWrap = document.getElementById('profile-notes-wrap');
    if (p.notes && p.notes.trim()) { setText('profile-notes', p.notes); notesWrap.hidden = false; }
    else notesWrap.hidden = true;

    const editBtn = document.getElementById('profile-edit-btn');
    editBtn.hidden = !state.isOwner;
    editBtn.onclick = () => { closeProfile(); openEditForm({ mode: 'edit', personId: id }); };

    const shareBtn = document.getElementById('profile-share-btn');
    shareBtn.onclick = () => sharePersonLink(id);

    modal.hidden = false;
    // Push hash without triggering a tour or search behavior
    const newHash = '#' + id;
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
    setTimeout(() => document.getElementById('modal-close').focus(), 50);
  }

  function closeProfile() {
    document.getElementById('profile-modal').hidden = true;
    // Clear hash so it doesn't re-open on reload unless user wants to share
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function sharePersonLink(id) {
    const url = window.location.href.split('#')[0] + '#' + id;
    const copyIt = () => {
      navigator.clipboard.writeText(url).then(
        () => toast('تم نسخ الرابط. أرسله لمن تريد.', 'success'),
        () => toast(url, 'default')
      );
    };
    if (navigator.share) {
      const p = state.data.people[id];
      navigator.share({
        title: p ? (p.displayName || p.name) : 'شجرة عائلة بن خادم',
        url,
      }).catch(copyIt);
    } else {
      copyIt();
    }
  }

  function renderLineage(p) {
    const el = document.getElementById('lineage');
    el.innerHTML = '';
    // Walk up to root via father, falling back to mother
    const path = [];
    let cur = p;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur);
      let parent = null;
      if (cur.fatherId && state.data.people[cur.fatherId] && !state.data.people[cur.fatherId].external) {
        parent = state.data.people[cur.fatherId];
      } else if (cur.motherId && state.data.people[cur.motherId]) {
        parent = state.data.people[cur.motherId];
      }
      cur = parent;
    }
    if (path.length <= 1) return;
    path.forEach((person, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'lineage__sep';
        sep.textContent = '◂';
        el.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lineage__item';
      if (person.id === p.id) btn.classList.add('is-current');
      btn.textContent = truncate(person.name, 20);
      if (person.id !== p.id) {
        btn.onclick = () => {
          closeProfile();
          revealPerson(person.id);
          setTimeout(() => openProfile(person.id), 400);
        };
      }
      el.appendChild(btn);
    });
  }

  function renderBadges(p) {
    const container = document.getElementById('profile-badges');
    const badges = [];
    badges.push(p.gender === 'female'
      ? `<span class="badge badge--female">أنثى</span>`
      : `<span class="badge badge--male">ذكر</span>`);
    if (p.external) badges.push(`<span class="badge badge--external">مصاهرة</span>`);
    if (p.uncertain) badges.push(`<span class="badge badge--uncertain">غير مؤكد</span>`);
    if (p.researcher) badges.push(`<span class="badge badge--researcher">معدّ الشجرة</span>`);
    container.innerHTML = badges.join('');
  }

  function renderFacts(p) {
    const facts = document.getElementById('profile-facts');
    const rows = [];
    rows.push(['المعرّف', p.id]);
    if (p.birthDate) rows.push(['تاريخ الميلاد', p.birthDate]);
    if (p.deathDate) rows.push(['تاريخ الوفاة', p.deathDate]);
    if (!p.birthDate && !p.deathDate) rows.push(['التواريخ', 'غير متوفرة']);
    facts.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  }

  function renderRelations(p) {
    renderRelationList('rel-father', p.fatherId ? [p.fatherId] : []);
    renderRelationList('rel-mother', p.motherId ? [p.motherId] : []);
    renderRelationList('rel-spouse', p.spouseIds || []);
    renderRelationList('rel-children', p.childrenIds || []);
    renderRelationList('rel-siblings', getSiblings(p));
  }

  function getSiblings(p) {
    const result = new Set();
    if (p.fatherId && state.data.people[p.fatherId]) {
      for (const id of (state.data.people[p.fatherId].childrenIds || [])) {
        if (id !== p.id) result.add(id);
      }
    }
    if (p.motherId && state.data.people[p.motherId]) {
      for (const id of (state.data.people[p.motherId].childrenIds || [])) {
        if (id !== p.id) result.add(id);
      }
    }
    return [...result];
  }

  function renderRelationList(containerId, ids) {
    const el = document.getElementById(containerId);
    if (!ids.length) {
      el.innerHTML = `<span class="relation-chip relation-chip--empty">—</span>`;
      return;
    }
    el.innerHTML = ids.map(id => {
      const person = state.data.people[id];
      if (!person) return `<span class="relation-chip relation-chip--empty">${escapeHtml(id)}</span>`;
      const label = truncate(person.displayName || person.name, 38);
      return `<button class="relation-chip" data-id="${escapeAttr(id)}" type="button">${escapeHtml(label)}</button>`;
    }).join('');
    el.querySelectorAll('.relation-chip[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        closeProfile();
        revealPerson(id);
        setTimeout(() => openProfile(id), 400);
      });
    });
  }

  /* ==============================================================
     Edit form (owner-gated by UI: edit buttons are hidden otherwise)
     ============================================================== */
  function setupEditForm() {
    const form = document.getElementById('edit-form');
    const closeBtn = document.getElementById('edit-close');
    const cancelBtn = document.getElementById('edit-cancel-btn');
    const deleteBtn = document.getElementById('edit-delete-btn');
    const modal = document.getElementById('edit-modal');

    closeBtn.addEventListener('click', closeEditForm);
    cancelBtn.addEventListener('click', closeEditForm);
    modal.querySelector('[data-close]').addEventListener('click', closeEditForm);

    deleteBtn.addEventListener('click', () => {
      if (state.editingPersonId) {
        closeEditForm();
        requestDeletePerson(state.editingPersonId);
      }
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      submitEditForm();
    });

    document.getElementById('add-spouse-btn').addEventListener('click', () => {
      const sel = document.getElementById('add-spouse-select');
      const val = sel.value;
      if (!val) return;
      if (!state.editingSpouseIds.includes(val)) {
        state.editingSpouseIds.push(val);
        renderSpousePicker();
      }
      sel.value = '';
    });

    document.getElementById('new-spouse-btn').addEventListener('click', () => {
      const parentEditing = state.editingPersonId;
      if (!parentEditing) {
        toast('احفظ هذا الشخص أولاً، ثم أضف زوجاً بإعادة فتح تحريره.', 'error');
        return;
      }
      closeEditForm();
      openEditForm({ mode: 'add-spouse', partnerId: parentEditing });
    });
  }

  function openEditForm(options) {
    if (!state.isOwner) {
      toast('التحرير متاح للمالك فقط. اضغط أيقونة القفل أعلى الصفحة.', 'error');
      return;
    }
    const modal = document.getElementById('edit-modal');
    const form = document.getElementById('edit-form');
    const titleEl = document.getElementById('edit-title');
    const subEl = document.getElementById('edit-subtitle');
    const deleteBtn = document.getElementById('edit-delete-btn');

    form.reset();
    state.editingPersonId = null;
    state.editingSpouseIds = [];

    populatePersonSelect(form.elements['fatherId'], { genderFilter: 'male' });
    populatePersonSelect(form.elements['motherId'], { genderFilter: 'female' });
    populatePersonSelect(document.getElementById('add-spouse-select'), {});

    if (options.mode === 'edit') {
      const p = state.data.people[options.personId];
      if (!p) { closeEditForm(); return; }
      state.editingPersonId = p.id;
      titleEl.textContent = 'تحرير شخص';
      subEl.textContent = `المعرّف: ${p.id}`;
      deleteBtn.hidden = false;
      form.elements['name'].value = p.name || '';
      form.elements['displayName'].value = p.displayName || '';
      form.elements['gender'].value = p.gender || 'male';
      form.elements['photoUrl'].value = p.photoUrl || '';
      form.elements['birthDate'].value = p.birthDate || '';
      form.elements['deathDate'].value = p.deathDate || '';
      form.elements['notes'].value = p.notes || '';
      form.elements['fatherId'].value = p.fatherId || '';
      form.elements['motherId'].value = p.motherId || '';
      form.elements['uncertain'].checked = !!p.uncertain;
      form.elements['external'].checked = !!p.external;
      form.elements['researcher'].checked = !!p.researcher;
      state.editingSpouseIds = [...(p.spouseIds || [])];
      populatePersonSelect(form.elements['fatherId'], { genderFilter: 'male', excludeId: p.id, selected: p.fatherId });
      populatePersonSelect(form.elements['motherId'], { genderFilter: 'female', excludeId: p.id, selected: p.motherId });
      populatePersonSelect(document.getElementById('add-spouse-select'), { excludeId: p.id });
    } else if (options.mode === 'add-child') {
      const parent = state.data.people[options.parentId];
      titleEl.textContent = 'إضافة ابن/ابنة';
      subEl.textContent = parent ? `تحت: ${parent.displayName || parent.name}` : '';
      deleteBtn.hidden = true;
      form.elements['gender'].value = 'male';
      if (parent) {
        if (parent.gender === 'male') {
          form.elements['fatherId'].value = parent.id;
          const motherId = (parent.spouseIds || [])[0];
          if (motherId) form.elements['motherId'].value = motherId;
        } else {
          form.elements['motherId'].value = parent.id;
          const fatherId = (parent.spouseIds || [])[0];
          if (fatherId) form.elements['fatherId'].value = fatherId;
        }
      }
    } else if (options.mode === 'add-spouse') {
      const partner = state.data.people[options.partnerId];
      titleEl.textContent = 'إضافة زوج/زوجة';
      subEl.textContent = partner ? `شريك: ${partner.displayName || partner.name}` : '';
      deleteBtn.hidden = true;
      form.elements['external'].checked = true;
      form.elements['gender'].value = partner && partner.gender === 'male' ? 'female' : 'male';
      state.editingSpouseIds = partner ? [partner.id] : [];
    }

    renderSpousePicker();
    modal.hidden = false;
    setTimeout(() => form.elements['name'].focus(), 60);
  }

  function closeEditForm() {
    document.getElementById('edit-modal').hidden = true;
    state.editingPersonId = null;
    state.editingSpouseIds = [];
  }

  function populatePersonSelect(selectEl, options) {
    if (!selectEl) return;
    const { genderFilter, excludeId, selected } = options || {};
    selectEl.innerHTML = '<option value="">— لا يوجد —</option>';
    const sorted = state.peopleArr
      .filter(p => {
        if (excludeId && p.id === excludeId) return false;
        if (genderFilter && p.gender !== genderFilter) return false;
        return true;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    for (const p of sorted) {
      const opt = document.createElement('option');
      opt.value = p.id;
      const extra = p.external ? ' (مصاهرة)' : '';
      opt.textContent = `${p.name}${extra} — ${p.id}`;
      selectEl.appendChild(opt);
    }
    if (selected && state.data.people[selected]) selectEl.value = selected;
  }

  function renderSpousePicker() {
    const picker = document.getElementById('spouses-picker');
    picker.innerHTML = '';
    if (!state.editingSpouseIds.length) {
      picker.innerHTML = '<span class="chip-picker__empty">— لا يوجد —</span>';
      return;
    }
    for (const sid of state.editingSpouseIds) {
      const sp = state.data.people[sid];
      const label = sp ? (sp.name || sid) : sid;
      const item = document.createElement('span');
      item.className = 'chip-picker__item';
      item.innerHTML = `${escapeHtml(label)} <button type="button" class="chip-picker__remove" aria-label="إزالة">×</button>`;
      item.querySelector('button').onclick = () => {
        state.editingSpouseIds = state.editingSpouseIds.filter(x => x !== sid);
        renderSpousePicker();
      };
      picker.appendChild(item);
    }
  }

  function submitEditForm() {
    const form = document.getElementById('edit-form');
    const name = form.elements['name'].value.trim();
    if (!name) { toast('الاسم مطلوب.', 'error'); form.elements['name'].focus(); return; }
    const patch = {
      name,
      displayName: form.elements['displayName'].value.trim() || null,
      gender: form.elements['gender'].value,
      photoUrl: form.elements['photoUrl'].value.trim() || null,
      birthDate: form.elements['birthDate'].value.trim() || null,
      deathDate: form.elements['deathDate'].value.trim() || null,
      fatherId: form.elements['fatherId'].value || null,
      motherId: form.elements['motherId'].value || null,
      notes: form.elements['notes'].value.trim() || null,
      uncertain: form.elements['uncertain'].checked,
      external: form.elements['external'].checked,
      researcher: form.elements['researcher'].checked,
      spouseIds: [...state.editingSpouseIds],
    };
    let savedId;
    if (state.editingPersonId) savedId = updatePerson(state.editingPersonId, patch);
    else savedId = createPerson(patch);
    closeEditForm();
    rebuildIndexes();
    renderTree();
    saveData();
    toast('تم الحفظ.', 'success');
    if (savedId) revealPerson(savedId);
  }

  /* ==============================================================
     CRUD
     ============================================================== */
  function createPerson(patch) {
    const id = generatePersonId(patch);
    const newPerson = {
      id, name: patch.name,
      displayName: patch.displayName || null,
      gender: patch.gender || 'male',
      fatherId: patch.fatherId || null,
      motherId: patch.motherId || null,
      spouseIds: [...(patch.spouseIds || [])],
      childrenIds: [],
      birthDate: patch.birthDate || null,
      deathDate: patch.deathDate || null,
      notes: patch.notes || null,
      photoUrl: patch.photoUrl || null,
      uncertain: !!patch.uncertain,
      external: !!patch.external,
      researcher: !!patch.researcher,
    };
    state.data.people[id] = newPerson;
    if (newPerson.fatherId && state.data.people[newPerson.fatherId]) {
      addUnique(state.data.people[newPerson.fatherId].childrenIds, id);
    }
    if (newPerson.motherId && state.data.people[newPerson.motherId]) {
      addUnique(state.data.people[newPerson.motherId].childrenIds, id);
    }
    for (const sid of newPerson.spouseIds) {
      const sp = state.data.people[sid];
      if (sp) { sp.spouseIds = sp.spouseIds || []; addUnique(sp.spouseIds, id); }
    }
    return id;
  }

  function updatePerson(id, patch) {
    const p = state.data.people[id];
    if (!p) return null;
    const prevFather = p.fatherId;
    const prevMother = p.motherId;
    const prevSpouses = [...(p.spouseIds || [])];
    Object.assign(p, {
      name: patch.name,
      displayName: patch.displayName || null,
      gender: patch.gender,
      photoUrl: patch.photoUrl || null,
      birthDate: patch.birthDate || null,
      deathDate: patch.deathDate || null,
      notes: patch.notes || null,
      uncertain: !!patch.uncertain,
      external: !!patch.external,
      researcher: !!patch.researcher,
    });
    const newFather = patch.fatherId || null;
    if (prevFather !== newFather) {
      if (prevFather && state.data.people[prevFather]) {
        state.data.people[prevFather].childrenIds =
          (state.data.people[prevFather].childrenIds || []).filter(x => x !== id);
      }
      p.fatherId = newFather;
      if (newFather && state.data.people[newFather]) addUnique(state.data.people[newFather].childrenIds, id);
    }
    const newMother = patch.motherId || null;
    if (prevMother !== newMother) {
      if (prevMother && state.data.people[prevMother]) {
        state.data.people[prevMother].childrenIds =
          (state.data.people[prevMother].childrenIds || []).filter(x => x !== id);
      }
      p.motherId = newMother;
      if (newMother && state.data.people[newMother]) addUnique(state.data.people[newMother].childrenIds, id);
    }
    const newSpouses = [...(patch.spouseIds || [])];
    const added = newSpouses.filter(s => !prevSpouses.includes(s));
    const removed = prevSpouses.filter(s => !newSpouses.includes(s));
    p.spouseIds = newSpouses;
    for (const sid of added) {
      const sp = state.data.people[sid];
      if (sp) addUnique(sp.spouseIds = sp.spouseIds || [], id);
    }
    for (const sid of removed) {
      const sp = state.data.people[sid];
      if (sp) sp.spouseIds = (sp.spouseIds || []).filter(x => x !== id);
    }
    return id;
  }

  function requestDeletePerson(id) {
    if (!state.isOwner) { toast('التحرير متاح للمالك فقط.', 'error'); return; }
    const p = state.data.people[id];
    if (!p) return;
    const isRoot = state.data.metadata.rootPersonId === id;
    if (isRoot) { toast('لا يمكن حذف جذر الشجرة. غيّر الجذر من ملف البيانات أولاً.', 'error'); return; }
    const hasChildren = (p.childrenIds || []).length > 0;
    let body = `هل أنت متأكد من حذف "${p.name}"؟`;
    if (hasChildren) body += `\n\nسينفصل الأبناء (${p.childrenIds.length}) ولن يُحذفوا.`;
    confirmDialog({ title: 'حذف شخص', body, confirmText: 'حذف' }).then(ok => {
      if (ok) {
        deletePerson(id);
        rebuildIndexes();
        renderTree();
        saveData();
        toast('تم الحذف.', 'success');
      }
    });
  }

  function deletePerson(id) {
    const p = state.data.people[id];
    if (!p) return;
    if (p.fatherId && state.data.people[p.fatherId]) {
      state.data.people[p.fatherId].childrenIds =
        (state.data.people[p.fatherId].childrenIds || []).filter(x => x !== id);
    }
    if (p.motherId && state.data.people[p.motherId]) {
      state.data.people[p.motherId].childrenIds =
        (state.data.people[p.motherId].childrenIds || []).filter(x => x !== id);
    }
    for (const sid of (p.spouseIds || [])) {
      if (state.data.people[sid]) {
        state.data.people[sid].spouseIds =
          (state.data.people[sid].spouseIds || []).filter(x => x !== id);
      }
    }
    for (const cid of (p.childrenIds || [])) {
      const c = state.data.people[cid];
      if (!c) continue;
      if (c.fatherId === id) c.fatherId = null;
      if (c.motherId === id) c.motherId = null;
    }
    delete state.data.people[id];
  }

  function generatePersonId(patch) {
    const prefix = patch.external ? 'sp' : 'p';
    const re = new RegExp(`^${prefix}(\\d+)$`);
    let max = 0;
    for (const k of Object.keys(state.data.people)) {
      const m = k.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  /* ==============================================================
     Search
     ============================================================== */
  function setupSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    let activeIndex = -1;
    const closeResults = () => { results.hidden = true; activeIndex = -1; };
    const runSearch = () => {
      const q = normalizeArabic(input.value);
      if (q.length < 1) { closeResults(); return; }
      const matches = state.searchIndex.filter(e => e.normalized.includes(q)).slice(0, 12);
      if (!matches.length) {
        results.innerHTML = `<div class="search-result__empty">لا توجد نتائج</div>`;
        results.hidden = false;
        return;
      }
      results.innerHTML = matches.map((m, i) => {
        const name = highlightMatch(m.person.displayName || m.person.name, input.value);
        const meta = metaLabel(m.person);
        return `<div class="search-result" data-id="${escapeAttr(m.person.id)}" data-index="${i}">
          <span class="search-result__name">${name}</span>
          <span class="search-result__meta">${meta}</span>
        </div>`;
      }).join('');
      results.hidden = false;
      activeIndex = -1;
      results.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.id;
          input.value = '';
          closeResults();
          revealPerson(id);
          setTimeout(() => openProfile(id), 400);
        });
      });
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', () => { if (input.value) runSearch(); });
    input.addEventListener('keydown', ev => {
      const items = Array.from(results.querySelectorAll('.search-result'));
      if (!items.length) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActive(items, activeIndex);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateActive(items, activeIndex);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const t = activeIndex >= 0 ? items[activeIndex] : items[0];
        if (t) t.click();
      } else if (ev.key === 'Escape') {
        closeResults(); input.blur();
      }
    });
    document.addEventListener('click', ev => {
      if (!ev.target.closest('.search')) closeResults();
    });
  }
  function updateActive(items, idx) {
    items.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }
  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const idx = (text || '').toLowerCase().indexOf(query.toLowerCase());
    if (idx >= 0) {
      return escapeHtml(text.slice(0, idx)) +
        `<mark>${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
        escapeHtml(text.slice(idx + query.length));
    }
    return escapeHtml(text);
  }
  function metaLabel(p) {
    if (p.external) return 'مصاهرة';
    if (p.uncertain) return 'غير مؤكد';
    if (p.researcher) return 'الباحث';
    return p.gender === 'female' ? 'أنثى' : 'ذكر';
  }

  /* ==============================================================
     Toolbar
     ============================================================== */
  function setupToolbar() {
    document.getElementById('btn-expand-all').addEventListener('click', expandAll);
    document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);

    document.getElementById('btn-export-quick')?.addEventListener('click', exportData);
    document.getElementById('btn-revert')?.addEventListener('click', () => {
      confirmDialog({
        title: 'استعادة البيانات الأصلية',
        body: 'سيتم التخلي عن كل التعديلات المحلية والرجوع للبيانات الأصلية من الملف. هل أنت متأكد؟',
        confirmText: 'استعادة',
      }).then(ok => { if (ok) revertToOriginal(); });
    });

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.view;
        if (!mode || !VALID_VIEW_MODES.includes(mode)) return;
        setViewMode(mode);
      });
    });
    const depthSel = document.getElementById('depth-select');
    if (depthSel) depthSel.addEventListener('change', (ev) => setDepth(ev.target.value));

    // Viewer strip close
    document.getElementById('viewer-strip-close').addEventListener('click', () => {
      document.getElementById('viewer-strip').hidden = true;
      try { localStorage.setItem(LS_VIEWER_SEEN, '1'); } catch (_) {}
    });

    // Help
    document.getElementById('btn-help').addEventListener('click', () => {
      document.getElementById('help-modal').hidden = false;
    });
  }

  function setViewMode(mode) {
    if (state.viewMode === mode) return;
    state.viewMode = mode;
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.view === mode);
    });
    updateDepthControlsVisibility();
    saveViewPrefs();
    renderTree();
  }

  /* ==============================================================
     Import / Export
     ============================================================== */
  function setupImportExport() {
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      importData(file);
      ev.target.value = '';
    });
  }

  function exportData() {
    if (!state.isOwner) { toast('التصدير متاح للمالك فقط.', 'error'); return; }
    if (!state.data.metadata) state.data.metadata = {};
    state.data.metadata.lastUpdated = new Date().toISOString().slice(0, 10);
    const pretty = JSON.stringify(state.data, null, 2);
    const blob = new Blob([pretty], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `family-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('تم تصدير الملف. ضعه في data/family.json لمشاركته مع العائلة.', 'success');
  }

  async function importData(file) {
    if (!state.isOwner) { toast('الاستيراد متاح للمالك فقط.', 'error'); return; }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.people || !parsed.metadata) {
        throw new Error('الملف لا يحتوي على بنية صحيحة (people, metadata).');
      }
      confirmDialog({
        title: 'استيراد بيانات',
        body: `هل تريد استبدال البيانات الحالية بمحتوى "${file.name}"؟ (${Object.keys(parsed.people).length} شخصاً)`,
        confirmText: 'استيراد',
      }).then(ok => {
        if (!ok) return;
        state.data = parsed;
        rebuildIndexes();
        applyMetadata(state.data.metadata);
        state.collapsed = new Set();
        saveCollapsed();
        renderTree();
        saveData();
        toast('تم استيراد البيانات بنجاح.', 'success');
      });
    } catch (err) {
      toast(`خطأ في الاستيراد: ${err.message}`, 'error');
    }
  }

  /* ==============================================================
     Theme / Modals / Keyboard / Hint
     ============================================================== */
  function initTheme() {
    let theme = localStorage.getItem(LS_THEME);
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(theme);
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const moon = document.getElementById('icon-moon');
    const sun = document.getElementById('icon-sun');
    if (theme === 'dark') { if (moon) moon.style.display = 'none'; if (sun) sun.style.display = ''; }
    else { if (moon) moon.style.display = ''; if (sun) sun.style.display = 'none'; }
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(LS_THEME, next);
  }

  function setupModals() {
    document.getElementById('modal-close').addEventListener('click', closeProfile);
    document.getElementById('profile-modal').querySelector('[data-close]').addEventListener('click', closeProfile);
    document.getElementById('help-modal').querySelectorAll('[data-close]').forEach(el =>
      el.addEventListener('click', () => { document.getElementById('help-modal').hidden = true; })
    );
    document.getElementById('confirm-modal').querySelector('[data-close]').addEventListener('click', () => resolveConfirm(false));
    document.getElementById('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
    document.getElementById('confirm-ok').addEventListener('click', () => resolveConfirm(true));
  }

  function confirmDialog({ title, body, confirmText = 'تأكيد' }) {
    return new Promise((resolve) => {
      setText('confirm-title', title);
      const bodyEl = document.getElementById('confirm-body');
      bodyEl.innerHTML = '';
      body.split('\n').forEach((line, i) => {
        if (i > 0) bodyEl.appendChild(document.createElement('br'));
        bodyEl.appendChild(document.createTextNode(line));
      });
      document.getElementById('confirm-ok').textContent = confirmText;
      document.getElementById('confirm-modal').hidden = false;
      state.confirmResolver = resolve;
    });
  }
  function resolveConfirm(result) {
    document.getElementById('confirm-modal').hidden = true;
    if (state.confirmResolver) {
      const r = state.confirmResolver;
      state.confirmResolver = null;
      r(result);
    }
  }

  function setupKeyboard() {
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        for (const mid of ['edit-modal','profile-modal','help-modal','welcome-modal','unlock-modal','confirm-modal']) {
          const m = document.getElementById(mid);
          if (m && !m.hidden) {
            if (mid === 'confirm-modal') resolveConfirm(false);
            else if (mid === 'profile-modal') closeProfile();
            else m.hidden = true;
            return;
          }
        }
      }
      if (ev.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        ev.preventDefault();
        document.getElementById('search-input').focus();
      }
      if (ev.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        ev.preventDefault();
        document.getElementById('help-modal').hidden = false;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's' && state.isOwner) {
        ev.preventDefault();
        exportData();
      }
    });
  }

  function setupHintDismiss() {
    const hint = document.getElementById('hint');
    if (localStorage.getItem(LS_HINT) === '1') hint.classList.add('is-hidden');
    document.getElementById('hint-close').addEventListener('click', () => {
      hint.classList.add('is-hidden');
      try { localStorage.setItem(LS_HINT, '1'); } catch (_) {}
    });
    setTimeout(() => {
      if (!hint.classList.contains('is-hidden')) {
        hint.classList.add('is-hidden');
        try { localStorage.setItem(LS_HINT, '1'); } catch (_) {}
      }
    }, 14000);
  }

  /* ==============================================================
     Utilities
     ============================================================== */
  function hideLoading() {
    const l = document.getElementById('loading');
    if (l) { l.classList.add('is-hidden'); setTimeout(() => l && l.remove(), 400); }
  }
  function showLoadError(err) {
    const l = document.getElementById('loading');
    if (l) {
      l.innerHTML = `
        <div style="text-align:center; padding:2rem; max-width: 500px;">
          <p style="color: var(--danger); font-weight:700; margin-bottom:0.5rem;">تعذّر تحميل بيانات العائلة</p>
          <p style="color:var(--ink-muted); font-size:0.9rem;">${escapeHtml(String(err.message || err))}</p>
          <p style="color:var(--ink-muted); font-size:0.85rem; margin-top:1rem;">
            تأكد من تشغيل التطبيق عبر خادم محلي (مثل <code>python -m http.server</code>) لقراءة ملف JSON.
          </p>
        </div>`;
    }
  }
  function toast(message, kind = 'default') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.className = `toast${kind !== 'default' ? ` toast--${kind}` : ''}`;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
  }
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '';
  }
  function firstLetter(s) {
    if (!s) return '؟';
    return s.trim().charAt(0) || '؟';
  }
  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function addUnique(arr, val) { if (!arr.includes(val)) arr.push(val); return arr; }
  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function dataEqual(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }
  function normalizeArabic(s) {
    if (!s) return '';
    return s
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[أإآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ؤئء]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
