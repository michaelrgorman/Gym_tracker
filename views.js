// ============================================================
// History, Progress, Best Lifts tabs
// Relies on helpers from log.js: calcE1RM, getLiftCategory, liftDot, escapeHtml
// ============================================================

const LIFT_LABELS = { squat: 'Squat', bench: 'Bench Press', deadlift: 'Deadlift', ohp: 'Overhead Press' };
const LIFT_ORDER = ['squat', 'bench', 'deadlift', 'ohp'];

function formatDateLong(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDuration(startIso, endIso) {
  if (!endIso) return '';
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  return `${mins} min`;
}

// ---------- Shared: fetch all main-lift working sets ----------

let mainLiftDataCache = null;

async function fetchMainLiftData() {
  if (mainLiftDataCache) return mainLiftDataCache;

  const { data, error } = await supabaseClient
    .from('Workout_Set')
    .select('weight_kg, reps, set_type, Workout_Session!inner(start_time), Workout_Exercise!inner(name, is_main_lift)')
    .eq('Workout_Exercise.is_main_lift', true)
    .neq('set_type', 'warmup');

  if (error) throw error;

  // category -> [{ ts, dateKey, weight_kg, reps, e1rm }]
  const byCategory = { squat: [], bench: [], deadlift: [], ohp: [] };

  (data || []).forEach(row => {
    const category = getLiftCategory(row.Workout_Exercise.name);
    if (!category || !byCategory[category]) return;
    const ts = new Date(row.Workout_Session.start_time).getTime();
    const e1rm = calcE1RM(row.weight_kg, row.reps);
    if (!e1rm) return;
    byCategory[category].push({
      ts,
      dateKey: new Date(ts).toISOString().slice(0, 10),
      weight_kg: row.weight_kg,
      reps: row.reps,
      e1rm
    });
  });

  mainLiftDataCache = byCategory;
  return byCategory;
}

function invalidateMainLiftCache() {
  mainLiftDataCache = null;
}

function bestPerDate(entries) {
  // collapse multiple sets per day down to the best e1RM that day
  const byDay = {};
  entries.forEach(e => {
    if (!byDay[e.dateKey] || e.e1rm > byDay[e.dateKey].e1rm) {
      byDay[e.dateKey] = e;
    }
  });
  return Object.values(byDay).sort((a, b) => a.ts - b.ts);
}

// ---------- Simple SVG line chart ----------

function renderTrendChart(points, color) {
  if (points.length === 0) {
    return `<div class="chart-empty">No data yet</div>`;
  }
  if (points.length === 1) {
    return `<div class="chart-single">${points[0].y.toFixed(1)} kg<span class="chart-single-date">${formatDateShort(points[0].x)}</span></div>`;
  }

  const width = 320, height = 80, padding = 10;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1;
  const spanY = (maxY - minY) || 1;

  const coords = points.map(p => {
    const px = padding + ((p.x - minX) / spanX) * (width - padding * 2);
    const py = height - padding - ((p.y - minY) / spanY) * (height - padding * 2);
    return [px, py];
  });

  const polyline = coords.map(c => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart" preserveAspectRatio="none">
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="${color}"/>
    </svg>
  `;
}

// ============================================================
// HOME TAB
// ============================================================

async function onHomeTabShown() {
  const root = document.getElementById('home-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const { data, error } = await supabaseClient
      .from('Workout_Session')
      .select('id, title, start_time, end_time, Workout_Set(id)')
      .order('start_time', { ascending: false })
      .limit(5);

    if (error) throw error;

    const sessions = data || [];
    const recent = sessions.slice(0, 3);

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeekCount = sessions.filter(s => new Date(s.start_time).getTime() >= oneWeekAgo).length;

    if (sessions.length === 0) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="num">Nothing logged yet</div>
          <p>Start your first workout and it'll show up here.</p>
        </div>
      `;
      return;
    }

    root.innerHTML = `
      <div class="card" style="margin-top: 12px;">
        <div class="section-label">This week</div>
        <span class="num" style="font-size: 20px;">${thisWeekCount} workout${thisWeekCount === 1 ? '' : 's'}</span>
      </div>

      <div class="section-label" style="margin-top: 20px;">Recent sessions</div>
      ${recent.map(s => `
        <div class="session-card" data-session-id="${s.id}">
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-meta">${formatDateLong(s.start_time)} · ${formatDuration(s.start_time, s.end_time)} · ${(s.Workout_Set || []).length} sets</div>
        </div>
      `).join('')}
    `;

    root.querySelectorAll('.session-card').forEach(card => {
      card.addEventListener('click', () => navigateToSessionDetail(Number(card.dataset.sessionId)));
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}

async function navigateToSessionDetail(sessionId) {
  if (!historyState.loaded) {
    await loadHistory();
  }
  historyState.detailId = sessionId;
  historyState.editMode = false;
  switchTab('view-history');
}

// ============================================================
// HISTORY TAB
// ============================================================

const historyState = { sessions: [], loaded: false, detailId: null, editMode: false };

async function onHistoryTabShown() {
  if (!historyState.loaded) {
    await loadHistory();
  }
  renderHistory();
}

async function loadHistory() {
  const root = document.getElementById('history-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const { data, error } = await supabaseClient
      .from('Workout_Session')
      .select('id, title, start_time, end_time, Workout_Set(id, weight_kg, reps, rpe, set_type, set_index, Workout_Exercise(id, name, is_main_lift))')
      .order('start_time', { ascending: false });

    if (error) throw error;

    historyState.sessions = (data || []).map(s => {
      const exerciseNames = [];
      const seen = new Set();
      (s.Workout_Set || []).forEach(set => {
        const name = set.Workout_Exercise ? set.Workout_Exercise.name : null;
        if (name && !seen.has(name)) {
          seen.add(name);
          exerciseNames.push(name);
        }
      });
      return {
        id: s.id,
        title: s.title,
        start_time: s.start_time,
        end_time: s.end_time,
        sets: s.Workout_Set || [],
        exerciseNames,
        totalSets: (s.Workout_Set || []).length
      };
    });

    historyState.loaded = true;
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load history</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
    throw err;
  }
}

function renderHistory() {
  const root = document.getElementById('history-root');

  if (historyState.detailId) {
    renderHistoryDetail();
    return;
  }

  if (historyState.sessions.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="num">No sessions yet</div>
        <p>Completed workouts will appear here, most recent first.</p>
      </div>
    `;
    return;
  }

  root.innerHTML = historyState.sessions.map(s => `
    <div class="session-card" data-session-id="${s.id}">
      <div class="session-title">${escapeHtml(s.title)}</div>
      <div class="session-meta">${formatDateLong(s.start_time)} · ${formatDuration(s.start_time, s.end_time)} · ${s.totalSets} sets</div>
      <div class="session-exercises">${s.exerciseNames.map(escapeHtml).join(', ')}</div>
    </div>
  `).join('');

  root.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', () => {
      historyState.detailId = Number(card.dataset.sessionId);
      renderHistory();
    });
  });
}

function renderHistoryDetail() {
  const root = document.getElementById('history-root');
  const session = historyState.sessions.find(s => s.id === historyState.detailId);
  if (!session) {
    historyState.detailId = null;
    renderHistory();
    return;
  }

  if (historyState.editMode) {
    renderHistoryDetailEdit(session);
    return;
  }

  // group sets by exercise, preserving first-appearance order
  const order = [];
  const seen = new Set();
  const byExercise = {};
  session.sets
    .slice()
    .sort((a, b) => a.id - b.id)
    .forEach(set => {
      const ex = set.Workout_Exercise;
      const name = ex ? ex.name : 'Unknown exercise';
      if (!seen.has(name)) {
        seen.add(name);
        order.push({ name, is_main_lift: ex ? ex.is_main_lift : false });
      }
      byExercise[name] = byExercise[name] || [];
      byExercise[name].push(set);
    });

  const exerciseBlocks = order.map(({ name, is_main_lift }) => {
    const sets = byExercise[name].sort((a, b) => a.set_index - b.set_index);
    const category = getLiftCategory(name);
    const bestE1rm = sets
      .filter(s => s.set_type !== 'warmup')
      .map(s => calcE1RM(s.weight_kg, s.reps))
      .filter(Boolean)
      .reduce((max, v) => Math.max(max, v), 0);

    const rows = sets.map((s, i) => `
      <div class="detail-set-row">
        <span class="set-num">${i + 1}</span>
        <span>${s.weight_kg ?? '—'} kg</span>
        <span>${s.reps ?? '—'} reps</span>
        <span>${s.rpe ? 'RPE ' + s.rpe : '—'}</span>
        <span class="set-type-tag">${s.set_type !== 'normal' ? s.set_type : ''}</span>
      </div>
    `).join('');

    return `
      <div class="detail-exercise-block">
        <div class="detail-exercise-header">
          <span>${liftDot(category)}${escapeHtml(name)}</span>
          ${bestE1rm ? `<span class="exercise-e1rm">e1RM ${bestE1rm.toFixed(1)} kg</span>` : ''}
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <button class="back-btn" id="history-back-btn" style="padding-bottom:0;">‹ All sessions</button>
      <button class="new-exercise-toggle" id="history-edit-btn">Edit</button>
    </div>
    <div class="detail-header">
      <div class="session-title">${escapeHtml(session.title)}</div>
      <div class="session-meta">${formatDateLong(session.start_time)} · ${formatDuration(session.start_time, session.end_time)}</div>
    </div>
    ${exerciseBlocks}
  `;

  document.getElementById('history-back-btn').addEventListener('click', () => {
    historyState.detailId = null;
    renderHistory();
  });
  document.getElementById('history-edit-btn').addEventListener('click', () => {
    historyState.editMode = true;
    renderHistoryDetail();
  });
}

function renderHistoryDetailEdit(session) {
  const root = document.getElementById('history-root');

  const order = [];
  const seen = new Set();
  const byExercise = {};
  session.sets
    .slice()
    .sort((a, b) => a.id - b.id)
    .forEach(set => {
      const ex = set.Workout_Exercise;
      const name = ex ? ex.name : 'Unknown exercise';
      if (!seen.has(name)) {
        seen.add(name);
        order.push(name);
      }
      byExercise[name] = byExercise[name] || [];
      byExercise[name].push(set);
    });

  const exerciseBlocks = order.map(name => {
    const sets = byExercise[name].sort((a, b) => a.set_index - b.set_index);
    const category = getLiftCategory(name);

    const rows = sets.map((s) => `
      <div class="edit-set-row" data-set-id="${s.id}">
        <input type="number" step="0.5" class="edit-weight" value="${s.weight_kg ?? ''}">
        <input type="number" step="1" class="edit-reps" value="${s.reps ?? ''}">
        <input type="number" step="0.5" class="edit-rpe" value="${s.rpe ?? ''}">
        <select class="edit-type">
          <option value="normal" ${s.set_type === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="warmup" ${s.set_type === 'warmup' ? 'selected' : ''}>Warmup</option>
          <option value="failure" ${s.set_type === 'failure' ? 'selected' : ''}>Failure</option>
          <option value="drop" ${s.set_type === 'drop' ? 'selected' : ''}>Drop</option>
        </select>
        <button class="edit-save-btn" data-set-id="${s.id}" title="Save">✓</button>
        <button class="edit-delete-btn" data-set-id="${s.id}" title="Delete">×</button>
      </div>
    `).join('');

    return `
      <div class="detail-exercise-block">
        <div class="detail-exercise-header">
          <span>${liftDot(category)}${escapeHtml(name)}</span>
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <button class="back-btn" id="history-back-btn" style="padding-bottom:0;">‹ All sessions</button>
      <button class="new-exercise-toggle" id="history-done-btn">Done</button>
    </div>

    <div class="field" style="margin-top: 12px;">
      <label>Title</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="edit-session-title" value="${escapeHtml(session.title)}">
        <button class="rest-timer-btn" id="edit-title-save-btn">Save</button>
      </div>
    </div>

    <div id="history-edit-message"></div>

    ${exerciseBlocks}

    <button class="btn-secondary finish-btn" id="delete-session-btn" style="border-color: var(--danger); color: var(--danger);">Delete this workout</button>
  `;

  document.getElementById('history-back-btn').addEventListener('click', () => {
    historyState.detailId = null;
    historyState.editMode = false;
    renderHistory();
  });
  document.getElementById('history-done-btn').addEventListener('click', () => {
    historyState.editMode = false;
    renderHistoryDetail();
  });
  document.getElementById('edit-title-save-btn').addEventListener('click', () => saveSessionTitle(session.id));

  root.querySelectorAll('.edit-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveSetEdit(Number(btn.dataset.setId)));
  });
  root.querySelectorAll('.edit-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSet(Number(btn.dataset.setId)));
  });
  document.getElementById('delete-session-btn').addEventListener('click', () => deleteSession(session.id));
}

async function saveSessionTitle(sessionId) {
  const input = document.getElementById('edit-session-title');
  const msgEl = document.getElementById('history-edit-message');
  const newTitle = input.value.trim();
  if (!newTitle) return;

  try {
    const { error } = await supabaseClient.from('Workout_Session').update({ title: newTitle }).eq('id', sessionId);
    if (error) throw error;
    const session = historyState.sessions.find(s => s.id === sessionId);
    if (session) session.title = newTitle;
    msgEl.innerHTML = `<div class="inline-message success">Title saved.</div>`;
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function saveSetEdit(setId) {
  const row = document.querySelector(`.edit-set-row[data-set-id="${setId}"]`);
  const msgEl = document.getElementById('history-edit-message');

  const weight = parseFloat(row.querySelector('.edit-weight').value);
  const reps = parseInt(row.querySelector('.edit-reps').value, 10);
  const rpeVal = row.querySelector('.edit-rpe').value;
  const setType = row.querySelector('.edit-type').value;

  try {
    const { error } = await supabaseClient
      .from('Workout_Set')
      .update({
        weight_kg: weight || null,
        reps: reps || null,
        rpe: rpeVal ? parseFloat(rpeVal) : null,
        set_type: setType
      })
      .eq('id', setId);
    if (error) throw error;

    invalidateMainLiftCache();
    historyState.loaded = false;
    msgEl.innerHTML = `<div class="inline-message success">Set saved.</div>`;
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function deleteSet(setId) {
  if (!confirm('Delete this set?')) return;
  const msgEl = document.getElementById('history-edit-message');

  try {
    const { error } = await supabaseClient.from('Workout_Set').delete().eq('id', setId);
    if (error) throw error;

    invalidateMainLiftCache();
    await loadHistory();
    renderHistory();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't delete: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this entire workout? This removes every set logged in it and cannot be undone.')) return;

  try {
    const { error } = await supabaseClient.from('Workout_Session').delete().eq('id', sessionId);
    if (error) throw error;

    invalidateMainLiftCache();
    historyState.detailId = null;
    historyState.editMode = false;
    await loadHistory();
    renderHistory();
  } catch (err) {
    console.error(err);
    const msgEl = document.getElementById('history-edit-message');
    if (msgEl) msgEl.innerHTML = `<div class="inline-message error">Couldn't delete: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

// ============================================================
// PROGRESS TAB
// ============================================================

const LIFT_COLOR_VARS = { squat: '#C8102E', bench: '#2E5EAA', deadlift: '#E8B923', ohp: '#3C8A54' };

async function onProgressTabShown() {
  const root = document.getElementById('progress-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const [mainLiftData, bodyweightData] = await Promise.all([
      fetchMainLiftData(),
      fetchBodyweightData()
    ]);
    renderProgress(mainLiftData, bodyweightData);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load progress</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}

async function fetchBodyweightData() {
  const { data, error } = await supabaseClient
    .from('Workout_Bodyweight')
    .select('id, date, weight_kg')
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

function renderProgress(mainLiftData, bodyweightData) {
  const root = document.getElementById('progress-root');

  const liftCards = LIFT_ORDER.map(category => {
    const points = bestPerDate(mainLiftData[category]).map(e => ({ x: e.ts, y: e.e1rm }));
    const current = points.length ? points[points.length - 1].y : null;
    return `
      <div class="lift-progress-card">
        <div class="lift-progress-header">
          <span class="lift-name">${liftDot(category)}${LIFT_LABELS[category]}</span>
          ${current ? `<span class="lift-progress-header lift-current">${current.toFixed(1)} kg</span>` : ''}
        </div>
        <div class="chart-container">${renderTrendChart(points, LIFT_COLOR_VARS[category])}</div>
      </div>
    `;
  }).join('');

  const bwPoints = bodyweightData.map(b => ({ x: new Date(b.date).getTime(), y: b.weight_kg }));

  root.innerHTML = `
    <div class="section-label">e1RM trends</div>
    ${liftCards}

    <div class="section-label" style="margin-top: 20px;">Bodyweight</div>
    <div class="bodyweight-form">
      <div class="field">
        <label>Date</label>
        <input type="text" id="bw-date-input" value="${new Date().toISOString().slice(0, 10)}">
      </div>
      <div class="field">
        <label>Weight (kg)</label>
        <input type="number" step="0.1" id="bw-weight-input">
      </div>
      <button id="bw-add-btn">Add</button>
    </div>
    <div id="bw-message"></div>
    <div class="lift-progress-card">
      <div class="chart-container">${renderTrendChart(bwPoints, '#ECEAE4')}</div>
    </div>
  `;

  document.getElementById('bw-add-btn').addEventListener('click', addBodyweightEntry);
}

async function addBodyweightEntry() {
  const dateInput = document.getElementById('bw-date-input');
  const weightInput = document.getElementById('bw-weight-input');
  const msgEl = document.getElementById('bw-message');

  const date = dateInput.value;
  const weight = parseFloat(weightInput.value);

  if (!date || !weight) {
    msgEl.innerHTML = `<div class="inline-message error">Enter both a date and a weight.</div>`;
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('Workout_Bodyweight')
      .insert({ date, weight_kg: weight });
    if (error) throw error;

    onProgressTabShown();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

// ============================================================
// BEST LIFTS TAB
// ============================================================

async function onBestTabShown() {
  const root = document.getElementById('best-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const mainLiftData = await fetchMainLiftData();
    renderBestLifts(mainLiftData);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load PRs</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}

function renderBestLifts(mainLiftData) {
  const root = document.getElementById('best-root');

  root.innerHTML = LIFT_ORDER.map(category => {
    const entries = mainLiftData[category];
    if (!entries || entries.length === 0) {
      return `
        <div class="pr-card empty">
          <span class="pr-label">${liftDot(category)}${LIFT_LABELS[category]}</span>
          <span class="pr-value"><span class="pr-e1rm">No data yet</span></span>
        </div>
      `;
    }

    const best = entries.reduce((max, e) => (e.e1rm > max.e1rm ? e : max), entries[0]);

    return `
      <div class="pr-card">
        <div>
          <span class="pr-label">${liftDot(category)}${LIFT_LABELS[category]}</span>
          <div class="pr-sub">${best.weight_kg} kg × ${best.reps} · ${formatDateShort(best.ts)}</div>
        </div>
        <div class="pr-value">
          <div class="pr-e1rm">${best.e1rm.toFixed(1)}</div>
          <div class="pr-unit">kg e1RM</div>
        </div>
      </div>
    `;
  }).join('');
}

// Home is the default active tab on page load — populate it immediately
onHomeTabShown();
