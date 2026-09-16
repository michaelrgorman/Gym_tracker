// ---------- Supabase client ----------
let supabaseClient = null;
let supabaseInitError = null;

try {
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('Supabase credentials not set in config.js');
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  supabaseInitError = err;
  console.error(err);
}

// ---------- Tab navigation ----------
const navButtons = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view');
const headerTitle = document.getElementById('header-title');
const headerSubline = document.getElementById('header-subline');

function switchTab(targetId) {
  views.forEach(v => v.classList.toggle('active', v.id === targetId));
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.target === targetId));

  const activeView = document.getElementById(targetId);
  headerTitle.textContent = activeView.dataset.title;
  headerSubline.textContent = activeView.dataset.subline;

  if (targetId === 'view-home' && typeof onHomeTabShown === 'function') {
    onHomeTabShown();
  }
  if (targetId === 'view-log' && typeof onLogTabShown === 'function') {
    onLogTabShown();
  }
  if (targetId === 'view-history' && typeof onHistoryTabShown === 'function') {
    onHistoryTabShown();
  }
  if (targetId === 'view-progress' && typeof onProgressTabShown === 'function') {
    onProgressTabShown();
  }
  if (targetId === 'view-best' && typeof onBestTabShown === 'function') {
    onBestTabShown();
  }
}

navButtons.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.target));
});

document.getElementById('home-start-workout-btn').addEventListener('click', () => switchTab('view-log'));

// ---------- Connection check ----------
async function checkConnection() {
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');

  if (supabaseInitError) {
    dot.classList.add('error');
    text.textContent = 'Add your Supabase URL/key in config.js';
    return;
  }

  try {
    const { error } = await supabaseClient.from('Workout_Exercise').select('id').limit(1);

    if (error) {
      dot.classList.add('error');
      text.textContent = 'Connection failed — check config.js and RLS policies';
      console.error(error);
    } else {
      dot.classList.add('connected');
      text.textContent = 'Connected to Supabase';
    }
  } catch (err) {
    dot.classList.add('error');
    text.textContent = 'Connection failed — check config.js';
    console.error(err);
  }
}

checkConnection();

// ---------- PWA: service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.error('Service worker registration failed:', err);
    });
  });
}
