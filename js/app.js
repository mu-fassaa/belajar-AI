/**
 * app.js - Main Application Controller for BelajarAI
 * Features: Dashboard (Beranda), Ringkasan, Kartu (Leitner-ready),
 * Benar/Salah, Cocokkan, Isian, Ulangi Soal Salah, Esai (Accordion),
 * Bookmark, Bab Terlemah, dan Target Harian.
 */

const $ = s => document.querySelector(s);
const app = $('#app');

// Shuffler
const sh = a => [...a].sort(() => Math.random() - .5);

// Chapter Names for display
const CHAPTER_NAMES = {
  1: 'Pendekatan & Etika AI',
  2: 'Agen & Sifat Lingkungan',
  3: 'Uninformed Search',
  4: 'Informed Search & A*',
  5: 'Constraint Satisfaction (CSP)',
  6: 'Logika Proposisi & Wumpus',
  7: 'First-Order Logic (FOL)'
};

// Tabs list
const TABS = [
  ['home', 'Beranda'],
  ['rg', 'Ringkasan'],
  ['fc', 'Kartu'],
  ['bs', 'Benar/Salah'],
  ['mt', 'Cocokkan'],
  ['fi', 'Isian'],
  ['wrong', 'Ulangi Salah'],
  ['es', 'Esai'],
  ['sim', 'Simulasi']
];

// App State
let mode = AIStorage.get('ui.mode', 'home'),
  ch = AIStorage.get('ui.ch', 0),
  onlyBm = AIStorage.get('ui.onlyBookmarked', false),
  st = {},
  deck = [],
  i = 0,
  flip = false,
  search = '';

// Helper to get question by stable ID
function getQuestionById(id) {
  if (!id) return null;
  if (id.startsWith('bs_')) {
    const found = B.find(item => AIStorage.hashId('bs', item[1]) === id);
    if (found) return { type: 'bs', data: found };
  } else if (id.startsWith('fi_')) {
    const found = F.find(item => AIStorage.hashId('fi', item[1]) === id);
    if (found) return { type: 'fi', data: found };
  } else if (id.startsWith('mt_')) {
    const found = M.find(item => AIStorage.hashId('mt', item[1]) === id);
    if (found) return { type: 'mt', data: found };
  } else if (id.startsWith('fc_')) {
    const found = C.find(item => AIStorage.hashId('fc', item[1]) === id);
    if (found) return { type: 'fc', data: found };
  } else if (id.startsWith('es_')) {
    const found = E.find(item => AIStorage.hashId('es', item[1]) === id);
    if (found) return { type: 'es', data: found };
  }
  return null;
}

// Navigation & Filter Chips
function updateScrollFades() {
  ['tabs', 'chips'].forEach(id => {
    const el = $('#' + id);
    const wrap = $('#' + id + '-wrap') || el;
    if (!el || !wrap) return;
    const canLeft = el.scrollLeft > 2;
    const canRight = el.scrollLeft < (el.scrollWidth - el.clientWidth - 2);
    wrap.classList.toggle('can-scroll-left', canLeft);
    wrap.classList.toggle('can-scroll-right', canRight);
  });
}

// Navigation & Filter Chips
function nav() {
  const tabsEl = $('#tabs');
  const chipsEl = $('#chips');

  const tabsScroll = tabsEl ? tabsEl.scrollLeft : 0;
  const chipsScroll = chipsEl ? chipsEl.scrollLeft : 0;

  const wrongMap = AIStorage.get('wrongReview', {});
  const wrongCount = Object.keys(wrongMap).length;
  const bmList = AIStorage.get('bookmarks', []);
  const bmCount = Array.isArray(bmList) ? bmList.length : 0;

  if (tabsEl) {
    tabsEl.innerHTML = TABS.map(t => {
      let label = t[1];
      if (t[0] === 'wrong' && wrongCount > 0) {
        label += ` (${wrongCount})`;
      }
      const isSelected = mode === t[0];
      return `<button class="tab ${isSelected ? 'on' : ''}" data-m="${t[0]}" role="tab" aria-selected="${isSelected ? 'true' : 'false'}" tabindex="${isSelected ? '0' : '-1'}" aria-label="${t[1]}">${label}</button>`;
    }).join('');
    tabsEl.scrollLeft = tabsScroll;
    const activeTab = tabsEl.querySelector('.tab.on');
    if (activeTab && tabsEl.scrollWidth > tabsEl.clientWidth) {
      activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }

  if (chipsEl) {
    const chipsHtml = ['Semua', 1, 2, 3, 4, 5, 6, 7].map((c, k) => {
      const isSelected = ch === k;
      return `<button class="chip ${isSelected ? 'on' : ''}" data-c="${k}" role="button" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${k ? 'Bab ' + c : 'Semua Bab'}">${k ? 'Bab ' + c : c}</button>`;
    }).join('');

    const bmChipHtml = `<button class="chip ${onlyBm ? 'on' : ''}" id="bm-filter-btn" role="button" aria-pressed="${onlyBm ? 'true' : 'false'}" aria-label="Filter hanya soal yang ditandai penting">★ Penting ${bmCount > 0 ? '(' + bmCount + ')' : ''}</button>`;

    chipsEl.innerHTML = chipsHtml + bmChipHtml;
    chipsEl.scrollLeft = chipsScroll;
    const activeChip = chipsEl.querySelector('.chip.on');
    if (activeChip && chipsEl.scrollWidth > chipsEl.clientWidth) {
      activeChip.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }

  updateScrollFades();
}

// Standard Quiz Flow for BS, MT, FI
function flow(k, pool, draw, fresh) {
  let S = st[k];
  if (fresh || !S) {
    let filtered = pool.filter(x => !ch || x[0] === ch);
    if (onlyBm) {
      filtered = filtered.filter(x => {
        const qId = AIStorage.hashId(k, x[1]);
        return AIStorage.isBookmarked(qId);
      });
    }
    S = st[k] = { l: sh(filtered), i: 0, s: 0, t: 0 };
  }

  if (!S.l.length) {
    const emptyMsg = onlyBm
      ? 'Belum ada soal yang ditandai penting di bab ini. Tekan tombol ★ pada soal untuk menandainya.'
      : 'Belum ada soal untuk bab ini. Pilih bab lain.';
    app.innerHTML = `<div class="pn">${emptyMsg}</div>`;
    return;
  }

  if (S.i >= S.l.length) {
    const pct = S.t ? Math.round((S.s / S.t) * 100) : 0;
    app.innerHTML = `
      <div class="pn c">
        <div class="info3">
          <div><b>${S.s}</b>Benar</div>
          <div><b>${S.t - S.s}</b>Salah</div>
          <div><b>${pct}%</b>Skor</div>
        </div>
        <p>${S.s === S.t ? 'Sempurna, siap UTS!' : S.s >= S.t * 0.7 ? 'Bagus, tinggal rapikan jebakannya.' : 'Buka tab Ringkasan dulu, lalu coba lagi.'}</p>
        <div class="row">
          <button class="cta o" id="btn-back-home">Ke Beranda</button>
          <button class="cta" id="rs">Main lagi</button>
        </div>
      </div>
    `;
    $('#rs').onclick = () => flow(k, pool, draw, 1);
    $('#btn-back-home').onclick = () => {
      mode = 'home';
      AIStorage.set('ui.mode', 'home');
      go();
    };
    return;
  }

  const x = S.l[S.i];
  const qId = AIStorage.hashId(k, x[1]);
  const isBm = AIStorage.isBookmarked(qId);
  const re = () => flow(k, pool, draw);

  const fin = (ok, msg, n = 1) => {
    S.s += ok;
    S.t += n;
    $('#fb').innerHTML = `
      <div class="exp">${msg}</div>
      <button class="cta w" id="nx">${S.i + 1 < S.l.length ? 'Lanjut' : 'Lihat skor'}</button>
    `;
    $('#nx').onclick = () => {
      S.i++;
      re();
      window.scrollTo(0, Math.max(0, $('#chips').offsetTop - 70));
    };
  };

  app.innerHTML = `
    <div class="bar"><i style="width:${(S.i / S.l.length) * 100}%"></i></div>
    <div class="pn">
      <div class="top-bar-quiz">
        <div class="tag">Bab ${x[0]} · ${S.i + 1} dari ${S.l.length}</div>
        <button class="bm-btn ${isBm ? 'on' : ''}" data-qid="${qId}" aria-label="Tandai penting">★ ${isBm ? 'Penting' : 'Tandai'}</button>
      </div>
      ${draw.h(x)}
      <div id="fb"></div>
    </div>
  `;

  // Attach bookmark toggle
  const bmBtn = app.querySelector ? app.querySelector('.bm-btn') : null;
  if (bmBtn) {
    bmBtn.onclick = (e) => {
      e.stopPropagation();
      const on = AIStorage.toggleBookmark(qId);
      bmBtn.classList.toggle('on', on);
      bmBtn.innerHTML = `★ ${on ? 'Penting' : 'Tandai'}`;
      nav();
    };
  }

  draw.b(x, fin);
}

// Benar / Salah Handlers
const BS = {
  h: x => `<p class="q">${x[1]}</p><button class="opt" data-v="1">Benar</button><button class="opt" data-v="0">Salah</button>`,
  b: (x, fin) => app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const v = +b.dataset.v;
    const ok = v === x[2];
    app.querySelectorAll('.opt').forEach(o => {
      o.disabled = true;
      if (+o.dataset.v === x[2]) o.classList.add('ok');
      else if (o === b) o.classList.add('bad');
    });

    // Log answer to centralized storage
    const qId = AIStorage.hashId('bs', x[1]);
    AIStorage.logAnswer({ id: qId, kategori: 'bs', bab: x[0], benar: ok });

    fin(+ok, (ok ? 'Benar. ' : 'Belum tepat. ') + x[3]);
  })
};

// Cocokkan Handlers
const MT = {
  h: x => `
    <p class="q">Cocokkan tiap kasus dengan ${x[1]}.</p>
    ${x[3].map((t, k) => `
      <div class="mr">
        <div>${t[0]}</div>
        <select data-k="${k}">
          <option value="">Pilih</option>
          ${x[2].map((o, j) => `<option value="${j}">${o}</option>`).join('')}
        </select>
      </div>
    `).join('')}
    <button class="cta w" id="ck">Periksa</button>
  `,
  b: (x, fin) => {
    $('#ck').onclick = () => {
      let ok = 0;
      const idSet = AIStorage.hashId('mt', x[1]);

      app.querySelectorAll('select').forEach((e, k) => {
        const c = x[3][k][1];
        const r = e.value !== '' && +e.value === c;
        if (r) ok++;
        e.classList.add(r ? 'good' : 'wrong');
        e.disabled = true;
        if (!r) e.parentElement.firstElementChild.insertAdjacentHTML('beforeend', `<div class="hint">Benar: ${x[2][c]}</div>`);

        // Log individual pair
        const pairId = AIStorage.hashId('mt_pair', x[1] + ':' + x[3][k][0]);
        AIStorage.logAnswer({ id: pairId, kategori: 'mt_pair', bab: x[0], benar: r });
      });

      $('#ck').remove();

      // Log set
      const isSetAllCorrect = (ok === x[3].length);
      AIStorage.logAnswer({
        id: idSet,
        kategori: 'mt',
        bab: x[0],
        benar: isSetAllCorrect,
        detail: { ok, total: x[3].length }
      });

      fin(ok, `${ok} dari ${x[3].length} cocok.`, x[3].length);
    };
  }
};

// Levenshtein Distance & Fuzzy Matcher for Isian
function levenshteinDistance(a, b) {
  a = String(a).toLowerCase().trim();
  b = String(b).toLowerCase().trim();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function checkIsianAnswer(userVal, keywordPattern) {
  if (!userVal) return { ok: false, fuzzy: false };
  const v = String(userVal).trim().toLowerCase();
  const keywords = String(keywordPattern).split('/').map(k => k.trim().toLowerCase());

  for (const kw of keywords) {
    if (v.includes(kw) || kw.includes(v)) {
      return { ok: true, fuzzy: false };
    }
  }

  const words = v.split(/\s+/);
  for (const kw of keywords) {
    for (const word of words) {
      if (word.length >= 4 && kw.length >= 4) {
        const dist = levenshteinDistance(word, kw);
        if (dist <= 1 || (kw.length >= 8 && dist <= 2)) {
          return { ok: true, fuzzy: true };
        }
      }
    }
  }

  return { ok: false, fuzzy: false };
}

// Isian Handlers with Fuzzy Matching
const FI = {
  h: x => `<p class="q">${x[1]}</p><input id="ans" placeholder="Ketik jawabanmu" autocomplete="off"><button class="cta w" id="ck">Periksa</button>`,
  b: (x, fin) => {
    const goCheck = () => {
      const v = $('#ans').value;
      const res = checkIsianAnswer(v, x[2]);
      $('#ans').disabled = true;
      $('#ck').remove();

      const qId = AIStorage.hashId('fi', x[1]);
      AIStorage.logAnswer({ id: qId, kategori: 'fi', bab: x[0], benar: res.ok });

      let msg = res.ok
        ? (res.fuzzy ? '<b>Benar!</b> <i>(Tip: perhatikan ejaan)</i>. ' : '<b>Benar!</b> ')
        : 'Belum tepat. ';
      msg += `Jawaban: <b>${x[3]}</b>`;
      fin(+res.ok, msg);
    };
    $('#ck').onclick = goCheck;
    $('#ans').onkeydown = e => {
      if (e.key === 'Enter') goCheck();
    };
  }
};

// Mode: Ulangi Soal Salah
function wrong() {
  const wrongMap = AIStorage.get('wrongReview', {});
  const wrongEntries = Object.values(wrongMap).filter(w => !ch || w.bab === ch);

  if (!wrongEntries.length) {
    app.innerHTML = `
      <div class="dash-card c empty-state">
        <h3>Bank Soal Salah Bersih! 🎉</h3>
        <p>Tidak ada soal yang tercatat salah saat ini${ch ? ' untuk Bab ' + ch : ''}. Setiap soal yang pernah salah otomatis keluar dari bank setelah kamu jawab benar 2 kali berturut-turut.</p>
        <div class="row">
          <button class="cta o" id="btn-home-back">Ke Beranda</button>
          <button class="cta" id="btn-to-bs">Latih Benar/Salah</button>
        </div>
      </div>
    `;
    $('#btn-home-back').onclick = () => { mode = 'home'; AIStorage.set('ui.mode', 'home'); go(); };
    $('#btn-to-bs').onclick = () => { mode = 'bs'; AIStorage.set('ui.mode', 'bs'); go(); };
    return;
  }

  // Resolve questions from bank
  const pool = [];
  wrongEntries.forEach(entry => {
    const q = getQuestionById(entry.id);
    if (q) {
      pool.push({ entry, type: q.type, data: q.data });
    }
  });

  if (!st['wrong_flow']) {
    st['wrong_flow'] = { list: sh(pool), idx: 0, correct: 0 };
  }
  const S = st['wrong_flow'];

  if (S.idx >= S.list.length) {
    app.innerHTML = `
      <div class="dash-card c">
        <h2>Selesai Review Soal Salah!</h2>
        <div class="info3">
          <div><b>${S.correct}</b>Benar</div>
          <div><b>${S.list.length - S.correct}</b>Masih Salah</div>
          <div><b>${Object.keys(AIStorage.get('wrongReview', {})).length}</b>Sisa Bank</div>
        </div>
        <p>Soal yang dijawab benar berturut-turut akan berkurang status salahnya.</p>
        <div class="row">
          <button class="cta o" id="btn-back-home-w">Ke Beranda</button>
          <button class="cta" id="btn-retry-w">Ulangi Sisa Salah</button>
        </div>
      </div>
    `;
    $('#btn-back-home-w').onclick = () => { mode = 'home'; AIStorage.set('ui.mode', 'home'); go(); };
    $('#btn-retry-w').onclick = () => { delete st['wrong_flow']; wrong(); };
    return;
  }

  const currentItem = S.list[S.idx];
  const qType = currentItem.type;
  const qData = currentItem.data;
  const qId = currentItem.entry.id;
  const isBm = AIStorage.isBookmarked(qId);
  const consec = currentItem.entry.consecutiveCorrect || 0;

  const fin = (ok, msg, n = 1) => {
    if (ok) S.correct++;
    let note = msg;
    if (ok) {
      if (consec + 1 >= 2) {
        note += '<br><b style="color:var(--yel)">✨ Soal ini resmi lulus dari Bank Salah!</b>';
      } else {
        note += '<br><i>(Dijawab benar 1x, butuh 1x benar lagi agar lulus bank salah)</i>';
      }
    }
    $('#fb').innerHTML = `
      <div class="exp">${note}</div>
      <button class="cta w" id="nx">${S.idx + 1 < S.list.length ? 'Lanjut' : 'Lihat Hasil'}</button>
    `;
    $('#nx').onclick = () => {
      S.idx++;
      wrong();
      window.scrollTo(0, Math.max(0, $('#chips').offsetTop - 70));
    };
  };

  const drawHelper = qType === 'bs' ? BS : qType === 'mt' ? MT : FI;

  app.innerHTML = `
    <div class="bar"><i style="width:${(S.idx / S.list.length) * 100}%"></i></div>
    <div class="pn">
      <div class="top-bar-quiz">
        <div class="tag">Bab ${qData[0]} · Soal Salah ${S.idx + 1} dari ${S.list.length}</div>
        <button class="bm-btn ${isBm ? 'on' : ''}" data-qid="${qId}" aria-label="Tandai penting">★ ${isBm ? 'Penting' : 'Tandai'}</button>
      </div>
      ${drawHelper.h(qData)}
      <div id="fb"></div>
    </div>
  `;

  const bmBtn = app.querySelector ? app.querySelector('.bm-btn') : null;
  if (bmBtn) {
    bmBtn.onclick = (e) => {
      e.stopPropagation();
      const on = AIStorage.toggleBookmark(qId);
      bmBtn.classList.toggle('on', on);
      bmBtn.innerHTML = `★ ${on ? 'Penting' : 'Tandai'}`;
      nav();
    };
  }

  drawHelper.b(qData, fin);
}

// Flashcards (Kartu)
function fc() {
  let cardPool = C.filter(c => (!ch || c[0] === ch));
  if (onlyBm) {
    cardPool = cardPool.filter(c => {
      const id = AIStorage.hashId('fc', c[1]);
      return AIStorage.isBookmarked(id);
    });
  }

  const leitner = AIStorage.get('leitner', {});
  const isMastered = c => {
    const id = AIStorage.hashId('fc', c[1]);
    return leitner[id] && leitner[id].box >= 3;
  };

  if (!deck.length || i >= deck.length) {
    deck = sh(cardPool.filter(c => !isMastered(c)));
    i = 0;
  }

  const tot = cardPool.length;
  const kn = cardPool.filter(c => isMastered(c)).length;

  if (!cardPool.length) {
    app.innerHTML = `<div class="pn">Belum ada kartu untuk filter ini.</div>`;
    return;
  }

  if (!deck.length) {
    app.innerHTML = `
      <div class="pn c">
        <h2>Semua kartu hafal! 🎉</h2>
        <p>Mantap! Seluruh kartu pada bab ini sudah masuk kategori hafal. Ulangi dari awal untuk menyegarkan ingatan.</p>
        <button class="cta" id="rs-cards">Ulang dari awal</button>
      </div>
    `;
    $('#rs-cards').onclick = () => {
      cardPool.forEach(c => {
        const id = AIStorage.hashId('fc', c[1]);
        if (leitner[id]) delete leitner[id];
      });
      AIStorage.set('leitner', leitner);
      deck = [];
      fc();
    };
    return;
  }

  const c = deck[i];
  const cId = AIStorage.hashId('fc', c[1]);
  const isBm = AIStorage.isBookmarked(cId);

  app.innerHTML = `
    <div class="bar"><i style="width:${tot ? (kn / tot) * 100 : 0}%"></i></div>
    <div class="pn fc" id="card">
      <div class="top-bar-quiz" style="width:100%">
        <div class="tag">Bab ${c[0]} · ${kn} dari ${tot} hafal</div>
        <button class="bm-btn ${isBm ? 'on' : ''}" data-qid="${cId}" aria-label="Tandai penting">★ ${isBm ? 'Penting' : 'Tandai'}</button>
      </div>
      ${flip ? `<div class="a" style="white-space:pre-line">${c[2]}</div>` : `<div class="t">${c[1]}</div><div class="hint">Ketuk kartu untuk melihat penjelasan.</div>`}
    </div>
    <div class="row">
      <button class="cta o" id="no">Belum hafal</button>
      <button class="cta" id="yes">Hafal</button>
    </div>
  `;

  const bmBtn = app.querySelector('.bm-btn');
  if (bmBtn) {
    bmBtn.onclick = (e) => {
      e.stopPropagation();
      const on = AIStorage.toggleBookmark(cId);
      bmBtn.classList.toggle('on', on);
      bmBtn.innerHTML = `★ ${on ? 'Penting' : 'Tandai'}`;
      nav();
    };
  }

  $('#card').onclick = () => { flip = !flip; fc(); };
  $('#no').onclick = () => {
    leitner[cId] = { box: 1, due: Date.now(), title: c[1] };
    AIStorage.set('leitner', leitner);
    flip = false;
    i++;
    fc();
  };
  $('#yes').onclick = () => {
    leitner[cId] = { box: 3, due: Date.now() + 86400000, title: c[1] };
    AIStorage.set('leitner', leitner);
    deck.splice(i, 1);
    flip = false;
    fc();
  };
}

// Summary (Ringkasan)
function rg() {
  let list = C.filter(c => (!ch || c[0] === ch) && (c[1] + c[2]).toLowerCase().includes(search));
  if (onlyBm) {
    list = list.filter(c => AIStorage.isBookmarked(AIStorage.hashId('fc', c[1])));
  }

  const q = n => n.filter(x => !ch || x[0] === ch).length;
  const leitner = AIStorage.get('leitner', {});
  const masteredCount = C.filter(c => {
    const id = AIStorage.hashId('fc', c[1]);
    return leitner[id] && leitner[id].box >= 3;
  }).length;

  app.innerHTML = `
    <div class="info3">
      <div><b>${list.length}</b>Topik</div>
      <div><b>${q(B) + q(F) + q(M)}</b>Set soal</div>
      <div><b>${masteredCount}</b>Kartu hafal</div>
    </div>
    <input id="s" placeholder="Cari istilah, misalnya admissible" value="${search}" style="margin-bottom:16px" aria-label="Cari istilah">
    <div class="pn">
      ${list.map(c => {
        const id = AIStorage.hashId('fc', c[1]);
        const isBm = AIStorage.isBookmarked(id);
        return `
          <div class="item">
            <div class="top-bar-quiz">
              <div class="tag">Bab ${c[0]}</div>
              <button class="bm-btn ${isBm ? 'on' : ''}" data-qid="${id}" aria-label="Tandai penting">★ ${isBm ? 'Penting' : 'Tandai'}</button>
            </div>
            <b>${c[1]}</b>
            <p style="white-space:pre-line">${c[2]}</p>
          </div>
        `;
      }).join('') || '<p>Tidak ada hasil pencarian.</p>'}
    </div>
  `;

  app.querySelectorAll('.bm-btn').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.qid;
      const on = AIStorage.toggleBookmark(id);
      b.classList.toggle('on', on);
      b.innerHTML = `★ ${on ? 'Penting' : 'Tandai'}`;
      nav();
    };
  });

  const s = $('#s');
  s.oninput = () => {
    search = s.value.toLowerCase();
    const p = s.selectionStart;
    rg();
    $('#s').focus();
    $('#s').setSelectionRange(p, p);
  };
}

// Essay Accordion (Esai)
function es() {
  try {
    // E items are objects: {bab, soal, pembahasan}
    let list = E.filter(x => !ch || x.bab === ch);
    if (onlyBm) {
      list = list.filter(x => AIStorage.isBookmarked(AIStorage.hashId('es', x.soal)));
    }

    const doneList = AIStorage.get('essays', []);
    const doneCount = Array.isArray(doneList) ? doneList.length : 0;

    app.innerHTML = `
      <div class="pn">
        <h2>Kemungkinan Soal Esai UTS</h2>
        <p class="hint" style="margin:0 0 16px">Buka pembahasan untuk mempelajari jawaban, lalu tandai jika sudah dilatih. ${doneCount} dari ${E.length} selesai.</p>
        ${list.map(x => {
          const eId = AIStorage.hashId('es', x.soal);
          const isDone = AIStorage.isEssayDone(eId);
          const isBm = AIStorage.isBookmarked(eId);
          return `
            <details class="eq-card ${isDone ? 'dn' : ''}">
              <summary class="eq-summary">
                <span class="tag">Bab ${x.bab}</span>
                <span class="eq-title">${x.soal}</span>
              </summary>
              <div class="eq-body">
                <div class="eq-content">${x.pembahasan}</div>
                <div class="eq-actions row" style="margin-top:16px">
                  <button class="cta ${isDone ? 'o' : ''} eq-btn" data-eid="${eId}">
                    ${isDone ? 'Tandai Belum Selesai' : 'Tandai Sudah Selesai'}
                  </button>
                  <button class="bm-btn ${isBm ? 'on' : ''}" data-qid="${eId}" aria-label="Tandai penting">
                    ★ ${isBm ? 'Penting' : 'Tandai'}
                  </button>
                </div>
              </div>
            </details>
          `;
        }).join('') || '<p>Belum ada soal esai untuk filter ini.</p>'}
      </div>
    `;

    app.querySelectorAll('.eq-btn').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const eId = b.dataset.eid;
        AIStorage.toggleEssay(eId);

        const openIndices = [];
        app.querySelectorAll('details.eq-card').forEach((el, idx) => {
          if (el.open) openIndices.push(idx);
        });

        const y = window.scrollY;
        es();
        window.scrollTo(0, y);

        app.querySelectorAll('details.eq-card').forEach((el, idx) => {
          if (openIndices.includes(idx)) el.open = true;
        });
      };
    });

    app.querySelectorAll('.bm-btn').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const id = b.dataset.qid;
        const on = AIStorage.toggleBookmark(id);
        b.classList.toggle('on', on);
        b.innerHTML = `★ ${on ? 'Penting' : 'Tandai'}`;
        nav();
      };
    });
  } catch (err) {
    console.error('es() error:', err);
    app.innerHTML = '<div class="pn"><p>Terjadi kesalahan memuat tab ini.</p></div>';
  }
}

// Dashboard (Beranda)
function home() {
  const history = AIStorage.get('history', []);
  const totalAnswered = history.length;
  const correctCount = history.filter(h => h.benar).length;
  const overallAcc = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
  const streak = AIStorage.get('streak', { count: 0 }).count;

  // Daily target
  const dailyGoal = AIStorage.get('settings.dailyGoal', 20);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const answersToday = history.filter(h => {
    const d = new Date(h.waktu);
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s === todayStr;
  }).length;
  const dailyPct = Math.min(100, Math.round((answersToday / dailyGoal) * 100));

  // Chapter Progress Calculation
  const leitner = AIStorage.get('leitner', {});
  const chStats = [];
  let weakestBab = null;
  let minAcc = 101;

  for (let b = 1; b <= 7; b++) {
    const bHist = history.filter(h => h.bab === b);
    const last30 = bHist.slice(-30);
    const acc = last30.length > 0 ? Math.round((last30.filter(h => h.benar).length / last30.length) * 100) : null;
    const cardsMastered = C.filter(c => c[0] === b && leitner[AIStorage.hashId('fc', c[1])] && leitner[AIStorage.hashId('fc', c[1])].box >= 3).length;
    // E items are objects: {bab, soal, pembahasan}
    const essaysDone = E.filter(e => e.bab === b && AIStorage.isEssayDone(AIStorage.hashId('es', e.soal))).length;

    if (last30.length >= 5 && acc !== null && acc < minAcc) {
      minAcc = acc;
      weakestBab = b;
    }

    chStats.push({
      bab: b,
      name: CHAPTER_NAMES[b],
      acc,
      totalAnswered: bHist.length,
      cardsMastered,
      cardsTotal: C.filter(c => c[0] === b).length,
      essaysDone,
      essaysTotal: E.filter(e => e.bab === b).length
    });
  }

  const wrongMap = AIStorage.get('wrongReview', {});
  const wrongCount = Object.keys(wrongMap).length;

  // Render HTML
  app.innerHTML = `
    <!-- Greeting & Header -->
    <div class="dash-header">
      <h2>Ringkasan Belajar</h2>
      <p>Latihan bertahap materi UTS Kecerdasan Buatan (KOM321)</p>
    </div>

    <!-- 3-Column Stats -->
    <div class="dash-card">
      <div class="info3">
        <div><b>${totalAnswered}</b>Soal Dijawab</div>
        <div><b>${overallAcc}%</b>Akurasi</div>
        <div><b>${streak}</b>Hari Streak</div>
      </div>
    </div>

    <!-- Daily Target -->
    <div class="dash-card daily-card">
      <div class="daily-head">
        <div class="daily-title">🎯 Target Hari Ini: ${answersToday} / ${dailyGoal} Soal</div>
        <button class="daily-goal-btn" id="btn-edit-goal" aria-label="Ubah target harian">Ubah Target</button>
      </div>
      <div class="ch-meter">
        <div class="ch-meter-fill" style="width:${dailyPct}%"></div>
      </div>
    </div>

    <!-- Weakest Chapter CTA -->
    <div class="dash-card">
      <div class="daily-head" style="margin-bottom:12px">
        <div>
          <b style="font-size:16px;color:var(--yel)">Fokus Penguatan</b>
          <p style="margin:4px 0 0;font-size:13px;opacity:.9">
            ${weakestBab ? `Bab ${weakestBab} (${CHAPTER_NAMES[weakestBab]}) akurasi terendah: ${minAcc}%.` : 'Jawab minimal 5 soal di suatu bab untuk menemukan bab terlemahmu.'}
          </p>
        </div>
      </div>
      <div class="row">
        <button class="cta" id="btn-train-weak" style="width:100%">
          ${weakestBab ? `⚡ Latih Bab ${weakestBab} Sekarang` : '🚀 Mulai Latihan Kuis'}
        </button>
      </div>
    </div>

    <!-- Bank Soal Salah Shortcut -->
    ${wrongCount > 0 ? `
      <div class="dash-card" style="border:2px solid var(--org)">
        <div class="daily-head">
          <div>
            <b style="color:var(--yel)">Bank Soal Salah (${wrongCount} Soal)</b>
            <p style="margin:4px 0 0;font-size:13px;opacity:.9">Soal-soal yang perlu diulang hingga benar 2x berturut-turut.</p>
          </div>
          <button class="cta" id="btn-train-wrong" style="padding:10px 16px;min-height:44px">Ulangi</button>
        </div>
      </div>
    ` : ''}

    <!-- Chapter Progress Breakdown (7 Bab) -->
    <div class="dash-card">
      <div class="chart-title">Progres per Bab (Bab 1–7)</div>
      <div class="ch-list">
        ${chStats.map(c => `
          <div class="ch-row ${weakestBab === c.bab ? 'weak' : ''}">
            <div class="ch-row-header">
              <div class="ch-name">Bab ${c.bab}: ${c.name}</div>
              <div class="ch-badges">
                ${weakestBab === c.bab ? '<span class="badge-weak">Bab Terlemah</span>' : ''}
                <span class="badge-acc">${c.acc !== null ? c.acc + '% Akurasi' : 'Belum Ada Data'}</span>
              </div>
            </div>
            <div class="ch-meter">
              <div class="ch-meter-fill" style="width:${c.acc !== null ? c.acc : 0}%"></div>
            </div>
            <div class="ch-meta">
              <span>Kartu: ${c.cardsMastered}/${c.cardsTotal} hafal</span>
              <span>Esai: ${c.essaysDone}/${c.essaysTotal} selesai</span>
              <span>${c.totalAnswered} dijawab</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Attach Event Handlers
  $('#btn-edit-goal').onclick = () => {
    const val = prompt('Masukkan target jumlah soal harian:', String(dailyGoal));
    if (val) {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) {
        AIStorage.set('settings.dailyGoal', n);
        home();
      }
    }
  };

  $('#btn-train-weak').onclick = () => {
    if (weakestBab) {
      ch = weakestBab;
      AIStorage.set('ui.ch', ch);
      const wrongInWeak = Object.values(wrongMap).filter(w => w.bab === weakestBab);
      if (wrongInWeak.length > 0) {
        mode = 'wrong';
      } else {
        mode = 'bs';
      }
    } else {
      mode = 'bs';
    }
    AIStorage.set('ui.mode', mode);
    delete st['bs'];
    delete st['wrong_flow'];
    go();
  };

  const btnTrainWrong = $('#btn-train-wrong');
  if (btnTrainWrong) {
    btnTrainWrong.onclick = () => {
      mode = 'wrong';
      AIStorage.set('ui.mode', 'wrong');
      delete st['wrong_flow'];
      go();
    };
  }
}

// Master Router
function go() {
  if (window.location.hash !== '#' + mode) {
    history.replaceState(null, '', '#' + mode);
  }
  nav();
  try {
    const fn = {
      home,
      rg,
      fc,
      bs: () => flow('bs', B, BS, 1),
      mt: () => flow('mt', M, MT, 1),
      fi: () => flow('fi', F, FI, 1),
      wrong,
      es,
      sim
    }[mode];
    if (fn) {
      fn();
    } else {
      // fallback: unknown mode → go home
      mode = 'home';
      home();
    }
  } catch (err) {
    console.error('go() routing error for mode=' + mode + ':', err);
    app.innerHTML = '<div class="pn"><p>Terjadi kesalahan memuat tab ini. Coba tab lain atau refresh halaman.</p></div>';
  }
}

// Global Tab Clicks
$('#tabs').onclick = e => {
  const m = e.target.dataset.m;
  if (m) {
    mode = m;
    AIStorage.set('ui.mode', m);
    flip = false;
    go();
  }
};

// Global Chip Clicks
$('#chips').onclick = e => {
  if (e.target.id === 'bm-filter-btn' || e.target.closest('#bm-filter-btn')) {
    onlyBm = !onlyBm;
    AIStorage.set('ui.onlyBookmarked', onlyBm);
    delete st['bs'];
    delete st['mt'];
    delete st['fi'];
    deck = [];
    go();
    return;
  }

  if (e.target.dataset.c != null) {
    ch = +e.target.dataset.c;
    AIStorage.set('ui.ch', ch);
    deck = [];
    flip = false;
    delete st['bs'];
    delete st['mt'];
    delete st['fi'];
    delete st['wrong_flow'];
    go();
  }
};

// Reset Progress Button
$('#rsall').onclick = () => {
  if (confirm('Hapus seluruh riwayat dan progres belajar? Data akan kembali bersih.')) {
    AIStorage.reset();
    ch = 0;
    onlyBm = false;
    mode = 'home';
    deck = [];
    st = {};
    go();
  }
};

function initStickyObserver() {
  const sentinel = $('#tabs-sentinel');
  const tabsWrap = $('#tabs-wrap');
  if (!sentinel || !tabsWrap || typeof IntersectionObserver === 'undefined') return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const isStuck = !entry.isIntersecting && entry.boundingClientRect.top <= 0;
      tabsWrap.classList.toggle('is-stuck', isStuck);
    });
  }, {
    threshold: [0, 1]
  });

  observer.observe(sentinel);
}

// Initialize Mouse, Drag, Keyboard, and Scroll Interactions
function initContainerInteractions() {
  initStickyObserver();

  ['tabs', 'chips'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;

    el.addEventListener('scroll', updateScrollFades, { passive: true });

    el.addEventListener('wheel', e => {
      if (el.scrollWidth > el.clientWidth) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta !== 0) {
          el.scrollLeft += delta;
          updateScrollFades();
          e.preventDefault();
        }
      }
    }, { passive: false });

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let isDragging = false;

    el.addEventListener('mousedown', e => {
      if (el.scrollWidth <= el.clientWidth) return;
      isDown = true;
      isDragging = false;
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    });

    el.addEventListener('mouseleave', () => {
      isDown = false;
    });

    el.addEventListener('mouseup', () => {
      isDown = false;
    });

    el.addEventListener('mousemove', e => {
      if (!isDown) return;
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startX);
      if (Math.abs(walk) > 5) {
        isDragging = true;
      }
      if (isDragging) {
        e.preventDefault();
        el.scrollLeft = scrollLeft - walk;
        updateScrollFades();
      }
    });

    el.addEventListener('click', e => {
      if (isDragging) {
        e.stopImmediatePropagation();
        e.preventDefault();
        isDragging = false;
      }
    }, true);
  });

  window.addEventListener('resize', updateScrollFades, { passive: true });

  const tabsContainer = $('#tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('keydown', e => {
      const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
      const currentTab = document.activeElement;
      const index = tabs.indexOf(currentTab);
      if (index === -1) return;

      let nextIndex = index;
      if (e.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const targetTab = tabs[nextIndex];
      targetTab.focus();
      targetTab.click();
    });
  }
}

// ── Simulasi Ujian UTS Controller ──────────────────────────────────────────────
let simInterval = null;

function sim() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }

  const active = AIStorage.get('active_sim', null);
  if (!active) {
    renderSimSetupScreen();
    return;
  }

  if (active.submitted) {
    renderSimResultScreen(active);
    return;
  }

  renderSimExamScreen(active);
}

function renderSimSetupScreen() {
  const history = AIStorage.get('simulations', []);
  const highest = history.reduce((max, h) => Math.max(max, h.skorTotal || 0), 0);
  const totalCount = history.length;
  const avg = totalCount ? Math.round(history.reduce((sum, h) => sum + (h.skorTotal || 0), 0) / totalCount) : 0;

  app.innerHTML = `
    <div class="sim-container">
      <div class="sim-result-hero">
        <h2 style="font-family:'Knewave',cursive;font-size:28px;color:var(--yel);margin:0 0 8px">Simulasi Ujian UTS AI</h2>
        <p style="margin:0 0 16px;opacity:0.9">Format ujian UTS standar: 20 Soal Campuran (Benar/Salah, Isian, Cocokkan) dengan batasan waktu.</p>
        <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span class="sim-rank-badge">⚡ 20 Soal Campuran</span>
          <span class="sim-rank-badge" style="background:var(--cy);color:var(--plum)">⏱ Durasi Terukur</span>
          <span class="sim-rank-badge" style="background:var(--yel);color:var(--plum)">📊 Analisis Hasil</span>
        </div>
      </div>

      <div class="sim-stats-grid">
        <div class="sim-stat-card">
          <h4>Ujian Diikuti</h4>
          <div class="val">${totalCount} Kali</div>
        </div>
        <div class="sim-stat-card">
          <h4>Skor Tertinggi</h4>
          <div class="val" style="color:var(--mag)">${highest} / 100</div>
        </div>
        <div class="sim-stat-card">
          <h4>Rata-rata Skor</h4>
          <div class="val" style="color:var(--cy)">${avg} / 100</div>
        </div>
      </div>

      <div class="dash-card">
        <h3>Pengaturan Simulasi Ujian</h3>
        <div style="display:flex;flex-direction:column;gap:16px;margin:16px 0">
          <div>
            <label style="font-weight:800;display:block;margin-bottom:6px">Durasi Ujian:</label>
            <select id="sim-opt-duration" style="width:100%;padding:12px;border-radius:12px;border:2px solid #DDD;font-weight:700">
              <option value="30" selected>30 Menit (Standar UTS)</option>
              <option value="20">20 Menit (Tantangan Cepat)</option>
              <option value="45">45 Menit (Santai)</option>
            </select>
          </div>
          <div>
            <label style="font-weight:800;display:block;margin-bottom:6px">Cakupan Bab:</label>
            <select id="sim-opt-bab" style="width:100%;padding:12px;border-radius:12px;border:2px solid #DDD;font-weight:700">
              <option value="0" selected>Semua Bab (Bab 1–7 Kumulatif)</option>
              ${[1,2,3,4,5,6,7].map(b => `<option value="${b}">Bab ${b}: ${CHAPTER_NAMES[b]}</option>`).join('')}
            </select>
          </div>
        </div>

        <button class="cta" id="btn-start-sim" style="width:100%;min-height:52px;font-size:16px">🚀 Mulai Ujian Sekarang</button>
      </div>
    </div>
  `;

  $('#btn-start-sim').onclick = () => {
    const durMin = parseInt($('#sim-opt-duration').value, 10) || 30;
    const selectedBab = parseInt($('#sim-opt-bab').value, 10) || 0;

    let bsPool = B.filter(x => !selectedBab || x[0] === selectedBab);
    let fiPool = F.filter(x => !selectedBab || x[0] === selectedBab);
    let mtPool = M.filter(x => !selectedBab || x[0] === selectedBab);

    bsPool = sh(bsPool).slice(0, 8);
    fiPool = sh(fiPool).slice(0, 8);
    mtPool = sh(mtPool).slice(0, 4);

    const questions = [];
    bsPool.forEach(item => questions.push({ type: 'bs', data: item, bab: item[0], id: AIStorage.hashId('bs', item[1]) }));
    fiPool.forEach(item => questions.push({ type: 'fi', data: item, bab: item[0], id: AIStorage.hashId('fi', item[1]) }));
    mtPool.forEach(item => questions.push({ type: 'mt', data: item, bab: item[0], id: AIStorage.hashId('mt', item[1]) }));

    const shuffledQuestions = sh(questions);

    const activeSim = {
      id: 'sim_' + Date.now(),
      startTime: Date.now(),
      durationMin: durMin,
      endTimeMs: Date.now() + (durMin * 60 * 1000),
      questions: shuffledQuestions,
      answers: {},
      flags: {},
      currentIdx: 0,
      submitted: false
    };

    AIStorage.set('active_sim', activeSim);
    renderSimExamScreen(activeSim);
  };
}

function renderSimExamScreen(activeSim) {
  const qList = activeSim.questions;
  const currIdx = activeSim.currentIdx || 0;
  const q = qList[currIdx];

  const updateTimer = () => {
    const remainMs = activeSim.endTimeMs - Date.now();
    if (remainMs <= 0) {
      if (simInterval) clearInterval(simInterval);
      alert('Waktu ujian telah habis! Jawaban kamu dikumpulkan secara otomatis.');
      submitSim(activeSim);
      return;
    }

    const totalSec = Math.floor(remainMs / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');

    const timerEl = $('#sim-timer-display');
    if (timerEl) {
      timerEl.textContent = `${m}:${s}`;
      if (totalSec < 300) {
        timerEl.classList.add('warning');
      } else {
        timerEl.classList.remove('warning');
      }
    }
  };

  simInterval = setInterval(updateTimer, 1000);

  const answeredCount = Object.keys(activeSim.answers).length;

  app.innerHTML = `
    <div class="sim-container">
      <div class="sim-header">
        <div>
          <span class="sim-tag">Ujian UTS Berlangsung</span>
          <h3 style="margin:4px 0 0;font-size:18px">${answeredCount} dari ${qList.length} Soal Terjawab</h3>
        </div>
        <div class="sim-timer" id="sim-timer-display">--:--</div>
      </div>

      <div class="sim-grid-nav">
        ${qList.map((item, idx) => {
          const isAns = activeSim.answers[idx] !== undefined && activeSim.answers[idx] !== '';
          const isFlg = !!activeSim.flags[idx];
          const isCurr = idx === currIdx;
          let cls = 'sim-grid-btn';
          if (isAns) cls += ' answered';
          if (isFlg) cls += ' flagged';
          if (isCurr) cls += ' current';
          return `<button class="${cls}" data-idx="${idx}">${idx + 1}</button>`;
        }).join('')}
      </div>

      <div class="sim-card">
        <div class="sim-card-top">
          <span class="sim-tag">Soal ${currIdx + 1} dari ${qList.length} · Bab ${q.bab} (${q.type === 'bs' ? 'Benar/Salah' : q.type === 'fi' ? 'Isian' : 'Cocokkan'})</span>
          <button class="sim-flag-btn ${activeSim.flags[currIdx] ? 'on' : ''}" id="btn-flag">
            ★ ${activeSim.flags[currIdx] ? 'Ragu-ragu' : 'Tandai'}
          </button>
        </div>

        <div class="sim-question-text">${q.type === 'bs' ? q.data[1] : q.type === 'fi' ? q.data[1] : q.data[1]}</div>

        <div id="sim-q-body"></div>

        <div class="sim-actions">
          <button class="cta o" id="btn-sim-prev" ${currIdx === 0 ? 'disabled' : ''}>← Sebelum</button>
          <button class="cta o" id="btn-sim-next" ${currIdx === qList.length - 1 ? 'disabled' : ''}>Lanjut →</button>
          <button class="cta w" id="btn-sim-submit" style="background:var(--mag);border-color:var(--mag);color:#FFF">✓ Kumpulkan Ujian</button>
        </div>
      </div>
    </div>
  `;

  updateTimer();

  app.querySelectorAll('.sim-grid-btn').forEach(btn => {
    btn.onclick = () => {
      activeSim.currentIdx = parseInt(btn.dataset.idx, 10);
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    };
  });

  $('#btn-flag').onclick = () => {
    activeSim.flags[currIdx] = !activeSim.flags[currIdx];
    AIStorage.set('active_sim', activeSim);
    renderSimExamScreen(activeSim);
  };

  const bodyEl = $('#sim-q-body');
  const userAns = activeSim.answers[currIdx];

  if (q.type === 'bs') {
    bodyEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
        <button class="cta ${userAns === true ? '' : 'o'}" id="bs-opt-true" style="min-height:54px;font-size:16px">BENAR</button>
        <button class="cta ${userAns === false ? '' : 'o'}" id="bs-opt-false" style="min-height:54px;font-size:16px">SALAH</button>
      </div>
    `;
    $('#bs-opt-true').onclick = () => {
      activeSim.answers[currIdx] = true;
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    };
    $('#bs-opt-false').onclick = () => {
      activeSim.answers[currIdx] = false;
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    };
  } else if (q.type === 'fi') {
    bodyEl.innerHTML = `
      <div style="margin:16px 0">
        <input id="sim-fi-input" value="${userAns || ''}" placeholder="Ketik jawaban kamu di sini..." style="width:100%;padding:14px;border-radius:14px;border:2px solid #DDD;font-size:16px;font-weight:700">
        <button class="cta w" id="sim-fi-save" style="margin-top:10px;width:100%">Simpan Jawaban</button>
      </div>
    `;
    const saveFi = () => {
      const val = $('#sim-fi-input').value;
      activeSim.answers[currIdx] = val;
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    };
    $('#sim-fi-save').onclick = saveFi;
    $('#sim-fi-input').onchange = saveFi;
  } else if (q.type === 'mt') {
    const pairs = q.data[3];
    const options = q.data[2];
    const mtAns = userAns || {};

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0">
        ${pairs.map((p, k) => `
          <div style="background:#FAF9FB;padding:12px 16px;border-radius:14px;border:2px solid #E5E5E5;display:flex;flex-direction:column;gap:6px">
            <span style="font-weight:800;color:var(--plum)">${p[0]}</span>
            <select data-pairidx="${k}" class="sim-mt-select" style="width:100%;padding:10px;border-radius:10px;border:2px solid #DDD;font-weight:700">
              <option value="">-- Pilih Pasangan --</option>
              ${options.map((opt, optIdx) => `<option value="${optIdx}" ${mtAns[k] === optIdx ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    `;

    bodyEl.querySelectorAll('.sim-mt-select').forEach(sel => {
      sel.onchange = () => {
        const pairK = sel.dataset.pairidx;
        const val = sel.value === '' ? undefined : parseInt(sel.value, 10);
        if (!activeSim.answers[currIdx]) activeSim.answers[currIdx] = {};
        if (val === undefined) {
          delete activeSim.answers[currIdx][pairK];
        } else {
          activeSim.answers[currIdx][pairK] = val;
        }
        AIStorage.set('active_sim', activeSim);
      };
    });
  }

  $('#btn-sim-prev').onclick = () => {
    if (currIdx > 0) {
      activeSim.currentIdx = currIdx - 1;
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    }
  };

  $('#btn-sim-next').onclick = () => {
    if (currIdx < qList.length - 1) {
      activeSim.currentIdx = currIdx + 1;
      AIStorage.set('active_sim', activeSim);
      renderSimExamScreen(activeSim);
    }
  };

  $('#btn-sim-submit').onclick = () => {
    const unans = qList.length - Object.keys(activeSim.answers).length;
    let msg = 'Apakah kamu yakin ingin mengumpulkan jawaban ujian ini?';
    if (unans > 0) {
      msg = `Masih ada ${unans} soal yang belum dijawab! ` + msg;
    }
    if (confirm(msg)) {
      submitSim(activeSim);
    }
  };
}

function submitSim(activeSim) {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }

  activeSim.submitted = true;
  activeSim.finishTime = Date.now();

  let scoreSum = 0;
  const reviews = [];
  const catScore = { bs: { ok: 0, tot: 0 }, fi: { ok: 0, tot: 0 }, mt: { ok: 0, tot: 0 } };
  const babScore = {};

  activeSim.questions.forEach((q, idx) => {
    const userVal = activeSim.answers[idx];
    let isOk = false;
    let userDisplay = 'Tidak dijawab';
    let correctDisplay = '';
    let itemScore = 0;

    if (!babScore[q.bab]) babScore[q.bab] = { ok: 0, tot: 0 };

    if (q.type === 'bs') {
      catScore.bs.tot += 5;
      babScore[q.bab].tot += 5;
      const expected = q.data[2];
      correctDisplay = expected ? 'BENAR' : 'SALAH';
      if (userVal !== undefined) {
        userDisplay = userVal ? 'BENAR' : 'SALAH';
        isOk = (userVal === expected);
      }
      if (isOk) {
        itemScore = 5;
        catScore.bs.ok += 5;
        babScore[q.bab].ok += 5;
      }
      AIStorage.logAnswer({ id: q.id, kategori: 'bs', bab: q.bab, benar: isOk });
    } else if (q.type === 'fi') {
      catScore.fi.tot += 5;
      babScore[q.bab].tot += 5;
      correctDisplay = q.data[3];
      if (userVal) {
        userDisplay = userVal;
        const check = checkIsianAnswer(userVal, q.data[2]);
        isOk = check.ok;
      }
      if (isOk) {
        itemScore = 5;
        catScore.fi.ok += 5;
        babScore[q.bab].ok += 5;
      }
      AIStorage.logAnswer({ id: q.id, kategori: 'fi', bab: q.bab, benar: isOk });
    } else if (q.type === 'mt') {
      catScore.mt.tot += 5;
      babScore[q.bab].tot += 5;
      const pairs = q.data[3];
      const opts = q.data[2];
      correctDisplay = pairs.map(p => `${p[0]} ➔ ${opts[p[1]]}`).join(' | ');

      let pairCorrectCount = 0;
      if (userVal && typeof userVal === 'object') {
        const userPairsStr = [];
        pairs.forEach((p, k) => {
          const ansIdx = userVal[k];
          if (ansIdx !== undefined) {
            userPairsStr.push(`${p[0]} ➔ ${opts[ansIdx]}`);
            if (ansIdx === p[1]) pairCorrectCount++;
          }
        });
        userDisplay = userPairsStr.length ? userPairsStr.join(' | ') : 'Tidak lengkap';
      }

      itemScore = (pairCorrectCount / pairs.length) * 5;
      catScore.mt.ok += itemScore;
      babScore[q.bab].ok += itemScore;
      isOk = (pairCorrectCount === pairs.length);
      AIStorage.logAnswer({ id: q.id, kategori: 'mt', bab: q.bab, benar: isOk });
    }

    scoreSum += itemScore;

    reviews.push({
      q,
      isOk,
      userDisplay,
      correctDisplay,
      exp: q.data[3] || q.data[2] || 'Lihat materi ringkasan bab terkait.'
    });
  });

  const finalScore = Math.round(scoreSum);
  const durationSec = Math.round((activeSim.finishTime - activeSim.startTime) / 1000);

  const simResultRecord = {
    waktu: Date.now(),
    durasiDetik: durationSec,
    skorTotal: finalScore,
    skorKategori: catScore,
    skorBab: babScore,
    totalSoal: activeSim.questions.length
  };

  const history = AIStorage.get('simulations', []);
  history.unshift(simResultRecord);
  AIStorage.set('simulations', history);

  activeSim.results = {
    score: finalScore,
    durationSec,
    catScore,
    babScore,
    reviews
  };

  AIStorage.set('active_sim', activeSim);
  renderSimResultScreen(activeSim);
}

function renderSimResultScreen(activeSim) {
  const res = activeSim.results;
  const score = res.score;
  const m = Math.floor(res.durationSec / 60);
  const s = res.durationSec % 60;

  let rankStr = 'PERLU BELAJAR LAGI';
  let rankBg = '#E74C3C';
  if (score >= 85) {
    rankStr = '🏆 SANGAT MEMUASKAN (A)';
    rankBg = 'var(--mag)';
  } else if (score >= 70) {
    rankStr = '✨ MEMUASKAN (B)';
    rankBg = 'var(--cy)';
  } else if (score >= 55) {
    rankStr = '👍 CUKUP (C)';
    rankBg = 'var(--yel)';
  }

  app.innerHTML = `
    <div class="sim-container">
      <div class="sim-result-hero">
        <h3 style="margin:0 0 4px;opacity:0.9">Hasil Simulasi Ujian UTS</h3>
        <div class="sim-big-score">${score}</div>
        <span class="sim-rank-badge" style="background:${rankBg};color:${score >= 55 && score < 70 ? 'var(--plum)' : '#FFF'}">${rankStr}</span>
      </div>

      <div class="sim-stats-grid">
        <div class="sim-stat-card">
          <h4>Total Waktu</h4>
          <div class="val">${m}m ${s}s</div>
        </div>
        <div class="sim-stat-card">
          <h4>Total Soal</h4>
          <div class="val">${activeSim.questions.length} Soal</div>
        </div>
        <div class="sim-stat-card">
          <h4>Akurasi Nilai</h4>
          <div class="val" style="color:var(--mag)">${score}%</div>
        </div>
      </div>

      <div class="dash-card">
        <h3>Evaluasi per Kategori Soal</h3>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
          <div>
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-bottom:4px">
              <span>Benar / Salah</span>
              <span>${Math.round((res.catScore.bs.ok / (res.catScore.bs.tot || 1)) * 100)}%</span>
            </div>
            <div class="ch-meter"><div class="ch-meter-fill" style="width:${(res.catScore.bs.ok / (res.catScore.bs.tot || 1)) * 100}%"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-bottom:4px">
              <span>Isian Singkat</span>
              <span>${Math.round((res.catScore.fi.ok / (res.catScore.fi.tot || 1)) * 100)}%</span>
            </div>
            <div class="ch-meter"><div class="ch-meter-fill" style="width:${(res.catScore.fi.ok / (res.catScore.fi.tot || 1)) * 100}%"></div></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-bottom:4px">
              <span>Cocokkan Pasangan</span>
              <span>${Math.round((res.catScore.mt.ok / (res.catScore.mt.tot || 1)) * 100)}%</span>
            </div>
            <div class="ch-meter"><div class="ch-meter-fill" style="width:${(res.catScore.mt.ok / (res.catScore.mt.tot || 1)) * 100}%"></div></div>
          </div>
        </div>
      </div>

      <div class="dash-card">
        <h3>Pembahasan & Review Jawaban</h3>
        <div style="margin-top:16px">
          ${res.reviews.map((rv, i) => `
            <div class="sim-review-item ${rv.isOk ? 'correct' : 'wrong'}">
              <div class="sim-review-header">
                <span>Soal ${i + 1} (Bab ${rv.q.bab})</span>
                <span class="sim-review-status ${rv.isOk ? 'correct' : 'wrong'}">${rv.isOk ? '✓ BENAR' : '✗ SALAH'}</span>
              </div>
              <p style="font-weight:800;margin:0 0 8px;color:var(--plum)">${rv.q.type === 'bs' ? rv.q.data[1] : rv.q.type === 'fi' ? rv.q.data[1] : rv.q.data[1]}</p>
              <div style="font-size:13px;line-height:1.4">
                <div><b>Jawaban Kamu:</b> ${rv.userDisplay}</div>
                <div><b>Jawaban Benar:</b> ${rv.correctDisplay}</div>
              </div>
              ${rv.q.type === 'bs' && rv.q.data[3] ? `<div class="sim-review-exp"><b>Pembahasan:</b> ${rv.q.data[3]}</div>` : ''}
              ${rv.q.type === 'es' && rv.q.data[2] ? `<div class="sim-review-exp"><b>Pembahasan:</b> ${rv.q.data[2]}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <div class="row" style="margin-top:16px">
        <button class="cta o" id="btn-sim-reset">🚀 Ujian Baru</button>
        <button class="cta" id="btn-sim-home">🏠 Ke Beranda</button>
      </div>
    </div>
  `;

  $('#btn-sim-reset').onclick = () => {
    AIStorage.set('active_sim', null);
    renderSimSetupScreen();
  };

  $('#btn-sim-home').onclick = () => {
    mode = 'home';
    AIStorage.set('ui.mode', 'home');
    go();
  };
}

// Hash Routing Listener
window.addEventListener('hashchange', () => {
  const h = window.location.hash.replace('#', '');
  if (h && TABS.some(t => t[0] === h)) {
    if (mode !== h) {
      mode = h;
      AIStorage.set('ui.mode', h);
      go();
    }
  }
});

// Initial Hash Check
if (window.location.hash) {
  const h = window.location.hash.replace('#', '');
  if (h && TABS.some(t => t[0] === h)) {
    mode = h;
    AIStorage.set('ui.mode', h);
  }
}

// Setup Export / Import
const btnExport = $('#btn-export');
if (btnExport) {
  btnExport.onclick = () => {
    const dataStr = AIStorage.export();
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `belajar_ai_uts_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

const btnImport = $('#btn-import');
const fileInput = $('#file-import-input');
if (btnImport && fileInput) {
  btnImport.onclick = () => fileInput.click();
  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = evt => {
        const ok = AIStorage.import(evt.target.result);
        if (ok) {
          alert('Progres berhasil diimpor!');
          mode = 'home';
          go();
        } else {
          alert('Gagal mengimpor file! Format JSON tidak valid.');
        }
      };
      reader.readAsText(file);
    }
  };
}

// Start application
initContainerInteractions();
go();

