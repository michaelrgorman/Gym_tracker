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

const historyState = { sessions: [], loaded: false, detailId: null, editMode: false, searchQuery: '', exerciseFilter: '', addingExerciseToSession: false };

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
      .select('id, title, start_time, end_time, notes, Workout_Set(id, weight_kg, reps, rpe, set_type, set_index, notes, superset_id, Workout_Exercise(id, name, is_main_lift))')
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
        notes: s.notes,
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

  const allExercises = [...new Set(historyState.sessions.flatMap(s => s.exerciseNames))].sort((a, b) => a.localeCompare(b));

  const q = historyState.searchQuery.toLowerCase().trim();
  const filtered = historyState.sessions.filter(s => {
    const matchesQuery = !q || s.title.toLowerCase().includes(q) || s.exerciseNames.some(n => n.toLowerCase().includes(q));
    const matchesExercise = !historyState.exerciseFilter || s.exerciseNames.includes(historyState.exerciseFilter);
    return matchesQuery && matchesExercise;
  });

  const listHtml = filtered.length
    ? filtered.map(s => `
        <div class="session-card" data-session-id="${s.id}">
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-meta">${formatDateLong(s.start_time)} · ${formatDuration(s.start_time, s.end_time)} · ${s.totalSets} sets</div>
          <div class="session-exercises">${s.exerciseNames.map(escapeHtml).join(', ')}</div>
        </div>
      `).join('')
    : `<div class="inline-message">No sessions match.</div>`;

  root.innerHTML = `
    <div class="field-row" style="margin-bottom: 12px;">
      <div class="field">
        <input type="text" id="history-search-input" placeholder="Search title or exercise…" value="${escapeHtml(historyState.searchQuery)}">
      </div>
      <div class="field" style="flex: none; width: 130px;">
        <select id="history-exercise-filter">
          <option value="">All exercises</option>
          ${allExercises.map(name => `<option value="${escapeHtml(name)}" ${historyState.exerciseFilter === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${listHtml}
  `;

  document.getElementById('history-search-input').addEventListener('input', (e) => {
    historyState.searchQuery = e.target.value;
    renderHistory();
    const input = document.getElementById('history-search-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.getElementById('history-exercise-filter').addEventListener('change', (e) => {
    historyState.exerciseFilter = e.target.value;
    renderHistory();
  });

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
    const supersetGroup = sets.find(s => s.superset_id)?.superset_id;
    const exerciseNote = sets.find(s => s.notes)?.notes;

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
          <span>${liftDot(category)}${escapeHtml(name)}${supersetGroup ? ` <span class="superset-badge">Superset ${escapeHtml(supersetGroup)}</span>` : ''}</span>
          ${bestE1rm ? `<span class="exercise-e1rm">e1RM ${bestE1rm.toFixed(1)} kg</span>` : ''}
        </div>
        ${exerciseNote ? `<div class="exercise-previous" style="padding-top:8px;">${escapeHtml(exerciseNote)}</div>` : ''}
        ${rows}
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <button class="back-btn" id="history-back-btn" style="margin-bottom:0;">‹ All sessions</button>
      <button class="new-exercise-toggle" id="history-edit-btn">Edit</button>
    </div>
    <div class="detail-header">
      <div class="session-title">${escapeHtml(session.title)}</div>
      <div class="session-meta">${formatDateLong(session.start_time)} · ${formatDuration(session.start_time, session.end_time)}</div>
      ${session.notes ? `<div class="exercise-previous" style="padding-top:8px; padding-left:0;">${escapeHtml(session.notes)}</div>` : ''}
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
  const exerciseIdByName = {};
  session.sets
    .slice()
    .sort((a, b) => a.id - b.id)
    .forEach(set => {
      const ex = set.Workout_Exercise;
      const name = ex ? ex.name : 'Unknown exercise';
      if (!seen.has(name)) {
        seen.add(name);
        order.push(name);
        exerciseIdByName[name] = ex ? ex.id : null;
      }
      byExercise[name] = byExercise[name] || [];
      byExercise[name].push(set);
    });

  const exerciseBlocks = order.map(name => {
    const sets = byExercise[name].sort((a, b) => a.set_index - b.set_index);
    const category = getLiftCategory(name);
    const exerciseId = exerciseIdByName[name];
    const nextSetIndex = sets.length ? Math.max(...sets.map(s => s.set_index)) + 1 : 1;

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
        <div class="add-set-form" data-exercise-id="${exerciseId}" data-session-id="${session.id}" data-next-index="${nextSetIndex}">
          <div class="field"><label>Weight</label><input type="number" step="0.5" class="hist-new-weight"></div>
          <div class="field"><label>Reps</label><input type="number" step="1" class="hist-new-reps"></div>
          <div class="field"><label>RPE</label><input type="number" step="0.5" class="hist-new-rpe"></div>
          <div class="field">
            <label>Type</label>
            <select class="hist-new-type">
              <option value="normal">Normal</option>
              <option value="warmup">Warmup</option>
              <option value="failure">Failure</option>
              <option value="drop">Drop</option>
            </select>
          </div>
          <button class="add-set-btn hist-add-set-btn">+ Add set</button>
        </div>
      </div>
    `;
  }).join('');

  const addExerciseSection = historyState.addingExerciseToSession ? `
    <div class="add-exercise-section" style="margin-top:12px;">
      <div class="section-label">Add exercise</div>
      <input type="text" id="hist-exercise-search-input" placeholder="Search exercises…">
      <div class="exercise-search-results" id="hist-exercise-search-results"></div>
    </div>
  ` : `<button class="new-exercise-toggle" id="hist-add-exercise-toggle" style="margin-top:12px;">+ Add exercise</button>`;

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <button class="back-btn" id="history-back-btn" style="margin-bottom:0;">‹ All sessions</button>
      <button class="new-exercise-toggle" id="history-done-btn">Done</button>
    </div>

    <div class="field" style="margin-top: 12px;">
      <label>Title</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="edit-session-title" value="${escapeHtml(session.title)}">
        <button class="rest-timer-btn" id="edit-title-save-btn">Save</button>
      </div>
    </div>

    <div class="field">
      <label>Session notes</label>
      <div style="display:flex; gap:8px; align-items:flex-start;">
        <textarea id="edit-session-notes" rows="2">${escapeHtml(session.notes || '')}</textarea>
        <button class="rest-timer-btn" id="edit-notes-save-btn">Save</button>
      </div>
    </div>

    <div id="history-edit-message"></div>

    ${exerciseBlocks}

    ${addExerciseSection}

    <button class="btn-secondary finish-btn" id="delete-session-btn" style="border-color: var(--danger); color: var(--danger); margin-top:16px;">Delete this workout</button>
  `;

  document.getElementById('history-back-btn').addEventListener('click', () => {
    historyState.detailId = null;
    historyState.editMode = false;
    historyState.addingExerciseToSession = false;
    renderHistory();
  });
  document.getElementById('history-done-btn').addEventListener('click', () => {
    historyState.editMode = false;
    historyState.addingExerciseToSession = false;
    renderHistoryDetail();
  });
  document.getElementById('edit-title-save-btn').addEventListener('click', () => saveSessionTitle(session.id));
  document.getElementById('edit-notes-save-btn').addEventListener('click', () => saveSessionNotes(session.id));

  root.querySelectorAll('.edit-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveSetEdit(Number(btn.dataset.setId)));
  });
  root.querySelectorAll('.edit-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSet(Number(btn.dataset.setId)));
  });
  document.getElementById('delete-session-btn').addEventListener('click', () => deleteSession(session.id));

  root.querySelectorAll('.hist-add-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = btn.closest('.add-set-form');
      addSetToHistorySession(
        Number(form.dataset.sessionId),
        Number(form.dataset.exerciseId),
        Number(form.dataset.nextIndex),
        form
      );
    });
  });

  const addExerciseToggle = document.getElementById('hist-add-exercise-toggle');
  if (addExerciseToggle) {
    addExerciseToggle.addEventListener('click', async () => {
      if (!logState.exerciseCatalog.length) {
        await loadTemplatesAndCatalog();
      }
      historyState.addingExerciseToSession = true;
      renderHistoryDetailEdit(session);
    });
  }

  const histSearchInput = document.getElementById('hist-exercise-search-input');
  if (histSearchInput) {
    histSearchInput.addEventListener('input', () => renderHistExerciseSearchResults(session, histSearchInput.value));
    renderHistExerciseSearchResults(session, '');
  }
}

function renderHistExerciseSearchResults(session, query) {
  const resultsEl = document.getElementById('hist-exercise-search-results');
  if (!resultsEl) return;
  const q = (query || '').toLowerCase().trim();
  const filtered = logState.exerciseCatalog.filter(e => !q || e.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    resultsEl.innerHTML = `<div class="inline-message">No exercises match "${escapeHtml(query)}".</div>`;
    return;
  }

  const groups = groupExercises(filtered);
  const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  resultsEl.innerHTML = sortedGroupNames.map(groupName => {
    const items = groups[groupName]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => {
        const category = getLiftCategory(e.name);
        return `<div class="exercise-search-item" data-exercise-id="${e.id}">${liftDot(category)}${escapeHtml(e.name)}</div>`;
      }).join('');
    return `<div class="exercise-group"><div class="exercise-group-label">${escapeHtml(groupName)}</div>${items}</div>`;
  }).join('');

  resultsEl.querySelectorAll('.exercise-search-item').forEach(item => {
    item.addEventListener('click', async () => {
      const exercise = logState.exerciseCatalog.find(e => e.id === Number(item.dataset.exerciseId));
      await addExerciseWithFirstSetToHistorySession(session, exercise);
    });
  });
}

async function addSetToHistorySession(sessionId, exerciseId, setIndex, formEl) {
  const weight = parseFloat(formEl.querySelector('.hist-new-weight').value);
  const reps = parseInt(formEl.querySelector('.hist-new-reps').value, 10);
  const rpeVal = formEl.querySelector('.hist-new-rpe').value;
  const setType = formEl.querySelector('.hist-new-type').value;
  const msgEl = document.getElementById('history-edit-message');

  if (!weight || !reps) {
    msgEl.innerHTML = `<div class="inline-message error">Enter both weight and reps.</div>`;
    return;
  }

  try {
    const { error } = await supabaseClient.from('Workout_Set').insert({
      session_id: sessionId,
      exercise_id: exerciseId,
      set_index: setIndex,
      set_type: setType,
      weight_kg: weight,
      reps: reps,
      rpe: rpeVal ? parseFloat(rpeVal) : null
    });
    if (error) throw error;

    invalidateMainLiftCache();
    await loadHistory();
    historyState.editMode = true;
    renderHistoryDetail();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't add set: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function addExerciseWithFirstSetToHistorySession(session, exercise) {
  const weight = prompt(`Weight (kg) for ${exercise.name}?`);
  if (weight === null) return;
  const reps = prompt(`Reps for ${exercise.name}?`);
  if (reps === null) return;

  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  if (!w || !r) {
    alert('Enter both a weight and reps to add this exercise.');
    return;
  }

  try {
    const { error } = await supabaseClient.from('Workout_Set').insert({
      session_id: session.id,
      exercise_id: exercise.id,
      set_index: 1,
      set_type: 'normal',
      weight_kg: w,
      reps: r
    });
    if (error) throw error;

    invalidateMainLiftCache();
    historyState.addingExerciseToSession = false;
    await loadHistory();
    historyState.editMode = true;
    renderHistoryDetail();
  } catch (err) {
    console.error(err);
    alert("Couldn't add exercise: " + (err.message || 'unknown error'));
  }
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

async function saveSessionNotes(sessionId) {
  const input = document.getElementById('edit-session-notes');
  const msgEl = document.getElementById('history-edit-message');
  const newNotes = input.value.trim();

  try {
    const { error } = await supabaseClient.from('Workout_Session').update({ notes: newNotes || null }).eq('id', sessionId);
    if (error) throw error;
    const session = historyState.sessions.find(s => s.id === sessionId);
    if (session) session.notes = newNotes;
    msgEl.innerHTML = `<div class="inline-message success">Notes saved.</div>`;
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
    const [mainLiftData, bodyweightData, volumeSets, sessionTimestamps] = await Promise.all([
      fetchMainLiftData(),
      fetchBodyweightData(),
      fetchVolumeData(),
      fetchSessionTimestamps()
    ]);
    renderProgress(mainLiftData, bodyweightData, volumeSets, sessionTimestamps);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load progress</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}

async function fetchVolumeData() {
  const { data, error } = await supabaseClient
    .from('Workout_Set')
    .select('weight_kg, reps, set_type, Workout_Session!inner(start_time)')
    .neq('set_type', 'warmup');
  if (error) throw error;
  return data || [];
}

async function fetchSessionTimestamps() {
  const { data, error } = await supabaseClient
    .from('Workout_Session')
    .select('start_time')
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []).map(s => new Date(s.start_time).getTime());
}

function getWeekStartTs(ts) {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function bucketByWeek(items, numWeeks, getTs, getValue) {
  const byWeek = {};
  items.forEach(item => {
    const weekStart = getWeekStartTs(getTs(item));
    byWeek[weekStart] = (byWeek[weekStart] || 0) + getValue(item);
  });
  const weekKeys = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  return weekKeys.slice(-numWeeks).map(ts => ({ x: ts, y: byWeek[ts] }));
}

function buildTotalSeries(mainLiftData) {
  const cats = ['squat', 'bench', 'deadlift'];
  const seriesPerCat = {};
  cats.forEach(c => { seriesPerCat[c] = bestPerDate(mainLiftData[c]); });

  const allDates = [...new Set(cats.flatMap(c => seriesPerCat[c].map(e => e.ts)))].sort((a, b) => a - b);

  const idx = { squat: 0, bench: 0, deadlift: 0 };
  const current = { squat: 0, bench: 0, deadlift: 0 };
  const points = [];

  allDates.forEach(ts => {
    cats.forEach(c => {
      while (idx[c] < seriesPerCat[c].length && seriesPerCat[c][idx[c]].ts <= ts) {
        current[c] = seriesPerCat[c][idx[c]].e1rm;
        idx[c]++;
      }
    });
    if (current.squat && current.bench && current.deadlift) {
      points.push({ x: ts, y: current.squat + current.bench + current.deadlift });
    }
  });

  return points;
}

function renderBarChart(points, color, formatValue) {
  if (points.length === 0) {
    return `<div class="chart-empty">No data yet</div>`;
  }

  const width = 320, height = 90, padding = 10;
  const maxY = Math.max(...points.map(p => p.y), 1);
  const gap = (width - padding * 2) / points.length;
  const barWidth = gap * 0.6;

  const bars = points.map((p, i) => {
    const barHeight = Math.max(2, (p.y / maxY) * (height - padding * 2));
    const x = padding + i * gap + (gap - barWidth) / 2;
    const y = height - padding - barHeight;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${color}" />`;
  }).join('');

  const lastVal = points[points.length - 1].y;
  const label = formatValue ? formatValue(lastVal) : lastVal;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart" preserveAspectRatio="none">${bars}</svg>
    <div class="chart-single-date" style="text-align:right;">This week: ${label}</div>
  `;
}

async function fetchBodyweightData() {
  const { data, error } = await supabaseClient
    .from('Workout_Bodyweight')
    .select('id, date, weight_kg')
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

function renderProgress(mainLiftData, bodyweightData, volumeSets, sessionTimestamps) {
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

  // ---- Insights: Total, weekly volume, consistency ----
  const totalPoints = buildTotalSeries(mainLiftData);
  const totalNow = totalPoints.length ? totalPoints[totalPoints.length - 1].y : null;

  const volumePoints = bucketByWeek(
    volumeSets, 8,
    v => new Date(v.Workout_Session.start_time).getTime(),
    v => (v.weight_kg || 0) * (v.reps || 0)
  );

  const frequencyPoints = bucketByWeek(
    sessionTimestamps, 8,
    ts => ts,
    () => 1
  );

  const totalSessions = sessionTimestamps.length;
  const lastSessionTs = sessionTimestamps.length ? sessionTimestamps[sessionTimestamps.length - 1] : null;
  const daysSinceLast = lastSessionTs !== null ? Math.floor((Date.now() - lastSessionTs) / 86400000) : null;
  const eightWeeksAgo = Date.now() - 8 * 7 * 86400000;
  const recentSessionCount = sessionTimestamps.filter(ts => ts >= eightWeeksAgo).length;
  const avgPerWeek = (recentSessionCount / 8);

  const insightsHtml = `
    <div class="section-label" style="margin-top: 20px;">Insights</div>

    <div class="lift-progress-card">
      <div class="lift-progress-header">
        <span class="lift-name">Total (S+B+D)</span>
        ${totalNow ? `<span class="lift-progress-header lift-current">${totalNow.toFixed(1)} kg</span>` : ''}
      </div>
      <div class="chart-container">
        ${totalPoints.length ? renderTrendChart(totalPoints, '#ECEAE4') : '<div class="chart-empty">Need e1RM data for Squat, Bench, and Deadlift</div>'}
      </div>
    </div>

    <div class="lift-progress-card">
      <div class="lift-progress-header"><span class="lift-name">Weekly volume</span></div>
      <div class="chart-container">${renderBarChart(volumePoints, '#2E5EAA', v => Math.round(v).toLocaleString() + ' kg')}</div>
    </div>

    <div class="lift-progress-card">
      <div class="lift-progress-header"><span class="lift-name">Consistency</span></div>
      <div class="chart-container">
        <div style="display:flex; justify-content:space-between; margin-bottom:12px; text-align:center;">
          <div><div class="num" style="font-size:20px;">${daysSinceLast === null ? '—' : daysSinceLast === 0 ? 'Today' : daysSinceLast}</div><div class="rep-pr-label">days since last</div></div>
          <div><div class="num" style="font-size:20px;">${totalSessions}</div><div class="rep-pr-label">total sessions</div></div>
          <div><div class="num" style="font-size:20px;">${avgPerWeek.toFixed(1)}</div><div class="rep-pr-label">avg/week (8wk)</div></div>
        </div>
        ${renderBarChart(frequencyPoints, '#3C8A54', v => v + (v === 1 ? ' session' : ' sessions'))}
      </div>
    </div>
  `;

  const bwSorted = bodyweightData.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const bwPoints = bodyweightData.map(b => ({ x: new Date(b.date).getTime(), y: b.weight_kg }));

  const bwListHtml = bwSorted.map(b => `
    <div class="edit-set-row" style="grid-template-columns: 1fr 1fr 30px 30px;" data-bw-id="${b.id}">
      <input type="text" class="bw-edit-date" value="${b.date}">
      <input type="number" step="0.1" class="bw-edit-weight" value="${b.weight_kg}">
      <button class="edit-save-btn bw-save-btn" data-bw-id="${b.id}">✓</button>
      <button class="edit-delete-btn bw-delete-btn" data-bw-id="${b.id}">×</button>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="section-label">e1RM trends</div>
    ${liftCards}

    ${insightsHtml}

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

    ${bwSorted.length ? `<div class="detail-exercise-block" style="margin-top: 10px;">${bwListHtml}</div>` : ''}
  `;

  document.getElementById('bw-add-btn').addEventListener('click', addBodyweightEntry);
  root.querySelectorAll('.bw-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveBodyweightEdit(Number(btn.dataset.bwId)));
  });
  root.querySelectorAll('.bw-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBodyweightEntry(Number(btn.dataset.bwId)));
  });
}

async function saveBodyweightEdit(id) {
  const row = document.querySelector(`[data-bw-id="${id}"]`);
  const msgEl = document.getElementById('bw-message');
  const date = row.querySelector('.bw-edit-date').value;
  const weight = parseFloat(row.querySelector('.bw-edit-weight').value);

  if (!date || !weight) {
    msgEl.innerHTML = `<div class="inline-message error">Enter both a date and a weight.</div>`;
    return;
  }

  try {
    const { error } = await supabaseClient.from('Workout_Bodyweight').update({ date, weight_kg: weight }).eq('id', id);
    if (error) throw error;
    onProgressTabShown();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function deleteBodyweightEntry(id) {
  if (!confirm('Delete this bodyweight entry?')) return;
  const msgEl = document.getElementById('bw-message');

  try {
    const { error } = await supabaseClient.from('Workout_Bodyweight').delete().eq('id', id);
    if (error) throw error;
    onProgressTabShown();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't delete: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
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
    const [mainLiftData, goals] = await Promise.all([fetchMainLiftData(), fetchGoals()]);
    renderBestLifts(mainLiftData, goals);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load PRs</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}

async function fetchGoals() {
  const { data, error } = await supabaseClient.from('Workout_Goal').select('*');
  if (error) throw error;
  const byCategory = {};
  (data || []).forEach(g => { byCategory[g.lift_category] = g; });
  return byCategory;
}

function bestWeightAtReps(entries, reps) {
  const matches = entries.filter(e => e.reps === reps);
  if (matches.length === 0) return null;
  return matches.reduce((max, e) => (e.weight_kg > max.weight_kg ? e : max), matches[0]);
}

function renderBestLifts(mainLiftData, goals) {
  const root = document.getElementById('best-root');

  root.innerHTML = LIFT_ORDER.map(category => {
    const entries = mainLiftData[category];
    const goal = goals && goals[category];

    if (!entries || entries.length === 0) {
      return `
        <div class="pr-card empty">
          <span class="pr-label">${liftDot(category)}${LIFT_LABELS[category]}</span>
          <span class="pr-value"><span class="pr-e1rm">No data yet</span></span>
        </div>
        ${renderGoalSection(category, null, goal)}
      `;
    }

    const best = entries.reduce((max, e) => (e.e1rm > max.e1rm ? e : max), entries[0]);

    const repPrs = [1, 3, 5].map(r => {
      const m = bestWeightAtReps(entries, r);
      return `<span class="rep-pr"><span class="rep-pr-label">${r}RM</span> ${m ? m.weight_kg + ' kg' : '—'}</span>`;
    }).join('');

    return `
      <div class="pr-card">
        <div>
          <span class="pr-label">${liftDot(category)}${LIFT_LABELS[category]}</span>
          <div class="pr-sub">${best.weight_kg} kg × ${best.reps} · ${formatDateShort(best.ts)}</div>
          <div class="rep-pr-row">${repPrs}</div>
        </div>
        <div class="pr-value">
          <div class="pr-e1rm">${best.e1rm.toFixed(1)}</div>
          <div class="pr-unit">kg e1RM</div>
        </div>
      </div>
      ${renderGoalSection(category, best.e1rm, goal)}
    `;
  }).join('');

  root.querySelectorAll('.goal-set-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(`goal-form-${btn.dataset.category}`);
      el.hidden = !el.hidden;
    });
  });
  root.querySelectorAll('.goal-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveGoal(btn.dataset.category));
  });
  root.querySelectorAll('.goal-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteGoal(btn.dataset.category));
  });
}

function renderGoalSection(category, currentE1rm, goal) {
  if (!goal) {
    return `
      <div class="goal-section">
        <button class="new-exercise-toggle goal-set-toggle" data-category="${category}">+ Set a goal</button>
        <div class="goal-form" id="goal-form-${category}" hidden>
          <input type="number" step="0.5" class="goal-weight-input" data-category="${category}" placeholder="Target kg">
          <button class="rest-timer-btn goal-save-btn" data-category="${category}">Save</button>
        </div>
      </div>
    `;
  }

  const pct = currentE1rm ? Math.min(100, (currentE1rm / goal.target_weight_kg) * 100) : 0;
  const remaining = currentE1rm ? Math.max(0, goal.target_weight_kg - currentE1rm) : goal.target_weight_kg;

  return `
    <div class="goal-section">
      <div class="goal-bar-track"><div class="goal-bar-fill" style="width:${pct.toFixed(1)}%; background:${LIFT_COLOR_VARS[category]};"></div></div>
      <div class="goal-text">
        Goal: ${goal.target_weight_kg} kg e1RM
        ${currentE1rm ? `· ${remaining > 0 ? remaining.toFixed(1) + ' kg to go' : 'Goal reached 🎉'}` : ''}
      </div>
      <div style="display:flex; gap:8px; margin-top:6px;">
        <button class="new-exercise-toggle goal-set-toggle" data-category="${category}">Edit</button>
        <button class="new-exercise-toggle goal-delete-btn" data-category="${category}">Remove</button>
      </div>
      <div class="goal-form" id="goal-form-${category}" hidden>
        <input type="number" step="0.5" class="goal-weight-input" data-category="${category}" value="${goal.target_weight_kg}">
        <button class="rest-timer-btn goal-save-btn" data-category="${category}">Save</button>
      </div>
    </div>
  `;
}

async function saveGoal(category) {
  const input = document.querySelector(`.goal-weight-input[data-category="${category}"]`);
  const weight = parseFloat(input.value);
  if (!weight) return;

  try {
    const { error } = await supabaseClient
      .from('Workout_Goal')
      .upsert({ lift_category: category, target_weight_kg: weight, updated_at: new Date().toISOString() }, { onConflict: 'lift_category' });
    if (error) throw error;
    onBestTabShown();
  } catch (err) {
    console.error(err);
    alert("Couldn't save goal: " + (err.message || 'unknown error'));
  }
}

async function deleteGoal(category) {
  if (!confirm('Remove this goal?')) return;
  try {
    const { error } = await supabaseClient.from('Workout_Goal').delete().eq('lift_category', category);
    if (error) throw error;
    onBestTabShown();
  } catch (err) {
    console.error(err);
    alert("Couldn't remove goal: " + (err.message || 'unknown error'));
  }
}

// Home is the default active tab on page load — populate it immediately
onHomeTabShown();
