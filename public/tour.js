// First-time guided tour. Short steps in simple (A2) English.
// Each screen (home, GM board, listener) has its own tour. It runs once per device,
// on the first visit to that screen. The "?" button runs it again at any time.

const KEY = (name) => `tour:${name}:done`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: the tour just shows again next time */ } },
};

// A step: { target: CSS selector or null, title, text }. A step whose target is not on
// the page is skipped (for example "Share link" on the solo board).
export const TOURS = {
  home: [
    { target: null, title: 'Welcome to Dandanaka', text: 'This is a soundboard for your game table. Everyone at the table hears the same sound at the same time.' },
    { target: '#start', title: 'Are you the GM?', text: 'Tap here. You get a room and a board of sounds.' },
    { target: '#joinrow', title: 'Are you a player?', text: 'Your GM gives you a room code. Type it here and tap Join. Or just open the link from your GM.' },
    { target: '#solo', title: 'Playing alone?', text: 'Use the solo board. The sound plays only on this device.' },
  ],
  board: [
    { target: null, title: 'This is your board', text: 'You are the GM. You tap a pad, and every player hears it.' },
    { target: '.pad.loop', title: 'Loop pads', text: 'A loop plays again and again. Tap once to start it. Tap again to stop it. A slider shows up for its volume.' },
    { target: '.pad.shot', title: 'One-shot pads', text: 'A one-shot plays one time. Use it for a door, a sword or a roar.' },
    { target: '#share', title: 'Invite your players', text: 'Tap Share link and send it to your players. They open it and tap once. Then they hear your sounds.' },
    { target: '#share + .status', title: 'Who is listening', text: 'Here you see how many players are connected. A green dot means all is good.' },
    { target: '.top .master', title: 'Volume for everyone', text: 'Master changes the volume for the whole table.' },
    { target: '#stopall', title: 'Stop all', text: 'This stops every sound at once.' },
    { target: '#help', title: 'Need help again?', text: 'Tap the ? button to see this tour again.' },
  ],
  listen: [
    { target: null, title: 'You are in', text: 'Your GM plays the sounds. You do not need to tap anything.' },
    { target: '#now', title: 'Now playing', text: 'Here you see the sounds that play now.' },
    { target: '#lvol', title: 'Your volume', text: 'This changes the volume on your device only. Mute stops the sound for you.' },
    { target: '#keepopen', title: 'Keep this page open', text: 'Do not lock your phone and do not change apps. If you do, the sound stops.' },
    { target: '#help', title: 'Need help again?', text: 'Tap the ? button to see this tour again.' },
  ],
};

let active = null;

export function hasSeen(name) { return store.get(KEY(name)) === '1'; }

// Show the tour for this screen if this device has not seen it yet.
export function maybeStartTour(name, root = document) {
  if (hasSeen(name)) return false;
  startTour(name, root);
  return true;
}

export function startTour(name, root = document) {
  endTour();
  const steps = (TOURS[name] || []).filter((s) => !s.target || root.querySelector(s.target));
  if (!steps.length) return;

  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'tour-title');
  layer.innerHTML = `
    <div class="tour-shade"></div>
    <div class="tour-ring" hidden></div>
    <div class="tour-card">
      <p class="tour-count" id="tour-count"></p>
      <h2 id="tour-title"></h2>
      <p class="tour-text" id="tour-text"></p>
      <div class="tour-btns">
        <button class="ghost" id="tour-skip">Skip</button>
        <button class="ghost" id="tour-back">Back</button>
        <button class="tour-next" id="tour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(layer);

  const ring = layer.querySelector('.tour-ring');
  const card = layer.querySelector('.tour-card');
  let i = 0;

  const place = () => {
    const step = steps[i];
    const el = step.target && root.querySelector(step.target);
    layer.classList.toggle('spot', !!el);
    if (!el) {
      ring.hidden = true;
      card.classList.add('mid');
      card.style.top = ''; card.style.bottom = '';
      return;
    }
    card.classList.remove('mid');
    const r = el.getBoundingClientRect();
    const pad = 6;
    ring.hidden = false;
    ring.style.left = `${r.left - pad}px`; ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`; ring.style.height = `${r.height + pad * 2}px`;
    // card goes below the target if there is room, else above it
    const below = r.bottom + 14 + card.offsetHeight < window.innerHeight;
    if (below) { card.style.top = `${Math.round(r.bottom + 14)}px`; card.style.bottom = ''; }
    else { card.style.top = ''; card.style.bottom = `${Math.round(window.innerHeight - r.top + 14)}px`; }
  };

  const show = () => {
    const step = steps[i];
    layer.querySelector('#tour-count').textContent = `${i + 1} of ${steps.length}`;
    layer.querySelector('#tour-title').textContent = step.title;
    layer.querySelector('#tour-text').textContent = step.text;
    layer.querySelector('#tour-back').hidden = i === 0;
    layer.querySelector('#tour-next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    const el = step.target && root.querySelector(step.target);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    requestAnimationFrame(place);
    layer.querySelector('#tour-next').focus({ preventScroll: true });
  };

  const finish = () => { store.set(KEY(name), '1'); endTour(); };
  layer.querySelector('#tour-next').onclick = () => { if (i < steps.length - 1) { i++; show(); } else finish(); };
  layer.querySelector('#tour-back').onclick = () => { if (i > 0) { i--; show(); } };
  layer.querySelector('#tour-skip').onclick = finish;
  const onKey = (e) => {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight') layer.querySelector('#tour-next').click();
    else if (e.key === 'ArrowLeft') layer.querySelector('#tour-back').click();
  };
  const onResize = () => place();
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, { passive: true });

  active = { name, layer, cleanup: () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize);
  } };
  show();
}

export function endTour() {
  if (!active) return;
  active.cleanup();
  active.layer.remove();
  active = null;
}

export function tourOpen() { return !!active; }
