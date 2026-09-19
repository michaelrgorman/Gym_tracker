// ============================================================
// Mock powerlifting meet — 3 attempts each on Squat/Bench/Deadlift,
// ending in a Total and DOTS score. Kept separate from regular
// training sessions.
// ============================================================

const MEET_LIFT_ORDER = ['squat', 'bench', 'deadlift'];

const meetState = {
  active: null // { bodyweight_kg, isMale, liftIndex, attempts: {squat:[],bench:[],deadlift:[]} }
};

function calcDots(totalKg, bodyweightKg, isMale) {
  const coeffs = isMale
    ? [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093]
    : [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706];
  const bw = bodyweightKg;
  const denom = coeffs[0] + coeffs[1] * bw + coeffs[2] * bw ** 2 + coeffs[3] * bw ** 3 + coeffs[4] * bw ** 4;
  return (totalKg * 500) / denom;
}

function getLastMeetSex() {
  try {
    return localStorage.getItem('iron-log-meet-sex') || 'male';
  } catch (e) {
    return 'male';
  }
}

function setLastMeetSex(sex) {
  try {
    localStorage.setItem('iron-log-meet-sex', sex);
  } catch (e) { /* ignore */ }
}

function openMeetSetup() {
  const root = document.getElementById('log-root');
  const lastSex = getLastMeetSex();

  root.innerHTML = `
    <div class="section-label">Start mock meet</div>
    <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
      Squat, Bench, Deadlift — 3 attempts each, same order as a real meet.
    </p>
    <div class="field">
      <label>Bodyweight (kg)</label>
      <input type="number" step="0.1" id="meet-bodyweight-input">
    </div>
    <div class="field">
      <label>For DOTS calculation</label>
      <select id="meet-sex-input">
        <option value="male" ${lastSex === 'male' ? 'selected' : ''}>Male</option>
        <option value="female" ${lastSex === 'female' ? 'selected' : ''}>Female</option>
      </select>
    </div>
    <div id="meet-setup-message"></div>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-secondary" id="meet-cancel-btn">Cancel</button>
      <button class="btn-primary" id="meet-begin-btn">Begin Meet</button>
    </div>
    <button class="new-exercise-toggle" id="meet-history-link-btn" style="margin-top:16px;">View past meets</button>
  `;

  document.getElementById('meet-cancel-btn').addEventListener('click', renderStartScreen);
  document.getElementById('meet-history-link-btn').addEventListener('click', renderMeetHistory);
  document.getElementById('meet-begin-btn').addEventListener('click', async () => {
    const bwInput = document.getElementById('meet-bodyweight-input');
    const sexInput = document.getElementById('meet-sex-input');
    const msgEl = document.getElementById('meet-setup-message');
    const bodyweight = parseFloat(bwInput.value);

    if (!bodyweight) {
      msgEl.innerHTML = `<div class="inline-message error">Enter your bodyweight to continue.</div>`;
      return;
    }

    setLastMeetSex(sexInput.value);

    const mainLiftData = await fetchMainLiftData();
    const attempts = { squat: [], bench: [], deadlift: [] };

    meetState.active = {
      bodyweight_kg: bodyweight,
      isMale: sexInput.value === 'male',
      liftIndex: 0,
      attempts,
      mainLiftData
    };

    renderMeetAttemptScreen();
  });
}

function suggestedOpener(category) {
  const entries = meetState.active.mainLiftData[category] || [];
  if (!entries.length) return '';
  const best = entries.reduce((max, e) => (e.e1rm > max.e1rm ? e : max), entries[0]);
  return roundToNearest(best.e1rm * 0.90, 2.5);
}

function suggestedNextAttempt(category) {
  const attempts = meetState.active.attempts[category];
  if (attempts.length === 0) return suggestedOpener(category);
  const last = attempts[attempts.length - 1];
  const increment = category === 'bench' ? 2.5 : 5;
  return last.result === 'good' ? roundToNearest(last.weight_kg + increment, 2.5) : last.weight_kg;
}

function renderMeetAttemptScreen() {
  const root = document.getElementById('log-root');
  const state = meetState.active;
  const category = MEET_LIFT_ORDER[state.liftIndex];
  const attempts = state.attempts[category];
  const attemptNumber = attempts.length + 1;

  if (attemptNumber > 3) {
    if (state.liftIndex < MEET_LIFT_ORDER.length - 1) {
      state.liftIndex += 1;
      renderMeetAttemptScreen();
    } else {
      renderMeetResults();
    }
    return;
  }

  const suggested = suggestedNextAttempt(category);

  const attemptChips = attempts.map((a, i) =>
    `<span class="previous-chip ${a.result === 'good' ? '' : 'target'}" style="${a.result === 'good' ? '' : 'color:var(--danger); border-color:var(--danger);'}">${a.weight_kg}kg ${a.result === 'good' ? '✓' : '✗'}</span>`
  ).join('');

  root.innerHTML = `
    <div class="section-label">Mock Meet · ${LIFT_LABELS[category]} · Attempt ${attemptNumber} of 3</div>
    ${attempts.length ? `<div class="previous-chip-row" style="padding-left:0;">${attemptChips}</div>` : ''}
    <div class="field" style="margin-top:14px;">
      <label>Weight (kg)</label>
      <input type="number" step="2.5" id="meet-attempt-weight-input" value="${suggested}">
    </div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button class="btn-primary" id="meet-good-lift-btn" style="background: var(--success); border-color: var(--success);">Good Lift</button>
      <button class="btn-secondary" id="meet-no-lift-btn" style="border-color: var(--danger); color: var(--danger);">No Lift</button>
    </div>
    ${attempts.length < 3 ? `<button class="new-exercise-toggle" id="meet-skip-lift-btn" style="margin-top:14px;">Skip remaining attempts for this lift</button>` : ''}
  `;

  const weightInput = document.getElementById('meet-attempt-weight-input');

  document.getElementById('meet-good-lift-btn').addEventListener('click', () => recordAttempt(category, weightInput.value, 'good'));
  document.getElementById('meet-no-lift-btn').addEventListener('click', () => recordAttempt(category, weightInput.value, 'no_lift'));

  const skipBtn = document.getElementById('meet-skip-lift-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      if (state.liftIndex < MEET_LIFT_ORDER.length - 1) {
        state.liftIndex += 1;
        renderMeetAttemptScreen();
      } else {
        renderMeetResults();
      }
    });
  }
}

function recordAttempt(category, weightStr, result) {
  const weight = parseFloat(weightStr);
  if (!weight) return;

  meetState.active.attempts[category].push({ weight_kg: weight, result });
  renderMeetAttemptScreen();
}

function bestAttempt(attempts) {
  const goodOnes = attempts.filter(a => a.result === 'good');
  if (goodOnes.length === 0) return 0;
  return Math.max(...goodOnes.map(a => a.weight_kg));
}

function renderMeetResults() {
  const root = document.getElementById('log-root');
  const state = meetState.active;

  const bests = {};
  MEET_LIFT_ORDER.forEach(cat => { bests[cat] = bestAttempt(state.attempts[cat]); });

  const total = bests.squat + bests.bench + bests.deadlift;
  const dots = total > 0 ? calcDots(total, state.bodyweight_kg, state.isMale) : 0;

  root.innerHTML = `
    <div class="section-label">Meet Results</div>
    ${MEET_LIFT_ORDER.map(cat => `
      <div class="pr-card">
        <span class="pr-label">${liftDot(cat)}${LIFT_LABELS[cat]}</span>
        <div class="pr-value"><div class="pr-e1rm">${bests[cat] || '—'}</div><div class="pr-unit">kg</div></div>
      </div>
    `).join('')}
    <div class="pr-card" style="border-color: var(--deadlift);">
      <span class="pr-label">Total</span>
      <div class="pr-value"><div class="pr-e1rm">${total}</div><div class="pr-unit">kg</div></div>
    </div>
    <div class="pr-card">
      <span class="pr-label">DOTS</span>
      <div class="pr-value"><div class="pr-e1rm">${dots.toFixed(1)}</div><div class="pr-unit">score</div></div>
    </div>
    <div id="meet-save-message"></div>
    <button class="btn-primary finish-btn" id="meet-save-btn">Save Meet</button>
    <button class="new-exercise-toggle" id="meet-discard-btn" style="margin-top:10px;">Discard</button>
  `;

  document.getElementById('meet-save-btn').addEventListener('click', () => saveMeet(bests, total, dots));
  document.getElementById('meet-discard-btn').addEventListener('click', () => {
    if (!confirm('Discard this mock meet?')) return;
    meetState.active = null;
    renderStartScreen();
  });
}

async function saveMeet(bests, total, dots) {
  const state = meetState.active;
  const msgEl = document.getElementById('meet-save-message');
  msgEl.innerHTML = `<div class="inline-message">Saving…</div>`;

  try {
    const { data: meetRow, error: meetError } = await supabaseClient
      .from('Workout_Meet')
      .insert({
        date: new Date().toISOString().slice(0, 10),
        bodyweight_kg: state.bodyweight_kg,
        total_kg: total,
        dots_score: dots
      })
      .select()
      .single();
    if (meetError) throw meetError;

    const attemptRows = [];
    MEET_LIFT_ORDER.forEach(cat => {
      state.attempts[cat].forEach((a, i) => {
        attemptRows.push({
          meet_id: meetRow.id,
          lift_category: cat,
          attempt_number: i + 1,
          weight_kg: a.weight_kg,
          result: a.result
        });
      });
    });

    const { error: attemptsError } = await supabaseClient.from('Workout_MeetAttempt').insert(attemptRows);
    if (attemptsError) throw attemptsError;

    meetState.active = null;
    renderMeetHistory();
  } catch (err) {
    console.error(err);
    msgEl.innerHTML = `<div class="inline-message error">Couldn't save: ${escapeHtml(err.message || 'unknown error')}</div>`;
  }
}

async function renderMeetHistory() {
  const root = document.getElementById('log-root');
  root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

  try {
    const { data, error } = await supabaseClient
      .from('Workout_Meet')
      .select('id, date, bodyweight_kg, total_kg, dots_score')
      .order('date', { ascending: false });
    if (error) throw error;

    const meets = data || [];
    const daysSinceLast = meets.length ? Math.floor((Date.now() - new Date(meets[0].date).getTime()) / 86400000) : null;

    const listHtml = meets.length
      ? meets.map(m => `
          <div class="session-card">
            <div class="session-title">${formatDateLong(m.date)}</div>
            <div class="session-meta">Total: ${m.total_kg} kg · DOTS: ${m.dots_score ? m.dots_score.toFixed(1) : '—'} · BW: ${m.bodyweight_kg} kg</div>
          </div>
        `).join('')
      : `<div class="inline-message">No mock meets logged yet.</div>`;

    root.innerHTML = `
      <button class="back-btn" id="meet-history-back-btn">‹ Back</button>
      <div class="section-label">Mock meet history</div>
      ${daysSinceLast !== null ? `<div class="inline-message" style="margin-bottom:12px;">${daysSinceLast} days since your last meet — testing every ~90 days is a common cadence.</div>` : ''}
      ${listHtml}
      <button class="btn-primary finish-btn" id="meet-history-new-btn">Start a new mock meet</button>
    `;

    document.getElementById('meet-history-back-btn').addEventListener('click', renderStartScreen);
    document.getElementById('meet-history-new-btn').addEventListener('click', openMeetSetup);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="num">Couldn't load meets</div><p>${escapeHtml(err.message || 'Unknown error')}</p></div>`;
  }
}
