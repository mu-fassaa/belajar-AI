/**
 * tools.js — Pomodoro Timer + Ambient Sound (Web Audio API)
 * Loaded after app.js as a plain <script>. Wrapped in IIFE.
 * Uses AIStorage API from storage.js for persistence.
 */
(function () {
  'use strict';

  // ── Storage helpers (all try/catch) ──
  function sGet(path, def) {
    try { return AIStorage.get(path, def); } catch (_) { return def; }
  }
  function sSet(path, val) {
    try { AIStorage.set(path, val); } catch (_) {}
  }

  // ── Constants ──
  var CIRC = 2 * Math.PI * 68; // ring circumference for r=68
  var PHASES = { focus: 'Fokus', short: 'Istirahat', long: 'Istirahat Panjang' };
  var ORIG_TITLE = document.title;

  // ── Pomodoro State ──
  var pomo = {
    phase: 'focus',      // 'focus' | 'short' | 'long'
    running: false,
    endTime: 0,           // timestamp when phase ends
    remaining: 0,         // seconds left (used when paused)
    cyclesDoneToday: 0,
    totalFocusCycles: 0,  // total since last long break
    tickInterval: null
  };

  // ── Sound State ──
  var sound = {
    ctx: null,            // AudioContext (lazy)
    masterGain: null,
    currentType: 'none',
    playing: false,
    nodes: [],            // active source nodes to disconnect
    intervals: [],        // intervals to clear
    timeouts: []          // timeouts to clear
  };

  // ── Panel State ──
  var panelOpen = false;
  var panelTab = 'pomo'; // 'pomo' | 'sound'

  // ── Wake Lock ──
  var wakeLock = null;
  var wakeLockEnabled = false;

  // ── DOM refs (set in init) ──
  var bubble, panel, backdrop;

  // =============================================
  //  INIT
  // =============================================
  function init() {
    // Restore pomodoro settings defaults if needed
    var ps = sGet('settings.pomodoro', null);
    if (!ps || typeof ps !== 'object') {
      sSet('settings.pomodoro', { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 });
    }
    var ss = sGet('settings.sound', null);
    if (!ss || typeof ss !== 'object') {
      sSet('settings.sound', { type: 'none', volume: 0.25 });
    }

    // Restore timer state
    var ts = sGet('toolsTimer', null);
    if (ts && ts.endTime && ts.running) {
      var now = Date.now();
      if (ts.endTime > now) {
        pomo.phase = ts.phase || 'focus';
        pomo.endTime = ts.endTime;
        pomo.remaining = Math.ceil((ts.endTime - now) / 1000);
        pomo.running = true;
        pomo.totalFocusCycles = ts.totalFocusCycles || 0;
      } else {
        // Timer expired while page was closed → ready for next phase
        pomo.phase = ts.phase || 'focus';
        pomo.totalFocusCycles = ts.totalFocusCycles || 0;
        advancePhase(true);
        pomo.running = false;
        pomo.endTime = 0;
      }
    } else if (ts && !ts.running && ts.remaining > 0) {
      pomo.phase = ts.phase || 'focus';
      pomo.remaining = ts.remaining;
      pomo.totalFocusCycles = ts.totalFocusCycles || 0;
    }

    // Count today's cycles
    loadTodayCycles();

    // Create DOM
    createBubble();
    createBackdrop();
    createPanel();

    // Start tick if running
    if (pomo.running) {
      startTick();
    }

    updateBubble();

    // Visibility change: re-request wake lock, resume audio context
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        if (pomo.running && wakeLockEnabled) requestWakeLock();
        if (sound.ctx && sound.ctx.state === 'suspended') {
          try { sound.ctx.resume(); } catch (_) {}
        }
      }
    });
  }

  // =============================================
  //  POMODORO CYCLE LOG
  // =============================================
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function loadTodayCycles() {
    var log = sGet('pomodoroLog', {});
    pomo.cyclesDoneToday = (log[todayKey()] || 0);
  }

  function recordCycle() {
    var log = sGet('pomodoroLog', {});
    var key = todayKey();
    log[key] = (log[key] || 0) + 1;
    sSet('pomodoroLog', log);
    pomo.cyclesDoneToday = log[key];
  }

  // =============================================
  //  BUBBLE DOM
  // =============================================
  function createBubble() {
    bubble = document.createElement('button');
    bubble.className = 'tools-bubble';
    bubble.setAttribute('aria-label', 'Buka alat belajar');
    bubble.setAttribute('aria-expanded', 'false');
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M12 1a7 7 0 0 0-7 7v2.17A3.001 3.001 0 0 0 3 13v2a3 3 0 0 0 2 2.83V18a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5v-.17A3 3 0 0 0 21 15v-2a3.001 3.001 0 0 0-2-2.83V8a7 7 0 0 0-7-7z" fill="currentColor" opacity=".25"/>' +
        '<path d="M5 10V8a7 7 0 0 1 14 0v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="3" y="11" width="4" height="6" rx="2" fill="currentColor"/>' +
        '<rect x="17" y="11" width="4" height="6" rx="2" fill="currentColor"/>' +
        '<circle cx="12" cy="14" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<line x1="12" y1="11" x2="12" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="bubble-time"></span>' +
      '<span class="sound-dot"></span>';
    bubble.addEventListener('click', togglePanel);
    document.body.appendChild(bubble);
  }

  function updateBubble() {
    if (!bubble) return;
    if (pomo.running || pomo.remaining > 0) {
      var secs = pomo.running ? Math.max(0, Math.ceil((pomo.endTime - Date.now()) / 1000)) : pomo.remaining;
      var mm = String(Math.floor(secs / 60)).padStart(2, '0');
      var ss = String(secs % 60).padStart(2, '0');
      bubble.querySelector('.bubble-time').textContent = mm + ':' + ss;
      bubble.classList.add('pill');
    } else {
      bubble.classList.remove('pill');
      bubble.querySelector('.bubble-time').textContent = '';
    }
    bubble.classList.toggle('has-sound', sound.playing);
    bubble.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
  }

  // =============================================
  //  BACKDROP
  // =============================================
  function createBackdrop() {
    backdrop = document.createElement('div');
    backdrop.className = 'tools-backdrop';
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);
  }

  // =============================================
  //  PANEL DOM
  // =============================================
  function createPanel() {
    panel = document.createElement('div');
    panel.className = 'tools-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Alat Belajar');
    document.body.appendChild(panel);
    renderPanel();
  }

  function renderPanel() {
    var ps = sGet('settings.pomodoro', { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 });
    var ssettings = sGet('settings.sound', { type: 'none', volume: 0.25 });

    var totalDur = getPhaseDuration();
    var secsLeft = pomo.running ? Math.max(0, Math.ceil((pomo.endTime - Date.now()) / 1000)) : (pomo.remaining || totalDur);
    var progress = totalDur > 0 ? (1 - secsLeft / totalDur) : 0;
    var dashOffset = CIRC * (1 - progress);
    var mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
    var ss = String(secsLeft % 60).padStart(2, '0');
    var isBreak = pomo.phase !== 'focus';
    var hasAudio = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
    var hasWakeLock = 'wakeLock' in navigator;

    panel.innerHTML =
      '<div class="tp-header">' +
        '<span class="tp-title">Alat Belajar</span>' +
        '<button class="tp-close" aria-label="Tutup">✕</button>' +
      '</div>' +
      '<div class="tp-tabs">' +
        '<button class="tp-tab' + (panelTab === 'pomo' ? ' on' : '') + '" data-tab="pomo">Pomodoro</button>' +
        '<button class="tp-tab' + (panelTab === 'sound' ? ' on' : '') + '" data-tab="sound">Suara</button>' +
      '</div>' +
      '<div class="tp-body">' +
        // Pomodoro section
        '<div class="tp-section' + (panelTab === 'pomo' ? ' show' : '') + '" id="tp-pomo">' +
          '<div class="pomo-ring-wrap">' +
            '<div class="pomo-ring-container">' +
              '<svg class="pomo-ring-svg" viewBox="0 0 160 160">' +
                '<circle class="pomo-ring-bg" cx="80" cy="80" r="68"/>' +
                '<circle class="pomo-ring-fg' + (isBreak ? ' break-ring' : '') + '" cx="80" cy="80" r="68" ' +
                  'stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + dashOffset + '"/>' +
              '</svg>' +
              '<div class="pomo-time-display">' +
                '<div class="pomo-time" id="pomo-time">' + mm + ':' + ss + '</div>' +
                '<div class="pomo-phase">' + (PHASES[pomo.phase] || 'Fokus') + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="pomo-controls">' +
            '<button class="pomo-btn primary" id="pomo-start">' + (pomo.running ? 'Jeda' : 'Mulai') + '</button>' +
            '<button class="pomo-btn secondary" id="pomo-reset">Reset</button>' +
            '<button class="pomo-btn secondary" id="pomo-skip">Lewati</button>' +
          '</div>' +
          '<div class="pomo-info">' +
            '<div class="pomo-info-row">' +
              '<span class="pomo-info-label">Siklus hari ini</span>' +
              '<span class="pomo-info-val" id="pomo-cycles">' + pomo.cyclesDoneToday + '</span>' +
            '</div>' +
          '</div>' +
          (hasWakeLock ?
            '<div class="pomo-wakelock-row">' +
              '<span>Jaga layar tetap menyala</span>' +
              '<label class="toggle-switch">' +
                '<input type="checkbox" id="pomo-wakelock"' + (wakeLockEnabled ? ' checked' : '') + '>' +
                '<span class="toggle-slider"></span>' +
              '</label>' +
            '</div>' : '') +
          '<button class="pomo-settings-toggle" id="pomo-stoggle">⚙ Atur Durasi</button>' +
          '<div class="pomo-settings" id="pomo-settings">' +
            '<label>Fokus (menit) <input type="number" id="ps-focus" min="1" max="120" value="' + ps.focusMin + '"></label>' +
            '<label>Istirahat pendek <input type="number" id="ps-short" min="1" max="120" value="' + ps.shortBreakMin + '"></label>' +
            '<label>Istirahat panjang <input type="number" id="ps-long" min="1" max="120" value="' + ps.longBreakMin + '"></label>' +
          '</div>' +
        '</div>' +
        // Sound section
        '<div class="tp-section' + (panelTab === 'sound' ? ' show' : '') + '" id="tp-sound">' +
          (hasAudio ?
            '<div class="sound-section">' +
              '<div class="sound-types">' +
                soundBtn('none', '🔇', 'Mati', ssettings.type) +
                soundBtn('rain', '🌧', 'Hujan', ssettings.type) +
                soundBtn('brown', '🌫', 'Brown Noise', ssettings.type) +
                soundBtn('lofi', '🎹', 'Lofi Pad', ssettings.type) +
              '</div>' +
              '<div class="sound-vol-row">' +
                '<span class="sound-vol-label">Volume</span>' +
                '<input type="range" class="sound-vol-slider" id="sound-vol" min="0" max="100" value="' + Math.round(ssettings.volume * 100) + '">' +
                '<span class="sound-vol-pct" id="sound-vol-pct">' + Math.round(ssettings.volume * 100) + '%</span>' +
              '</div>' +
              '<button class="sound-play-btn" id="sound-play">' + (sound.playing ? '⏸ Jeda' : '▶ Putar') + '</button>' +
              '<div class="sound-note">Di iPhone, suara bisa berhenti saat layar terkunci.</div>' +
            '</div>'
          :
            '<div class="sound-unavailable">Browser ini tidak mendukung Web Audio API.<br>Suara latar tidak tersedia.</div>'
          ) +
        '</div>' +
      '</div>';

    // Bind events
    panel.querySelector('.tp-close').addEventListener('click', closePanel);

    panel.querySelectorAll('.tp-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        panelTab = btn.dataset.tab;
        renderPanel();
      });
    });

    // Pomodoro events
    var startBtn = panel.querySelector('#pomo-start');
    if (startBtn) startBtn.addEventListener('click', togglePomodoro);
    var resetBtn = panel.querySelector('#pomo-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetPomodoro);
    var skipBtn = panel.querySelector('#pomo-skip');
    if (skipBtn) skipBtn.addEventListener('click', skipPhase);
    var stoggle = panel.querySelector('#pomo-stoggle');
    if (stoggle) stoggle.addEventListener('click', function () {
      var s = panel.querySelector('#pomo-settings');
      if (s) s.classList.toggle('show');
    });

    // Settings inputs
    ['ps-focus', 'ps-short', 'ps-long'].forEach(function (id) {
      var inp = panel.querySelector('#' + id);
      if (inp) inp.addEventListener('change', savePomodoroSettings);
    });

    // Wake lock toggle
    var wlInput = panel.querySelector('#pomo-wakelock');
    if (wlInput) wlInput.addEventListener('change', function () {
      wakeLockEnabled = wlInput.checked;
      if (wakeLockEnabled && pomo.running && pomo.phase === 'focus') {
        requestWakeLock();
      } else if (!wakeLockEnabled) {
        releaseWakeLock();
      }
    });

    // Sound events
    panel.querySelectorAll('.sound-type-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.dataset.stype;
        sSet('settings.sound.type', type);
        sound.currentType = type;
        if (type === 'none') {
          stopSound();
        } else if (sound.playing) {
          // Switch type while playing
          stopSound();
          startSound(type);
        }
        renderPanel();
        updateBubble();
      });
    });

    var volSlider = panel.querySelector('#sound-vol');
    if (volSlider) volSlider.addEventListener('input', function () {
      var v = parseInt(volSlider.value, 10) / 100;
      sSet('settings.sound.volume', v);
      setVolume(v);
      var pctEl = panel.querySelector('#sound-vol-pct');
      if (pctEl) pctEl.textContent = Math.round(v * 100) + '%';
    });

    var playBtn = panel.querySelector('#sound-play');
    if (playBtn) playBtn.addEventListener('click', function () {
      var type = sGet('settings.sound.type', 'none');
      if (type === 'none') return;
      if (sound.playing) {
        stopSound();
      } else {
        startSound(type);
      }
      renderPanel();
      updateBubble();
    });

    // ESC key
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closePanel();
      }
    });
  }

  function soundBtn(type, icon, label, current) {
    return '<button class="sound-type-btn' + (current === type ? ' on' : '') + '" data-stype="' + type + '">' +
      '<span class="sicon">' + icon + '</span>' + label + '</button>';
  }

  // =============================================
  //  PANEL TOGGLE
  // =============================================
  function togglePanel() {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    panelOpen = true;
    renderPanel();
    panel.classList.add('show');
    backdrop.classList.add('show');
    // Mobile: aria-modal
    if (window.innerWidth <= 768) {
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('aria-modal');
    }
    bubble.setAttribute('aria-expanded', 'true');
    // Focus management
    var closeBtn = panel.querySelector('.tp-close');
    if (closeBtn) closeBtn.focus();
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove('show');
    backdrop.classList.remove('show');
    panel.removeAttribute('aria-modal');
    bubble.setAttribute('aria-expanded', 'false');
    bubble.focus();
  }

  // =============================================
  //  POMODORO LOGIC
  // =============================================
  function getPhaseDuration() {
    var ps = sGet('settings.pomodoro', { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 });
    if (pomo.phase === 'focus') return ps.focusMin * 60;
    if (pomo.phase === 'short') return ps.shortBreakMin * 60;
    return ps.longBreakMin * 60;
  }

  function togglePomodoro() {
    if (pomo.running) {
      // Pause
      pomo.remaining = Math.max(0, Math.ceil((pomo.endTime - Date.now()) / 1000));
      pomo.running = false;
      pomo.endTime = 0;
      stopTick();
      releaseWakeLock();
    } else {
      // Start / Resume
      if (!pomo.remaining || pomo.remaining <= 0) {
        pomo.remaining = getPhaseDuration();
      }
      pomo.endTime = Date.now() + pomo.remaining * 1000;
      pomo.running = true;
      startTick();
      if (wakeLockEnabled && pomo.phase === 'focus') requestWakeLock();
    }
    saveTimerState();
    if (panelOpen) renderPanel();
    updateBubble();
  }

  function resetPomodoro() {
    pomo.running = false;
    pomo.endTime = 0;
    pomo.phase = 'focus';
    pomo.remaining = 0;
    pomo.totalFocusCycles = 0;
    stopTick();
    releaseWakeLock();
    document.title = ORIG_TITLE;
    saveTimerState();
    if (panelOpen) renderPanel();
    updateBubble();
  }

  function skipPhase() {
    if (pomo.phase === 'focus' && pomo.running) {
      // Don't count skipped focus as completed
    }
    advancePhase(false);
    pomo.running = false;
    pomo.endTime = 0;
    stopTick();
    releaseWakeLock();
    document.title = ORIG_TITLE;
    saveTimerState();
    if (panelOpen) renderPanel();
    updateBubble();
  }

  function advancePhase(wasCompleted) {
    if (pomo.phase === 'focus') {
      if (wasCompleted) {
        pomo.totalFocusCycles++;
        recordCycle();
        loadTodayCycles();
      }
      if (pomo.totalFocusCycles > 0 && pomo.totalFocusCycles % 4 === 0) {
        pomo.phase = 'long';
      } else {
        pomo.phase = 'short';
      }
    } else {
      pomo.phase = 'focus';
    }
    pomo.remaining = getPhaseDuration();
  }

  function onPhaseComplete() {
    pomo.running = false;
    pomo.endTime = 0;
    stopTick();
    releaseWakeLock();

    // Beep
    playBeep();

    // Vibrate
    try { if (navigator.vibrate) navigator.vibrate([100, 50, 100]); } catch (_) {}

    // Advance
    advancePhase(true);
    pomo.running = false; // Don't auto-start

    document.title = ORIG_TITLE;
    saveTimerState();
    if (panelOpen) renderPanel();
    updateBubble();
  }

  function saveTimerState() {
    try {
      sSet('toolsTimer', {
        phase: pomo.phase,
        running: pomo.running,
        endTime: pomo.endTime,
        remaining: pomo.remaining,
        totalFocusCycles: pomo.totalFocusCycles
      });
    } catch (_) {}
  }

  function savePomodoroSettings() {
    var fEl = panel.querySelector('#ps-focus');
    var sEl = panel.querySelector('#ps-short');
    var lEl = panel.querySelector('#ps-long');
    if (!fEl || !sEl || !lEl) return;
    var f = clamp(parseInt(fEl.value, 10) || 25, 1, 120);
    var s = clamp(parseInt(sEl.value, 10) || 5, 1, 120);
    var l = clamp(parseInt(lEl.value, 10) || 15, 1, 120);
    sSet('settings.pomodoro', { focusMin: f, shortBreakMin: s, longBreakMin: l });
    fEl.value = f;
    sEl.value = s;
    lEl.value = l;
    // If not running, update remaining to reflect new duration
    if (!pomo.running) {
      pomo.remaining = getPhaseDuration();
      renderPanel();
      updateBubble();
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Timer Tick ──
  function startTick() {
    stopTick();
    pomo.tickInterval = setInterval(tick, 250);
  }

  function stopTick() {
    if (pomo.tickInterval) {
      clearInterval(pomo.tickInterval);
      pomo.tickInterval = null;
    }
  }

  function tick() {
    if (!pomo.running) return;
    var now = Date.now();
    var secsLeft = Math.max(0, Math.ceil((pomo.endTime - now) / 1000));

    if (secsLeft <= 0) {
      onPhaseComplete();
      return;
    }

    // Update title
    var mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
    var ss = String(secsLeft % 60).padStart(2, '0');
    document.title = mm + ':' + ss + ' \u00B7 ' + (PHASES[pomo.phase] || 'Fokus') + ' — ' + ORIG_TITLE;

    // Update bubble
    updateBubble();

    // Update panel if open (throttle to once per second via modulo)
    if (panelOpen) {
      var timeEl = panel.querySelector('#pomo-time');
      if (timeEl) timeEl.textContent = mm + ':' + ss;
      var ringFg = panel.querySelector('.pomo-ring-fg');
      if (ringFg) {
        var totalDur = getPhaseDuration();
        var progress = totalDur > 0 ? (1 - secsLeft / totalDur) : 0;
        ringFg.setAttribute('stroke-dashoffset', String(CIRC * (1 - progress)));
      }
      var cyclesEl = panel.querySelector('#pomo-cycles');
      if (cyclesEl) cyclesEl.textContent = String(pomo.cyclesDoneToday);
    }
  }

  // =============================================
  //  WAKE LOCK
  // =============================================
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (_) {}
      wakeLock = null;
    }
  }

  // =============================================
  //  BEEP (Web Audio)
  // =============================================
  function playBeep() {
    try {
      var vol = sGet('settings.sound.volume', 0.25);
      vol = Math.max(0.08, vol * 0.5); // ensure audible but soft
      var ctx = getAudioContext();
      if (!ctx) return;
      ctx.resume();

      var gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      // Two-tone beep
      [660, 880].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.15);
      });
    } catch (_) {}
  }

  // =============================================
  //  AUDIO CONTEXT (shared, lazy)
  // =============================================
  function getAudioContext() {
    if (sound.ctx) return sound.ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sound.ctx = new AC();
      sound.masterGain = sound.ctx.createGain();
      sound.masterGain.connect(sound.ctx.destination);
      var vol = sGet('settings.sound.volume', 0.25);
      sound.masterGain.gain.setValueAtTime(vol, sound.ctx.currentTime);
      return sound.ctx;
    } catch (_) {
      return null;
    }
  }

  function setVolume(v) {
    if (sound.masterGain && sound.ctx) {
      try {
        sound.masterGain.gain.setTargetAtTime(v, sound.ctx.currentTime, 0.05);
      } catch (_) {}
    }
  }

  // =============================================
  //  AMBIENT SOUND GENERATORS
  // =============================================
  function stopSound() {
    // Fade out
    if (sound.masterGain && sound.ctx) {
      try {
        sound.masterGain.gain.setTargetAtTime(0, sound.ctx.currentTime, 0.15);
      } catch (_) {}
    }

    // Schedule cleanup after fade
    setTimeout(function () {
      // Stop and disconnect all nodes
      sound.nodes.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (_) {}
        try { if (n.disconnect) n.disconnect(); } catch (_) {}
      });
      sound.nodes = [];

      sound.intervals.forEach(function (id) { clearInterval(id); });
      sound.intervals = [];

      sound.timeouts.forEach(function (id) { clearTimeout(id); });
      sound.timeouts = [];

      // Restore gain for next play
      if (sound.masterGain && sound.ctx) {
        try {
          var vol = sGet('settings.sound.volume', 0.25);
          sound.masterGain.gain.setValueAtTime(vol, sound.ctx.currentTime);
        } catch (_) {}
      }
    }, 300);

    sound.playing = false;
    sound.currentType = 'none';
    updateBubble();
  }

  function startSound(type) {
    var ctx = getAudioContext();
    if (!ctx) return;
    try { ctx.resume(); } catch (_) {}

    // Make sure old sounds are stopped first
    stopSoundImmediate();

    var vol = sGet('settings.sound.volume', 0.25);
    sound.masterGain.gain.setValueAtTime(0, ctx.currentTime);
    sound.masterGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.7);

    sound.currentType = type;
    sound.playing = true;

    if (type === 'rain') createRain(ctx);
    else if (type === 'brown') createBrown(ctx);
    else if (type === 'lofi') createLofi(ctx);
  }

  function stopSoundImmediate() {
    sound.nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (_) {}
      try { if (n.disconnect) n.disconnect(); } catch (_) {}
    });
    sound.nodes = [];
    sound.intervals.forEach(function (id) { clearInterval(id); });
    sound.intervals = [];
    sound.timeouts.forEach(function (id) { clearTimeout(id); });
    sound.timeouts = [];
    sound.playing = false;
  }

  // ── Rain ──
  function createRain(ctx) {
    // White noise → bandpass + lowpass for rain-like patter
    var bufferSize = ctx.sampleRate * 4;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    // Bandpass for rain texture
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 0.5;

    // Lowpass for softness
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    lp.Q.value = 0.3;

    // Slight LFO modulation on bandpass freq for natural variation
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 400;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    lfo.start();

    src.connect(bp);
    bp.connect(lp);
    lp.connect(sound.masterGain);

    src.start();

    sound.nodes.push(src, bp, lp, lfo, lfoGain);
  }

  // ── Brown noise ──
  function createBrown(ctx) {
    var bufferSize = ctx.sampleRate * 4;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);

    // Generate via integration of white noise
    var last = 0;
    for (var i = 0; i < bufferSize; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white);
      // Clamp
      if (last > 1) last = 1;
      if (last < -1) last = -1;
      data[i] = last;
    }

    // Normalize
    var maxVal = 0;
    for (var j = 0; j < bufferSize; j++) {
      if (Math.abs(data[j]) > maxVal) maxVal = Math.abs(data[j]);
    }
    if (maxVal > 0) {
      for (var k = 0; k < bufferSize; k++) {
        data[k] /= maxVal;
      }
    }

    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    // Lowpass for warmth
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 0.3;

    src.connect(lp);
    lp.connect(sound.masterGain);
    src.start();

    sound.nodes.push(src, lp);
  }

  // ── Lofi pad ──
  function createLofi(ctx) {
    // Chord progression: Fmaj7 → Em7 → Dm7 → Cmaj7 (frequencies)
    var chords = [
      [174.61, 220.00, 261.63, 329.63], // Fmaj7
      [164.81, 196.00, 246.94, 311.13], // Em7
      [146.83, 174.61, 220.00, 293.66], // Dm7
      [130.81, 164.81, 196.00, 261.63]  // Cmaj7
    ];

    var chordIndex = 0;
    var oscNodes = [];
    var chordGain = ctx.createGain();
    chordGain.gain.value = 0.35;

    // Lowpass for warmth
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    lp.Q.value = 0.5;

    chordGain.connect(lp);
    lp.connect(sound.masterGain);

    sound.nodes.push(chordGain, lp);

    function playChord() {
      // Stop previous oscillators
      oscNodes.forEach(function (o) {
        try { o.stop(); } catch (_) {}
        try { o.disconnect(); } catch (_) {}
      });
      oscNodes = [];

      var freqs = chords[chordIndex % chords.length];
      chordIndex++;

      freqs.forEach(function (freq) {
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq + (Math.random() * 2 - 1); // slight detune
        osc.connect(chordGain);
        osc.start();
        oscNodes.push(osc);
        sound.nodes.push(osc);
      });
    }

    playChord();
    var chordInt = setInterval(function () {
      if (!sound.playing || sound.currentType !== 'lofi') {
        clearInterval(chordInt);
        return;
      }
      // Crossfade by briefly lowering gain
      try {
        chordGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.3);
        var t = setTimeout(function () {
          playChord();
          try {
            chordGain.gain.setTargetAtTime(0.35, ctx.currentTime, 0.4);
          } catch (_) {}
        }, 600);
        sound.timeouts.push(t);
      } catch (_) {}
    }, 4000);
    sound.intervals.push(chordInt);

    // Vinyl crackle: tiny noise bursts
    var crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.04;
    crackleGain.connect(sound.masterGain);
    sound.nodes.push(crackleGain);

    var crackleSize = ctx.sampleRate * 2;
    var crackleBuf = ctx.createBuffer(1, crackleSize, ctx.sampleRate);
    var crackleData = crackleBuf.getChannelData(0);
    for (var i = 0; i < crackleSize; i++) {
      // Sparse crackle: mostly silence with occasional pops
      crackleData[i] = Math.random() < 0.005 ? (Math.random() * 2 - 1) : 0;
    }

    var crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = crackleBuf;
    crackleSrc.loop = true;

    var crackleLp = ctx.createBiquadFilter();
    crackleLp.type = 'highpass';
    crackleLp.frequency.value = 1000;

    crackleSrc.connect(crackleLp);
    crackleLp.connect(crackleGain);
    crackleSrc.start();

    sound.nodes.push(crackleSrc, crackleLp);
  }

  // =============================================
  //  KEYBOARD
  // =============================================
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelOpen) {
      closePanel();
    }
  });

  // =============================================
  //  BOOT
  // =============================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
