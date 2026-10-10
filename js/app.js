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
  ['es', 'Esai']
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

// Isian Handlers
const FI = {
  h: x => `<p class="q">${x[1]}</p><input id="ans" placeholder="Ketik jawabanmu" autocomplete="off"><button class="cta w" id="ck">Periksa</button>`,
  b: (x, fin) => {
    const go = () => {
      const v = $('#ans').value.trim().toLowerCase();
      const ok = !!v && x[2].split('/').some(a => v.includes(a));
      $('#ans').disabled = true;
      $('#ck').remove();

      // Log answer
      const qId = AIStorage.hashId('fi', x[1]);
      AIStorage.logAnswer({ id: qId, kategori: 'fi', bab: x[0], benar: ok });

      fin(+ok, `${ok ? 'Benar. ' : 'Belum tepat. '}Jawaban: <b>${x[3]}</b>`);
    };
    $('#ck').onclick = go;
    $('#ans').onkeydown = e => {
      if (e.key === 'Enter') go();
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
      es
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

// Initialize Mouse, Drag, Keyboard, and Scroll Interactions
function initContainerInteractions() {
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

// Start application
initContainerInteractions();
go();
