// ============================================================
// Export all data to a multi-sheet .xlsx file (via SheetJS)
// ============================================================

function toMinutes(startIso, endIso) {
  if (!endIso) return '';
  return Math.round((new Date(endIso) - new Date(startIso)) / 60000);
}

function toDateStr(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD, sorts/reads cleanly in Excel
}

async function exportAllDataToExcel() {
  const btn = document.getElementById('export-excel-btn');
  const msgEl = document.getElementById('export-message');
  const originalLabel = btn.textContent;
  btn.textContent = 'Exporting…';
  msgEl.innerHTML = '';

  try {
    const [sessions, exercises, templates, bodyweight, goals, meets, meetAttempts] = await Promise.all([
      fetchExportSessions(),
      fetchExportExercises(),
      fetchExportTemplates(),
      fetchExportBodyweight(),
      fetchExportGoals(),
      fetchExportMeets(),
      fetchExportMeetAttempts()
    ]);

    const { sessionRows, setRows } = flattenSessions(sessions);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionRows), 'Sessions');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(setRows), 'Sets');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exercises), 'Exercises');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(templates), 'Templates');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bodyweight), 'Bodyweight');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(goals), 'Goals');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meets), 'Meets');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meetAttempts), 'Meet Attempts');

    const filename = `iron-log-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);

    msgEl.innerHTML = `<div class="inline-message success">Downloaded ${filename}</div>`;
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Export failed: ${escapeHtml(err.message || 'unknown error')}</div>`;
  } finally {
    btn.textContent = originalLabel;
  }
}

async function fetchExportSessions() {
  const { data, error } = await supabaseClient
    .from('Workout_Session')
    .select('id, title, start_time, end_time, notes, program_week, Workout_Set(set_index, set_type, weight_kg, reps, rpe, notes, superset_id, Workout_Exercise(name))')
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

function flattenSessions(sessions) {
  const sessionRows = [];
  const setRows = [];

  sessions.forEach(s => {
    sessionRows.push({
      Date: toDateStr(s.start_time),
      Title: s.title,
      'Start Time': s.start_time ? new Date(s.start_time).toLocaleTimeString() : '',
      'Duration (min)': toMinutes(s.start_time, s.end_time),
      'Program Week': s.program_week || '',
      Notes: s.notes || ''
    });

    (s.Workout_Set || []).forEach(set => {
      setRows.push({
        Date: toDateStr(s.start_time),
        Session: s.title,
        Exercise: set.Workout_Exercise ? set.Workout_Exercise.name : '',
        'Set #': set.set_index,
        Type: set.set_type,
        'Weight (kg)': set.weight_kg,
        Reps: set.reps,
        RPE: set.rpe || '',
        Superset: set.superset_id || '',
        Notes: set.notes || ''
      });
    });
  });

  return { sessionRows, setRows };
}

async function fetchExportExercises() {
  const { data, error } = await supabaseClient
    .from('Workout_Exercise')
    .select('name, equipment, muscle_group, is_main_lift')
    .order('name');
  if (error) throw error;
  return (data || []).map(e => ({
    Name: e.name,
    Equipment: e.equipment || '',
    'Muscle Group': e.muscle_group || '',
    'Main Lift': e.is_main_lift ? 'Yes' : 'No'
  }));
}

async function fetchExportTemplates() {
  const { data, error } = await supabaseClient
    .from('Workout_Template')
    .select('name, Workout_TemplateExercise(order_index, target_sets, target_reps, Workout_Exercise(name))')
    .order('name');
  if (error) throw error;

  const rows = [];
  (data || []).forEach(t => {
    (t.Workout_TemplateExercise || [])
      .sort((a, b) => a.order_index - b.order_index)
      .forEach(te => {
        rows.push({
          Template: t.name,
          Order: te.order_index,
          Exercise: te.Workout_Exercise ? te.Workout_Exercise.name : '',
          'Target Sets': te.target_sets || '',
          'Target Reps': te.target_reps || ''
        });
      });
  });
  return rows;
}

async function fetchExportBodyweight() {
  const { data, error } = await supabaseClient
    .from('Workout_Bodyweight')
    .select('date, weight_kg, notes')
    .order('date');
  if (error) throw error;
  return (data || []).map(b => ({ Date: b.date, 'Weight (kg)': b.weight_kg, Notes: b.notes || '' }));
}

async function fetchExportGoals() {
  const { data, error } = await supabaseClient.from('Workout_Goal').select('lift_category, target_weight_kg, target_date');
  if (error) throw error;
  return (data || []).map(g => ({
    Lift: LIFT_LABELS[g.lift_category] || g.lift_category,
    'Target (kg e1RM)': g.target_weight_kg,
    'Target Date': g.target_date || ''
  }));
}

async function fetchExportMeets() {
  const { data, error } = await supabaseClient
    .from('Workout_Meet')
    .select('date, bodyweight_kg, total_kg, dots_score, notes')
    .order('date');
  if (error) throw error;
  return (data || []).map(m => ({
    Date: m.date,
    'Bodyweight (kg)': m.bodyweight_kg,
    'Total (kg)': m.total_kg,
    DOTS: m.dots_score ? m.dots_score.toFixed(1) : '',
    Notes: m.notes || ''
  }));
}

async function fetchExportMeetAttempts() {
  const { data, error } = await supabaseClient
    .from('Workout_MeetAttempt')
    .select('attempt_number, lift_category, weight_kg, result, Workout_Meet(date)')
    .order('meet_id');
  if (error) throw error;
  return (data || []).map(a => ({
    Date: a.Workout_Meet ? a.Workout_Meet.date : '',
    Lift: LIFT_LABELS[a.lift_category] || a.lift_category,
    'Attempt #': a.attempt_number,
    'Weight (kg)': a.weight_kg,
    Result: a.result === 'good' ? 'Good Lift' : 'No Lift'
  }));
}

document.getElementById('export-excel-btn').addEventListener('click', exportAllDataToExcel);
