'use strict';
/* Did you do it? — daily check-in with exact timers. No dependencies. */
const KEY = 'daily-check-v1';
const DEFAULT_TASKS = [
  { id: 'math', icon: '📐', name: 'Math INF401 · focused', goalMin: 300 },
  { id: 'telc', icon: '🗣', name: 'telc C1 · Sprechen', goalMin: 180 },
];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- state ---------- */
let S = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  s = s && typeof s === 'object' ? s : {};
  // goals are fixed in code: whatever is in storage can not change them
  return { days: {}, running: null, theme: '', celebrated: {}, badges: {}, tgMsgs: {}, tgFinal: {}, awayLog: [], ...s, tasks: DEFAULT_TASKS.map(t => ({ ...t })) };
}
const SEAL = KEY + '-seal', FLAG = KEY + '-flag';
// tamper seal: a hash of everything that matters. Hand-edits in DevTools break it and get flagged.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const sealOf = () => String(cyrb53(JSON.stringify([S.days, S.since, S.running, S.celebrated]) + '|no-cheating'));
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); localStorage.setItem(SEAL, sealOf()); } catch (e) {}
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const nextMidnight = t => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
const prettyDay = k => {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  return fromKey(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
};

/* ---------- day data ---------- */
function entry(day, id, create) {
  const d = S.days[day] || (create ? (S.days[day] = {}) : null);
  if (!d) return { ms: 0 };
  return d[id] || (create ? (d[id] = { ms: 0 }) : { ms: 0 });
}
// live ms for a task on a day (includes the running timer's uncommitted part)
function msOf(day, id) {
  let ms = entry(day, id).ms;
  const r = S.running;
  if (r && r.id === id && keyOf(new Date(r.start)) === day) ms += Date.now() - r.start;
  return ms;
}
const goalMs = t => t.goalMin * 60000;
// Ledger instead of a cliff. No percentages decide anything, only minutes, and only between NEIGHBOUR days:
//   - overtime on a day is banked for the NEXT day only (covers its shortfall)
//   - a shortfall is a debt for the NEXT day only: do that many extra minutes and the short day counts
//   - nothing chains: old debt expires after one day, so you never owe more than ONE day's own gap
//   yes  = reached 100% of the goal that day
//   near = below 100% but covered by banked overtime or repaid the next day (you must have worked that day)
//   no   = past day, too little work and not repaid (still shows its real time, never zero)
const ratio = (day, t) => msOf(day, t.id) / goalMs(t);
let ledgerCache = {};
function ledger(t) {
  const sec = Math.floor(Date.now() / 1000), c = ledgerCache[t.id];
  if (c && c.sec === sec) return c.v;
  const goal = goalMs(t), v = {}, t0 = todayKey();
  let k = dayKeys()[0] && dayKeys()[0] < S.since ? dayKeys()[0] : S.since, prev = null, credit = 0, debt = 0;
  for (; k <= t0; k = addDays(k, 1)) {
    const ms = msOf(k, t.id), d = v[k] = { ms, covered: false, need: 0 };
    if (ms >= goal) {
      let extra = ms - goal;
      if (prev && debt > 0) {                           // overtime repays yesterday's debt first
        const pay = Math.min(debt, extra); debt -= pay; extra -= pay;
        if (debt === 0) prev.covered = true; else prev.need = debt;
      }
      credit = extra; debt = 0;                          // what is left is banked for tomorrow only
    } else {
      let need = goal - ms;
      if (credit > 0 && ms > 0) need -= Math.min(credit, need);  // yesterday's banked overtime
      if (prev && debt > 0) prev.need = debt;            // yesterday's debt was not repaid: it expires
      credit = 0;
      if (ms > 0 && need === 0) d.covered = true;
      d.need = ms > 0 ? need : 0;
      debt = d.need;
    }
    prev = d;
  }
  ledgerCache[t.id] = { sec, v };
  return v;
}
function status(day, t) {
  const d = ledger(t)[day];
  if (d && d.ms >= goalMs(t)) return 'yes';
  if (d && d.covered) return 'near';
  return day < todayKey() ? 'no' : null;
}
const counts = (day, t) => { const s = status(day, t); return s === 'yes' || s === 'near'; };

/* ---------- timer (timestamp based, so it is exact even if the tab sleeps) ---------- */
function commit(now = Date.now()) {
  const r = S.running;
  if (!r) return;
  let t = r.start;
  while (t < now) {
    const end = Math.min(now, nextMidnight(t));
    entry(keyOf(new Date(t)), r.id, true).ms += end - t;
    t = end;
  }
  r.start = now;
  save();
}
function startTimer(id) {
  if (S.running) commit();
  S.running = { id, start: Date.now(), since: Date.now() };
  { const t = S.tasks.find(x => x.id === id); tgPing(`▶ ${t.icon || ''} <b>${esc(t.name)}</b> started`); }
  save(); render(); tgSync();
}
const AWAY_MS = 3 * 60 * 1000;
// While the page is alive the saved start is refreshed every 10s. If it is older than 3 min, the page was
// closed, asleep or frozen: that gap is NOT counted and the timer stops.
function awayDiscard(now) {
  const gap = now - S.running.start;
  (S.awayLog = S.awayLog || []).push({ at: now, gap, task: S.running.id });
  S.awayLog = S.awayLog.slice(-30);
  S.running = null; save(); tgSync();
  tgPing(`⚠ Timer stopped. You were away for ${hm(gap)}, not counted.`);
  toast(`Timer paused. You were away for ${hm(gap)} and that time was not counted.`, 6000);
}
function stopTimer() {
  commit();
  if (S.running) { const t = S.tasks.find(x => x.id === S.running.id); tgPing(`⏸ ${t.icon || ''} <b>${esc(t.name)}</b> paused · ${hm(msOf(todayKey(), t.id))}`); }
  S.running = null;
  save(); render(); tgSync();
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    [0, .25, .5].forEach(o => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.frequency.value = 880; osc.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(.18, c.currentTime + o);
      g.gain.exponentialRampToValueAtTime(.001, c.currentTime + o + .2);
      osc.start(c.currentTime + o); osc.stop(c.currentTime + o + .22);
    });
  } catch (e) {}
}

/* ---------- formatting ---------- */
const clock = ms => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
const hm = ms => {
  const m = Math.round(Math.max(0, ms) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};

/* ---------- stats ---------- */
function streak(t) {
  let k = todayKey();
  if (!counts(k, t)) k = addDays(k, -1); // today still open: don't break the streak yet
  let n = 0;
  while (counts(k, t)) { n++; k = addDays(k, -1); }
  return n;
}
function lastDays(n, from = todayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(from, i - n + 1));
}
function stats(t) {
  const t0 = todayKey();
  const d30 = lastDays(30, t0);
  const d7 = lastDays(7, t0);
  const hit30 = d30.filter(k => counts(k, t)).length;
  const week = d7.reduce((a, k) => a + msOf(k, t.id), 0);
  let total = 0;
  for (const k in S.days) total += msOf(k, t.id);
  return { streak: streak(t), hit30, week, total };
}

/* ---------- view ---------- */
let viewDay = todayKey();
const view = $('#view');

function render() {
  const t0 = todayKey();
  if (viewDay > t0) viewDay = t0;
  const isToday = viewDay === t0;
  let h = '';

  let flag = null;
  try { flag = localStorage.getItem(FLAG); } catch (e) {}
  if (flag) h += `<div class="banner">⚠ Saved data was edited outside the app (detected ${fmtDate(flag)}). Your record is marked.</div>`;

  h += plannerCard();

  h += `<div class="daynav">
    <button class="btn icon" data-nav="-1" title="Previous day">←</button>
    <h2>${prettyDay(viewDay)}<span class="muted small" style="font-weight:400;margin-left:10px">${viewDay}</span></h2>
    ${isToday ? '' : '<button class="btn" data-nav="today">Back to today</button>'}
    <button class="btn icon" data-nav="1" title="Next day" ${isToday ? 'disabled' : ''}>→</button>
  </div>`;

  h += `<div class="grid">`;
  for (const t of S.tasks) h += taskCard(t, isToday);
  h += `</div>`;

  h += `<div class="grid" style="margin-top:16px">`;
  for (const t of S.tasks) h += statsCard(t);
  h += badgeShelf();
  h += `</div>`;

  h += settingsCard();
  h += tgCard();
  view.innerHTML = h;
  tick();
}

/* ---------- planner: one block per day until the exam ---------- */
function verdict(k) {
  const t0 = todayKey();
  if (k > t0) return 'f';
  const st = S.tasks.map(t => status(k, t));
  const effort = S.tasks.reduce((a, t) => a + Math.min(1, ratio(k, t)), 0) / S.tasks.length; // 0..1, real work
  if (st.every(x => x === 'yes')) return 'g';       // everything at 100%
  if (k === t0) return effort > 0 ? 'p' : 'open';   // today is still in progress
  return effort > 0 ? 'p' : 'r';                    // any real work is never red. Red = nothing was done
}
const fmtDate = k => { const d = fromKey(k); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
function plannerCard() {
  const t0 = todayKey();
  const first = S.since < t0 ? S.since : t0;
  const last = S.examDate >= first ? S.examDate : first;
  const total = Math.round((fromKey(last) - fromKey(first)) / 864e5) + 1;
  const lead = (fromKey(first).getDay() + 6) % 7;  // Monday-first grid
  let cells = '<i class="pad"></i>'.repeat(lead), c = { g: 0, p: 0, r: 0 };
  for (let i = 0; i < total; i++) {
    const k = addDays(first, i), v = verdict(k), d = fromKey(k);
    if (c[v] !== undefined) c[v]++;
    const label = d.getDate() === 1 || i === 0 ? d.toLocaleDateString('en-GB', { month: 'short' }) : '';
    const isExam = k === last;
    const mark = isExam ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : v === 'g' ? '✓' : v === 'r' ? '✕' : v === 'p' ? Math.round(S.tasks.reduce((a, t) => a + Math.min(1, ratio(k, t)), 0) / S.tasks.length * 100) + '%' : '';
    cells += `<button class="blk ${v} ${k === t0 ? 'today' : ''} ${k === viewDay ? 'sel' : ''} ${k === last ? 'exam' : ''}" data-goto="${k}" title="${k} · ${prettyDay(k)}${k === last ? ' · EXAM' : ''}">
      <small>${label}</small><b>${isExam ? '🏁' : d.getDate()}</b><em>${mark}</em></button>`;
  }
  const left = Math.max(0, Math.round((fromKey(last) - fromKey(t0)) / 864e5));
  return `<section class="card" style="margin-bottom:16px"><div class="card-h"><h3>INF401 planner · exam ${fmtDate(last)} · ${left} day${left === 1 ? '' : 's'} left</h3>
    <div class="row small muted"><span><i class="lg g"></i>great ${c.g}</span><span><i class="lg p"></i>partial ${c.p}</span><span><i class="lg r"></i>missed ${c.r}</span></div></div>
    <div class="card-b"><div class="dow"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div><div class="planner">${cells}</div></div></section>`;
}

function taskCard(t, isToday) {
  const st = status(viewDay, t);
  const running = S.running && S.running.id === t.id && isToday;
  const goal = goalMs(t);
  return `<section class="card task s6 ${st === 'yes' ? 'done' : ''} ${running ? 'running' : ''}" data-task="${t.id}">
    <div class="card-h"><h3><span class="dot"></span>&nbsp; ${esc(t.name)}</h3>
      <span class="badge ${st === 'yes' || st === 'near' ? 'solid' : st === 'no' ? 'warn' : ''}">${st === 'yes' ? '✓ Goal reached' : st === 'near' ? `◐ Counted · ${hm(msOf(viewDay, t.id))}` : st === 'no' ? `✗ Short · ${hm(msOf(viewDay, t.id))}` : 'Goal ' + hm(goal)}</span></div>
    <div class="card-b stack">
      <div>
        <div class="clock mono" data-clock>00:00:00</div>
        <div class="muted small" data-left></div>
      </div>
      <div class="bar"><i data-bar style="width:0%"></i></div>
      ${isToday ? `<div class="row">
        ${running
          ? `<button class="btn primary lg" data-stop style="flex:1">❚❚ Pause</button>`
          : `<button class="btn primary lg" data-start="${t.id}" style="flex:1">▶ ${msOf(viewDay, t.id) > 0 ? 'Resume' : 'Start'} timer</button>`}
      </div>` : ''}
      <div class="lockline small">🔒 Only the timer counts. No manual edits, no skipping.</div>
    </div></section>`;
}

function heatmap(t) {
  const t0 = todayKey();
  const weeks = 17;
  const todayDow = (fromKey(t0).getDay() + 6) % 7; // Monday = 0
  const start = addDays(t0, -(weeks - 1) * 7 - todayDow);
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const k = addDays(start, i);
    if (k > t0) { cells += '<i class="fut"></i>'; continue; }
    const ms = msOf(k, t.id), st = k < S.since ? null : status(k, t);
    let c = '';
    if (st === 'yes') c = 'l4';
    else if (st === 'near') c = 'l3';
    else if (ms > 0) c = ms / goalMs(t) > .66 ? 'l3' : ms / goalMs(t) > .33 ? 'l2' : 'l1';
    cells += `<i class="${c} ${k === t0 ? 'today' : ''}" title="${k} · ${hm(ms)}${st ? ' · ' + st : ''}"></i>`;
  }
  return `<div class="heatwrap"><div class="heat" style="--cols:${weeks}">${cells}</div></div>`;
}

function statsCard(t) {
  const s = stats(t);
  const days = lastDays(7);
  const max = Math.max(goalMs(t), ...days.map(k => msOf(k, t.id)));
  const bars = days.map(k => {
    const ms = msOf(k, t.id);
    const d = fromKey(k).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2);
    return `<div class="${k === todayKey() ? 't' : ''}" title="${k} · ${hm(ms)}"><span>${ms ? hm(ms) : ''}</span><i class="${ms ? '' : 'z'}" style="height:${Math.max(3, ms / max * 70)}px"></i>${d}</div>`;
  }).join('');
  return `<section class="card s6"><div class="card-h"><h3>${esc(t.name)} · stats</h3></div><div class="card-b stack">
    <div class="stats4">
      <div class="stat"><b>${s.streak}</b><span>day streak</span></div>
      <div class="stat"><b>${s.hit30}/30</b><span>days done</span></div>
      <div class="stat"><b>${hm(s.week)}</b><span>last 7 days</span></div>
      <div class="stat"><b>${hm(s.total)}</b><span>all time</span></div>
    </div>
    <div class="week">${bars}</div>
    ${heatmap(t)}
  </div></section>`;
}

function settingsCard() {
  return `<details class="card" style="margin-top:16px"><summary>Settings <span class="muted small" style="font-weight:400">exam date · export</span></summary><div class="card-b stack">
    <label class="f" style="max-width:260px">INF401 exam date<input class="input" type="date" data-set-exam value="${S.examDate}"></label>
    ${(S.awayLog || []).length ? `<div class="small"><b>Away log</b> <span class="muted">(times the timer was stopped because the page wasn't running)</span><br>${(S.awayLog || []).slice(-6).reverse().map(a => `<span class="mono">${new Date(a.at).toLocaleString('en-GB')}</span> · ${hm(a.gap)} not counted`).join('<br>')}</div>` : ''}
    <div class="muted small">Goals are fixed (${S.tasks.map(t => esc(t.name) + ' ' + hm(goalMs(t))).join(' · ')}). There is no import, no manual time and no manual Yes.</div>
    <div class="row">
      <button class="btn" id="exportBtn">Export backup (read-only copy)</button>
      <button class="btn danger" id="wipeBtn">Delete all data</button>
    </div>
  </div></details>`;
}

/* ---------- telegram: ONE live message per task per day, edited in place ---------- */
const TGKEY = KEY + '-tg';                         // kept outside the data: never exported, never sealed
const tgCfg = () => {                               // browser settings win over the local config file
  let c = {}; try { c = JSON.parse(localStorage.getItem(TGKEY)) || {}; } catch (e) {}
  return { ...(window.TG_CONFIG || {}), ...c };
};
const tgOn = () => { const c = tgCfg(); return !!(c.token && c.chat); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
let tgLast = 0, tgBusy = false, tgDirty = false, tgInfo = '';
function tgStatus(msg) { tgInfo = msg; const el = $('#tgStatus'); if (el) el.textContent = msg; }
async function tgApi(method, body, token) {
  const r = await fetch(`https://api.telegram.org/bot${token || tgCfg().token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
const bar = p => { const n = Math.round(Math.min(1, p) * 12); return '▓'.repeat(n) + '░'.repeat(12 - n); };
function tgText(t, day, final) {
  const ms = msOf(day, t.id), goal = goalMs(t), done = ms >= goal;
  const running = !final && S.running && S.running.id === t.id && day === todayKey();
  const left = Math.max(0, Math.round((fromKey(S.examDate) - fromKey(todayKey())) / 864e5));
  const state = final ? (done ? '✅ <b>Goal reached</b>' : status(day, t) === 'near' ? `🟡 <b>Counted</b> (${Math.floor(ms / goal * 100)}%, covered by the ledger)` : `🔸 <b>Short</b> (${Math.floor(ms / goal * 100)}%)`)
    : running ? `🟢 <b>Running</b> since ${hhmm(S.running.since || S.running.start)}`
    : done ? '🏆 <b>Goal reached</b>' : '⏸ <b>Paused</b>';
  return `${t.icon || '⏱'} <b>${esc(t.name)}</b> · ${fmtDate(day)}\n\n${bar(ms / goal)} <b>${Math.floor(ms / goal * 100)}%</b>\n`
    + `⏱ <b>${hm(ms)}</b> / ${hm(goal)}${done ? ` · +${hm(ms - goal)}` : ` · ${hm(goal - ms)} to go`}\n\n${state}\n`
    + `🔥 Streak <b>${streak(t)}</b> · 🏁 Exam in <b>${left}</b> days\n<i>Updated ${hhmm(Date.now())}</i>`;
}
const PAUSE_KB = { inline_keyboard: [[{ text: '⏸ Pause', callback_data: 'pause' }]] }, NO_KB = { inline_keyboard: [] };
async function tgPut(t, day, final) {
  const c = tgCfg(), key = `${day}:${t.id}`, running = !final && S.running && S.running.id === t.id && day === todayKey();
  const body = { chat_id: c.chat, text: tgText(t, day, final), parse_mode: 'HTML', reply_markup: running ? PAUSE_KB : NO_KB };
  if (S.tgMsgs[key]) {
    const r = await tgApi('editMessageText', { ...body, message_id: S.tgMsgs[key] });
    if (r.ok || /not modified/i.test(r.description || '')) return true;
    if (!/not found|can't be edited/i.test(r.description || '')) throw new Error(r.description);
  }
  if (final) return false;                          // never create a message for a finished day
  const r = await tgApi('sendMessage', { ...body, disable_notification: true });
  if (!r.ok) throw new Error(r.description);
  S.tgMsgs[key] = r.result.message_id; save();
  return true;
}
function tgSync() {
  if (!tgOn()) return;
  tgLast = Date.now(); tgDirty = true;
  if (!tgBusy) tgLoop();
}
async function tgLoop() {
  tgBusy = true;
  while (tgDirty) {
    tgDirty = false;
    const today = todayKey(), yday = addDays(today, -1);
    try {
      for (const t of S.tasks) {
        const fk = `${yday}:${t.id}`;               // close yesterday's message with its final result
        if (S.tgMsgs[fk] && !S.tgFinal[fk]) { await tgPut(t, yday, true); S.tgFinal[fk] = true; save(); await sleep(1100); }
        const running = S.running && S.running.id === t.id;
        if (S.tgMsgs[`${today}:${t.id}`] || running || msOf(today, t.id) > 0) { await tgPut(t, today, false); await sleep(1100); }
      }
      tgStatus('Connected · synced ' + hhmm(Date.now()));
    } catch (e) { tgStatus('Telegram error: ' + e.message); }
  }
  tgBusy = false;
}
// Sound without clutter: Telegram never makes a sound for EDITS, only for new messages.
// So: send a tiny message with sound, delete it a few seconds later. The phone has already pinged.
async function tgPing(text) {
  const c = tgCfg();
  if (!tgOn() || c.pings === false) return;
  try {
    const r = await tgApi('sendMessage', { chat_id: c.chat, text, parse_mode: 'HTML' });
    if (r.ok) setTimeout(() => tgApi('deleteMessage', { chat_id: c.chat, message_id: r.result.message_id }).catch(() => {}), 8000);
  } catch (e) {}
}
async function tgGoal(t, ms) {                       // the only NEW message of the day for a task, with sound
  const c = tgCfg();
  if (!tgOn() || c.goalNotify === false) return;
  try { await tgApi('sendMessage', { chat_id: c.chat, parse_mode: 'HTML', text: `🏆 <b>Goal reached!</b>\n${t.icon || ''} ${esc(t.name)} · <b>${clock(ms)}</b>\n🔥 Streak <b>${streak(t)}</b>` }); } catch (e) {}
}
// phone -> app. Only ever PAUSES. There is deliberately no remote start / add-time.
let tgOffset = 0, tgPolling = false;
async function tgPoll() {
  if (tgPolling || !tgOn()) return;
  tgPolling = true;
  try {
    const first = await tgApi('getUpdates', { offset: -1 });          // skip old history, never replay old commands
    if (first.ok && first.result.length) tgOffset = first.result[first.result.length - 1].update_id + 1;
    while (tgOn()) {
      const r = await tgApi('getUpdates', { offset: tgOffset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      if (!r.ok) { tgStatus('Telegram error: ' + r.description); await sleep(10000); continue; }
      for (const u of r.result) { tgOffset = u.update_id + 1; await tgHandle(u); }
    }
  } catch (e) { tgPolling = false; await sleep(8000); return tgPoll(); }
  tgPolling = false;
}
async function tgHandle(u) {
  const c = tgCfg(), cq = u.callback_query, m = u.message;
  if (cq) {
    if (String(cq.message && cq.message.chat.id) !== String(c.chat)) return;   // only YOUR chat
    if (cq.data === 'pause') {
      const was = !!S.running; if (was) stopTimer();
      await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: was ? 'Paused ⏸' : 'Timer is not running' });
    }
    return;
  }
  if (!m || String(m.chat.id) !== String(c.chat) || !m.text) return;
  const cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/pause' || cmd === '/status') {
    if (cmd === '/pause' && S.running) stopTimer(); else tgSync();
    tgApi('deleteMessage', { chat_id: c.chat, message_id: m.message_id }).catch(() => {}); // no clutter
  }
}
function tgCard() {
  const c = tgCfg();
  return `<details class="card" style="margin-top:16px"><summary>Telegram <span class="muted small" style="font-weight:400">${tgOn() ? '● connected' : 'not connected'}</span></summary><div class="card-b stack">
    <div class="muted small">One live message per task per day, edited in place. Token and chat ID stay in this browser only and are never exported.</div>
    <label class="f">Bot token<input class="input" id="tgToken" type="password" autocomplete="off" placeholder="123456:ABC…" value="${esc(c.token || '')}"></label>
    <label class="f">Chat ID<input class="input" id="tgChat" inputmode="numeric" autocomplete="off" placeholder="send /start to your bot, then press “Find my chat ID”" value="${esc(c.chat || '')}"></label>
    <label class="row small"><input type="checkbox" id="tgGoal" ${c.goalNotify === false ? '' : 'checked'}> Keep one message (with sound) when I reach a goal</label>
    <label class="row small"><input type="checkbox" id="tgPings" ${c.pings === false ? '' : 'checked'}> Sound pings on start, pause and 25/50/75% (deleted after 8 s, so the chat stays clean)</label>
    <div class="row"><button class="btn" id="tgFind">Find my chat ID</button><button class="btn primary" id="tgSave">Save &amp; connect</button><button class="btn" id="tgTest">Send test</button><button class="btn danger" id="tgOff">Disconnect</button></div>
    <div class="small muted" id="tgStatus">${esc(tgInfo)}</div>
  </div></details>`;
}

/* ---------- achievements ---------- */
const dayKeys = () => Object.keys(S.days).sort();
function longestStreak(t) {
  let best = 0, cur = 0, prev = null;
  for (const k of dayKeys()) if (counts(k, t)) { cur = prev && addDays(prev, 1) === k ? cur + 1 : 1; best = Math.max(best, cur); prev = k; }
  return best;
}
function totalMs() { let n = 0; for (const k of dayKeys()) for (const t of S.tasks) n += msOf(k, t.id); return n; }
const BADGES = [
  { id: 'first', icon: '🎯', name: 'First goal', desc: 'Hit a daily goal', test: () => dayKeys().some(k => S.tasks.some(t => status(k, t) === 'yes')) },
  { id: 'double', icon: '⚡', name: 'Double day', desc: 'Hit both goals in one day', test: () => dayKeys().some(k => S.tasks.every(t => status(k, t) === 'yes')) },
  { id: 's3', icon: '🔥', name: '3-day streak', desc: 'One task, 3 days in a row', test: () => S.tasks.some(t => longestStreak(t) >= 3) },
  { id: 's7', icon: '🌋', name: '7-day streak', desc: 'One task, 7 days in a row', test: () => S.tasks.some(t => longestStreak(t) >= 7) },
  { id: 's14', icon: '👑', name: '14-day streak', desc: 'One task, 14 days in a row', test: () => S.tasks.some(t => longestStreak(t) >= 14) },
  { id: 'over', icon: '🚀', name: 'Overachiever', desc: '150% of a daily goal', test: () => dayKeys().some(k => S.tasks.some(t => msOf(k, t.id) >= goalMs(t) * 1.5)) },
  { id: 'h20', icon: '⏱️', name: '20 hours', desc: '20 focused hours in total', test: () => totalMs() >= 20 * 36e5 },
  { id: 'h50', icon: '🧠', name: '50 hours', desc: '50 focused hours in total', test: () => totalMs() >= 50 * 36e5 },
  { id: 'h100', icon: '🏔️', name: '100 hours', desc: '100 focused hours in total', test: () => totalMs() >= 100 * 36e5 },
];
function checkBadges() {
  const fresh = [];
  for (const b of BADGES) if (!S.badges[b.id] && b.test()) { S.badges[b.id] = todayKey(); fresh.push(b); }
  if (fresh.length) save();
  return fresh;
}
function badgeShelf() {
  const n = BADGES.filter(b => S.badges[b.id]).length;
  return `<section class="card s12"><div class="card-h"><h3>Achievements</h3><span class="badge">${n}/${BADGES.length}</span></div><div class="card-b"><div class="badges">${
    BADGES.map(b => { const d = S.badges[b.id]; return `<div class="bdg ${d ? '' : 'locked'}"><span>${d ? b.icon : '🔒'}</span><b>${b.name}</b><small>${d ? fmtDate(d) : b.desc}</small></div>`; }).join('')
  }</div></div></section>`;
}

/* ---------- celebration ---------- */
const LINES = ['Locked in. Nobody can take this one away.', 'That is what discipline looks like.', 'You showed up, and the timer proves it.', 'Another block of the exam, built.', 'Distractions: 0. You: 1.'];
function celebrate(t, ms) {
  const fresh = checkBadges();
  const st = streak(t);
  const el = document.createElement('div');
  el.className = 'celeb';
  el.innerHTML = `<div class="celeb-b"><div class="trophy">🏆</div><h2>Goal reached</h2><p class="muted">${esc(t.name)}</p>
    <div class="clock mono" style="margin:10px 0">${clock(ms)}</div><p>${LINES[Math.floor(Math.random() * LINES.length)]}</p>
    <div class="row center" style="margin:14px 0"><span class="badge solid">🔥 ${st} day streak</span><span class="badge">+${hm(ms - goalMs(t))} over goal</span></div>
    ${fresh.map(b => `<div class="newbadge">${b.icon} Achievement unlocked: <b>${b.name}</b></div>`).join('')}
    <div class="row center" style="margin-top:16px"><button class="btn primary lg" data-celeb-close>Keep going (overtime)</button><button class="btn lg" data-celeb-stop>Stop timer</button></div></div>`;
  document.body.appendChild(el);
  beep(); confetti();
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.className = 'confetti'; document.body.appendChild(cv);
  const g = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
  const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue('--ok'), getComputedStyle(document.body).color, cs.getPropertyValue('--part')];
  const P = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .2, y: H * .4, vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 4, s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.floor(Math.random() * 3)] }));
  let f = 0;
  (function step() {
    g.clearRect(0, 0, W, H);
    for (const p of P) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore(); }
    if (++f < 220) requestAnimationFrame(step); else cv.remove();
  })();
}
const miles = {};
function milestones(t, ms, goal) {
  const steps = [['25', goal * .25, 'a quarter done. Keep the rhythm.'], ['50', goal * .5, 'halfway. The hard part is behind you.'], ['75', goal * .75, '75%. Final stretch.'], ['ot', goal + 36e5, '+1h overtime. Beast mode 🔥']];
  for (const [key, thr, msg] of steps) {
    const k = `${todayKey()}:${t.id}:${key}`;
    if (miles[k] === undefined) { miles[k] = ms >= thr; continue; }   // first look: silent, no replay after reload
    if (!miles[k] && ms >= thr) { miles[k] = true; toast(`${t.name}: ${msg}`, 4500); tgPing(`${t.icon || ''} <b>${esc(t.name)}</b>: ${msg}`); }
  }
}

/* ---------- live update (no re-render, only text) ---------- */
let lastDay = todayKey();
function tick() {
  const now = Date.now();
  if (S.running && now - S.running.start > AWAY_MS) { awayDiscard(now); render(); return; }
  if (S.running && keyOf(new Date(S.running.start)) !== keyOf(new Date(now))) commit(now); // crossed midnight
  if (todayKey() !== lastDay) { lastDay = todayKey(); render(); tgSync(); return; }
  const r = S.running;
  if (r) {
    const t = S.tasks.find(x => x.id === r.id), ms = msOf(todayKey(), r.id), goal = goalMs(t), ck = `${todayKey()}:${t.id}`;
    if (ms >= goal && !S.celebrated[ck]) { S.celebrated[ck] = true; save(); render(); celebrate(t, ms); tgGoal(t, ms); tgSync(); return; }
    milestones(t, ms, goal);
    if (Date.now() - tgLast > 30000) tgSync();
  }
  for (const t of S.tasks) {
    const card = $(`[data-task="${t.id}"]`);
    if (!card) continue;
    const ms = msOf(viewDay, t.id), goal = goalMs(t);
    $('[data-clock]', card).textContent = clock(ms);
    $('[data-bar]', card).style.width = Math.min(100, ms / goal * 100) + '%';
    $('[data-left]', card).textContent = ms >= goal
      ? `Goal reached · +${hm(ms - goal)} extra`
      : `${hm(goal - ms)} to go · ${Math.floor(ms / goal * 100)}% of ${hm(goal)}`;
  }
  document.title = r && viewDay === todayKey()
    ? `${clock(msOf(todayKey(), r.id))} · ${S.tasks.find(t => t.id === r.id).name}`
    : 'Did you do it? · Daily check-in';
}
setInterval(tick, 250);
setInterval(() => { if (S.running) commit(); }, 10000);          // persist progress
// Heartbeat from a Web Worker: Chrome throttles normal timers in background tabs (1 tick/min after 5 min),
// worker timers are not throttled that way, so the "I'm still alive" signal keeps coming.
try {
  const hb = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(1),5000)'], { type: 'text/javascript' })));
  hb.onmessage = () => { if (S.running) { if (Date.now() - S.running.start > AWAY_MS) tick(); else commit(); } };
} catch (e) {}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
// closing/reloading the tab while a timer runs asks for confirmation (Chrome only shows it after you clicked in the page once)
window.addEventListener('beforeunload', e => {
  if (!S.running) return;
  commit();
  e.preventDefault(); e.returnValue = '';
});

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-celeb-close')) return b.closest('.celeb').remove();
  if (b.hasAttribute('data-celeb-stop')) { b.closest('.celeb').remove(); return stopTimer(); }
  if (b.dataset.start) return startTimer(b.dataset.start);
  if (b.hasAttribute('data-stop')) return stopTimer();
  if (b.dataset.goto) { viewDay = b.dataset.goto; render(); return $('.daynav').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (b.dataset.nav) {
    viewDay = b.dataset.nav === 'today' ? todayKey() : addDays(viewDay, +b.dataset.nav);
    return render();
  }
  if (b.id === 'tgFind') return (async () => {
    const token = $('#tgToken').value.trim();
    if (!token) return tgStatus('Paste the bot token first.');
    try {
      const r = await tgApi('getUpdates', {}, token);
      if (!r.ok) return tgStatus('Telegram error: ' + r.description);
      const msgs = r.result.map(u => (u.message || u.edited_message || (u.callback_query && u.callback_query.message))).filter(Boolean);
      if (!msgs.length) return tgStatus('Nothing found. Open your bot in Telegram, send it /start, then press this again.');
      $('#tgChat').value = String(msgs[msgs.length - 1].chat.id);
      tgStatus('Found your chat ID. Now press “Save & connect”.');
    } catch (e) { tgStatus('Network error: ' + e.message); }
  })();
  if (b.id === 'tgSave') {
    const token = $('#tgToken').value.trim(), chat = $('#tgChat').value.trim();
    if (!token || !chat) return tgStatus('Token and chat ID are both needed.');
    localStorage.setItem(TGKEY, JSON.stringify({ token, chat, goalNotify: $('#tgGoal').checked, pings: $('#tgPings').checked }));
    tgStatus('Saved. Connecting…'); tgSync(); tgPoll(); return toast('Telegram connected');
  }
  if (b.id === 'tgTest') return (async () => {
    if (!tgOn()) return tgStatus('Save the token and chat ID first.');
    const r = await tgApi('sendMessage', { chat_id: tgCfg().chat, text: '✅ Connected. Your live messages will appear here and be edited in place.' }).catch(e => ({ ok: false, description: e.message }));
    tgStatus(r.ok ? 'Test message sent.' : 'Telegram error: ' + r.description);
  })();
  if (b.id === 'tgOff') { localStorage.removeItem(TGKEY); tgStatus('Disconnected.'); return render(); }
  if (b.id === 'exportBtn') {
    if (S.running) commit();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `daily-check-${todayKey()}.json`; a.click();
    return toast('Exported');
  }
  if (b.id === 'wipeBtn') {
    if (!confirm('Delete ALL data? This cannot be undone.')) return;
    [KEY, SEAL, FLAG].forEach(k => localStorage.removeItem(k)); S = load(); S.since = todayKey(); S.examDate = '2027-01-15'; save(); render(); return toast('All data deleted');
  }
  if (b.id === 'themeBtn') return setTheme(isDark() ? 'light' : 'dark');
  if (b.id === 'fsBtn') return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.hasAttribute('data-set-exam')) { if (el.value) { S.examDate = el.value; save(); } render(); }
});

/* ---------- theme / toast ---------- */
const isDark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const ICON = {
  sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  fs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
};
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  S.theme = t; save();
  $('#themeBtn').innerHTML = isDark() ? ICON.sun : ICON.moon;
}
let toastT;
function toast(msg, ms = 2400) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- boot ---------- */
// tamper check runs before anything saves
try { const sv = localStorage.getItem(SEAL); if (sv && sv !== sealOf()) localStorage.setItem(FLAG, todayKey()); } catch (e) {}
// a second tab changed the data: take over its state instead of overwriting it (prevents double counting)
window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { S = load(); render(); } });
if (!S.since) S.since = todayKey();
if (!S.examDate || S.examDate === '2027-01-21') S.examDate = '2027-01-15'; // INF401 exam (21st was the old auto-default)
save();
checkBadges();
if (tgOn()) { tgSync(); tgPoll(); }
if (S.theme) document.documentElement.dataset.theme = S.theme;
$('#themeBtn').innerHTML = isDark() ? ICON.sun : ICON.moon;
$('#fsBtn').innerHTML = ICON.fs;
render();
