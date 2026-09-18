// ============================================================
// 5/3/1 program mode
// ============================================================

const FIVE31_LIFT_ORDER = ['squat', 'bench', 'deadlift', 'ohp'];
const FIVE31_EXERCISE_NAMES = {
  squat: 'Squat (Barbell)',
  bench: 'Bench Press (Barbell)',
  deadlift: 'Deadlift (Barbell)',
  ohp: 'Overhead Press (Barbell)'
};

const FIVE31_WEEK_SCHEMES = {
  1: [{ pct: 0.65, reps: 5, amrap: false }, { pct: 0.75, reps: 5, amrap: false }, { pct: 0.85, reps: 5, amrap: true }],
  2: [{ pct: 0.70, reps: 3, amrap: false }, { pct: 0.80, reps: 3, amrap: false }, { pct: 0.90, reps: 3, amrap: true }],
  3: [{ pct: 0.75, reps: 5, amrap: false }, { pct: 0.85, reps: 3, amrap: false }, { pct: 0.95, reps: 1, amrap: true }],
  4: [{ pct: 0.40, reps: 5, amrap: false }, { pct: 0.50, reps: 5, amrap: false }, { pct: 0.60, reps: 5, amrap: false }]
};

function roundToNearest(value, increment) {
  return Math.round(value / increment) * increment;
}

async function loadActiveProgramState() {
  const { data: programs, error } = await supabaseClient
    .from('Workout_Program')
    .select('*')
    .eq('status', 'active')
    .order('started_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!programs || programs.length === 0) return null;

  const program = programs[0];

  const { data: liftRows, error: liftsError } = await supabaseClient
    .from('Workout_ProgramLift')
    .select('id, exercise_id, starting_e1rm, Workout_Exercise(name)')
    .eq('program_id', program.id);
  if (liftsError) throw liftsError;

  const programLifts = FIVE31_LIFT_ORDER.map(category => {
    const row = liftRows.find(l => getLiftCategory(l.Workout_Exercise.name) === category);
    return row ? {
      id: row.id,
      category,
      exercise_id: row.exercise_id,
      exercise_name: row.Workout_Exercise.name,
      starting_e1rm: parseFloat(row.starting_e1rm)
    } : null;
  });

  const { count, error: countError } = await supabaseClient
    .from('Workout_Session')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', program.id);
  if (countError) throw countError;

  let totalCompleted = count || 0;

  // A full 4-week (16-session) cycle just wrapped — re-snapshot from current e1RM
  if (totalCompleted > 0 && totalCompleted % 16 === 0) {
    const mainLiftData = await fetchMainLiftData();
    for (const pl of programLifts) {
      if (!pl) continue;
      const entries = mainLiftData[pl.category] || [];
      if (entries.length) {
        const best = entries.reduce((max, e) => (e.e1rm > max.e1rm ? e : max), entries[0]);
        pl.starting_e1rm = best.e1rm;
        await supabaseClient.from('Workout_ProgramLift').update({ starting_e1rm: best.e1rm }).eq('id', pl.id);
      }
    }
  }

  const posInCycle = totalCompleted % 16;
  const weekIndex = Math.floor(posInCycle / 4) + 1;
  const liftIndexInWeek = posInCycle % 4;

  return { program, programLifts, totalCompleted, weekIndex, liftIndexInWeek };
}

function renderActiveProgramCard() {
  const state = logState.activeProgram;
  if (!state) {
    return `<button class="new-exercise-toggle" id="start-531-setup-btn">+ Start 5/3/1 program</button>`;
  }

  const category = FIVE31_LIFT_ORDER[state.liftIndexInWeek];
  const liftInfo = state.programLifts[state.liftIndexInWeek];

  if (!liftInfo) {
    return `<div class="inline-message error">5/3/1 is missing one of its lifts (Squat/Bench/Deadlift/OHP Barbell) in your catalog.</div>`;
  }

  const scheme = FIVE31_WEEK_SCHEMES[state.weekIndex];
  const targetsPreview = scheme.map(s =>
    `${roundToNearest(liftInfo.starting_e1rm * s.pct, 2.5)}kg×${s.reps}${s.amrap ? '+' : ''}`
  ).join(' · ');

  return `
    <div class="card" style="border-color: var(--deadlift); margin-bottom: 16px;">
      <div class="section-label">Active program</div>
      <div style="font-weight:600; display:flex; align-items:center; gap:8px;">${liftDot(category)}5/3/1 · Week ${state.weekIndex} · ${LIFT_LABELS[category]}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">${targetsPreview}</div>
      <button class="btn-primary" style="margin-top:12px;" id="start-531-session-btn">Start this session</button>
      <button class="new-exercise-toggle" style="margin-top:10px;" id="end-531-btn">End program</button>
    </div>
  `;
}

function attachActiveProgramHandlers() {
  const setupBtn = document.getElementById('start-531-setup-btn');
  if (setupBtn) setupBtn.addEventListener('click', renderFiveThreeOneSetup);

  const startBtn = document.getElementById('start-531-session-btn');
  if (startBtn) startBtn.addEventListener('click', startFiveThreeOneSession);

  const endBtn = document.getElementById('end-531-btn');
  if (endBtn) endBtn.addEventListener('click', endActiveProgram);
}

async function renderFiveThreeOneSetup() {
  const root = document.getElementById('log-root');
  root.innerHTML = `<div class="empty-state"><p>Loading current maxes…</p></div>`;

  const mainLiftData = await fetchMainLiftData();

  const rows = FIVE31_LIFT_ORDER.map(category => {
    const entries = mainLiftData[category] || [];
    const best = entries.length ? entries.reduce((max, e) => (e.e1rm > max.e1rm ? e : max), entries[0]) : null;
    return `
      <div class="field-row" style="align-items:flex-end;">
        <div class="field" style="flex: none; width: 90px;">
          <label>&nbsp;</label>
          <span style="display:flex; align-items:center; height:41px;">${liftDot(category)}${LIFT_LABELS[category]}</span>
        </div>
        <div class="field">
          <label>Starting e1RM (kg)</label>
          <input type="number" step="0.5" class="setup-e1rm-input" data-category="${category}" value="${best ? best.e1rm.toFixed(1) : ''}">
        </div>
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div class="section-label">Start 5/3/1</div>
    <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
      Pre-filled from your current best e1RM per lift. Adjust if you want to start more conservatively.
    </p>
    ${rows}
    <div id="setup-531-message"></div>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-secondary" id="setup-531-cancel-btn">Cancel</button>
      <button class="btn-primary" id="setup-531-save-btn">Start Program</button>
    </div>
  `;

  document.getElementById('setup-531-cancel-btn').addEventListener('click', renderStartScreen);
  document.getElementById('setup-531-save-btn').addEventListener('click', createFiveThreeOneProgram);
}

async function createFiveThreeOneProgram() {
  const msgEl = document.getElementById('setup-531-message');
  const inputs = document.querySelectorAll('.setup-e1rm-input');
  const values = {};
  let hasError = false;

  inputs.forEach(input => {
    const val = parseFloat(input.value);
    if (!val) hasError = true;
    values[input.dataset.category] = val;
  });

  if (hasError) {
    msgEl.innerHTML = `<div class="inline-message error">Enter a starting e1RM for all four lifts.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="inline-message">Starting…</div>`;

  try {
    const { data: programRow, error: programError } = await supabaseClient
      .from('Workout_Program')
      .insert({ name: '5/3/1', started_date: new Date().toISOString().slice(0, 10), status: 'active' })
      .select()
      .single();
    if (programError) throw programError;

    const liftRows = FIVE31_LIFT_ORDER.map(category => {
      const exercise = logState.exerciseCatalog.find(e => e.name === FIVE31_EXERCISE_NAMES[category]);
      if (!exercise) throw new Error(`Missing exercise "${FIVE31_EXERCISE_NAMES[category]}" in your catalog`);
      return { program_id: programRow.id, exercise_id: exercise.id, starting_e1rm: values[category] };
    });

    const { error: liftsError } = await supabaseClient.from('Workout_ProgramLift').insert(liftRows);
    if (liftsError) throw liftsError;

    logState.activeProgram = null;
    logState.programLoaded = false;
    renderStartScreen();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't start program: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

function startFiveThreeOneSession() {
  const state = logState.activeProgram;
  const category = FIVE31_LIFT_ORDER[state.liftIndexInWeek];
  const liftInfo = state.programLifts[state.liftIndexInWeek];
  const scheme = FIVE31_WEEK_SCHEMES[state.weekIndex];

  const programTargets = scheme.map(s => ({
    weight: roundToNearest(liftInfo.starting_e1rm * s.pct, 2.5),
    reps: s.reps,
    amrap: s.amrap
  }));

  logState.session = {
    title: `5/3/1 – Week ${state.weekIndex} – ${LIFT_LABELS[category]}`,
    start_time: new Date().toISOString(),
    template_id: null,
    notes: '',
    program_id: state.program.id,
    program_week: state.weekIndex,
    exercises: [{
      exercise_id: liftInfo.exercise_id,
      name: liftInfo.exercise_name,
      is_main_lift: true,
      target_sets: null,
      target_reps: null,
      sets: [],
      previous: null,
      notes: '',
      supersetGroup: null,
      programTargets
    }]
  };

  renderActiveWorkout();

  fetchPreviousSetsForExercise(liftInfo.exercise_id).then(prev => {
    logState.session.exercises[0].previous = prev;
    if (logState.session) renderActiveWorkout();
  });
}

async function endActiveProgram() {
  if (!confirm('End the active 5/3/1 program? You can start a new one anytime.')) return;
  const state = logState.activeProgram;

  try {
    const { error } = await supabaseClient.from('Workout_Program').update({ status: 'ended' }).eq('id', state.program.id);
    if (error) throw error;

    logState.activeProgram = null;
    logState.programLoaded = false;
    renderStartScreen();
  } catch (err) {
    console.error(err);
    alert("Couldn't end program: " + (err.message || 'unknown error'));
  }
}
