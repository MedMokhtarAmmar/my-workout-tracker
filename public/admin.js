// Deliberately a separate file from app.js — the backoffice is a distinct
// concern (admin-only, different data shape) and app.js was already large
// enough that bolting this on would've made it harder to navigate.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  if (res.status === 401 || res.status === 403) location.href = '/login.html';
  return res;
};

let tplExerciseSelect = null; // icon-select instance for the "Add exercise" picker in the template manager modal

// ---------- Modal ----------

function openModal(title, dateStr, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-date').textContent = dateStr;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-overlay').classList.remove('hidden');
  requestAnimationFrame(() => $('#modal-overlay').classList.add('open'));
}

function closeModal() {
  $('#modal-overlay').classList.remove('open');
  setTimeout(() => {
    $('#modal-overlay').classList.add('hidden');
    $('#modal-body').innerHTML = '';
  }, 160);
}

// ---------- Tabs ----------

function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'dashboard') loadStats();
      if (btn.dataset.tab === 'exercises') loadExercises();
      if (btn.dataset.tab === 'plans') loadPlans();
      if (btn.dataset.tab === 'users') loadUsers();
    });
  });
}

// ---------- Dashboard ----------

async function loadStats() {
  const res = await fetch('/api/admin/stats');
  const stats = await res.json();
  const tiles = [
    ['Users', stats.totalUsers],
    ['Workouts logged', stats.totalSessions],
    ['Exercises', stats.totalExercises],
    ['Plans', stats.totalPlans],
    ['Progress photos', stats.totalProgressPhotos],
  ];
  $('#admin-stats').innerHTML = tiles.map(([label, value]) => `
    <div class="stat-tile">
      <span class="stat-value">${value}</span>
      <span class="stat-label">${label}</span>
    </div>`).join('');
}

// ---------- Exercises ----------

const ADMIN_LIST_PAGE_SIZE = 15;
let adminExercisesCache = [];
let adminExercisesPage = 0;

async function loadExercises() {
  const res = await fetch('/api/admin/exercises');
  adminExercisesCache = await res.json();
  adminExercisesPage = 0;
  renderAdminExercisesPage();
}

function renderAdminExercisesPage() {
  $('#admin-exercise-list').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Category</th><th>Media</th><th></th></tr></thead>
      <tbody>${paginateItems(adminExercisesCache, adminExercisesPage, ADMIN_LIST_PAGE_SIZE).map((e) => `
        <tr data-id="${e.id}">
          <td>${e.name}</td>
          <td>${e.category || '-'}</td>
          <td>${e.image_path ? '🖼️' : ''} ${e.video_url ? '🎬' : ''}</td>
          <td><button type="button" class="icon-btn delete-exercise-btn" title="Delete">✕</button></td>
        </tr>`).join('')}</tbody>
    </table>`;

  $('#admin-exercise-list').querySelectorAll('.delete-exercise-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm('Delete this exercise?')) return;
      const res = await fetch(`/api/admin/exercises/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not delete.');
        return;
      }
      loadExercises();
    });
  });

  renderPagination($('#admin-exercise-pagination'), {
    totalItems: adminExercisesCache.length, pageSize: ADMIN_LIST_PAGE_SIZE, page: adminExercisesPage,
    onPageChange: (p) => { adminExercisesPage = p; renderAdminExercisesPage(); },
  });
}

const ADMIN_IMAGE_MAX_DIMENSION = 1000;

// Downscales onto a canvas before upload so a multi-MB phone photo (of a gym
// machine, or a plan cover shot) doesn't balloon the request (and long-term
// storage) once base64-encoded.
function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > ADMIN_IMAGE_MAX_DIMENSION || height > ADMIN_IMAGE_MAX_DIMENSION) {
        const scale = ADMIN_IMAGE_MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// The dropzone stages a resized image locally (drag/drop or click-to-browse,
// with its own preview + "staged" success state) and the actual upload
// happens as part of the single "Add exercise" request below, alongside the
// name/category/video fields it's submitted together with — matching the
// existing /api/admin/exercises contract with no backend change needed.
let pendingExerciseImage = null;
let exerciseDropzone = null;

async function addExercise() {
  const name = $('#ex-name').value.trim();
  if (!name) return alert('Name is required.');

  const btn = $('#add-exercise-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const res = await fetch('/api/admin/exercises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category: $('#ex-category').value,
        image: pendingExerciseImage,
        video_url: $('#ex-video').value.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.error || 'Could not add exercise.');
    }

    $('#ex-name').value = '';
    $('#ex-video').value = '';
    pendingExerciseImage = null;
    exerciseDropzone?.reset();
    loadExercises();
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ---------- Plans ----------

async function loadPlans() {
  const res = await fetch('/api/admin/plans');
  const plans = await res.json();

  $('#admin-plans-list').innerHTML = plans.map((p) => `
    <div class="card">
      ${p.cover_image ? `<img class="plan-cover-preview" src="${p.cover_image}" alt="${p.name} cover" />` : ''}
      <h2>${p.name} <span class="meta">(${p.key})</span></h2>
      ${p.description ? `<p class="exercise-target">${p.description}</p>` : ''}
      <button type="button" class="secondary toggle-cover-btn" data-plan-id="${p.id}">${p.cover_image ? 'Change cover image' : '+ Add cover image'}</button>
      <div class="plan-cover-upload hidden" data-plan-id="${p.id}"></div>
      <div class="admin-template-list">
        ${p.templates.length ? p.templates.map((t) => `
          <div class="admin-template-row">
            <span>${t.name}${t.focus ? ` — ${t.focus}` : ''} <span class="meta">· ${t.exercises.length} exercises</span></span>
            <button type="button" class="secondary manage-template-btn" data-key="${t.key}">Manage exercises</button>
          </div>`).join('') : '<p class="exercise-target">No templates yet.</p>'}
      </div>
      <div class="card subtle admin-add-template">
        <h3>Add template</h3>
        <label>Key
          <input type="text" class="tpl-key" />
        </label>
        <label>Name
          <input type="text" class="tpl-name" />
        </label>
        <label>Focus (optional)
          <input type="text" class="tpl-focus" />
        </label>
        <button type="button" class="secondary add-template-btn" data-plan-key="${p.key}">Add template</button>
      </div>
    </div>`).join('');

  $('#admin-plans-list').querySelectorAll('.add-template-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const key = card.querySelector('.tpl-key').value.trim();
      const name = card.querySelector('.tpl-name').value.trim();
      const focus = card.querySelector('.tpl-focus').value.trim();
      if (!key || !name) return alert('Key and name are required.');

      const res = await fetch(`/api/admin/plans/${btn.dataset.planKey}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name, focus: focus || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return alert(data.error || 'Could not add template.');
      }
      loadPlans();
    });
  });

  $('#admin-plans-list').querySelectorAll('.manage-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTemplateManager(btn.dataset.key));
  });

  $('#admin-plans-list').querySelectorAll('.toggle-cover-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mount = document.querySelector(`.plan-cover-upload[data-plan-id="${btn.dataset.planId}"]`);
      mount.classList.toggle('hidden');
      if (mount.classList.contains('hidden') || mount._dropzone) return;

      mount._dropzone = createDropzone(mount, {
        hint: 'Drag a cover image here, or click to browse',
        onFile: async (file) => {
          const image = await resizeImageToDataUrl(file);
          const res = await fetch(`/api/admin/plans/${btn.dataset.planId}/cover`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Could not update cover.');
          }
          // Let the dropzone's own "✓ Uploaded" state flash briefly before
          // the whole list re-renders with the new cover.
          setTimeout(loadPlans, 900);
        },
      });
    });
  });
}

let pendingPlanCover = null;
let planCoverDropzone = null;

async function addPlan() {
  const key = $('#plan-key').value.trim();
  const name = $('#plan-name').value.trim();
  const description = $('#plan-description').value.trim();
  if (!key || !name) return alert('Key and name are required.');

  const btn = $('#add-plan-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const res = await fetch('/api/admin/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, name, description: description || null, image: pendingPlanCover }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.error || 'Could not add plan.');
    }

    $('#plan-key').value = '';
    $('#plan-name').value = '';
    $('#plan-description').value = '';
    pendingPlanCover = null;
    planCoverDropzone?.reset();
    loadPlans();
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function showTemplateManager(templateKey) {
  const [plansRes, exercisesRes] = await Promise.all([
    fetch('/api/admin/plans'),
    fetch('/api/admin/exercises'),
  ]);
  const plans = await plansRes.json();
  const exerciseLibrary = await exercisesRes.json();

  let template = null;
  for (const p of plans) {
    template = p.templates.find((t) => t.key === templateKey) || template;
  }
  if (!template) return;

  const rows = template.exercises.map((ex) => `
    <tr data-id="${ex.template_exercise_id}">
      <td>${ex.exercise_name}</td>
      <td>${ex.target_sets} × ${ex.target_reps_low}–${ex.target_reps_high}</td>
      <td><button type="button" class="icon-btn remove-template-exercise-btn" title="Remove">✕</button></td>
    </tr>`).join('');

  const body = `
    <table>
      <thead><tr><th>Exercise</th><th>Target</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="meta">No exercises yet.</td></tr>'}</tbody>
    </table>
    <div class="card subtle" style="margin-top: 12px;">
      <h3>Add exercise</h3>
      <label>Exercise
        <div id="tpl-ex-select"></div>
      </label>
      <div class="field-row-3">
        <input type="number" id="tpl-ex-sets" placeholder="Sets" value="3" />
        <input type="number" id="tpl-ex-reps-low" placeholder="Reps low" value="8" />
        <input type="number" id="tpl-ex-reps-high" placeholder="Reps high" value="12" />
      </div>
      <button type="button" class="primary" id="add-template-exercise-btn">Add to template</button>
    </div>
  `;
  openModal(template.name, template.key, body);

  tplExerciseSelect = createIconSelect($('#tpl-ex-select'), {
    items: exerciseLibrary.map((e) => ({ value: e.id, label: e.name, icon: iconForExercise(e) })),
    placeholder: 'Choose an exercise',
  });

  $('#add-template-exercise-btn').addEventListener('click', async () => {
    const res = await fetch(`/api/admin/templates/${templateKey}/exercises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exercise_id: tplExerciseSelect?.getValue(),
        target_sets: parseInt($('#tpl-ex-sets').value, 10),
        target_reps_low: parseInt($('#tpl-ex-reps-low').value, 10),
        target_reps_high: parseInt($('#tpl-ex-reps-high').value, 10),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.error || 'Could not add exercise.');
    }
    closeModal();
    loadPlans();
  });

  $('#modal-body').querySelectorAll('.remove-template-exercise-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm('Remove this exercise from the template?')) return;
      await fetch(`/api/admin/template-exercises/${id}`, { method: 'DELETE' });
      closeModal();
      loadPlans();
    });
  });
}

// ---------- Users ----------

let adminUsersCache = [];
let adminUsersPage = 0;

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  adminUsersCache = await res.json();
  adminUsersPage = 0;
  renderAdminUsersPage();
}

function renderAdminUsersPage() {
  $('#admin-users-list').innerHTML = `
    <table>
      <thead><tr><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
      <tbody>${paginateItems(adminUsersCache, adminUsersPage, ADMIN_LIST_PAGE_SIZE).map((u) => `
        <tr>
          <td>${u.email}</td>
          <td>${u.is_admin ? '<span class="chip-admin">Admin</span>' : '<span class="meta">User</span>'}</td>
          <td>${u.created_at}</td>
        </tr>`).join('')}</tbody>
    </table>`;

  renderPagination($('#admin-users-pagination'), {
    totalItems: adminUsersCache.length, pageSize: ADMIN_LIST_PAGE_SIZE, page: adminUsersPage,
    onPageChange: (p) => { adminUsersPage = p; renderAdminUsersPage(); },
  });
}

function init() {
  setupTabs();
  loadStats();
  exerciseDropzone = createDropzone($('#ex-image-dropzone'), {
    hint: 'Drag a photo here, or click to browse',
    onFile: async (file) => { pendingExerciseImage = await resizeImageToDataUrl(file); },
  });
  planCoverDropzone = createDropzone($('#plan-cover-dropzone'), {
    hint: 'Drag a cover image here, or click to browse',
    onFile: async (file) => { pendingPlanCover = await resizeImageToDataUrl(file); },
  });
  $('#add-exercise-btn').addEventListener('click', addExercise);
  $('#add-plan-btn').addEventListener('click', addPlan);
  $('#modal-close-btn').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

init();
