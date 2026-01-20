(() => {
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'publicPhoneVaultEntries';

  const subLine = $('subLine');
  const publicChip = $('publicChip');
  const toast = $('toast');
  const updatedStamp = $('updatedStamp');

  const entryForm = $('entryForm');
  const nameInput = $('name');
  const phoneInput = $('phone');
  const labelInput = $('label');
  const notesInput = $('notes');
  const isPublicInput = $('isPublic');
  const btnReset = $('btnReset');

  const entryList = $('entryList');
  const publicBoard = $('publicBoard');
  const publicExport = $('publicExport');
  const btnCopy = $('btnCopy');
  const countLabel = $('countLabel');

  const filterButtons = document.querySelectorAll('[data-filter]');

  let entries = [];
  let editingId = null;
  let activeFilter = 'all';

  function startMatrix() {
    const canvas = $('matrix');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const chars = '0123456789#☎︎•+';
    const fontSize = 18;
    let columns = Math.floor(window.innerWidth / fontSize);
    let drops = Array.from({ length: columns }, () => Math.random() * 20);

    function tick() {
      ctx.fillStyle = 'rgba(7, 9, 15, 0.18)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.font = `${fontSize}px ui-monospace, monospace`;
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        ctx.fillStyle = 'rgba(96,242,255,0.75)';
        ctx.fillText(text, x, y);

        if (y > window.innerHeight && Math.random() > 0.972) drops[i] = 0;
        drops[i]++;
      }

      const newCols = Math.floor(window.innerWidth / fontSize);
      if (newCols !== columns) {
        columns = newCols;
        drops = Array.from({ length: columns }, () => Math.random() * 20);
      }

      requestAnimationFrame(tick);
    }
    tick();
  }

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      entries = raw ? JSON.parse(raw) : [];
    } catch {
      entries = [];
    }
  }

  function saveEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function setToast(message) {
    toast.textContent = message;
  }

  function setUpdatedStamp() {
    const last = entries[0]?.updatedAt || entries[0]?.createdAt;
    if (!last) {
      updatedStamp.textContent = 'Last updated: —';
      return;
    }
    const date = new Date(last);
    updatedStamp.textContent = `Last updated: ${date.toLocaleString()}`;
  }

  function resetForm() {
    entryForm.reset();
    editingId = null;
    $('btnSave').textContent = 'SAVE NUMBER';
    $('btnSave').innerHTML = 'SAVE NUMBER<span class="btnSub">stored locally</span>';
  }

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderEntries();
  }

  function renderEntries() {
    const filtered = activeFilter === 'public'
      ? entries.filter(entry => entry.isPublic)
      : entries;

    countLabel.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} saved`;

    entryList.innerHTML = filtered.map(entry => {
      const label = entry.label ? `<span class="tag">${entry.label}</span>` : '<span class="tag">No label</span>';
      const notes = entry.notes ? `<div class="cardNotes">${entry.notes}</div>` : '';
      const publicTag = entry.isPublic ? '<span class="tag">Public</span>' : '<span class="tag">Private</span>';
      return `
        <div class="card" data-id="${entry.id}">
          <div class="cardTop">
            <div class="cardName">${entry.name}</div>
            <div class="tag">${publicTag}</div>
          </div>
          <div class="cardPhone">${entry.phone}</div>
          <div class="cardTop">
            ${label}
            <span class="tag">${new Date(entry.updatedAt || entry.createdAt).toLocaleDateString()}</span>
          </div>
          ${notes}
          <div class="cardActions">
            <button class="linkBtn" data-action="edit">Edit</button>
            <button class="linkBtn dim" data-action="delete">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    if (!filtered.length) {
      entryList.innerHTML = '<div class="card"><div class="cardName">No entries yet.</div><div class="cardNotes">Add a contact to get started.</div></div>';
    }
  }

  function renderPublicBoard() {
    const publicEntries = entries.filter(entry => entry.isPublic);
    publicChip.textContent = `public: ${publicEntries.length}`;

    publicBoard.innerHTML = publicEntries.map(entry => {
      const notes = entry.notes ? `<div class="cardNotes">${entry.notes}</div>` : '';
      return `
        <div class="publicCard">
          <div class="cardName">${entry.name}</div>
          <div class="cardPhone">${entry.phone}</div>
          ${entry.label ? `<div class="tag">${entry.label}</div>` : ''}
          ${notes}
        </div>
      `;
    }).join('');

    if (!publicEntries.length) {
      publicBoard.innerHTML = '<div class="publicCard"><div class="cardName">No public numbers yet.</div><div class="cardNotes">Enable “Show on public access board” to display a contact here.</div></div>';
    }

    const exportText = publicEntries.map(entry => {
      const label = entry.label ? ` (${entry.label})` : '';
      const notes = entry.notes ? ` — ${entry.notes}` : '';
      return `${entry.name}: ${entry.phone}${label}${notes}`;
    }).join('\n');

    publicExport.value = exportText || 'No public entries to share.';
  }

  function upsertEntry(data) {
    if (editingId) {
      entries = entries.map(entry => entry.id === editingId ? { ...entry, ...data, updatedAt: Date.now() } : entry);
      setToast('Entry updated.');
    } else {
      const newEntry = { id: Date.now().toString(), ...data, createdAt: Date.now() };
      entries = [newEntry, ...entries];
      setToast('Entry saved.');
    }
    saveEntries();
    renderEntries();
    renderPublicBoard();
    setUpdatedStamp();
    resetForm();
  }

  function handleEdit(id) {
    const entry = entries.find(item => item.id === id);
    if (!entry) return;
    editingId = id;
    nameInput.value = entry.name;
    phoneInput.value = entry.phone;
    labelInput.value = entry.label || '';
    notesInput.value = entry.notes || '';
    isPublicInput.checked = entry.isPublic;
    $('btnSave').innerHTML = 'UPDATE NUMBER<span class="btnSub">save changes</span>';
    setToast('Editing entry. Make updates then save.');
    nameInput.focus();
  }

  function handleDelete(id) {
    entries = entries.filter(entry => entry.id !== id);
    saveEntries();
    renderEntries();
    renderPublicBoard();
    setUpdatedStamp();
    setToast('Entry removed.');
  }

  function handleSubmit(event) {
    event.preventDefault();
    const data = {
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      label: labelInput.value.trim(),
      notes: notesInput.value.trim(),
      isPublic: isPublicInput.checked
    };

    if (!data.name || !data.phone) {
      setToast('Name and phone are required.');
      return;
    }

    upsertEntry(data);
  }

  function handleCopy() {
    publicExport.select();
    document.execCommand('copy');
    setToast('Public list copied to clipboard.');
  }

  function attachEvents() {
    entryForm.addEventListener('submit', handleSubmit);
    btnReset.addEventListener('click', () => {
      resetForm();
      setToast('Form cleared.');
    });

    entryList.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      const card = event.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      if (action === 'edit') handleEdit(id);
      if (action === 'delete') handleDelete(id);
    });

    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    btnCopy.addEventListener('click', handleCopy);
  }

  function init() {
    startMatrix();
    loadEntries();
    renderEntries();
    renderPublicBoard();
    setUpdatedStamp();
    setToast('Ready to save your public access list.');
    attachEvents();
    subLine.textContent = 'Store numbers for public access if your phone is lost.';
  }

  document.addEventListener('deviceready', init, false);
  if (!window.cordova) init();
})();
