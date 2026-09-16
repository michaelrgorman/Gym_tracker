// ============================================================
// Log tab — start screen, active workout, set logging, rest timer
// ============================================================

const logState = {
  session: null,        // { title, start_time, template_id, exercises: [...] }
  templates: [],         // [{ id, name, exercises: [{exercise_id, name, target_sets, target_reps}] }]
  exerciseCatalog: [],   // [{ id, name, equipment, muscle_group, is_main_lift }]
  loaded: false,
  elapsedInterval: null
};

const restTimerState = {
  remaining: 0,
  interval: null
};

// ---------- Helpers ----------

function calcE1RM(weightKg, reps) {
  if (!weightKg || !reps) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
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
    <div class="section-label">Templates</div>
    ${templatesHtml}
    <button class="btn-secondary finish-btn" id="start-blank-btn">Start blank workout</button>
  `;

  root.querySelectorAll('.start-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = logState.templates.find(t => t.id === Number(btn.dataset.templateId));
      startFromTemplate(template);
    });
  });

  document.getElementById('start-blank-btn').addEventListener('click', startBlankWorkout);
}

function startBlankWorkout() {
  logState.session = {
    title: 'Workout',
    start_time: new Date().toISOString(),
    template_id: null,
    exercises: []
  };
  renderActiveWorkout();
}

function startFromTemplate(template) {
  logState.session = {
    title: template.name,
    start_time: new Date().toISOString(),
    template_id: template.id,
    exercises: template.exercises.map(e => ({
      exercise_id: e.exercise_id,
      name: e.name,
      is_main_lift: e.is_main_lift,
      target_sets: e.target_sets,
      target_reps: e.target_reps,
      sets: []
    }))
  };
  renderActiveWorkout();
}

// ---------- Active workout ----------

function renderActiveWorkout() {
  const root = document.getElementById('log-root');
  const session = logState.session;

  if (logState.elapsedInterval) clearInterval(logState.elapsedInterval);

  const exercisesHtml = session.exercises.map((ex, i) => renderExerciseBlock(ex, i)).join('');

  root.innerHTML = `
    <div class="workout-header">
      <h2>${escapeHtml(session.title)}</h2>
      <span class="elapsed" id="workout-elapsed">${formatElapsed(session.start_time)}</span>
    </div>

    ${exercisesHtml}

    <div class="add-exercise-section" id="add-exercise-section">
      <div class="section-label">Add exercise</div>
      <input type="text" id="exercise-search-input" placeholder="Search exercises…">
      <div class="exercise-search-results" id="exercise-search-results"></div>
      <button class="new-exercise-toggle" id="new-exercise-toggle">+ Tag a new exercise</button>
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

  return `
    <div class="exercise-block">
      <div class="exercise-block-header">
        <span class="exercise-name">${liftDot(category)}${escapeHtml(ex.name)}</span>
        ${bestE1rm ? `<span class="exercise-e1rm">e1RM ${bestE1rm.toFixed(1)} kg</span>` : targetLabel}
      </div>
      <div class="set-list">${setsHtml}</div>
      <div class="add-set-form">
        <div class="field"><label>Weight (kg)</label><input type="number" step="0.5" class="set-weight-input" data-ex="${exIndex}"></div>
        <div class="field"><label>Reps</label><input type="number" step="1" class="set-reps-input" data-ex="${exIndex}"></div>
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
    </div>
  `;
}

function attachActiveWorkoutHandlers() {
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

  const searchInput = document.getElementById('exercise-search-input');
  searchInput.addEventListener('input', () => renderExerciseSearchResults(searchInput.value));

  document.getElementById('new-exercise-toggle').addEventListener('click', () => {
    const form = document.getElementById('new-exercise-form');
    form.hidden = !form.hidden;
  });

  document.getElementById('create-exercise-btn').addEventListener('click', createNewExercise);
  document.getElementById('finish-workout-btn').addEventListener('click', finishWorkout);

  document.getElementById('rest-timer-add30').addEventListener('click', () => adjustRestTimer(30));
  document.getElementById('rest-timer-skip').addEventListener('click', stopRestTimer);
}

function renderExerciseSearchResults(query) {
  const resultsEl = document.getElementById('exercise-search-results');
  if (!query || query.length < 1) {
    resultsEl.innerHTML = '';
    return;
  }

  const q = query.toLowerCase();
  const matches = logState.exerciseCatalog
    .filter(e => e.name.toLowerCase().includes(q))
    .slice(0, 8);

  resultsEl.innerHTML = matches.map(e => {
    const category = getLiftCategory(e.name);
    return `<div class="exercise-search-item" data-exercise-id="${e.id}">${liftDot(category)}${escapeHtml(e.name)}</div>`;
  }).join('');

  resultsEl.querySelectorAll('.exercise-search-item').forEach(item => {
    item.addEventListener('click', () => {
      const exercise = logState.exerciseCatalog.find(e => e.id === Number(item.dataset.exerciseId));
      addExerciseToSession(exercise);
    });
  });
}

function addExerciseToSession(exercise) {
  logState.session.exercises.push({
    exercise_id: exercise.id,
    name: exercise.name,
    is_main_lift: exercise.is_main_lift,
    target_sets: null,
    target_reps: null,
    sets: []
  });
  renderActiveWorkout();
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
  startRestTimer(120);
}

// ---------- Rest timer ----------

function startRestTimer(seconds) {
  restTimerState.remaining = seconds;
  updateRestTimerDisplay();
  document.getElementById('rest-timer-banner').hidden = false;

  if (restTimerState.interval) clearInterval(restTimerState.interval);
  restTimerState.interval = setInterval(() => {
    restTimerState.remaining -= 1;
    updateRestTimerDisplay();
    if (restTimerState.remaining <= 0) {
      stopRestTimer();
      if (navigator.vibrate) {
        try { navigator.vibrate(200); } catch (e) { /* ignore */ }
      }
    }
  }, 1000);
}

function adjustRestTimer(deltaSeconds) {
  restTimerState.remaining += deltaSeconds;
  updateRestTimerDisplay();
}

function stopRestTimer() {
  if (restTimerState.interval) clearInterval(restTimerState.interval);
  restTimerState.interval = null;
  document.getElementById('rest-timer-banner').hidden = true;
}

function updateRestTimerDisplay() {
  const m = Math.floor(Math.max(0, restTimerState.remaining) / 60);
  const s = Math.max(0, restTimerState.remaining) % 60;
  const clockEl = document.getElementById('rest-timer-clock');
  if (clockEl) clockEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
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
        template_id: session.template_id
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
          rpe: s.rpe
        });
      });
    });

    const { error: setsError } = await supabaseClient.from('Workout_Set').insert(setRows);
    if (setsError) throw setsError;

    if (logState.elapsedInterval) clearInterval(logState.elapsedInterval);
    stopRestTimer();
    logState.session = null;

    document.getElementById('log-root').innerHTML = `
      <div class="empty-state">
        <div class="num">Workout saved</div>
        <p>${totalSets} set${totalSets === 1 ? '' : 's'} logged. Check the History tab to see it.</p>
      </div>
      <button class="btn-primary" id="log-another-btn">Start another workout</button>
    `;
    document.getElementById('log-another-btn').addEventListener('click', renderStartScreen);

  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save workout: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}
