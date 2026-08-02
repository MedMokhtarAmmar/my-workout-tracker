// Empty on the web app, where the API is same-origin. The mobile app (which
// serves these files from the app bundle, not the server) sets window.API_BASE
// to the server's origin so API calls and server-hosted images still resolve.
const API_BASE = window.API_BASE || '';

// If the session cookie ever expires or is revoked, bounce to the login
// page instead of every API call failing silently.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  if (res.status === 401) location.href = '/login.html';
  return res;
};

const state = {
  activeSessionId: null,
  activeExercises: [],   // session_exercises for the current session
  setLogIds: {},         // key `${sessionExerciseId}-${setNum}` -> set_log id
  prByExercise: {},      // exercise_id -> best weight_kg ever logged, kept in sync as new sets are saved
  exerciseLibrary: [],   // all exercises, for the add/replace pickers
  addExerciseSelect: null, // icon-select instance for "Add an exercise" (see icon-select.js)
  exerciseSelect: null,    // icon-select instance for the Progress-tab exercise picker
  progressChart: null,
  weightChart: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth() + 1, // 1-12
  reportPeriod: 'week',  // 'week' | 'month'
  reportDate: null,      // any date within the currently viewed period; set to today on first load
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Shared Chart.js styling so the two line charts (progress-by-exercise and
// weight-over-time) match the app's dark theme instead of Chart.js defaults.
// Reads current theme colors from CSS so charts match dark/light mode
// automatically (charts are recreated on every load, so this re-evaluates
// each time — including right after a theme switch).
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function themedLineChartOptions() {
  const tickColor = cssVar('--muted');
  const isLight = document.documentElement.dataset.theme === 'light';
  const gridColor = isLight ? 'rgba(15, 17, 21, 0.06)' : 'rgba(255, 255, 255, 0.06)';
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: tickColor, font: { size: 12 } } },
      tooltip: {
        backgroundColor: cssVar('--card'),
        borderColor: cssVar('--border'),
        borderWidth: 1,
        titleColor: cssVar('--text'),
        bodyColor: cssVar('--text'),
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
      },
    },
    scales: {
      x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: false },
    },
  };
}

function themedLineDataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}1a`,
    pointBackgroundColor: color,
    pointBorderColor: cssVar('--card'),
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.25,
    fill: true,
  };
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ---------- Tabs ----------

function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'plans') { loadPlans(); loadMyTemplates(); }
      if (btn.dataset.tab === 'history') loadHistory();
      if (btn.dataset.tab === 'calendar') loadCalendar();
      if (btn.dataset.tab === 'progress') { loadExerciseOptions(); loadProgressPhotos(); }
      if (btn.dataset.tab === 'stats') { loadBodyStats(); loadNutritionProfile(); }
      if (btn.dataset.tab === 'profile') loadProfile();
      if (btn.dataset.tab === 'settings') loadSettings();
    });
  });
}

// Sub-tabs within a tab panel (currently just Body Stats: Log / Weight /
// History / Nutrition). Separate class names from the main tabs above so
// the two don't interfere with each other.
function setupSubTabs() {
  $$('.subtab-nav').forEach((nav) => {
    const panelGroup = nav.parentElement;
    nav.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.segmented-btn').forEach((b) => b.classList.remove('active'));
        panelGroup.querySelectorAll('.subtab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#subtab-${btn.dataset.subtab}`).classList.add('active');
        // Chart.js can't size a canvas correctly while its container is
        // display:none, so nudge it once it's actually visible.
        if (btn.dataset.subtab === 'weight' && state.weightChart) state.weightChart.resize();
        if (btn.dataset.subtab === 'report') loadReport();
        if (btn.dataset.subtab === 'records') loadRecords();
        if (btn.dataset.subtab === 'favorites') loadFavorites();
      });
    });
  });
}

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  $$('#theme-toggle .segmented-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  });
  // Charts read colors from CSS at creation time, so redraw any that are
  // currently visible to reflect the new theme immediately.
  if ($('#tab-stats').classList.contains('active')) loadBodyStats();
  if ($('#tab-progress').classList.contains('active')) {
    const exerciseId = state.exerciseSelect?.getValue();
    if (exerciseId) loadProgress(exerciseId);
  }
}

function setupThemeToggle() {
  const current = document.documentElement.dataset.theme || 'dark';
  $$('#theme-toggle .segmented-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === current);
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
  });
}

// ---------- Today / active workout ----------

async function loadTemplates() {
  const [templatesRes, suggestedRes, myTemplatesRes] = await Promise.all([
    fetch(`${API_BASE}/api/templates`),
    fetch(`${API_BASE}/api/templates/suggested?date=${todayISO()}`),
    fetch(`${API_BASE}/api/my-templates`),
  ]);
  const templates = await templatesRes.json();
  const { key: suggestedKey } = await suggestedRes.json();
  const myTemplates = await myTemplatesRes.json();

  const planOptions = templates
    .map((t) => `<option value="${t.key}">${t.name}${t.focus ? ' — ' + t.focus : ''}</option>`)
    .join('');
  const myOptions = myTemplates.length
    ? `<optgroup label="My Templates">${myTemplates
        .map((t) => `<option value="${t.key}">${t.name}${t.focus ? ' — ' + t.focus : ''}</option>`)
        .join('')}</optgroup>`
    : '';

  const select = $('#template-select');
  select.innerHTML = planOptions + myOptions + '<option value="">Cardio day</option>';
  select.value = suggestedKey;
}

async function openActiveSession(session, date) {
  state.activeSessionId = session.id;

  $('#active-session-title').textContent = `${session.template_name || 'Cardio day'}${session.template_focus ? ' — ' + session.template_focus : ''}`;
  $('#active-session-date').textContent = date;

  await loadExerciseLibrary();
  await loadActiveExercises();

  $('#today-setup').classList.add('hidden');
  $('#active-session').classList.remove('hidden');
}

async function startSession() {
  const date = $('#session-date').value || todayISO();
  const templateKey = $('#template-select').value;

  // The server resumes an existing session for this date instead of
  // creating a duplicate if one was already started.
  const createRes = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, template_key: templateKey, cardio_minutes: 0 }),
  });
  const session = await createRes.json();
  await openActiveSession(session, date);
}

// Reopens today's workout on load if one was already started, so closing
// the tab mid-workout never loses progress or lets a second one start.
async function resumeTodaySessionIfAny() {
  const date = todayISO();
  const res = await fetch(`${API_BASE}/api/sessions?date=${date}`);
  const existing = await res.json();
  if (existing.length > 0) {
    await openActiveSession(existing[0], date);
  }
}

async function loadExerciseLibrary() {
  const res = await fetch(`${API_BASE}/api/exercises`);
  state.exerciseLibrary = await res.json();
  const items = state.exerciseLibrary.map((ex) => ({ value: ex.id, label: ex.name, icon: iconForExercise(ex) }));
  if (state.addExerciseSelect) {
    state.addExerciseSelect.setItems(items);
  } else {
    state.addExerciseSelect = createIconSelect($('#add-exercise-select'), { items, placeholder: 'Choose an exercise' });
  }
}

async function loadActiveExercises() {
  const [exRes, sessionRes] = await Promise.all([
    fetch(`${API_BASE}/api/sessions/${state.activeSessionId}/exercises`),
    fetch(`${API_BASE}/api/sessions/${state.activeSessionId}`),
  ]);
  const exercises = await exRes.json();
  const session = await sessionRes.json();

  state.activeExercises = exercises;
  state.setLogIds = {};
  state.prByExercise = {};
  exercises.forEach((ex) => { state.prByExercise[ex.exercise_id] = ex.pr_weight_kg; });
  stopRestTimer();
  const loggedSets = {};
  session.sets.forEach((s) => {
    const key = `${s.session_exercise_id}-${s.set_number}`;
    state.setLogIds[key] = s.id;
    loggedSets[key] = { reps: s.reps, weight_kg: s.weight_kg };
  });

  renderExerciseList(exercises, loggedSets);
}

// Classic double-progression rule: once every weighted set last time hit
// the top of the rep range, the next step is more weight rather than more
// reps. Uses ex.previous (already fetched per exercise) — no extra request.
const PROGRESSION_INCREMENT_KG = 2.5;

function progressionSuggestion(ex) {
  const sets = ex.previous?.sets || [];
  const weighted = sets.filter((s) => s.weight_kg != null && s.reps != null);
  if (!weighted.length) return null;
  const allHitTop = weighted.every((s) => s.reps >= ex.target_reps_high);
  if (!allHitTop) return null;

  const lastWeight = weighted[weighted.length - 1].weight_kg;
  const suggested = Math.round((lastWeight + PROGRESSION_INCREMENT_KG) * 2) / 2;
  return `You hit the top of your rep range last time — try ${suggested}kg`;
}

function renderExerciseList(exercises, loggedSets = {}) {
  // A set logged beyond the template's target count (via "+ Add set")
  // still needs a row after a reload — go by whichever is higher.
  const maxLoggedSetByExercise = {};
  Object.keys(loggedSets).forEach((key) => {
    const [sessionExerciseId, setNumStr] = key.split('-');
    const setNum = parseInt(setNumStr, 10);
    if (!maxLoggedSetByExercise[sessionExerciseId] || setNum > maxLoggedSetByExercise[sessionExerciseId]) {
      maxLoggedSetByExercise[sessionExerciseId] = setNum;
    }
  });

  const container = $('#exercise-list');
  container.innerHTML = exercises
    .map((ex) => {
      const repsLabel = ex.target_reps_low === ex.target_reps_high
        ? ex.target_reps_low
        : `${ex.target_reps_low}–${ex.target_reps_high}`;

      const previousBySet = {};
      (ex.previous?.sets || []).forEach((s) => { previousBySet[s.set_number] = s; });

      const rowCount = Math.max(ex.target_sets, maxLoggedSetByExercise[ex.session_exercise_id] || 0);
      const setsRows = Array.from({ length: rowCount }, (_, i) => {
        const setNum = i + 1;
        const logged = loggedSets[`${ex.session_exercise_id}-${setNum}`];
        const prev = previousBySet[setNum];
        const weightPlaceholder = prev?.weight_kg != null ? `last ${prev.weight_kg}kg` : 'weight (kg)';
        const repsPlaceholder = prev?.reps != null ? `last ${prev.reps} reps` : `reps (target ${repsLabel})`;
        const sameAsLastBtn = prev && (prev.weight_kg != null || prev.reps != null)
          ? `<button type="button" class="icon-btn same-as-last-btn" title="Same as last time"
              data-se="${ex.session_exercise_id}" data-set="${setNum}"
              data-weight="${prev.weight_kg ?? ''}" data-reps="${prev.reps ?? ''}">↺</button>`
          : '<span></span>';
        return `
          <div class="set-row">
            <span>#${setNum}</span>
            <input type="number" step="0.5" placeholder="${weightPlaceholder}" value="${logged?.weight_kg ?? ''}"
              data-se="${ex.session_exercise_id}" data-set="${setNum}" data-field="weight" />
            <input type="number" placeholder="${repsPlaceholder}" value="${logged?.reps ?? ''}"
              data-se="${ex.session_exercise_id}" data-set="${setNum}" data-field="reps" />
            ${sameAsLastBtn}
          </div>`;
      }).join('');

      const previousSummary = (ex.previous?.sets || []).length
        ? `<div class="exercise-previous">Last time (${ex.previous.date}): ${ex.previous.sets
            .map((s) => `${s.weight_kg ?? '-'}kg × ${s.reps ?? '-'}`)
            .join(' · ')}</div>`
        : '';

      const suggestion = progressionSuggestion(ex);
      const suggestionHtml = suggestion
        ? `<div class="exercise-suggestion">💡 ${suggestion}</div>`
        : '';

      // Uploaded exercise photos are served by the API; the fallback category
      // icons ship with the app, so only the former needs API_BASE.
      const iconSrc = ex.exercise_image
        ? API_BASE + ex.exercise_image
        : EQUIPMENT_ICONS[ex.exercise_category] || EQUIPMENT_ICONS.bodyweight;

      return `
        <div class="exercise-block" data-session-exercise-id="${ex.session_exercise_id}">
          <div class="exercise-header">
            <img class="equipment-icon" src="${iconSrc}" alt="${ex.exercise_category || 'bodyweight'} icon" />
            <div class="exercise-header-text">
              <h3>${ex.exercise_name}</h3>
              <div class="exercise-target">${ex.target_sets} × ${repsLabel}${ex.rest_seconds ? ` · rest ${ex.rest_seconds}s` : ''}</div>
              ${ex.notes ? `<div class="exercise-note">${ex.notes}</div>` : ''}
              ${ex.pr_weight_kg != null ? `<div class="exercise-pr">🏆 PR: ${ex.pr_weight_kg}kg</div>` : ''}
              ${previousSummary}
              ${suggestionHtml}
            </div>
            <div class="exercise-actions">
              ${ex.exercise_image || ex.exercise_video
                ? `<button type="button" class="icon-btn howto-btn" title="How to perform this exercise" data-session-exercise-id="${ex.session_exercise_id}">▶</button>`
                : ''}
              <button type="button" class="icon-btn replace-btn" title="Replace exercise">⇄</button>
              <button type="button" class="icon-btn remove-btn" title="Remove exercise">✕</button>
            </div>
          </div>
          <div class="replace-picker hidden">
            <div class="replace-select"></div>
            <button type="button" class="secondary confirm-replace-btn">Confirm</button>
            <button type="button" class="secondary cancel-replace-btn">Cancel</button>
          </div>
          ${setsRows}
          <button type="button" class="secondary add-set-btn">+ Add set</button>
        </div>`;
    })
    .join('');

  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', onSetInputChange);
  });
  container.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', onRemoveExercise);
  });
  container.querySelectorAll('.replace-btn').forEach((btn) => {
    btn.addEventListener('click', onToggleReplacePicker);
  });
  container.querySelectorAll('.confirm-replace-btn').forEach((btn) => {
    btn.addEventListener('click', onConfirmReplace);
  });
  container.querySelectorAll('.add-set-btn').forEach((btn) => {
    btn.addEventListener('click', onAddSetRow);
  });
  container.querySelectorAll('.cancel-replace-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => e.target.closest('.replace-picker').classList.add('hidden'));
  });
  container.querySelectorAll('.howto-btn').forEach((btn) => {
    btn.addEventListener('click', () => showExerciseHowTo(btn.dataset.sessionExerciseId));
  });
  container.querySelectorAll('.same-as-last-btn').forEach((btn) => {
    btn.addEventListener('click', onSameAsLastClick);
  });

  updateSessionProgress();
}

// Planned sets come from each exercise's template target (not the row count,
// which can exceed it via "+ Add set"); a set counts as logged once reps are
// filled in, since weight alone (e.g. a dropped set) doesn't confirm it was
// completed. Reads straight from the DOM so it stays in sync with whatever's
// currently rendered without needing a fresh fetch.
function updateSessionProgress() {
  const totalPlanned = state.activeExercises.reduce((sum, ex) => sum + ex.target_sets, 0);
  const loggedCount = $$('#exercise-list .set-row').filter((row) => {
    const reps = row.querySelector('[data-field="reps"]');
    return reps && reps.value !== '';
  }).length;
  const pct = totalPlanned ? Math.min(100, Math.round((loggedCount / totalPlanned) * 100)) : 0;

  $('#session-progress-fill').style.width = `${pct}%`;
  $('#session-progress-label').textContent = `${loggedCount} of ${totalPlanned} sets logged`;
}

function youtubeEmbedUrl(url) {
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
  const shortsMatch = url.match(/\/shorts\/([^?&/]+)/);
  if (shortsMatch) return `https://www.youtube.com/embed/${shortsMatch[1]}`;
  return url;
}

function showExerciseHowTo(sessionExerciseId) {
  const ex = state.activeExercises.find((e) => String(e.session_exercise_id) === String(sessionExerciseId));
  if (!ex) return;

  const body = `
    ${ex.exercise_image ? `<img class="howto-image" src="${API_BASE}${ex.exercise_image}" alt="${ex.exercise_name}" />` : ''}
    ${ex.exercise_video ? `<div class="video-wrapper"><iframe src="${youtubeEmbedUrl(ex.exercise_video)}" title="How to: ${ex.exercise_name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : ''}
  `;
  openModal(ex.exercise_name, '', body);
}

// Shared by typing into a row and the "same as last time" quick-fill button.
// PR/rest-timer only fire for a brand-new set (not an edit to one already
// saved) and only once it's actually got both numbers — a half-filled row
// shouldn't start the clock or claim a record.
async function saveSet(sessionExerciseId, setNum, weight, reps) {
  const key = `${sessionExerciseId}-${setNum}`;
  const isNewSet = !state.setLogIds[key];

  if (!isNewSet) {
    await fetch(`${API_BASE}/api/sets/${state.setLogIds[key]}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reps, weight_kg: weight }),
    });
  } else {
    const res = await fetch(`${API_BASE}/api/sessions/${state.activeSessionId}/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_exercise_id: sessionExerciseId, set_number: setNum, reps, weight_kg: weight }),
    });
    const { id } = await res.json();
    state.setLogIds[key] = id;
  }

  if (isNewSet && weight != null && reps != null) {
    checkForPR(sessionExerciseId, weight);
    const ex = state.activeExercises.find((x) => String(x.session_exercise_id) === String(sessionExerciseId));
    if (ex?.rest_seconds) startRestTimer(ex.rest_seconds);
  }
}

async function onSetInputChange(e) {
  const input = e.target;
  const se = input.dataset.se;
  const setNum = input.dataset.set;

  const row = input.closest('.set-row');
  const weightInput = row.querySelector('[data-field="weight"]');
  const repsInput = row.querySelector('[data-field="reps"]');
  const weight = weightInput.value ? parseFloat(weightInput.value) : null;
  const reps = repsInput.value ? parseInt(repsInput.value, 10) : null;

  updateSessionProgress();
  await saveSet(se, setNum, weight, reps);
}

// Fills a row with the same weight/reps logged for this set last time and
// saves it immediately, so hitting the same numbers again is one tap.
function onSameAsLastClick(e) {
  const btn = e.target.closest('.same-as-last-btn');
  const row = btn.closest('.set-row');
  const weight = btn.dataset.weight === '' ? null : parseFloat(btn.dataset.weight);
  const reps = btn.dataset.reps === '' ? null : parseInt(btn.dataset.reps, 10);

  row.querySelector('[data-field="weight"]').value = weight ?? '';
  row.querySelector('[data-field="reps"]').value = reps ?? '';

  updateSessionProgress();
  saveSet(btn.dataset.se, btn.dataset.set, weight, reps);
}

// ---------- Personal records ----------

function checkForPR(sessionExerciseId, weight) {
  const ex = state.activeExercises.find((x) => String(x.session_exercise_id) === String(sessionExerciseId));
  if (!ex) return;
  const previousBest = state.prByExercise[ex.exercise_id];
  if (previousBest == null || weight > previousBest) {
    state.prByExercise[ex.exercise_id] = weight;
    // Only celebrate beating a real previous best — logging an exercise for
    // the first time ever isn't a "record" so much as a starting point.
    if (previousBest != null) showToast(`🏆 New PR — ${ex.exercise_name}: ${weight}kg`);
  }
}

// ---------- Toasts ----------

let toastTimeout = null;
function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------- Rest timer ----------

let restTimerInterval = null;

function startRestTimer(seconds) {
  clearInterval(restTimerInterval);
  const endsAt = Date.now() + seconds * 1000;
  const el = $('#rest-timer');
  const label = $('#rest-timer-label');
  el.classList.remove('hidden');

  function tick() {
    const remaining = Math.round((endsAt - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(restTimerInterval);
      el.classList.add('hidden');
      playRestTimerAlert();
      return;
    }
    const mm = Math.floor(remaining / 60);
    const ss = String(remaining % 60).padStart(2, '0');
    label.textContent = `Rest ${mm}:${ss}`;
  }
  tick();
  restTimerInterval = setInterval(tick, 250);
}

function stopRestTimer() {
  clearInterval(restTimerInterval);
  $('#rest-timer')?.classList.add('hidden');
}

// A short beep via Web Audio (no asset file needed) plus a vibration on
// devices that support it, so you notice rest is over without staring at
// the screen the whole time.
function playRestTimerAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio isn't available in every context (e.g. no user gesture yet) —
    // the visual bar hiding is enough of a signal on its own.
  }
  if (navigator.vibrate) navigator.vibrate(200);
}

// Appends one blank set row directly instead of re-rendering the whole
// exercise list, so an unsaved value someone's still typing in another row
// isn't wiped out. Set numbers are always contiguous (no way to delete a
// single set), so "how many rows are already here" is a safe count.
function onAddSetRow(e) {
  const block = e.target.closest('.exercise-block');
  const sessionExerciseId = block.dataset.sessionExerciseId;
  const nextSetNum = block.querySelectorAll('.set-row').length + 1;

  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = `
    <span>#${nextSetNum}</span>
    <input type="number" step="0.5" placeholder="weight (kg)" data-se="${sessionExerciseId}" data-set="${nextSetNum}" data-field="weight" />
    <input type="number" placeholder="reps" data-se="${sessionExerciseId}" data-set="${nextSetNum}" data-field="reps" />
    <span></span>
  `;
  e.target.insertAdjacentElement('beforebegin', row);
  row.querySelectorAll('input').forEach((input) => input.addEventListener('change', onSetInputChange));
}

async function onAddExercise() {
  const exerciseId = state.addExerciseSelect?.getValue();
  if (!exerciseId) return;
  await fetch(`${API_BASE}/api/sessions/${state.activeSessionId}/exercises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: exerciseId, target_sets: 3, target_reps_low: 8, target_reps_high: 12 }),
  });
  await loadActiveExercises();
}

async function onRemoveExercise(e) {
  const block = e.target.closest('.exercise-block');
  if (!confirm("Remove this exercise from today's workout?")) return;
  await fetch(`${API_BASE}/api/session-exercises/${block.dataset.sessionExerciseId}`, { method: 'DELETE' });
  await loadActiveExercises();
}

function onToggleReplacePicker(e) {
  const block = e.target.closest('.exercise-block');
  const picker = block.querySelector('.replace-picker');
  picker.classList.toggle('hidden');
  if (!picker.classList.contains('hidden')) {
    const mount = picker.querySelector('.replace-select');
    // Stashed on the mount element itself since there's no longer a native
    // <select> to read .value from directly.
    mount._iconSelect = createIconSelect(mount, {
      items: state.exerciseLibrary.map((ex) => ({ value: ex.id, label: ex.name, icon: iconForExercise(ex) })),
      placeholder: 'Choose a replacement',
    });
  }
}

async function onConfirmReplace(e) {
  const block = e.target.closest('.exercise-block');
  const exerciseId = block.querySelector('.replace-select')._iconSelect?.getValue();
  if (!exerciseId) return;
  await fetch(`${API_BASE}/api/session-exercises/${block.dataset.sessionExerciseId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: exerciseId }),
  });
  await loadActiveExercises();
}

async function finishSession() {
  const cardio = parseInt($('#cardio-minutes').value, 10) || 0;
  await fetch(`${API_BASE}/api/sessions/${state.activeSessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardio_minutes: cardio }),
  });

  stopRestTimer();
  state.activeSessionId = null;
  $('#active-session').classList.add('hidden');
  $('#today-setup').classList.remove('hidden');
  $('#cardio-minutes').value = 0;
  loadWeekProgress();
  alert('Workout saved.');
}

// ---------- Weekly progress ----------

async function loadWeekProgress() {
  const [weekRes, templatesRes] = await Promise.all([
    fetch(`${API_BASE}/api/progress/week`),
    fetch(`${API_BASE}/api/templates`),
  ]);
  const data = await weekRes.json();
  const allTemplates = await templatesRes.json();

  const pct = data.sessionsPlanned
    ? Math.min(100, Math.round((data.sessionsCompleted / data.sessionsPlanned) * 100))
    : 0;
  $('#week-bar-fill').style.width = `${pct}%`;
  $('#week-bar-label').textContent = `${data.sessionsCompleted} of ${data.sessionsPlanned} workouts this week`;

  const doneKeys = new Set(data.templatesDone.map((t) => t.key));
  $('#week-chips').innerHTML = allTemplates
    .map((t) => `<span class="week-chip ${doneKeys.has(t.key) ? 'done' : ''}">${doneKeys.has(t.key) ? '✓' : '·'} ${t.name}</span>`)
    .join('');

  $('#week-volume').textContent = `${data.totalVolumeKg.toLocaleString()} kg lifted this week`;
}

// ---------- History ----------

const HISTORY_PAGE_SIZE = 10;
let historySessions = [];
let historyPage = 0;

async function loadHistory() {
  const res = await fetch(`${API_BASE}/api/sessions`);
  historySessions = await res.json();
  historyPage = 0;
  renderHistoryPage();
}

function renderHistoryPage() {
  const list = $('#history-list');
  if (historySessions.length === 0) {
    list.innerHTML = '<p class="exercise-target">No sessions logged yet.</p>';
    $('#history-pagination').innerHTML = '';
    return;
  }

  list.innerHTML = paginateItems(historySessions, historyPage, HISTORY_PAGE_SIZE)
    .map(
      (s) => `
      <div class="history-item" data-id="${s.id}">
        <div>
          <div>${s.template_name || 'Cardio day'}</div>
          <div class="meta">${s.date}${s.cardio_minutes ? ` · ${s.cardio_minutes} min cardio` : ''}</div>
        </div>
        <span class="meta">view →</span>
      </div>`
    )
    .join('');

  list.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => showSessionDetail(item.dataset.id));
  });

  renderPagination($('#history-pagination'), {
    totalItems: historySessions.length, pageSize: HISTORY_PAGE_SIZE, page: historyPage,
    onPageChange: (p) => { historyPage = p; renderHistoryPage(); },
  });
}

function showSessionDetail(id) {
  return renderSessionDetail(id, { includeDelete: true });
}

// ---------- Plans ----------

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PLANS_LIST_PAGE_SIZE = 3;
let plansCache = [];
let plansPage = 0;

async function loadPlans() {
  const res = await fetch(`${API_BASE}/api/plans`);
  plansCache = await res.json();
  plansPage = 0;
  renderPlansPage();
}

function renderPlansPage() {
  $('#plans-list').innerHTML = paginateItems(plansCache, plansPage, PLANS_LIST_PAGE_SIZE)
    .map((p) => {
      const scheduledWeekdays = new Set(p.schedule.map((s) => s.weekday));
      const dayToggles = WEEKDAY_NAMES
        .map((label, weekday) => `
          <label class="schedule-day-toggle">
            <input type="checkbox" value="${weekday}" ${scheduledWeekdays.has(weekday) ? 'checked' : ''} />
            ${label}
          </label>`)
        .join('');
      const summary = p.schedule.length
        ? p.schedule.map((s) => `${WEEKDAY_NAMES[s.weekday]} → ${s.template_name}`).join(' · ')
        : 'No workout days chosen yet — every day shows as rest.';

      return `
      <div class="card plan-card ${p.active ? 'active-plan' : ''}">
        <h2>${p.name} ${p.active ? '<span class="plan-badge">Active</span>' : ''}</h2>
        ${p.description ? `<div class="plan-description">${p.description}</div>` : ''}
        <div class="plan-days">
          ${p.templates.map((t) => `<span class="week-chip">${t.name}${t.focus ? ' — ' + t.focus : ''}</span>`).join('')}
        </div>
        ${p.active ? '' : `<button type="button" class="primary select-plan-btn" data-plan-key="${p.key}">Switch to this plan</button>`}
        <div class="plan-schedule">
          <h3>Workout days</h3>
          <div class="schedule-days" data-plan-key="${p.key}">${dayToggles}</div>
          <button type="button" class="secondary save-schedule-btn" data-plan-key="${p.key}">Save workout days</button>
          <div class="schedule-summary">${summary}</div>
        </div>
      </div>`;
    })
    .join('');

  $$('.select-plan-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectPlan(btn.dataset.planKey));
  });
  $$('.save-schedule-btn').forEach((btn) => {
    btn.addEventListener('click', () => saveSchedule(btn.dataset.planKey));
  });

  renderPagination($('#plans-list-pagination'), {
    totalItems: plansCache.length, pageSize: PLANS_LIST_PAGE_SIZE, page: plansPage,
    onPageChange: (p) => { plansPage = p; renderPlansPage(); },
  });
}

async function selectPlan(key) {
  await fetch(`${API_BASE}/api/plans/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  await loadPlans();
  await loadTemplates();
  await loadWeekProgress();
}

async function saveSchedule(planKey) {
  const container = document.querySelector(`.schedule-days[data-plan-key="${planKey}"]`);
  const weekdays = Array.from(container.querySelectorAll('input'))
    .filter((i) => i.checked)
    .map((i) => parseInt(i.value, 10));
  await fetch(`${API_BASE}/api/plans/${planKey}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekdays }),
  });
  await loadPlans();
}

// ---------- My Templates (user-created, private) ----------

let myTemplatesCache = [];
let myTemplateExerciseSelect = null;

const MY_TEMPLATES_PAGE_SIZE = 10;
let myTemplatesPage = 0;

async function loadMyTemplates() {
  const res = await fetch(`${API_BASE}/api/my-templates`);
  myTemplatesCache = await res.json();
  myTemplatesPage = 0;
  renderMyTemplatesPage();
}

function renderMyTemplatesPage() {
  const list = $('#my-templates-list');
  list.innerHTML = myTemplatesCache.length
    ? `<div class="admin-template-list">${paginateItems(myTemplatesCache, myTemplatesPage, MY_TEMPLATES_PAGE_SIZE).map((t) => `
        <div class="admin-template-row">
          <span>${t.name}${t.focus ? ` — ${t.focus}` : ''} <span class="meta">· ${t.exercises.length} exercises</span></span>
          <div class="exercise-actions">
            <button type="button" class="secondary manage-my-template-btn" data-key="${t.key}">Manage exercises</button>
            <button type="button" class="icon-btn delete-my-template-btn" data-id="${t.id}" title="Delete">✕</button>
          </div>
        </div>`).join('')}</div>`
    : '<p class="exercise-target">No custom templates yet — create one below.</p>';

  list.querySelectorAll('.manage-my-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => showMyTemplateManager(btn.dataset.key));
  });
  list.querySelectorAll('.delete-my-template-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this template? This cannot be undone.')) return;
      await fetch(`${API_BASE}/api/my-templates/${btn.dataset.id}`, { method: 'DELETE' });
      await loadMyTemplates();
      await loadTemplates();
    });
  });

  renderPagination($('#my-templates-pagination'), {
    totalItems: myTemplatesCache.length, pageSize: MY_TEMPLATES_PAGE_SIZE, page: myTemplatesPage,
    onPageChange: (p) => { myTemplatesPage = p; renderMyTemplatesPage(); },
  });
}

async function onAddMyTemplate() {
  const name = $('#my-template-name').value.trim();
  if (!name) return alert('Name is required.');
  const focus = $('#my-template-focus').value.trim();

  const res = await fetch(`${API_BASE}/api/my-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, focus: focus || null }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return alert(data.error || 'Could not create template.');
  }

  $('#my-template-name').value = '';
  $('#my-template-focus').value = '';
  await loadMyTemplates();
  await loadTemplates();
}

async function showMyTemplateManager(templateKey) {
  const template = myTemplatesCache.find((t) => t.key === templateKey);
  if (!template) return;

  // The exercise library is only otherwise loaded once a workout is
  // started — fetch it here too so this modal works even if none has been
  // started yet this visit.
  if (!state.exerciseLibrary.length) {
    const res = await fetch(`${API_BASE}/api/exercises`);
    state.exerciseLibrary = await res.json();
  }

  const rows = template.exercises.map((ex) => `
    <tr data-id="${ex.template_exercise_id}">
      <td>${ex.exercise_name}</td>
      <td>${ex.target_sets} × ${ex.target_reps_low}–${ex.target_reps_high}</td>
      <td><button type="button" class="icon-btn remove-my-template-exercise-btn" title="Remove">✕</button></td>
    </tr>`).join('');

  const body = `
    <table>
      <thead><tr><th>Exercise</th><th>Target</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="meta">No exercises yet.</td></tr>'}</tbody>
    </table>
    <div class="card subtle" style="margin-top: 12px;">
      <h3>Add exercise</h3>
      <label>Exercise
        <div id="my-tpl-ex-select"></div>
      </label>
      <div class="field-row-3">
        <input type="number" id="my-tpl-ex-sets" placeholder="Sets" value="3" />
        <input type="number" id="my-tpl-ex-reps-low" placeholder="Reps low" value="8" />
        <input type="number" id="my-tpl-ex-reps-high" placeholder="Reps high" value="12" />
      </div>
      <button type="button" class="primary" id="add-my-template-exercise-btn">Add to template</button>
    </div>
  `;
  openModal(template.name, template.focus || '', body);

  myTemplateExerciseSelect = createIconSelect($('#my-tpl-ex-select'), {
    items: state.exerciseLibrary.map((ex) => ({ value: ex.id, label: ex.name, icon: iconForExercise(ex) })),
    placeholder: 'Choose an exercise',
  });

  $('#add-my-template-exercise-btn').addEventListener('click', async () => {
    const res = await fetch(`${API_BASE}/api/my-templates/${template.id}/exercises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exercise_id: myTemplateExerciseSelect?.getValue(),
        target_sets: parseInt($('#my-tpl-ex-sets').value, 10),
        target_reps_low: parseInt($('#my-tpl-ex-reps-low').value, 10),
        target_reps_high: parseInt($('#my-tpl-ex-reps-high').value, 10),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.error || 'Could not add exercise.');
    }
    closeModal();
    await loadMyTemplates();
    await loadTemplates();
  });

  $('#modal-body').querySelectorAll('.remove-my-template-exercise-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm('Remove this exercise from the template?')) return;
      await fetch(`${API_BASE}/api/my-template-exercises/${id}`, { method: 'DELETE' });
      closeModal();
      await loadMyTemplates();
      await loadTemplates();
    });
  });
}

// ---------- Calendar ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

async function loadCalendar() {
  closeModal();
  const monthStr = `${state.calendarYear}-${String(state.calendarMonth).padStart(2, '0')}`;
  const res = await fetch(`${API_BASE}/api/calendar?month=${monthStr}`);
  const { sessionsByDate, schedule } = await res.json();
  renderCalendarGrid(state.calendarYear, state.calendarMonth, sessionsByDate, schedule);
}

function renderCalendarGrid(year, month, sessionsByDate, schedule) {
  $('#calendar-month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;

  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = firstDay.getDay(); // 0 = Sunday
  const today = todayISO();

  let cells = '';
  for (let i = 0; i < leadingBlanks; i++) {
    cells += `<div class="calendar-day empty"></div>`;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(year, month - 1, day).getDay();
    const sessionsThatDay = sessionsByDate[dateStr];
    const scheduled = schedule[weekday];

    let classes = 'calendar-day clickable';
    let icon = '';
    let data = '';

    if (sessionsThatDay) {
      classes += ' done';
      icon = '🎉';
      data = `data-kind="session" data-session-id="${sessionsThatDay[0].id}"`;
    } else if (scheduled && dateStr < today) {
      classes += ' missed';
      icon = '😠';
      data = `data-kind="scheduled" data-template-key="${scheduled.template_key}" data-status="missed"`;
    } else if (scheduled) {
      classes += ' planned';
      icon = '📅';
      data = `data-kind="scheduled" data-template-key="${scheduled.template_key}" data-status="planned"`;
    } else {
      classes += ' rest';
      icon = '💤';
      data = 'data-kind="rest"';
    }
    if (dateStr === today) classes += ' today';
    cells += `
      <div class="${classes}" data-date="${dateStr}" ${data}>
        <span class="day-number">${day}</span>
        ${icon ? `<span class="day-icon">${icon}</span>` : ''}
      </div>`;
  }

  $('#calendar-grid').innerHTML = cells;
  $$('.calendar-day.clickable').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.kind === 'session') renderSessionDetail(el.dataset.sessionId);
      else if (el.dataset.kind === 'scheduled') showScheduledDayDetail(el.dataset.templateKey, el.dataset.date, el.dataset.status);
      else showRestDayDetail(el.dataset.date);
    });
  });
}

// ---------- Modal ----------

function openModal(title, dateStr, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-date').textContent = dateStr;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-overlay').classList.remove('hidden');
  // rAF so the "hidden -> visible" transition actually animates instead of
  // starting from the final state.
  requestAnimationFrame(() => $('#modal-overlay').classList.add('open'));
}

function closeModal() {
  $('#modal-overlay').classList.remove('open');
  setTimeout(() => {
    $('#modal-overlay').classList.add('hidden');
    // Clears any embedded YouTube iframe so it actually stops playing,
    // rather than just being hidden and running in the background.
    $('#modal-body').innerHTML = '';
  }, 160);
}

// Shared by the History tab and the Calendar tab — shows a logged session's
// exercises/sets (with prescribed target alongside what was actually logged)
// in the popup modal rather than inline in the page.
async function renderSessionDetail(sessionId, { includeDelete = false } = {}) {
  const [sessionRes, exercisesRes] = await Promise.all([
    fetch(`${API_BASE}/api/sessions/${sessionId}`),
    fetch(`${API_BASE}/api/sessions/${sessionId}/exercises`),
  ]);
  const session = await sessionRes.json();
  const exercises = await exercisesRes.json();
  const isFuture = session.date > todayISO();

  const loggedBySessionExercise = {};
  session.sets.forEach((s) => {
    (loggedBySessionExercise[s.session_exercise_id] ||= []).push(s);
  });

  const rows = exercises.map((ex) => {
    const repsLabel = ex.target_reps_low === ex.target_reps_high
      ? ex.target_reps_low
      : `${ex.target_reps_low}–${ex.target_reps_high}`;
    const logged = loggedBySessionExercise[ex.session_exercise_id];
    const loggedStr = logged?.length
      ? logged.map((s) => `#${s.set_number}: ${s.weight_kg ?? '-'}kg × ${s.reps ?? '-'}`).join(' · ')
      : `<span class="meta">${isFuture ? 'Planned — not logged yet' : 'No sets logged'}</span>`;
    return `<tr><td>${ex.exercise_name}<div class="meta">${ex.target_sets} × ${repsLabel}</div></td><td>${loggedStr}</td></tr>`;
  }).join('');

  const body = `
    <table><thead><tr><th>Exercise</th><th>Sets</th></tr></thead><tbody>${rows}</tbody></table>
    ${session.cardio_minutes ? `<p class="exercise-target">Cardio: ${session.cardio_minutes} min</p>` : ''}
    ${includeDelete ? '<button class="danger" id="delete-session-btn">Delete session</button>' : ''}
  `;
  openModal(`${session.template_name || 'Cardio day'}${isFuture ? ' (planned)' : ''}`, session.date, body);

  if (includeDelete) {
    $('#delete-session-btn').addEventListener('click', async () => {
      if (!confirm('Delete this session?')) return;
      await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
      closeModal();
      loadHistory();
    });
  }
}

async function showScheduledDayDetail(templateKey, dateStr, status) {
  const res = await fetch(`${API_BASE}/api/templates/${templateKey}`);
  const template = await res.json();

  const rows = template.exercises.map((ex) => {
    const repsLabel = ex.target_reps_low === ex.target_reps_high
      ? ex.target_reps_low
      : `${ex.target_reps_low}–${ex.target_reps_high}`;
    return `<tr><td>${ex.exercise_name}</td><td>${ex.target_sets} × ${repsLabel}${ex.rest_seconds ? ` · rest ${ex.rest_seconds}s` : ''}</td></tr>`;
  }).join('');

  const statusLine = status === 'missed'
    ? '<p class="exercise-note" style="color: var(--danger)">Missed — no session was logged this day.</p>'
    : '<p class="exercise-note">Planned — not logged yet.</p>';

  const body = `
    ${statusLine}
    <table><thead><tr><th>Exercise</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  openModal(`${template.name}${template.focus ? ' — ' + template.focus : ''} (${status === 'missed' ? 'missed' : 'planned'})`, dateStr, body);
}

function showRestDayDetail(dateStr) {
  openModal('Rest day', dateStr, '<p class="exercise-target">No workout scheduled.</p>');
}

function changeCalendarMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth > 12) { state.calendarMonth = 1; state.calendarYear++; }
  if (state.calendarMonth < 1) { state.calendarMonth = 12; state.calendarYear--; }
  loadCalendar();
}

// ---------- Progress ----------

async function loadExerciseOptions() {
  const res = await fetch(`${API_BASE}/api/exercises`);
  const exercises = await res.json();
  const items = exercises.map((e) => ({ value: e.id, label: e.name, icon: iconForExercise(e) }));

  const prev = state.exerciseSelect?.getValue();
  const value = (prev && items.some((i) => String(i.value) === String(prev))) ? prev : items[0]?.value;

  if (state.exerciseSelect) {
    state.exerciseSelect.setItems(items, value);
  } else {
    state.exerciseSelect = createIconSelect($('#exercise-select'), {
      items, value, placeholder: 'Choose an exercise', onChange: (id) => loadProgress(id),
    });
  }
  if (items.length) loadProgress(value);
}

const PROGRESS_TABLE_PAGE_SIZE = 15;
let progressTableRows = [];
let progressTablePage = 0;

async function loadProgress(exerciseId) {
  const res = await fetch(`${API_BASE}/api/progress/exercise/${exerciseId}`);
  const rows = await res.json();

  const labels = rows.map((r) => r.date);
  const weights = rows.map((r) => r.weight_kg);

  const ctx = $('#progress-chart').getContext('2d');
  if (state.progressChart) state.progressChart.destroy();
  state.progressChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [themedLineDataset('Weight (kg)', weights, '#4f8cff')],
    },
    options: themedLineChartOptions(),
  });

  // Newest first for the table (the chart above stays in chronological
  // order, which is what a trend line needs).
  progressTableRows = rows.slice().reverse();
  progressTablePage = 0;
  renderProgressTablePage();
}

function renderProgressTablePage() {
  const tableRows = paginateItems(progressTableRows, progressTablePage, PROGRESS_TABLE_PAGE_SIZE)
    .map((r) => `<tr><td>${r.date}</td><td>#${r.set_number}</td><td>${r.weight_kg ?? '-'}</td><td>${r.reps ?? '-'}</td></tr>`)
    .join('');
  $('#progress-table').innerHTML = `
    <table><thead><tr><th>Date</th><th>Set</th><th>Weight</th><th>Reps</th></tr></thead>
    <tbody>${tableRows}</tbody></table>`;

  renderPagination($('#progress-table-pagination'), {
    totalItems: progressTableRows.length, pageSize: PROGRESS_TABLE_PAGE_SIZE, page: progressTablePage,
    onPageChange: (p) => { progressTablePage = p; renderProgressTablePage(); },
  });
}

// ---------- Records & Favorites ----------

const RECORDS_TABLE_PAGE_SIZE = 10;
let recordsCache = [];
let recordsSortKey = 'times_logged';
let recordsPage = 0;

function recordExerciseIcon(r) {
  return r.exercise_image ? API_BASE + r.exercise_image : (EQUIPMENT_ICONS[r.exercise_category] || EQUIPMENT_ICONS.bodyweight);
}

async function loadRecords() {
  const res = await fetch(`${API_BASE}/api/progress/records`);
  recordsCache = await res.json();
  recordsPage = 0;
  renderRecordsTable();
}

function renderRecordsTable() {
  const sorted = [...recordsCache].sort((a, b) => (b[recordsSortKey] ?? 0) - (a[recordsSortKey] ?? 0));
  $('#records-table').innerHTML = sorted.length ? `
    <table>
      <thead><tr><th>Exercise</th><th>Times logged</th><th>Avg weight</th><th>Top weight</th></tr></thead>
      <tbody>${paginateItems(sorted, recordsPage, RECORDS_TABLE_PAGE_SIZE).map((r) => `
        <tr>
          <td class="records-exercise-cell"><img class="records-icon" src="${recordExerciseIcon(r)}" alt="" />${r.exercise_name}</td>
          <td>${r.times_logged}</td>
          <td>${r.avg_weight_kg != null ? r.avg_weight_kg + 'kg' : '-'}</td>
          <td>${r.max_weight_kg != null ? r.max_weight_kg + 'kg' : '-'}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="exercise-target">No sets logged yet — your records will show up here once you do.</p>';

  renderPagination($('#records-table-pagination'), {
    totalItems: sorted.length, pageSize: RECORDS_TABLE_PAGE_SIZE, page: recordsPage,
    onPageChange: (p) => { recordsPage = p; renderRecordsTable(); },
  });
}

const FAVORITE_MEDALS = ['🥇', '🥈', '🥉'];

async function loadFavorites() {
  const res = await fetch(`${API_BASE}/api/progress/records`);
  const records = await res.json();
  const top3 = [...records].sort((a, b) => b.times_logged - a.times_logged).slice(0, 3);

  $('#favorites-list').innerHTML = top3.length ? top3.map((r, i) => `
    <div class="favorite-row">
      <span class="favorite-medal">${FAVORITE_MEDALS[i]}</span>
      <img class="records-icon" src="${recordExerciseIcon(r)}" alt="" />
      <div class="favorite-info">
        <div class="favorite-name">${r.exercise_name}</div>
        <div class="meta">${r.times_logged} workouts · avg ${r.avg_weight_kg ?? '-'}kg · top ${r.max_weight_kg ?? '-'}kg</div>
      </div>
    </div>`).join('') : '<p class="exercise-target">No sets logged yet — your favorites will show up here once you do.</p>';
}

// ---------- Report ----------

async function loadReport() {
  if (!state.reportDate) state.reportDate = todayISO();
  const res = await fetch(`${API_BASE}/api/reports?period=${state.reportPeriod}&date=${state.reportDate}`);
  const data = await res.json();
  renderReport(data);
}

function renderReport(data) {
  const rangeLabel = data.period === 'week'
    ? `${data.start} – ${data.end}`
    : `${MONTH_NAMES[parseInt(data.start.slice(5, 7), 10) - 1]} ${data.start.slice(0, 4)}`;
  $('#report-range-label').textContent = rangeLabel;

  const tiles = [
    ['Workouts', data.sessionsPlanned != null ? `${data.sessionsCompleted} / ${data.sessionsPlanned}` : data.sessionsCompleted],
    ['Sets logged', data.totalSets],
    ['Volume lifted', `${data.totalVolumeKg} kg`],
    ['Cardio', `${data.cardioMinutes} min`],
  ];
  if (data.weightChangeKg != null) {
    const sign = data.weightChangeKg > 0 ? '+' : '';
    tiles.push(['Weight change', `${sign}${data.weightChangeKg} kg`]);
  }
  $('#report-stats').innerHTML = tiles.map(([label, value]) => `
    <div class="stat-tile">
      <span class="stat-value">${value}</span>
      <span class="stat-label">${label}</span>
    </div>`).join('');

  reportExercisesCache = data.exercises;
  reportExercisesPage = 0;
  renderReportExercisesPage();

  reportSessionsCache = data.sessions;
  reportSessionsPage = 0;
  renderReportSessionsPage();
}

const REPORT_LIST_PAGE_SIZE = 10;
let reportExercisesCache = [];
let reportExercisesPage = 0;
let reportSessionsCache = [];
let reportSessionsPage = 0;

function renderReportExercisesPage() {
  $('#report-exercises').innerHTML = reportExercisesCache.length ? `
    <h3>Exercises trained</h3>
    <table>
      <thead><tr><th>Exercise</th><th>Sets</th><th>Volume</th><th>Top set</th></tr></thead>
      <tbody>${paginateItems(reportExercisesCache, reportExercisesPage, REPORT_LIST_PAGE_SIZE).map((e) => `
        <tr>
          <td>${e.name}</td>
          <td>${e.sets}</td>
          <td>${e.volumeKg} kg</td>
          <td>${e.maxWeightKg != null ? `${e.maxWeightKg} kg` : '-'}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="exercise-target">No sets logged in this period.</p>';

  renderPagination($('#report-exercises-pagination'), {
    totalItems: reportExercisesCache.length, pageSize: REPORT_LIST_PAGE_SIZE, page: reportExercisesPage,
    onPageChange: (p) => { reportExercisesPage = p; renderReportExercisesPage(); },
  });
}

function renderReportSessionsPage() {
  $('#report-sessions').innerHTML = reportSessionsCache.length ? `
    <h3>Workouts</h3>
    <ul class="report-session-list">
      ${paginateItems(reportSessionsCache, reportSessionsPage, REPORT_LIST_PAGE_SIZE).map((s) => `<li>${s.date} — ${s.template_name || 'Cardio day'}</li>`).join('')}
    </ul>` : '';

  renderPagination($('#report-sessions-pagination'), {
    totalItems: reportSessionsCache.length, pageSize: REPORT_LIST_PAGE_SIZE, page: reportSessionsPage,
    onPageChange: (p) => { reportSessionsPage = p; renderReportSessionsPage(); },
  });
}

function shiftReportRange(direction) {
  const d = new Date(`${state.reportDate}T00:00:00`);
  if (state.reportPeriod === 'week') {
    d.setDate(d.getDate() + direction * 7);
  } else {
    d.setMonth(d.getMonth() + direction);
  }
  state.reportDate = d.toISOString().slice(0, 10);
  loadReport();
}

// ---------- Progress photos ----------

const PHOTO_MAX_DIMENSION = 1600;

// Downscales onto a canvas before upload so a multi-MB phone photo doesn't
// balloon the request (and long-term storage) once base64-encoded.
function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > PHOTO_MAX_DIMENSION || height > PHOTO_MAX_DIMENSION) {
        const scale = PHOTO_MAX_DIMENSION / Math.max(width, height);
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

async function uploadProgressPhoto() {
  const file = $('#photo-file').files[0];
  const date = $('#photo-date').value || todayISO();
  const weightInput = $('#photo-weight').value;

  if (!file) return alert('Please choose a photo.');

  const btn = $('#upload-photo-btn');
  btn.disabled = true;
  try {
    const image = await resizeImageToDataUrl(file);
    const res = await fetch(`${API_BASE}/api/progress-photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, weight_kg: weightInput ? parseFloat(weightInput) : null, image }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Upload failed.');
      return;
    }
    $('#photo-file').value = '';
    $('#photo-weight').value = '';
    await loadProgressPhotos();
  } finally {
    btn.disabled = false;
  }
}

const PHOTO_GALLERY_PAGE_SIZE = 12;
let photoGalleryPhotos = [];
let photoGalleryPage = 0;

async function loadProgressPhotos() {
  const res = await fetch(`${API_BASE}/api/progress-photos`);
  photoGalleryPhotos = (await res.json()).slice().reverse();
  photoGalleryPage = 0;
  renderPhotoGalleryPage();
}

function renderPhotoGalleryPage() {
  const gallery = $('#photo-gallery');
  gallery.innerHTML = photoGalleryPhotos.length
    ? paginateItems(photoGalleryPhotos, photoGalleryPage, PHOTO_GALLERY_PAGE_SIZE).map((p) => `
        <div class="photo-card" data-id="${p.id}" data-date="${p.date}">
          <img src="${API_BASE}/api/progress-photos/${p.id}/image" alt="Progress photo from ${p.date}" loading="lazy" />
          <button type="button" class="photo-delete-btn" title="Delete photo">✕</button>
          <div class="photo-meta">
            <span>${p.date}</span>
            ${p.weight_kg != null ? `<span>${p.weight_kg} kg</span>` : ''}
          </div>
        </div>`).join('')
    : '<p class="exercise-target">No progress photos yet.</p>';

  gallery.querySelectorAll('.photo-card img').forEach((img) => {
    img.addEventListener('click', () => {
      const card = img.closest('.photo-card');
      openModal('Progress photo', card.dataset.date, `<img src="${img.src}" style="width:100%; border-radius:8px; display:block;" />`);
    });
  });
  gallery.querySelectorAll('.photo-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.photo-card');
      if (!confirm('Delete this photo?')) return;
      await fetch(`${API_BASE}/api/progress-photos/${card.dataset.id}`, { method: 'DELETE' });
      loadProgressPhotos();
    });
  });

  renderPagination($('#photo-gallery-pagination'), {
    totalItems: photoGalleryPhotos.length, pageSize: PHOTO_GALLERY_PAGE_SIZE, page: photoGalleryPage,
    onPageChange: (p) => { photoGalleryPage = p; renderPhotoGalleryPage(); },
  });
}

// ---------- Body stats ----------

async function saveBodyStats() {
  const date = $('#stats-date').value || todayISO();
  const weight_kg = $('#stats-weight').value ? parseFloat($('#stats-weight').value) : null;
  const waist_cm = $('#stats-waist').value ? parseFloat($('#stats-waist').value) : null;

  await fetch(`${API_BASE}/api/body-stats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, weight_kg, waist_cm }),
  });

  $('#stats-weight').value = '';
  $('#stats-waist').value = '';
  loadBodyStats();
}

const STATS_TABLE_PAGE_SIZE = 15;
let statsTableRows = [];
let statsTablePage = 0;

async function loadBodyStats() {
  const res = await fetch(`${API_BASE}/api/body-stats`);
  const rows = await res.json();

  const ctx = $('#weight-chart').getContext('2d');
  if (state.weightChart) state.weightChart.destroy();
  state.weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map((r) => r.date),
      datasets: [themedLineDataset('Weight (kg)', rows.map((r) => r.weight_kg), '#34d399')],
    },
    options: themedLineChartOptions(),
  });

  statsTableRows = rows.slice().reverse();
  statsTablePage = 0;
  renderStatsTablePage();

  const latestWeight = statsTableRows.find((r) => r.weight_kg != null)?.weight_kg;
  if (latestWeight != null) $('#nutri-weight').value = latestWeight;
}

function renderStatsTablePage() {
  $('#stats-table').innerHTML = `
    <table><thead><tr><th>Date</th><th>Weight (kg)</th><th>Waist (cm)</th></tr></thead>
    <tbody>${paginateItems(statsTableRows, statsTablePage, STATS_TABLE_PAGE_SIZE)
      .map((r) => `<tr><td>${r.date}</td><td>${r.weight_kg ?? '-'}</td><td>${r.waist_cm ?? '-'}</td></tr>`)
      .join('')}</tbody></table>`;

  renderPagination($('#stats-table-pagination'), {
    totalItems: statsTableRows.length, pageSize: STATS_TABLE_PAGE_SIZE, page: statsTablePage,
    onPageChange: (p) => { statsTablePage = p; renderStatsTablePage(); },
  });
}

// ---------- Nutrition calculator ----------
// Mifflin-St Jeor BMR, activity-scaled TDEE, and goal-driven macro/hydration
// targets. See conversation/README for the formula reference.

const GOAL_DEFAULT_ADJUSTMENT = { lose: -500, maintain: 0, gain: 300 };
const GOAL_PROTEIN_PER_KG = { lose: 2.0, maintain: 1.8, gain: 2.2 };

function bmiCategory(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

async function loadNutritionProfile() {
  const res = await fetch(`${API_BASE}/api/settings`);
  const s = await res.json();
  if (s.nutrition_calorie_adjustment) $('#nutri-adjustment').value = s.nutrition_calorie_adjustment;
}

// Age/sex/height/activity/goal/body-fat now live on the Profile tab (single
// source of truth) — the calculator just reads them and asks for weight.
async function calculateNutrition() {
  const profileRes = await fetch(`${API_BASE}/api/settings`);
  const profile = await profileRes.json();
  const age = parseFloat(profile.nutrition_age);
  const sex = profile.nutrition_sex;
  const height = parseFloat(profile.nutrition_height_cm);
  const activityMultiplier = parseFloat(profile.nutrition_activity);
  const goal = profile.nutrition_goal;
  const bodyFat = profile.nutrition_body_fat_pct ? parseFloat(profile.nutrition_body_fat_pct) : null;

  if (!age || !height) {
    alert('Please fill in your fitness profile (age, height) first.');
    $('.tab-btn[data-tab="profile"]').click();
    return;
  }

  const weight = parseFloat($('#nutri-weight').value);
  const adjustmentInput = $('#nutri-adjustment').value;
  if (!weight) {
    alert('Please fill in your weight.');
    return;
  }

  const bmr = sex === 'female'
    ? (10 * weight) + (6.25 * height) - (5 * age) - 161
    : (10 * weight) + (6.25 * height) - (5 * age) + 5;

  const tdee = bmr * activityMultiplier;
  const adjustment = adjustmentInput !== '' ? parseFloat(adjustmentInput) : GOAL_DEFAULT_ADJUSTMENT[goal];
  const targetCalories = tdee + adjustment;

  const proteinG = weight * GOAL_PROTEIN_PER_KG[goal];
  const fatG = (targetCalories * 0.25) / 9;
  const carbsG = (targetCalories - (proteinG * 4) - (fatG * 9)) / 4;
  const fiberG = (targetCalories / 1000) * 14;
  const waterL = (weight * 40) / 1000;
  const bmi = weight / ((height / 100) ** 2);

  const rows = [
    ['BMR', `${Math.round(bmr)} kcal`],
    ['TDEE (maintenance)', `${Math.round(tdee)} kcal`],
    ['Target calories', `${Math.round(targetCalories)} kcal (${adjustment >= 0 ? '+' : ''}${Math.round(adjustment)} kcal)`],
    ['Protein', `${Math.round(proteinG)} g (${Math.round(proteinG * 4)} kcal)`],
    ['Fat', `${Math.round(fatG)} g (${Math.round(fatG * 9)} kcal)`],
    ['Carbohydrates', `${Math.round(carbsG)} g (${Math.round(carbsG * 4)} kcal)`],
    ['Fiber', `${Math.round(fiberG)} g`],
    ['Water', `${waterL.toFixed(1)} L`],
    ['BMI', `${bmi.toFixed(1)} (${bmiCategory(bmi)})`],
  ];
  if (bodyFat != null) {
    rows.push(['Lean body mass', `${(weight * (1 - bodyFat / 100)).toFixed(1)} kg`]);
    rows.push(['Fat mass', `${(weight * (bodyFat / 100)).toFixed(1)} kg`]);
  }

  $('#nutri-results').innerHTML = `<table><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
  $('#nutri-results').classList.remove('hidden');

  await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nutrition_calorie_adjustment: adjustmentInput }),
  });
}

// ---------- Settings ----------

async function loadSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  const settings = await res.json();
  $('#reminder-time').value = settings.reminder_time;
}

async function saveSettings() {
  const reminder_time = $('#reminder-time').value;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reminder_time, timezone }),
  });
  alert('Settings saved.');
}

// ---------- Profile ----------

async function loadProfile() {
  const [settingsRes, statusRes, statsRes] = await Promise.all([
    fetch(`${API_BASE}/api/settings`),
    fetch(`${API_BASE}/api/auth/status`),
    fetch(`${API_BASE}/api/body-stats`),
  ]);
  const settings = await settingsRes.json();
  const status = await statusRes.json();
  const stats = await statsRes.json();

  $('#profile-email').textContent = status.email || '';
  $('#admin-link').classList.toggle('hidden', !status.isAdmin);

  if (settings.nutrition_age) $('#profile-age').value = settings.nutrition_age;
  $('#profile-sex').value = settings.nutrition_sex;
  if (settings.nutrition_height_cm) $('#profile-height').value = settings.nutrition_height_cm;
  $('#profile-activity').value = settings.nutrition_activity;
  $('#profile-goal').value = settings.nutrition_goal;
  if (settings.nutrition_body_fat_pct) $('#profile-bodyfat').value = settings.nutrition_body_fat_pct;

  const latest = stats.slice().reverse().find((r) => r.weight_kg != null);
  const height = parseFloat(settings.nutrition_height_cm);
  if (latest && height) {
    const bmi = latest.weight_kg / ((height / 100) ** 2);
    $('#profile-snapshot').textContent =
      `Weight: ${latest.weight_kg} kg (logged ${latest.date}) · BMI: ${bmi.toFixed(1)} (${bmiCategory(bmi)})`;
  } else if (latest) {
    $('#profile-snapshot').textContent = `Weight: ${latest.weight_kg} kg (logged ${latest.date}) · add your height for BMI`;
  } else {
    $('#profile-snapshot').textContent = 'No body stats logged yet.';
  }
}

async function saveProfile() {
  await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nutrition_age: $('#profile-age').value,
      nutrition_sex: $('#profile-sex').value,
      nutrition_height_cm: $('#profile-height').value,
      nutrition_activity: $('#profile-activity').value,
      nutrition_goal: $('#profile-goal').value,
      nutrition_body_fat_pct: $('#profile-bodyfat').value,
    }),
  });
  alert('Profile saved.');
  loadProfile();
}

async function logout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  location.href = '/login.html';
}

// Saves the browser's detected timezone the first time the app loads, so
// even a workout logged before ever visiting Settings gets a calendar
// reminder at the right local time instead of defaulting to UTC.
async function ensureTimezone() {
  const res = await fetch(`${API_BASE}/api/settings`);
  const settings = await res.json();
  if (settings.timezone && settings.timezone !== 'UTC') return;
  await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
}

// ---------- Init ----------

function init() {
  setupTabs();
  setupSubTabs();
  setupThemeToggle();
  $('#session-date').value = todayISO();
  $('#stats-date').value = todayISO();
  $('#photo-date').value = todayISO();
  loadTemplates();
  loadWeekProgress();
  ensureTimezone();
  resumeTodaySessionIfAny();

  $('#start-session-btn').addEventListener('click', startSession);
  $('#finish-session-btn').addEventListener('click', finishSession);
  $('#rest-timer-skip').addEventListener('click', stopRestTimer);
  $('#add-exercise-btn').addEventListener('click', onAddExercise);
  $('#add-my-template-btn').addEventListener('click', onAddMyTemplate);
  $('#save-stats-btn').addEventListener('click', saveBodyStats);
  $('#upload-photo-btn').addEventListener('click', uploadProgressPhoto);
  $('#nutri-calculate-btn').addEventListener('click', calculateNutrition);
  $('#nutri-profile-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('.tab-btn[data-tab="profile"]').click();
  });
  $('#save-profile-btn').addEventListener('click', saveProfile);
  $('#save-settings-btn').addEventListener('click', saveSettings);
  $('#logout-btn').addEventListener('click', logout);
  $('#calendar-prev-btn').addEventListener('click', () => changeCalendarMonth(-1));
  $('#calendar-next-btn').addEventListener('click', () => changeCalendarMonth(1));
  $('#report-prev-btn').addEventListener('click', () => shiftReportRange(-1));
  $('#report-next-btn').addEventListener('click', () => shiftReportRange(1));
  $$('#report-period-toggle .segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.reportPeriod = btn.dataset.period;
      $$('#report-period-toggle .segmented-btn').forEach((b) => b.classList.toggle('active', b === btn));
      loadReport();
    });
  });
  $$('#records-sort-toggle .segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      recordsSortKey = btn.dataset.sort;
      recordsPage = 0;
      $$('#records-sort-toggle .segmented-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderRecordsTable();
    });
  });
  $('#modal-close-btn').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

init();
