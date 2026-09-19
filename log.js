// ============================================================
// Log tab — start screen, active workout, set logging, rest timer
// ============================================================

const logState = {
  session: null,        // { title, start_time, template_id, exercises: [...] }
  templates: [],         // [{ id, name, exercises: [{exercise_id, name, target_sets, target_reps}] }]
  exerciseCatalog: [],   // [{ id, name, equipment, muscle_group, is_main_lift }]
  loaded: false,
  elapsedInterval: null,
  pendingSupersetIndex: null,
  activeProgram: null,
  programLoaded: false
};

// ---------- Persist the in-progress workout across app close/reopen ----------

const ACTIVE_SESSION_STORAGE_KEY = 'iron-log-active-session';

function saveSessionToStorage() {
  try {
    if (logState.session) {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(logState.session));
    }
  } catch (err) {
    console.error('Failed to save in-progress workout:', err);
  }
}

function clearSessionStorage() {
  try {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear saved workout:', err);
  }
}

function restoreSessionFromStorage() {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Date objects don't survive JSON round-trips — rehydrate them
    (session.exercises || []).forEach(ex => {
      if (ex.previous && ex.previous.date) {
        ex.previous.date = new Date(ex.previous.date);
      }
    });
    return session;
  } catch (err) {
    console.error('Failed to restore in-progress workout:', err);
    return null;
  }
}

// Restore any in-progress workout immediately so it's ready the moment
// the Log tab is opened, even after the app was fully closed
logState.session = restoreSessionFromStorage();

// ---------- Helpers ----------

function calcE1RM(weightKg, reps) {
  if (!weightKg || !reps) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

async function fetchPreviousSetsForExercise(exerciseId) {
  try {
    const { data, error } = await supabaseClient
      .from('Workout_Set')
      .select('weight_kg, reps, set_type, set_index, Workout_Session!inner(start_time)')
      .eq('exercise_id', exerciseId);

    if (error) throw error;
    if (!data || data.length === 0) return null;

    let maxTs = 0;
    data.forEach(r => {
      const ts = new Date(r.Workout_Session.start_time).getTime();
      if (ts > maxTs) maxTs = ts;
    });

    const lastSets = data
      .filter(r => new Date(r.Workout_Session.start_time).getTime() === maxTs)
      .sort((a, b) => a.set_index - b.set_index);

    return { date: new Date(maxTs), sets: lastSets };
  } catch (err) {
    console.error(err);
    return null;
  }
}

function getLiftCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('squat')) return 'squat';
  if (n.includes('deadlift')) return 'deadlift';
  if (n.includes('bench')) return 'bench';
  if (n.includes('overhead press') || n.includes('ohp') || n.includes('military press') || n.includes('shoulder press')) return 'ohp';
  return null;
}

function liftDot(category) {
  if (!category) return '';
  return `<span class="lift-dot ${category}" title="${category}"></span>`;
}

function formatElapsed(startIso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDateShort(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Entry point (called by app.js when Log tab is shown) ----------

async function onLogTabShown() {
  if (logState.session) {
    renderActiveWorkout();
    return;
  }
  if (!logState.loaded) {
    await loadTemplatesAndCatalog();
  }
  if (!logState.programLoaded) {
    try {
      logState.activeProgram = await loadActiveProgramState();
    } catch (err) {
      console.error(err);
      logState.activeProgram = null;
    }
    logState.programLoaded = true;
  }
  renderStartScreen();
}

async function loadTemplatesAndCatalog() {
  const root = document.getElementById('log-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const { data: exercises, error: exError } = await supabaseClient
      .from('Workout_Exercise')
      .select('id, name, equipment, muscle_group, is_main_lift')
      .order('name');
    if (exError) throw exError;
    logState.exerciseCatalog = exercises || [];

    const { data: templates, error: tError } = await supabaseClient
      .from('Workout_Template')
      .select('id, name, notes, Workout_TemplateExercise(exercise_id, order_index, target_sets, target_reps, Workout_Exercise(id, name, is_main_lift))')
      .order('name');
    if (tError) throw tError;

    logState.templates = (templates || []).map(t => ({
      id: t.id,
      name: t.name,
      exercises: (t.Workout_TemplateExercise || [])
        .sort((a, b) => a.order_index - b.order_index)
        .map(te => ({
          exercise_id: te.exercise_id,
          name: te.Workout_Exercise ? te.Workout_Exercise.name : 'Unknown exercise',
          is_main_lift: te.Workout_Exercise ? te.Workout_Exercise.is_main_lift : false,
          target_sets: te.target_sets,
          target_reps: te.target_reps
        }))
    }));

    logState.loaded = true;
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load data</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
    throw err;
  }
}

// ---------- Start screen ----------

function renderStartScreen() {
  const root = document.getElementById('log-root');

  const templatesHtml = logState.templates.length
    ? logState.templates.map(t => `
        <div class="template-item">
          <div>
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="meta">${t.exercises.length} exercise${t.exercises.length === 1 ? '' : 's'}</div>
          </div>
          <button data-template-id="${t.id}" class="start-template-btn">Start</button>
        </div>
      `).join('')
    : `<div class="inline-message">No templates saved yet. Start blank and we'll add template-saving later.</div>`;

  root.innerHTML = `
    ${renderActiveProgramCard()}
    <div class="section-label">Templates</div>
    ${templatesHtml}
    <button class="btn-secondary finish-btn" id="start-blank-btn">Start blank workout</button>
    <div style="display:flex; gap:16px; margin-top:12px; flex-wrap: wrap;">
      <button class="new-exercise-toggle" id="create-template-btn">+ Create new template</button>
      <button class="new-exercise-toggle" id="manage-exercises-btn">Manage exercises</button>
      <button class="new-exercise-toggle" id="start-meet-btn">+ Start mock meet</button>
    </div>
  `;

  attachActiveProgramHandlers();

  root.querySelectorAll('.start-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = logState.templates.find(t => t.id === Number(btn.dataset.templateId));
      startFromTemplate(template);
    });
  });

  document.getElementById('start-blank-btn').addEventListener('click', startBlankWorkout);
  document.getElementById('create-template-btn').addEventListener('click', () => openTemplateBuilder());
  document.getElementById('manage-exercises-btn').addEventListener('click', () => openExerciseCatalogManager());
  document.getElementById('start-meet-btn').addEventListener('click', () => openMeetSetup());
}

function startBlankWorkout() {
  logState.session = {
    title: 'Workout',
    start_time: new Date().toISOString(),
    template_id: null,
    notes: '',
    exercises: []
  };
  renderActiveWorkout();
}

function startFromTemplate(template) {
  logState.session = {
    title: template.name,
    start_time: new Date().toISOString(),
    template_id: template.id,
    notes: '',
    exercises: template.exercises.map(e => ({
      exercise_id: e.exercise_id,
      name: e.name,
      is_main_lift: e.is_main_lift,
      target_sets: e.target_sets,
      target_reps: e.target_reps,
      sets: [],
      previous: null,
      notes: '',
      supersetGroup: null
    }))
  };
  renderActiveWorkout();

  // Fetch "last time" data per exercise, then re-render once it's in
  Promise.all(
    logState.session.exercises.map((ex, i) =>
      fetchPreviousSetsForExercise(ex.exercise_id).then(prev => { ex.previous = prev; })
    )
  ).then(() => {
    if (logState.session) renderActiveWorkout();
  });
}

// ---------- Active workout ----------

function renderActiveWorkout() {
  const root = document.getElementById('log-root');
  const session = logState.session;

  saveSessionToStorage();

  if (logState.elapsedInterval) clearInterval(logState.elapsedInterval);

  const exercisesHtml = session.exercises.map((ex, i) => renderExerciseBlock(ex, i)).join('');

  root.innerHTML = `
    <div class="workout-header">
      <h2>${escapeHtml(session.title)}</h2>
      <span class="elapsed" id="workout-elapsed">${formatElapsed(session.start_time)}</span>
    </div>
    <button class="new-exercise-toggle" id="discard-workout-btn" style="margin-bottom: 12px;">Discard workout</button>

    <div class="field">
      <label>Session notes</label>
      <textarea id="session-notes-input" rows="2" placeholder="How did it feel today?">${escapeHtml(session.notes || '')}</textarea>
    </div>

    ${exercisesHtml}

    <button class="fab-add-exercise" id="fab-add-exercise-btn" title="Add exercise">+</button>

    <div class="add-exercise-section" id="add-exercise-section">
      <div class="section-label">Add exercise</div>
      <input type="text" id="exercise-search-input" placeholder="Search exercises…">
      <button class="btn-secondary" id="new-exercise-toggle" style="margin-top:8px;">+ Add a new exercise</button>
      <div class="exercise-search-results" id="exercise-search-results"></div>
      <div class="new-exercise-form" id="new-exercise-form" hidden>
        <div class="field">
          <label>Exercise name</label>
          <input type="text" id="new-exercise-name">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Equipment</label>
            <select id="new-exercise-equipment">
              <option value="barbell">Barbell</option>
              <option value="dumbbell">Dumbbell</option>
              <option value="machine">Machine</option>
              <option value="cable">Cable</option>
              <option value="bodyweight">Bodyweight</option>
              <option value="trap bar">Trap bar</option>
              <option value="cardio">Cardio</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="field">
            <label>Muscle group</label>
            <input type="text" id="new-exercise-muscle" placeholder="e.g. legs, back">
          </div>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="new-exercise-main-lift">
          <label for="new-exercise-main-lift">This is a main lift (Squat/Bench/Deadlift/OHP)</label>
        </div>
        <button class="btn-secondary" id="create-exercise-btn">Add & use in this workout</button>
      </div>
    </div>

    <div id="log-inline-message"></div>

    <button class="btn-primary finish-btn" id="finish-workout-btn">Finish workout</button>
  `;

  logState.elapsedInterval = setInterval(() => {
    const el = document.getElementById('workout-elapsed');
    if (el) el.textContent = formatElapsed(session.start_time);
  }, 1000);

  attachActiveWorkoutHandlers();
}

function nextSupersetLetter(session) {
  const used = new Set(session.exercises.map(e => e.supersetGroup).filter(Boolean));
  const letters = 'ABCDEFGH';
  for (const l of letters) {
    if (!used.has(l)) return l;
  }
  return 'X';
}

function toggleSuperset(exIndex) {
  const session = logState.session;
  const ex = session.exercises[exIndex];

  if (ex.supersetGroup) {
    ex.supersetGroup = null;
    renderActiveWorkout();
    return;
  }

  if (logState.pendingSupersetIndex === null || logState.pendingSupersetIndex === undefined) {
    logState.pendingSupersetIndex = exIndex;
  } else if (logState.pendingSupersetIndex === exIndex) {
    logState.pendingSupersetIndex = null;
  } else {
    const otherEx = session.exercises[logState.pendingSupersetIndex];
    const letter = otherEx.supersetGroup || nextSupersetLetter(session);
    ex.supersetGroup = letter;
    otherEx.supersetGroup = letter;
    logState.pendingSupersetIndex = null;
  }
  renderActiveWorkout();
}

function renderExerciseBlock(ex, exIndex) {
  const category = getLiftCategory(ex.name);
  const bestE1rm = ex.sets
    .filter(s => s.set_type !== 'warmup')
    .map(s => calcE1RM(s.weight_kg, s.reps))
    .filter(Boolean)
    .reduce((max, v) => Math.max(max, v), 0);

  const setsHtml = ex.sets.map((s, i) => `
    <div class="set-row">
      <span class="set-num">${i + 1}</span>
      <span>${s.weight_kg} kg</span>
      <span>${s.reps} reps</span>
      <span>${s.rpe ? 'RPE ' + s.rpe : '—'}</span>
      <span class="set-type-tag">${s.set_type !== 'normal' ? s.set_type : ''}</span>
      <button class="set-delete" data-ex="${exIndex}" data-set="${i}">×</button>
    </div>
  `).join('');

  const targetLabel = ex.target_sets && ex.target_reps
    ? `<span class="exercise-target">Target: ${ex.target_sets}×${ex.target_reps}</span>`
    : '';

  const nextIndex = ex.sets.length;
  const prevSet = ex.previous && ex.previous.sets[nextIndex];
  const programTarget = ex.programTargets && ex.programTargets[nextIndex];
  const prefillWeight = programTarget ? programTarget.weight : (prevSet ? prevSet.weight_kg : '');
  const prefillReps = programTarget ? programTarget.reps : (prevSet ? prevSet.reps : '');

  const programTargetRow = ex.programTargets
    ? `
      <div class="previous-chip-row">
        <span class="previous-chip-label">This week</span>
        ${ex.programTargets.map((t, i) => `<span class="previous-chip target${i === nextIndex ? ' next' : ''}">${t.weight}×${t.reps}${t.amrap ? '+' : ''}</span>`).join('')}
      </div>
    `
    : '';

  const previousLine = ex.previous
    ? `
      <div class="previous-chip-row">
        <span class="previous-chip-label">Last time (${formatDateShort(ex.previous.date.getTime())})</span>
        ${ex.previous.sets.map((s, i) => `<span class="previous-chip${!ex.programTargets && i === nextIndex ? ' next' : ''}">${s.weight_kg}×${s.reps}</span>`).join('')}
      </div>
    `
    : '';

  const isPending = logState.pendingSupersetIndex === exIndex;
  const supersetLabel = ex.supersetGroup
    ? `<span class="superset-badge">Superset ${ex.supersetGroup}</span>`
    : (isPending ? `<span class="superset-badge pending">Pick a partner…</span>` : '');
  const supersetBtnLabel = ex.supersetGroup ? 'Unlink' : (isPending ? 'Cancel' : 'Link superset');

  return `
    <div class="exercise-block">
      <div class="exercise-block-header">
        <span class="exercise-name">${liftDot(category)}${escapeHtml(ex.name)}</span>
        ${bestE1rm ? `<span class="exercise-e1rm">e1RM ${bestE1rm.toFixed(1)} kg</span>` : targetLabel}
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; padding: 8px 14px 0;">
        ${supersetLabel}
        <button class="new-exercise-toggle superset-toggle-btn" data-ex="${exIndex}" style="margin-left:auto;">${supersetBtnLabel}</button>
      </div>
      ${programTargetRow}
      ${previousLine}
      <div class="set-list">${setsHtml}</div>
      <div class="add-set-form">
        <div class="field"><label>Weight (kg)</label><input type="number" step="0.5" class="set-weight-input" data-ex="${exIndex}" value="${prefillWeight}"></div>
        <div class="field"><label>Reps</label><input type="number" step="1" class="set-reps-input" data-ex="${exIndex}" value="${prefillReps}"></div>
        <div class="field"><label>RPE</label><input type="number" step="0.5" min="1" max="10" class="set-rpe-input" data-ex="${exIndex}"></div>
        <div class="field">
          <label>Type</label>
          <select class="set-type-input" data-ex="${exIndex}">
            <option value="normal">Normal</option>
            <option value="warmup">Warmup</option>
            <option value="failure">Failure</option>
            <option value="drop">Drop</option>
          </select>
        </div>
        <button class="add-set-btn" data-ex="${exIndex}">Add set</button>
      </div>
      <div class="field" style="padding: 0 14px 12px;">
        <label>Exercise notes</label>
        <input type="text" class="exercise-notes-input" data-ex="${exIndex}" value="${escapeHtml(ex.notes || '')}" placeholder="Optional">
      </div>
    </div>
  `;
}

function attachActiveWorkoutHandlers() {
  const fabBtn = document.getElementById('fab-add-exercise-btn');
  if (fabBtn) {
    fabBtn.addEventListener('click', () => {
      const section = document.getElementById('add-exercise-section');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section.classList.add('flash-highlight');
      setTimeout(() => section.classList.remove('flash-highlight'), 1200);
      document.getElementById('exercise-search-input').focus();
    });
  }

  const discardBtn = document.getElementById('discard-workout-btn');
  if (discardBtn) discardBtn.addEventListener('click', discardWorkout);

  const notesInput = document.getElementById('session-notes-input');
  if (notesInput) {
    notesInput.addEventListener('input', () => {
      logState.session.notes = notesInput.value;
      saveSessionToStorage();
    });
  }

  document.querySelectorAll('.add-set-btn').forEach(btn => {
    btn.addEventListener('click', () => addSet(Number(btn.dataset.ex)));
  });

  document.querySelectorAll('.set-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const exIdx = Number(btn.dataset.ex);
      const setIdx = Number(btn.dataset.set);
      logState.session.exercises[exIdx].sets.splice(setIdx, 1);
      renderActiveWorkout();
    });
  });

  document.querySelectorAll('.superset-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSuperset(Number(btn.dataset.ex)));
  });

  document.querySelectorAll('.exercise-notes-input').forEach(input => {
    input.addEventListener('input', () => {
      logState.session.exercises[Number(input.dataset.ex)].notes = input.value;
      saveSessionToStorage();
    });
  });

  const searchInput = document.getElementById('exercise-search-input');
  searchInput.addEventListener('input', () => renderExerciseSearchResults(searchInput.value));
  renderExerciseSearchResults('');

  document.getElementById('new-exercise-toggle').addEventListener('click', () => {
    const form = document.getElementById('new-exercise-form');
    form.hidden = !form.hidden;
    if (!form.hidden) {
      const nameInput = document.getElementById('new-exercise-name');
      if (!nameInput.value) nameInput.value = document.getElementById('exercise-search-input').value.trim();
      nameInput.focus();
    }
  });

  document.getElementById('create-exercise-btn').addEventListener('click', createNewExercise);
  document.getElementById('finish-workout-btn').addEventListener('click', finishWorkout);
}

function groupExercises(list) {
  const groups = {};
  list.forEach(e => {
    const key = (e.muscle_group && e.muscle_group.trim()) || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });
  return groups;
}

function renderExerciseSearchResults(query) {
  const resultsEl = document.getElementById('exercise-search-results');
  const q = (query || '').toLowerCase().trim();

  const filtered = logState.exerciseCatalog.filter(e => !q || e.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    resultsEl.innerHTML = `
      <div class="inline-message">No exercises match "${escapeHtml(query)}".</div>
      <button class="btn-secondary" id="add-searched-as-new-btn" style="margin-top:8px;">+ Add "${escapeHtml(query)}" as a new exercise</button>
    `;
    const addBtn = document.getElementById('add-searched-as-new-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        document.getElementById('new-exercise-toggle').click();
      });
    }
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
    return `
      <div class="exercise-group">
        <div class="exercise-group-label">${escapeHtml(groupName)}</div>
        ${items}
      </div>
    `;
  }).join('');

  resultsEl.querySelectorAll('.exercise-search-item').forEach(item => {
    item.addEventListener('click', () => {
      const exercise = logState.exerciseCatalog.find(e => e.id === Number(item.dataset.exerciseId));
      addExerciseToSession(exercise);
    });
  });
}

function addExerciseToSession(exercise) {
  const ex = {
    exercise_id: exercise.id,
    name: exercise.name,
    is_main_lift: exercise.is_main_lift,
    target_sets: null,
    target_reps: null,
    sets: [],
    previous: null,
    notes: '',
    supersetGroup: null
  };
  logState.session.exercises.push(ex);
  renderActiveWorkout();

  fetchPreviousSetsForExercise(exercise.id).then(prev => {
    ex.previous = prev;
    if (logState.session) renderActiveWorkout();
  });
}

async function createNewExercise() {
  const name = document.getElementById('new-exercise-name').value.trim();
  const equipment = document.getElementById('new-exercise-equipment').value;
  const muscleGroup = document.getElementById('new-exercise-muscle').value.trim();
  const isMainLift = document.getElementById('new-exercise-main-lift').checked;
  const msgEl = document.getElementById('log-inline-message');

  if (!name) {
    msgEl.innerHTML = `<div class="inline-message error">Give the exercise a name first.</div>`;
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('Workout_Exercise')
      .insert({ name, equipment, muscle_group: muscleGroup || null, is_main_lift: isMainLift })
      .select()
      .single();

    if (error) throw error;

    logState.exerciseCatalog.push(data);
    addExerciseToSession(data);
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't add exercise: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

function addSet(exIndex) {
  const weightInput = document.querySelector(`.set-weight-input[data-ex="${exIndex}"]`);
  const repsInput = document.querySelector(`.set-reps-input[data-ex="${exIndex}"]`);
  const rpeInput = document.querySelector(`.set-rpe-input[data-ex="${exIndex}"]`);
  const typeInput = document.querySelector(`.set-type-input[data-ex="${exIndex}"]`);

  const weight = parseFloat(weightInput.value);
  const reps = parseInt(repsInput.value, 10);

  if (!weight || !reps) {
    document.getElementById('log-inline-message').innerHTML =
      `<div class="inline-message error">Enter both weight and reps to log a set.</div>`;
    return;
  }

  logState.session.exercises[exIndex].sets.push({
    weight_kg: weight,
    reps: reps,
    rpe: rpeInput.value ? parseFloat(rpeInput.value) : null,
    set_type: typeInput.value
  });

  renderActiveWorkout();
}

function discardWorkout() {
  if (!confirm('Discard this workout? Nothing logged in it will be saved.')) return;
  if (logState.elapsedInterval) clearInterval(logState.elapsedInterval);
  logState.session = null;
  clearSessionStorage();
  renderStartScreen();
}

// ---------- Finish workout ----------

async function finishWorkout() {
  const session = logState.session;
  const msgEl = document.getElementById('log-inline-message');
  const totalSets = session.exercises.reduce((sum, e) => sum + e.sets.length, 0);

  if (totalSets === 0) {
    msgEl.innerHTML = `<div class="inline-message error">Log at least one set before finishing.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="inline-message">Saving…</div>`;

  try {
    const { data: sessionRow, error: sessionError } = await supabaseClient
      .from('Workout_Session')
      .insert({
        title: session.title,
        start_time: session.start_time,
        end_time: new Date().toISOString(),
        template_id: session.template_id,
        program_id: session.program_id || null,
        program_week: session.program_week || null,
        notes: session.notes || null
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    const setRows = [];
    session.exercises.forEach(ex => {
      ex.sets.forEach((s, i) => {
        setRows.push({
          session_id: sessionRow.id,
          exercise_id: ex.exercise_id,
          set_index: i + 1,
          set_type: s.set_type,
          weight_kg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
          notes: ex.notes || null,
          superset_id: ex.supersetGroup || null
        });
      });
    });

    const { error: setsError } = await supabaseClient.from('Workout_Set').insert(setRows);
    if (setsError) throw setsError;

    if (logState.elapsedInterval) clearInterval(logState.elapsedInterval);

    const finishedTitle = session.title;
    const finishedExercises = session.exercises.map(ex => ({
      exercise_id: ex.exercise_id,
      name: ex.name,
      target_sets: ex.sets.length,
      target_reps: mostCommonValue(ex.sets.filter(s => s.set_type !== 'warmup').map(s => s.reps))
    }));

    logState.session = null;
    clearSessionStorage();

    if (typeof invalidateMainLiftCache === 'function') invalidateMainLiftCache();
    if (typeof historyState !== 'undefined') historyState.loaded = false;
    logState.programLoaded = false;

    document.getElementById('log-root').innerHTML = `
      <div class="empty-state">
        <div class="num">Workout saved</div>
        <p>${totalSets} set${totalSets === 1 ? '' : 's'} logged. Check the History tab to see it.</p>
      </div>
      <button class="btn-primary" id="log-another-btn">Start another workout</button>
      <button class="btn-secondary finish-btn" id="save-as-template-btn">Save as template</button>
    `;
    document.getElementById('log-another-btn').addEventListener('click', renderStartScreen);
    document.getElementById('save-as-template-btn').addEventListener('click', () => {
      openTemplateBuilder({ name: finishedTitle, exercises: finishedExercises });
    });

  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save workout: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}
