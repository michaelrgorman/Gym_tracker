// ---------- Supabase client ----------
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
}

navButtons.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.target));
});

// ---------- Connection check ----------
async function checkConnection() {
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    dot.classList.add('error');
    text.textContent = 'Add your Supabase URL/key in config.js';
    return;
  }

  const { error } = await supabase.from('Workout_Exercise').select('id').limit(1);

  if (error) {
    dot.classList.add('error');
    text.textContent = 'Connection failed — check config.js and RLS policies';
    console.error(error);
  } else {
    dot.classList.add('connected');
    text.textContent = 'Connected to Supabase';
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
