/**
 * storage.js - Centralized Storage Management with Namespace 'ai_v2'
 * Handles versioning, migrations from old ai_* keys, stable IDs,
 * question answer tracking (max 2000 entries), wrong review bank, and bookmarks.
 */

(function (root) {
  'use strict';

  // djb2 hash function for deterministic stable IDs
  function hashId(category, text) {
    const str = category + ':' + String(text).trim().toLowerCase();
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return category + '_' + Math.abs(hash).toString(36);
  }

  const STORAGE_KEY = 'ai_v2';
  const CURRENT_VERSION = 2;
  const MAX_HISTORY_ITEMS = 2000;

  let inMemoryData = null;

  function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getYesterdayString() {
    const d = new Date(Date.now() - 86400000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getDefaultState() {
    return {
      version: CURRENT_VERSION,
      settings: {
        dailyGoal: 20,
        pomodoro: {
          focusMin: 25,
          shortBreakMin: 5,
          longBreakMin: 15
        },
        sound: {
          type: 'none',
          volume: 0.25
        }
      },
      ui: {
        mode: 'home',
        ch: 0,
        onlyBookmarked: false,
        reviewMistakes: false
      },
      bookmarks: [],
      history: [],
      wrongReview: {},
      leitner: {},
      essays: [],
      simulations: [],
      streak: {
        lastDate: '',
        count: 0
      }
    };
  }

  function readRawStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const item = window.localStorage.getItem(STORAGE_KEY);
        return item ? JSON.parse(item) : null;
      }
    } catch (e) {
      console.warn('Storage read warning:', e);
    }
    return inMemoryData;
  }

  function writeRawStorage(data) {
    inMemoryData = data;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Storage write warning:', e);
    }
  }

  function migrateOldKeys(state) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return state;

      // 1. ai_mode
      const oldMode = window.localStorage.getItem('ai_mode');
      if (oldMode) {
        try {
          const parsedMode = JSON.parse(oldMode);
          if (parsedMode && typeof parsedMode === 'string') {
            state.ui.mode = parsedMode;
          }
        } catch (_) {}
      }

      // 2. ai_ch
      const oldCh = window.localStorage.getItem('ai_ch');
      if (oldCh) {
        try {
          const parsedCh = JSON.parse(oldCh);
          if (typeof parsedCh === 'number') state.ui.ch = parsedCh;
        } catch (_) {}
      }

      // 3. ai_known (kartu hafal lama -> leitner box 3)
      const oldKnown = window.localStorage.getItem('ai_known');
      if (oldKnown) {
        try {
          const titles = JSON.parse(oldKnown);
          if (Array.isArray(titles)) {
            titles.forEach(title => {
              const id = hashId('fc', title);
              if (!state.leitner[id]) {
                state.leitner[id] = {
                  box: 3,
                  due: Date.now() + 86400000,
                  title: title
                };
              }
            });
          }
        } catch (_) {}
      }

      // 4. ai_esai3 and ai_esai
      const oldEsai3 = window.localStorage.getItem('ai_esai3') || window.localStorage.getItem('ai_esai');
      if (oldEsai3 && root.E) {
        try {
          const idxs = JSON.parse(oldEsai3);
          if (Array.isArray(idxs)) {
            idxs.forEach(idx => {
              if (root.E[idx]) {
                // E items are objects {bab, soal, pembahasan}; handle both old (array) and new (object) format
                const item = root.E[idx];
                const soalText = item.soal || item[1];
                if (soalText) {
                  const id = hashId('es', soalText);
                  if (!state.essays.includes(id)) {
                    state.essays.push(id);
                  }
                }
              }
            });
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('Migration error:', e);
    }
    return state;
  }

  function getInitialState() {
    let state = readRawStorage();
    if (!state || !state.version || state.version < CURRENT_VERSION) {
      let fresh = getDefaultState();
      if (state) {
        Object.assign(fresh, state);
      }
      fresh.version = CURRENT_VERSION;
      fresh = migrateOldKeys(fresh);
      writeRawStorage(fresh);
      return fresh;
    }
    return state;
  }

  let currentState = getInitialState();

  const AIStorage = {
    hashId,

    get(path, defaultVal) {
      if (!path) return currentState;
      const keys = path.split('.');
      let curr = currentState;
      for (const k of keys) {
        if (curr == null || typeof curr !== 'object' || !(k in curr)) {
          return defaultVal;
        }
        curr = curr[k];
      }
      return curr !== undefined ? curr : defaultVal;
    },

    set(path, val) {
      if (!path) return;
      const keys = path.split('.');
      let curr = currentState;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!curr[k] || typeof curr[k] !== 'object') {
          curr[k] = {};
        }
        curr = curr[k];
      }
      curr[keys[keys.length - 1]] = val;
      writeRawStorage(currentState);
      return val;
    },

    update(updaterFn) {
      if (typeof updaterFn === 'function') {
        const res = updaterFn(currentState);
        if (res) currentState = res;
        writeRawStorage(currentState);
      }
      return currentState;
    },

    reset() {
      currentState = getDefaultState();
      writeRawStorage(currentState);
      return currentState;
    },

    export() {
      return JSON.stringify(currentState, null, 2);
    },

    import(jsonString) {
      try {
        const parsed = JSON.parse(jsonString);
        if (parsed && typeof parsed === 'object') {
          parsed.version = CURRENT_VERSION;
          currentState = parsed;
          writeRawStorage(currentState);
          return true;
        }
      } catch (e) {
        console.error('Import error:', e);
      }
      return false;
    },

    // Record question answer
    logAnswer({ id, kategori, bab, benar, waktu = Date.now(), detail = null }) {
      if (!id || !kategori) return;

      const entry = {
        id,
        kategori,
        bab: Number(bab) || 0,
        benar: Boolean(benar),
        waktu,
        detail
      };

      // 1. Append history (FIFO max 2000 items)
      currentState.history.push(entry);
      if (currentState.history.length > MAX_HISTORY_ITEMS) {
        currentState.history.splice(0, currentState.history.length - MAX_HISTORY_ITEMS);
      }

      // 2. Update wrong bank (wrongReview)
      if (!currentState.wrongReview) currentState.wrongReview = {};
      if (!entry.benar) {
        const prev = currentState.wrongReview[id] || { consecutiveCorrect: 0 };
        currentState.wrongReview[id] = {
          id,
          kategori,
          bab: entry.bab,
          consecutiveCorrect: 0,
          lastWrongTime: waktu
        };
      } else {
        if (currentState.wrongReview[id]) {
          currentState.wrongReview[id].consecutiveCorrect = (currentState.wrongReview[id].consecutiveCorrect || 0) + 1;
          if (currentState.wrongReview[id].consecutiveCorrect >= 2) {
            delete currentState.wrongReview[id];
          }
        }
      }

      // 3. Update streak
      const today = getTodayString();
      const yesterday = getYesterdayString();
      if (!currentState.streak) currentState.streak = { lastDate: '', count: 0 };

      if (currentState.streak.lastDate === today) {
        // already active today
      } else if (currentState.streak.lastDate === yesterday) {
        currentState.streak.count += 1;
        currentState.streak.lastDate = today;
      } else {
        currentState.streak.count = 1;
        currentState.streak.lastDate = today;
      }

      writeRawStorage(currentState);
      return entry;
    },

    // Toggle bookmark
    toggleBookmark(id) {
      if (!id) return false;
      if (!Array.isArray(currentState.bookmarks)) currentState.bookmarks = [];
      const idx = currentState.bookmarks.indexOf(id);
      if (idx > -1) {
        currentState.bookmarks.splice(idx, 1);
        writeRawStorage(currentState);
        return false;
      } else {
        currentState.bookmarks.push(id);
        writeRawStorage(currentState);
        return true;
      }
    },

    isBookmarked(id) {
      return Array.isArray(currentState.bookmarks) && currentState.bookmarks.includes(id);
    },

    // Essay progress
    toggleEssay(id) {
      if (!id) return false;
      if (!Array.isArray(currentState.essays)) currentState.essays = [];
      const idx = currentState.essays.indexOf(id);
      if (idx > -1) {
        currentState.essays.splice(idx, 1);
        writeRawStorage(currentState);
        return false;
      } else {
        currentState.essays.push(id);
        writeRawStorage(currentState);
        return true;
      }
    },

    isEssayDone(id) {
      return Array.isArray(currentState.essays) && currentState.essays.includes(id);
    }
  };

  root.AIStorage = AIStorage;
})(typeof window !== 'undefined' ? window : globalThis);
