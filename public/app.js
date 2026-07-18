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
  exerciseLibrary: [],   // all exercises, for the add/replace pickers
  progressChart: null,
  weightChart: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth() + 1, // 1-12
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const EQUIPMENT_ICONS = {
  machine: '/icons/machine.svg',
  cable: '/icons/cable.svg',
  dumbbell: '/icons/dumbbell.svg',
  barbell: '/icons/barbell.svg',
  bodyweight: '/icons/bodyweight.svg',
};

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
      if (btn.dataset.tab === 'plans') loadPlans();
      if (btn.dataset.tab === 'history') loadHistory();
      if (btn.dataset.tab === 'calendar') loadCalendar();
      if (btn.dataset.tab === 'progress') loadExerciseOptions();
      if (btn.dataset.tab === 'stats') { loadBodyStats(); loadNutritionProfile(); }
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
    const exerciseId = $('#exercise-select').value;
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
  const [templatesRes, suggestedRes] = await Promise.all([
    fetch('/api/templates'),
    fetch(`/api/templates/suggested?date=${todayISO()}`),
  ]);
  const templates = await templatesRes.json();
  const { key: suggestedKey } = await suggestedRes.json();

  const select = $('#template-select');
  select.innerHTML = templates
    .map((t) => `<option value="${t.key}">${t.name}${t.focus ? ' — ' + t.focus : ''}</option>`)
    .join('') + '<option value="">Cardio day</option>';
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
  const createRes = await fetch('/api/sessions', {
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
  const res = await fetch(`/api/sessions?date=${date}`);
  const existing = await res.json();
  if (existing.length > 0) {
    await openActiveSession(existing[0], date);
  }
}

async function loadExerciseLibrary() {
  const res = await fetch('/api/exercises');
  state.exerciseLibrary = await res.json();
  $('#add-exercise-select').innerHTML = state.exerciseLibrary
    .map((ex) => `<option value="${ex.id}">${ex.name}</option>`)
    .join('');
}

async function loadActiveExercises() {
  const [exRes, sessionRes] = await Promise.all([
    fetch(`/api/sessions/${state.activeSessionId}/exercises`),
    fetch(`/api/sessions/${state.activeSessionId}`),
  ]);
  const exercises = await exRes.json();
  const session = await sessionRes.json();

  state.activeExercises = exercises;
  state.setLogIds = {};
  const loggedSets = {};
  session.sets.forEach((s) => {
    const key = `${s.session_exercise_id}-${s.set_number}`;
    state.setLogIds[key] = s.id;
    loggedSets[key] = { reps: s.reps, weight_kg: s.weight_kg };
  });

  renderExerciseList(exercises, loggedSets);
}

function renderExerciseList(exercises, loggedSets = {}) {
  const container = $('#exercise-list');
  container.innerHTML = exercises
    .map((ex) => {
      const repsLabel = ex.target_reps_low === ex.target_reps_high
        ? ex.target_reps_low
        : `${ex.target_reps_low}–${ex.target_reps_high}`;

      const previousBySet = {};
      (ex.previous?.sets || []).forEach((s) => { previousBySet[s.set_number] = s; });

      const setsRows = Array.from({ length: ex.target_sets }, (_, i) => {
        const setNum = i + 1;
        const logged = loggedSets[`${ex.session_exercise_id}-${setNum}`];
        const prev = previousBySet[setNum];
        const weightPlaceholder = prev?.weight_kg != null ? `last ${prev.weight_kg}kg` : 'weight (kg)';
        const repsPlaceholder = prev?.reps != null ? `last ${prev.reps} reps` : `reps (target ${repsLabel})`;
        return `
          <div class="set-row">
            <span>#${setNum}</span>
            <input type="number" step="0.5" placeholder="${weightPlaceholder}" value="${logged?.weight_kg ?? ''}"
              data-se="${ex.session_exercise_id}" data-set="${setNum}" data-field="weight" />
            <input type="number" placeholder="${repsPlaceholder}" value="${logged?.reps ?? ''}"
              data-se="${ex.session_exercise_id}" data-set="${setNum}" data-field="reps" />
          </div>`;
      }).join('');

      const previousSummary = (ex.previous?.sets || []).length
        ? `<div class="exercise-previous">Last time (${ex.previous.date}): ${ex.previous.sets
            .map((s) => `${s.weight_kg ?? '-'}kg × ${s.reps ?? '-'}`)
            .join(' · ')}</div>`
        : '';

      const iconSrc = EQUIPMENT_ICONS[ex.exercise_category] || EQUIPMENT_ICONS.bodyweight;

      return `
        <div class="exercise-block" data-session-exercise-id="${ex.session_exercise_id}">
          <div class="exercise-header">
            <img class="equipment-icon" src="${iconSrc}" alt="${ex.exercise_category || 'bodyweight'} icon" />
            <div class="exercise-header-text">
              <h3>${ex.exercise_name}</h3>
              <div class="exercise-target">${ex.target_sets} × ${repsLabel}${ex.rest_seconds ? ` · rest ${ex.rest_seconds}s` : ''}</div>
              ${ex.notes ? `<div class="exercise-note">${ex.notes}</div>` : ''}
              ${previousSummary}
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
            <select class="replace-select"></select>
            <button type="button" class="secondary confirm-replace-btn">Confirm</button>
            <button type="button" class="secondary cancel-replace-btn">Cancel</button>
          </div>
          ${setsRows}
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
  container.querySelectorAll('.cancel-replace-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => e.target.closest('.replace-picker').classList.add('hidden'));
  });
  container.querySelectorAll('.howto-btn').forEach((btn) => {
    btn.addEventListener('click', () => showExerciseHowTo(btn.dataset.sessionExerciseId));
  });
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
    ${ex.exercise_image ? `<img class="howto-image" src="${ex.exercise_image}" alt="${ex.exercise_name}" />` : ''}
    ${ex.exercise_video ? `<div class="video-wrapper"><iframe src="${youtubeEmbedUrl(ex.exercise_video)}" title="How to: ${ex.exercise_name}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : ''}
  `;
  openModal(ex.exercise_name, '', body);
}

async function onSetInputChange(e) {
  const input = e.target;
  const se = input.dataset.se;
  const setNum = input.dataset.set;
  const key = `${se}-${setNum}`;

  const row = input.closest('.set-row');
  const weightInput = row.querySelector('[data-field="weight"]');
  const repsInput = row.querySelector('[data-field="reps"]');
  const weight = weightInput.value ? parseFloat(weightInput.value) : null;
  const reps = repsInput.value ? parseInt(repsInput.value, 10) : null;

  if (state.setLogIds[key]) {
    await fetch(`/api/sets/${state.setLogIds[key]}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reps, weight_kg: weight }),
    });
  } else {
    const res = await fetch(`/api/sessions/${state.activeSessionId}/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_exercise_id: se, set_number: setNum, reps, weight_kg: weight }),
    });
    const { id } = await res.json();
    state.setLogIds[key] = id;
  }
}

async function onAddExercise() {
  const exerciseId = $('#add-exercise-select').value;
  if (!exerciseId) return;
  await fetch(`/api/sessions/${state.activeSessionId}/exercises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: exerciseId, target_sets: 3, target_reps_low: 8, target_reps_high: 12 }),
  });
  await loadActiveExercises();
}

async function onRemoveExercise(e) {
  const block = e.target.closest('.exercise-block');
  if (!confirm("Remove this exercise from today's workout?")) return;
  await fetch(`/api/session-exercises/${block.dataset.sessionExerciseId}`, { method: 'DELETE' });
  await loadActiveExercises();
}

function onToggleReplacePicker(e) {
  const block = e.target.closest('.exercise-block');
  const picker = block.querySelector('.replace-picker');
  picker.classList.toggle('hidden');
  if (!picker.classList.contains('hidden')) {
    picker.querySelector('.replace-select').innerHTML = state.exerciseLibrary
      .map((ex) => `<option value="${ex.id}">${ex.name}</option>`)
      .join('');
  }
}

async function onConfirmReplace(e) {
  const block = e.target.closest('.exercise-block');
  const exerciseId = block.querySelector('.replace-select').value;
  await fetch(`/api/session-exercises/${block.dataset.sessionExerciseId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: exerciseId }),
  });
  await loadActiveExercises();
}

async function finishSession() {
  const cardio = parseInt($('#cardio-minutes').value, 10) || 0;
  await fetch(`/api/sessions/${state.activeSessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardio_minutes: cardio }),
  });

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
    fetch('/api/progress/week'),
    fetch('/api/templates'),
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

async function loadHistory() {
  const res = await fetch('/api/sessions');
  const sessions = await res.json();
  const list = $('#history-list');
  if (sessions.length === 0) {
    list.innerHTML = '<p class="exercise-target">No sessions logged yet.</p>';
    return;
  }
  list.innerHTML = sessions
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
}

function showSessionDetail(id) {
  return renderSessionDetail(id, { includeDelete: true });
}

// ---------- Plans ----------

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function loadPlans() {
  const res = await fetch('/api/plans');
  const plans = await res.json();

  $('#plans-list').innerHTML = plans
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
}

async function selectPlan(key) {
  await fetch('/api/plans/active', {
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
  await fetch(`/api/plans/${planKey}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekdays }),
  });
  await loadPlans();
}

// ---------- Calendar ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

async function loadCalendar() {
  closeModal();
  const monthStr = `${state.calendarYear}-${String(state.calendarMonth).padStart(2, '0')}`;
  const res = await fetch(`/api/calendar?month=${monthStr}`);
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
    fetch(`/api/sessions/${sessionId}`),
    fetch(`/api/sessions/${sessionId}/exercises`),
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
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      closeModal();
      loadHistory();
    });
  }
}

async function showScheduledDayDetail(templateKey, dateStr, status) {
  const res = await fetch(`/api/templates/${templateKey}`);
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
  const res = await fetch('/api/exercises');
  const exercises = await res.json();
  const select = $('#exercise-select');
  const prev = select.value;
  select.innerHTML = exercises.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
  if (prev) select.value = prev;
  select.onchange = () => loadProgress(select.value);
  if (exercises.length) loadProgress(select.value);
}

async function loadProgress(exerciseId) {
  const res = await fetch(`/api/progress/exercise/${exerciseId}`);
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

  const tableRows = rows
    .slice()
    .reverse()
    .map((r) => `<tr><td>${r.date}</td><td>#${r.set_number}</td><td>${r.weight_kg ?? '-'}</td><td>${r.reps ?? '-'}</td></tr>`)
    .join('');
  $('#progress-table').innerHTML = `
    <table><thead><tr><th>Date</th><th>Set</th><th>Weight</th><th>Reps</th></tr></thead>
    <tbody>${tableRows}</tbody></table>`;
}

// ---------- Body stats ----------

async function saveBodyStats() {
  const date = $('#stats-date').value || todayISO();
  const weight_kg = $('#stats-weight').value ? parseFloat($('#stats-weight').value) : null;
  const waist_cm = $('#stats-waist').value ? parseFloat($('#stats-waist').value) : null;

  await fetch('/api/body-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, weight_kg, waist_cm }),
  });

  $('#stats-weight').value = '';
  $('#stats-waist').value = '';
  loadBodyStats();
}

async function loadBodyStats() {
  const res = await fetch('/api/body-stats');
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

  $('#stats-table').innerHTML = `
    <table><thead><tr><th>Date</th><th>Weight (kg)</th><th>Waist (cm)</th></tr></thead>
    <tbody>${rows
      .slice()
      .reverse()
      .map((r) => `<tr><td>${r.date}</td><td>${r.weight_kg ?? '-'}</td><td>${r.waist_cm ?? '-'}</td></tr>`)
      .join('')}</tbody></table>`;

  const latestWeight = rows.slice().reverse().find((r) => r.weight_kg != null)?.weight_kg;
  if (latestWeight != null) $('#nutri-weight').value = latestWeight;
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
  const res = await fetch('/api/settings');
  const s = await res.json();
  if (s.nutrition_age) $('#nutri-age').value = s.nutrition_age;
  $('#nutri-sex').value = s.nutrition_sex;
  if (s.nutrition_height_cm) $('#nutri-height').value = s.nutrition_height_cm;
  $('#nutri-activity').value = s.nutrition_activity;
  $('#nutri-goal').value = s.nutrition_goal;
  if (s.nutrition_calorie_adjustment) $('#nutri-adjustment').value = s.nutrition_calorie_adjustment;
  if (s.nutrition_body_fat_pct) $('#nutri-bodyfat').value = s.nutrition_body_fat_pct;
}

async function calculateNutrition() {
  const age = parseFloat($('#nutri-age').value);
  const sex = $('#nutri-sex').value;
  const weight = parseFloat($('#nutri-weight').value);
  const height = parseFloat($('#nutri-height').value);
  const activityMultiplier = parseFloat($('#nutri-activity').value);
  const goal = $('#nutri-goal').value;
  const adjustmentInput = $('#nutri-adjustment').value;
  const bodyFatInput = $('#nutri-bodyfat').value;

  if (!age || !weight || !height) {
    alert('Please fill in age, weight, and height.');
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

  const bodyFat = bodyFatInput !== '' ? parseFloat(bodyFatInput) : null;

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

  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nutrition_age: age,
      nutrition_sex: sex,
      nutrition_height_cm: height,
      nutrition_activity: activityMultiplier,
      nutrition_goal: goal,
      nutrition_calorie_adjustment: adjustmentInput,
      nutrition_body_fat_pct: bodyFatInput,
    }),
  });
}

// ---------- Settings ----------

async function loadSettings() {
  const [settingsRes, statusRes] = await Promise.all([
    fetch('/api/settings'),
    fetch('/api/auth/status'),
  ]);
  const settings = await settingsRes.json();
  const status = await statusRes.json();

  $('#reminder-time').value = settings.reminder_time;
  $('#settings-email').textContent = status.email || '';
}

async function saveSettings() {
  const reminder_time = $('#reminder-time').value;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reminder_time, timezone }),
  });
  alert('Settings saved.');
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}

// Saves the browser's detected timezone the first time the app loads, so
// even a workout logged before ever visiting Settings gets a calendar
// reminder at the right local time instead of defaulting to UTC.
async function ensureTimezone() {
  const res = await fetch('/api/settings');
  const settings = await res.json();
  if (settings.timezone && settings.timezone !== 'UTC') return;
  await fetch('/api/settings', {
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
  loadTemplates();
  loadWeekProgress();
  ensureTimezone();
  resumeTodaySessionIfAny();

  $('#start-session-btn').addEventListener('click', startSession);
  $('#finish-session-btn').addEventListener('click', finishSession);
  $('#add-exercise-btn').addEventListener('click', onAddExercise);
  $('#save-stats-btn').addEventListener('click', saveBodyStats);
  $('#nutri-calculate-btn').addEventListener('click', calculateNutrition);
  $('#save-settings-btn').addEventListener('click', saveSettings);
  $('#logout-btn').addEventListener('click', logout);
  $('#calendar-prev-btn').addEventListener('click', () => changeCalendarMonth(-1));
  $('#calendar-next-btn').addEventListener('click', () => changeCalendarMonth(1));
  $('#modal-close-btn').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

init();
