// ============================================================
// Template builder — create a new template from scratch, or
// prefilled from a just-finished workout
// ============================================================

const templateBuilderState = {
  name: '',
  exercises: [] // [{ exercise_id, name, target_sets, target_reps }]
};

function openTemplateBuilder(prefill) {
  templateBuilderState.name = (prefill && prefill.name) || '';
  templateBuilderState.exercises = (prefill && prefill.exercises)
    ? prefill.exercises.map(e => ({ ...e }))
    : [];
  renderTemplateBuilder();
}

function renderTemplateBuilder() {
  const root = document.getElementById('log-root');

  const exerciseRows = templateBuilderState.exercises.map((ex, i) => {
    const category = getLiftCategory(ex.name);
    return `
      <div class="edit-set-row" style="grid-template-columns: 1fr 70px 70px 30px;">
        <span style="display:flex; align-items:center; gap:6px;">${liftDot(category)}${escapeHtml(ex.name)}</span>
        <input type="number" class="tb-sets-input" data-i="${i}" value="${ex.target_sets ?? ''}" placeholder="sets">
        <input type="number" class="tb-reps-input" data-i="${i}" value="${ex.target_reps ?? ''}" placeholder="reps">
        <button class="edit-delete-btn" data-i="${i}">×</button>
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div class="field">
      <label>Template name</label>
      <input type="text" id="tb-name-input" value="${escapeHtml(templateBuilderState.name)}">
    </div>

    <div class="section-label">Exercises</div>
    <div class="detail-exercise-block">
      ${exerciseRows || '<div class="inline-message">No exercises added yet.</div>'}
    </div>

    <div class="add-exercise-section" id="tb-add-exercise-section">
      <div class="section-label">Add exercise</div>
      <input type="text" id="tb-exercise-search-input" placeholder="Search exercises…">
      <div class="exercise-search-results" id="tb-exercise-search-results"></div>
    </div>

    <div id="tb-message"></div>

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-secondary" id="tb-cancel-btn">Cancel</button>
      <button class="btn-primary" id="tb-save-btn">Save template</button>
    </div>
  `;

  document.getElementById('tb-name-input').addEventListener('input', (e) => {
    templateBuilderState.name = e.target.value;
  });

  root.querySelectorAll('.tb-sets-input').forEach(input => {
    input.addEventListener('input', () => {
      templateBuilderState.exercises[Number(input.dataset.i)].target_sets = parseInt(input.value, 10) || null;
    });
  });
  root.querySelectorAll('.tb-reps-input').forEach(input => {
    input.addEventListener('input', () => {
      templateBuilderState.exercises[Number(input.dataset.i)].target_reps = parseInt(input.value, 10) || null;
    });
  });
  root.querySelectorAll('.edit-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      templateBuilderState.exercises.splice(Number(btn.dataset.i), 1);
      renderTemplateBuilder();
    });
  });

  const searchInput = document.getElementById('tb-exercise-search-input');
  searchInput.addEventListener('input', () => renderTbExerciseSearchResults(searchInput.value));
  renderTbExerciseSearchResults('');

  document.getElementById('tb-cancel-btn').addEventListener('click', renderStartScreen);
  document.getElementById('tb-save-btn').addEventListener('click', saveTemplate);
}

function renderTbExerciseSearchResults(query) {
  const resultsEl = document.getElementById('tb-exercise-search-results');
  const q = (query || '').toLowerCase().trim();

  const alreadyAdded = new Set(templateBuilderState.exercises.map(e => e.exercise_id));
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
        const addedTag = alreadyAdded.has(e.id) ? ' style="opacity:0.4;"' : '';
        return `<div class="exercise-search-item" data-exercise-id="${e.id}"${addedTag}>${liftDot(category)}${escapeHtml(e.name)}</div>`;
      }).join('');
    return `<div class="exercise-group"><div class="exercise-group-label">${escapeHtml(groupName)}</div>${items}</div>`;
  }).join('');

  resultsEl.querySelectorAll('.exercise-search-item').forEach(item => {
    item.addEventListener('click', () => {
      const exercise = logState.exerciseCatalog.find(e => e.id === Number(item.dataset.exerciseId));
      if (templateBuilderState.exercises.some(e => e.exercise_id === exercise.id)) return;
      templateBuilderState.exercises.push({
        exercise_id: exercise.id,
        name: exercise.name,
        target_sets: null,
        target_reps: null
      });
      renderTemplateBuilder();
    });
  });
}

async function saveTemplate() {
  const msgEl = document.getElementById('tb-message');
  const name = templateBuilderState.name.trim();

  if (!name) {
    msgEl.innerHTML = `<div class="inline-message error">Give the template a name.</div>`;
    return;
  }
  if (templateBuilderState.exercises.length === 0) {
    msgEl.innerHTML = `<div class="inline-message error">Add at least one exercise.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="inline-message">Saving…</div>`;

  try {
    const { data: templateRow, error: templateError } = await supabaseClient
      .from('Workout_Template')
      .insert({ name })
      .select()
      .single();
    if (templateError) throw templateError;

    const rows = templateBuilderState.exercises.map((ex, i) => ({
      template_id: templateRow.id,
      exercise_id: ex.exercise_id,
      order_index: i + 1,
      target_sets: ex.target_sets,
      target_reps: ex.target_reps
    }));

    const { error: rowsError } = await supabaseClient.from('Workout_TemplateExercise').insert(rows);
    if (rowsError) throw rowsError;

    logState.loaded = false; // force templates to reload next time Log tab opens
    await loadTemplatesAndCatalog();
    renderStartScreen();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save template: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

function mostCommonValue(values) {
  const nums = values.filter(v => v !== null && v !== undefined);
  if (nums.length === 0) return null;
  const counts = {};
  nums.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Number(Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b)));
}
