// Shared between app.js and admin.js. Native <select> can't reliably show a
// per-option image across browsers, so exercise pickers (which need an icon
// next to each name) use this tiny custom dropdown instead. Every other
// <select> in the app (no icons needed) stays native and just gets modern
// CSS in style.css.

const EQUIPMENT_ICONS = {
  machine: '/icons/machine.svg',
  cable: '/icons/cable.svg',
  dumbbell: '/icons/dumbbell.svg',
  barbell: '/icons/barbell.svg',
  bodyweight: '/icons/bodyweight.svg',
};

// An exercise's own uploaded photo doubles as its icon everywhere it's
// listed; exercises without one fall back to a generic per-category icon.
// Uploaded photos come from the server (so they need API_BASE, which the
// mobile app sets — see app.js); the fallback icons ship with the app.
function iconForExercise(exercise) {
  if (exercise.image_path) return (window.API_BASE || '') + exercise.image_path;
  return EQUIPMENT_ICONS[exercise.category] || EQUIPMENT_ICONS.bodyweight;
}

// root: an empty container element to mount into.
// items: [{ value, label, icon }].
// Returns { getValue, setValue(v), setItems(items, value?) }.
function createIconSelect(root, { items = [], value = '', placeholder = 'Select…', onChange } = {}) {
  root.classList.add('icon-select');
  root.innerHTML = `
    <button type="button" class="icon-select-btn">
      <img class="icon-select-icon hidden" alt="" />
      <span class="icon-select-label"></span>
      <span class="icon-select-chevron">▾</span>
    </button>
    <div class="icon-select-panel hidden"></div>
  `;
  const btn = root.querySelector('.icon-select-btn');
  const iconEl = root.querySelector('.icon-select-icon');
  const labelEl = root.querySelector('.icon-select-label');
  const panel = root.querySelector('.icon-select-panel');

  let currentItems = items;
  let currentValue = value;

  function findCurrent() {
    return currentItems.find((i) => String(i.value) === String(currentValue));
  }

  function renderButton() {
    const found = findCurrent();
    if (found) {
      iconEl.src = found.icon;
      iconEl.classList.remove('hidden');
      labelEl.textContent = found.label;
    } else {
      iconEl.classList.add('hidden');
      labelEl.textContent = placeholder;
    }
  }

  function onOutsideClick(e) {
    if (!root.contains(e.target)) closePanel();
  }

  function closePanel() {
    panel.classList.add('hidden');
    document.removeEventListener('click', onOutsideClick, true);
  }

  // Search box lives above a separately-scrolling options list, so typing
  // never scrolls the box itself out of view — only the exercise library is
  // expected to grow long enough to need this.
  function renderOptions(container, filterText) {
    const q = filterText.trim().toLowerCase();
    const filtered = q ? currentItems.filter((i) => i.label.toLowerCase().includes(q)) : currentItems;

    container.innerHTML = filtered.length
      ? filtered.map((i) => `
        <button type="button" class="icon-select-option${String(i.value) === String(currentValue) ? ' selected' : ''}" data-value="${i.value}">
          <img src="${i.icon}" alt="" />
          <span>${i.label}</span>
        </button>`).join('')
      : '<div class="icon-select-empty">No matches</div>';

    container.querySelectorAll('.icon-select-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        currentValue = opt.dataset.value;
        renderButton();
        closePanel();
        onChange?.(currentValue);
      });
    });
  }

  function renderPanel() {
    panel.innerHTML = `
      <input type="text" class="icon-select-search" placeholder="Search…" autocomplete="off" />
      <div class="icon-select-options"></div>
    `;
    const searchInput = panel.querySelector('.icon-select-search');
    const optionsEl = panel.querySelector('.icon-select-options');
    searchInput.addEventListener('input', () => renderOptions(optionsEl, searchInput.value));
    renderOptions(optionsEl, '');
  }

  btn.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) {
      renderPanel();
      panel.classList.remove('hidden');
      document.addEventListener('click', onOutsideClick, true);
      panel.querySelector('.icon-select-search').focus();
    } else {
      closePanel();
    }
  });

  renderButton();

  return {
    getValue: () => currentValue,
    setValue(v) { currentValue = v; renderButton(); },
    setItems(newItems, newValue) {
      currentItems = newItems;
      if (newValue !== undefined) currentValue = newValue;
      renderButton();
    },
  };
}
