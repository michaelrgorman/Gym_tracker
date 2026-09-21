// ============================================================
// Exercise catalog management — edit or delete tagged exercises
// ============================================================

function openExerciseCatalogManager() {
  renderExerciseCatalogManager();
}

function renderExerciseCatalogManager(editingId, showAddForm) {
  const root = document.getElementById('log-root');
  const groups = groupExercises(logState.exerciseCatalog);
  const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  const addFormHtml = showAddForm ? `
    <div class="detail-exercise-block" style="margin-bottom: 16px;">
      <div class="field" style="padding: 10px 14px 0;">
        <label>Name</label>
        <input type="text" id="cat-new-name">
      </div>
      <div class="field-row" style="padding: 0 14px;">
        <div class="field">
          <label>Equipment</label>
          <select id="cat-new-equipment">
            ${['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'trap bar', 'cardio', 'other'].map(opt =>
              `<option value="${opt}">${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>Muscle group</label>
          <input type="text" id="cat-new-muscle">
        </div>
      </div>
      <div class="checkbox-field" style="padding: 0 14px;">
        <input type="checkbox" id="cat-new-main-lift">
        <label for="cat-new-main-lift">Main lift</label>
      </div>
      <div id="cat-new-message" style="padding: 0 14px;"></div>
      <div style="display:flex; gap:8px; padding: 0 14px 14px;">
        <button class="btn-secondary" id="cat-new-cancel-btn">Cancel</button>
        <button class="btn-primary" id="cat-new-save-btn">Add exercise</button>
      </div>
    </div>
  ` : `<button class="new-exercise-toggle" id="cat-add-new-btn" style="margin-bottom: 16px;">+ Add new exercise</button>`;

  const groupsHtml = sortedGroupNames.map(groupName => {
    const items = groups[groupName]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => {
        if (e.id === editingId) {
          return `
            <div class="detail-exercise-block" data-exercise-id="${e.id}">
              <div class="field" style="padding: 10px 14px 0;">
                <label>Name</label>
                <input type="text" id="cat-edit-name" value="${escapeHtml(e.name)}">
              </div>
              <div class="field-row" style="padding: 0 14px;">
                <div class="field">
                  <label>Equipment</label>
                  <select id="cat-edit-equipment">
                    ${['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'trap bar', 'cardio', 'other'].map(opt =>
                      `<option value="${opt}" ${e.equipment === opt ? 'selected' : ''}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`
                    ).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>Muscle group</label>
                  <input type="text" id="cat-edit-muscle" value="${escapeHtml(e.muscle_group || '')}">
                </div>
              </div>
              <div class="checkbox-field" style="padding: 0 14px;">
                <input type="checkbox" id="cat-edit-main-lift" ${e.is_main_lift ? 'checked' : ''}>
                <label for="cat-edit-main-lift">Main lift</label>
              </div>
              <div id="cat-edit-message" style="padding: 0 14px;"></div>
              <div style="display:flex; gap:8px; padding: 0 14px 14px;">
                <button class="btn-secondary" id="cat-cancel-btn">Cancel</button>
                <button class="btn-primary" id="cat-save-btn" data-exercise-id="${e.id}">Save</button>
                <button class="edit-delete-btn" id="cat-delete-btn" data-exercise-id="${e.id}" style="flex-shrink:0; width:auto; padding: 0 14px;">Delete</button>
              </div>
            </div>
          `;
        }
        const category = getLiftCategory(e.name);
        return `
          <div class="exercise-search-item" data-exercise-id="${e.id}" style="cursor:pointer;">
            ${liftDot(category)}${escapeHtml(e.name)}
            <span style="margin-left:auto; color:var(--text-faint); font-size:12px;">${e.equipment || ''}</span>
          </div>
        `;
      }).join('');
    return `<div class="exercise-group"><div class="exercise-group-label">${escapeHtml(groupName)}</div>${items}</div>`;
  }).join('');

  root.innerHTML = `
    <button class="back-btn" id="cat-back-btn">‹ Back</button>
    <div class="section-label">Manage exercises</div>
    ${addFormHtml}
    <div class="exercise-search-results" style="max-height: none;">${groupsHtml}</div>
  `;

  document.getElementById('cat-back-btn').addEventListener('click', renderStartScreen);

  const addNewBtn = document.getElementById('cat-add-new-btn');
  if (addNewBtn) addNewBtn.addEventListener('click', () => renderExerciseCatalogManager(null, true));

  const addCancelBtn = document.getElementById('cat-new-cancel-btn');
  if (addCancelBtn) addCancelBtn.addEventListener('click', () => renderExerciseCatalogManager());

  const addSaveBtn = document.getElementById('cat-new-save-btn');
  if (addSaveBtn) addSaveBtn.addEventListener('click', createExerciseFromCatalogManager);

  root.querySelectorAll('.exercise-search-item[data-exercise-id]').forEach(item => {
    item.addEventListener('click', () => renderExerciseCatalogManager(Number(item.dataset.exerciseId)));
  });

  const cancelBtn = document.getElementById('cat-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => renderExerciseCatalogManager());

  const saveBtn = document.getElementById('cat-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => saveExerciseCatalogEdit(Number(saveBtn.dataset.exerciseId)));

  const deleteBtn = document.getElementById('cat-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteExerciseFromCatalog(Number(deleteBtn.dataset.exerciseId)));
}

async function createExerciseFromCatalogManager() {
  const msgEl = document.getElementById('cat-new-message');
  const name = document.getElementById('cat-new-name').value.trim();
  const equipment = document.getElementById('cat-new-equipment').value;
  const muscleGroup = document.getElementById('cat-new-muscle').value.trim();
  const isMainLift = document.getElementById('cat-new-main-lift').checked;

  if (!name) {
    msgEl.innerHTML = `<div class="inline-message error">Give the exercise a name.</div>`;
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('Workout_Exercise')
      .insert({ name, equipment, muscle_group: muscleGroup || null, is_main_lift: isMainLift });
    if (error) throw error;

    logState.loaded = false;
    await loadTemplatesAndCatalog();
    renderExerciseCatalogManager();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't add: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function saveExerciseCatalogEdit(exerciseId) {
  const msgEl = document.getElementById('cat-edit-message');
  const name = document.getElementById('cat-edit-name').value.trim();
  const equipment = document.getElementById('cat-edit-equipment').value;
  const muscleGroup = document.getElementById('cat-edit-muscle').value.trim();
  const isMainLift = document.getElementById('cat-edit-main-lift').checked;

  if (!name) {
    msgEl.innerHTML = `<div class="inline-message error">Name can't be empty.</div>`;
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('Workout_Exercise')
      .update({ name, equipment, muscle_group: muscleGroup || null, is_main_lift: isMainLift })
      .eq('id', exerciseId);
    if (error) throw error;

    logState.loaded = false;
    await loadTemplatesAndCatalog();
    renderExerciseCatalogManager();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function deleteExerciseFromCatalog(exerciseId) {
  if (!confirm('Delete this exercise from your catalog?')) return;
  const msgEl = document.getElementById('cat-edit-message');

  try {
    const { error } = await supabaseClient.from('Workout_Exercise').delete().eq('id', exerciseId);
    if (error) throw error;

    logState.loaded = false;
    await loadTemplatesAndCatalog();
    renderExerciseCatalogManager();
  } catch (err) {
    console.error(err);
    const friendly = (err.message || '').includes('foreign key')
      ? "Can't delete — it's used in past workouts or templates. Rename it instead if it needs fixing."
      : (err.message || 'unknown error');
    msgEl.innerHTML = `<div class="inline-message error">${escapeHtml(friendly)}</div>`;
  }
}
