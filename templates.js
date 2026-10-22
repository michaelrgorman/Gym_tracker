// ============================================================
// Template builder — create a new template, edit an existing one,
// or start from a just-finished workout
// ============================================================

const templateBuilderState = {
  editingId: null,   // null = creating a new template
  name: '',
  notes: '',
  exercises: []      // [{ exercise_id, name, target_sets, target_reps }]
};

function openTemplateBuilder(prefill, editingId) {
  templateBuilderState.editingId = editingId || null;
  templateBuilderState.name = (prefill && prefill.name) || '';
  templateBuilderState.notes = (prefill && prefill.notes) || '';
  templateBuilderState.exercises = (prefill && prefill.exercises)
    ? prefill.exercises.map(e => ({ ...e }))
    : [];
  renderTemplateBuilder();
}

function openTemplateEditor(templateId) {
  const template = logState.templates.find(t => t.id === templateId);
  if (!template) return;
  openTemplateBuilder(template, template.id);
}

function renderTemplateBuilder() {
  const root = document.getElementById('log-root');
  const s = templateBuilderState;
  const isEditing = s.editingId !== null;
  const lastIndex = s.exercises.length - 1;

  const exerciseBlocks = s.exercises.map((ex, i) => {
    const category = getLiftCategory(ex.name);
    return `
      <div class="detail-exercise-block" style="margin-bottom: 10px;">
        <div class="detail-exercise-header">
          <span style="display:flex; align-items:center; gap:6px;">${liftDot(category)}${escapeHtml(ex.name)}</span>
          <span style="display:flex; gap:6px;">
            <button class="rest-timer-btn tb-up-btn" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
            <button class="rest-timer-btn tb-down-btn" data-i="${i}" ${i === lastIndex ? 'disabled' : ''} title="Move down">▼</button>
            <button class="edit-delete-btn tb-remove-btn" data-i="${i}" style="padding: 6px 10px;" title="Remove">×</button>
          </span>
        </div>
        <div class="field-row" style="padding: 10px 14px 0;">
          <div class="field"><label>Sets</label><input type="number" class="tb-sets-input" data-i="${i}" value="${ex.target_sets ?? ''}"></div>
          <div class="field"><label>Reps</label><input type="number" class="tb-reps-input" data-i="${i}" value="${ex.target_reps ?? ''}"></div>
        </div>
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div class="section-label">${isEditing ? 'Edit template' : 'New template'}</div>

    <div class="field">
      <label>Template name</label>
      <input type="text" id="tb-name-input" value="${escapeHtml(s.name)}">
    </div>

    <div class="field">
      <label>Notes (optional)</label>
      <textarea id="tb-notes-input" rows="3" placeholder="Coaching cues for this day">${escapeHtml(s.notes)}</textarea>
    </div>

    <div class="section-label">Exercises</div>
    ${exerciseBlocks || '<div class="inline-message">No exercises added yet.</div>'}

    <div class="add-exercise-section" id="tb-add-exercise-section">
      <div class="section-label">Add exercise</div>
      <input type="text" id="tb-exercise-search-input" placeholder="Search exercises…">
      <div class="exercise-search-results" id="tb-exercise-search-results"></div>
    </div>

    <div id="tb-message"></div>

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-secondary" id="tb-cancel-btn">Cancel</button>
      <button class="btn-primary" id="tb-save-btn">${isEditing ? 'Save changes' : 'Save template'}</button>
    </div>
    ${isEditing ? `<button class="btn-secondary finish-btn" id="tb-delete-btn" style="border-color: var(--danger); color: var(--danger);">Delete template</button>` : ''}
  `;

  document.getElementById('tb-name-input').addEventListener('input', (e) => {
    s.name = e.target.value;
  });
  document.getElementById('tb-notes-input').addEventListener('input', (e) => {
    s.notes = e.target.value;
  });

  root.querySelectorAll('.tb-sets-input').forEach(input => {
    input.addEventListener('input', () => {
      s.exercises[Number(input.dataset.i)].target_sets = parseInt(input.value, 10) || null;
    });
  });
  root.querySelectorAll('.tb-reps-input').forEach(input => {
    input.addEventListener('input', () => {
      s.exercises[Number(input.dataset.i)].target_reps = parseInt(input.value, 10) || null;
    });
  });

  root.querySelectorAll('.tb-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      s.exercises.splice(Number(btn.dataset.i), 1);
      renderTemplateBuilder();
    });
  });
  root.querySelectorAll('.tb-up-btn').forEach(btn => {
    btn.addEventListener('click', () => moveTemplateExercise(Number(btn.dataset.i), -1));
  });
  root.querySelectorAll('.tb-down-btn').forEach(btn => {
    btn.addEventListener('click', () => moveTemplateExercise(Number(btn.dataset.i), 1));
  });

  const searchInput = document.getElementById('tb-exercise-search-input');
  searchInput.addEventListener('input', () => renderTbExerciseSearchResults(searchInput.value));
  renderTbExerciseSearchResults('');

  document.getElementById('tb-cancel-btn').addEventListener('click', renderStartScreen);
  document.getElementById('tb-save-btn').addEventListener('click', saveTemplate);

  const deleteBtn = document.getElementById('tb-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', deleteTemplate);
}

function moveTemplateExercise(index, direction) {
  const list = templateBuilderState.exercises;
  const target = index + direction;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  renderTemplateBuilder();
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
  const s = templateBuilderState;
  const msgEl = document.getElementById('tb-message');
  const name = s.name.trim();
  const notes = s.notes.trim();

  if (!name) {
    msgEl.innerHTML = `<div class="inline-message error">Give the template a name.</div>`;
    return;
  }
  if (s.exercises.length === 0) {
    msgEl.innerHTML = `<div class="inline-message error">Add at least one exercise.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="inline-message">Saving…</div>`;

  try {
    let templateId = s.editingId;
    let oldRowIds = [];

    if (templateId) {
      const { error: updateError } = await supabaseClient
        .from('Workout_Template')
        .update({ name, notes: notes || null })
        .eq('id', templateId);
      if (updateError) throw updateError;

      const { data: oldRows, error: oldError } = await supabaseClient
        .from('Workout_TemplateExercise')
        .select('id')
        .eq('template_id', templateId);
      if (oldError) throw oldError;
      oldRowIds = (oldRows || []).map(r => r.id);
    } else {
      const { data: templateRow, error: templateError } = await supabaseClient
        .from('Workout_Template')
        .insert({ name, notes: notes || null })
        .select()
        .single();
      if (templateError) throw templateError;
      templateId = templateRow.id;
    }

    const rows = s.exercises.map((ex, i) => ({
      template_id: templateId,
      exercise_id: ex.exercise_id,
      order_index: i + 1,
      target_sets: ex.target_sets,
      target_reps: ex.target_reps
    }));

    // Insert the new list first, then remove the old rows, so a failure
    // part-way never leaves the template empty
    const { error: rowsError } = await supabaseClient.from('Workout_TemplateExercise').insert(rows);
    if (rowsError) throw rowsError;

    if (oldRowIds.length) {
      const { error: deleteError } = await supabaseClient
        .from('Workout_TemplateExercise')
        .delete()
        .in('id', oldRowIds);
      if (deleteError) throw deleteError;
    }

    logState.loaded = false; // force templates to reload
    await loadTemplatesAndCatalog();
    renderStartScreen();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save template: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function deleteTemplate() {
  const s = templateBuilderState;
  if (!s.editingId) return;
  if (!confirm(`Delete "${s.name}"? Workouts you've already logged from it stay in your History.`)) return;

  const msgEl = document.getElementById('tb-message');

  try {
    // Detach past sessions so History keeps them
    const { error: detachError } = await supabaseClient
      .from('Workout_Session')
      .update({ template_id: null })
      .eq('template_id', s.editingId);
    if (detachError) throw detachError;

    const { error: rowsError } = await supabaseClient
      .from('Workout_TemplateExercise')
      .delete()
      .eq('template_id', s.editingId);
    if (rowsError) throw rowsError;

    const { error: templateError } = await supabaseClient
      .from('Workout_Template')
      .delete()
      .eq('id', s.editingId);
    if (templateError) throw templateError;

    logState.loaded = false;
    await loadTemplatesAndCatalog();
    renderStartScreen();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't delete template: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

function mostCommonValue(values) {
  const nums = values.filter(v => v !== null && v !== undefined);
  if (nums.length === 0) return null;
  const counts = {};
  nums.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Number(Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b)));
}
