const $ = s => document.querySelector(s);
const app = $('#app');

const LS = {
  g(k, d) {
    try {
      const v = localStorage.getItem('ai_' + k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  },
  s(k, v) {
    try {
      localStorage.setItem('ai_' + k, JSON.stringify(v));
    } catch (e) {}
  }
};

const sh = a => [...a].sort(() => Math.random() - .5);

const TABS = [
  ['rg', 'Ringkasan'],
  ['fc', 'Kartu'],
  ['bs', 'Benar/Salah'],
  ['mt', 'Cocokkan'],
  ['fi', 'Isian'],
  ['es', 'Esai']
];

let mode = LS.g('mode', 'rg'),
  ch = LS.g('ch', 0),
  known = new Set(LS.g('known', [])),
  st = {},
  deck = [],
  i = 0,
  flip = false,
  search = '';

const saveK = () => LS.s('known', [...known]);

function nav() {
  $('#tabs').innerHTML = TABS.map(t => `<button class="tab ${mode == t[0] ? 'on' : ''}" data-m="${t[0]}">${t[1]}</button>`).join('');
  $('#chips').innerHTML = ['Semua', 1, 2, 3, 4, 5, 6, 7].map((c, k) => `<button class="chip ${ch == k ? 'on' : ''}" data-c="${k}">${k ? 'Bab ' + c : c}</button>`).join('');
}

function flow(k, pool, draw, fresh) {
  let S = st[k];
  if (fresh || !S) {
    S = st[k] = { l: sh(pool.filter(x => !ch || x[0] == ch)), i: 0, s: 0, t: 0 };
  }
  if (!S.l.length) {
    app.innerHTML = '<div class="pn">Belum ada soal untuk bab ini. Pilih bab lain.</div>';
    return;
  }
  if (S.i >= S.l.length) {
    app.innerHTML = `<div class="pn c"><div class="info3"><div><b>${S.s}</b>Benar</div><div><b>${S.t - S.s}</b>Salah</div><div><b>${Math.round(S.s / S.t * 100)}%</b>Skor</div></div><p>${S.s == S.t ? 'Sempurna, siap UTS!' : S.s >= S.t * .7 ? 'Bagus, tinggal rapikan jebakannya.' : 'Buka tab Ringkasan dulu, lalu coba lagi.'}</p><button class="cta" id="rs">Main lagi</button></div>`;
    $('#rs').onclick = () => flow(k, pool, draw, 1);
    return;
  }
  const x = S.l[S.i],
    re = () => flow(k, pool, draw);
  const fin = (ok, msg, n = 1) => {
    S.s += ok;
    S.t += n;
    $('#fb').innerHTML = `<div class="exp">${msg}</div><button class="cta w" id="nx">${S.i + 1 < S.l.length ? 'Lanjut' : 'Lihat skor'}</button>`;
    $('#nx').onclick = () => {
      S.i++;
      re();
      window.scrollTo(0, Math.max(0, $('#chips').offsetTop - 70));
    };
  };
  app.innerHTML = `<div class="bar"><i style="width:${S.i / S.l.length * 100}%"></i></div><div class="pn"><div class="tag">Bab ${x[0]} · ${S.i + 1} dari ${S.l.length}</div>${draw.h(x)}<div id="fb"></div></div>`;
  draw.b(x, fin);
}

const BS = {
  h: x => `<p class="q">${x[1]}</p><button class="opt" data-v="1">Benar</button><button class="opt" data-v="0">Salah</button>`,
  b: (x, fin) => app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const v = +b.dataset.v,
      ok = v == x[2];
    app.querySelectorAll('.opt').forEach(o => {
      o.disabled = true;
      if (+o.dataset.v == x[2]) o.classList.add('ok');
      else if (o == b) o.classList.add('bad');
    });
    fin(+ok, (ok ? 'Benar. ' : 'Belum tepat. ') + x[3]);
  })
};

const MT = {
  h: x => `<p class="q">Cocokkan tiap kasus dengan ${x[1]}.</p>${x[3].map((t, k) => `<div class="mr"><div>${t[0]}</div><select data-k="${k}"><option value="">Pilih</option>${x[2].map((o, j) => `<option value="${j}">${o}</option>`).join('')}</select></div>`).join('')}<button class="cta w" id="ck">Periksa</button>`,
  b: (x, fin) => {
    $('#ck').onclick = () => {
      let ok = 0;
      app.querySelectorAll('select').forEach((e, k) => {
        const c = x[3][k][1],
          r = e.value !== '' && +e.value === c;
        if (r) ok++;
        e.classList.add(r ? 'good' : 'wrong');
        e.disabled = true;
        if (!r) e.parentElement.firstElementChild.insertAdjacentHTML('beforeend', `<div class="hint">Benar: ${x[2][c]}</div>`);
      });
      $('#ck').remove();
      fin(ok, `${ok} dari ${x[3].length} cocok.`, x[3].length);
    };
  }
};

const FI = {
  h: x => `<p class="q">${x[1]}</p><input id="ans" placeholder="Ketik jawabanmu" autocomplete="off"><button class="cta w" id="ck">Periksa</button>`,
  b: (x, fin) => {
    const go = () => {
      const v = $('#ans').value.trim().toLowerCase(),
        ok = !!v && x[2].split('/').some(a => v.includes(a));
      $('#ans').disabled = true;
      $('#ck').remove();
      fin(+ok, `${ok ? 'Benar. ' : 'Belum tepat. '}Jawaban: <b>${x[3]}</b>`);
    };
    $('#ck').onclick = go;
    $('#ans').onkeydown = e => {
      if (e.key == 'Enter') go();
    };
  }
};

function fc() {
  if (!deck.length || i >= deck.length) {
    deck = sh(C.filter(c => (!ch || c[0] == ch) && !known.has(c[1])));
    i = 0;
  }
  const tot = C.filter(c => !ch || c[0] == ch).length,
    kn = C.filter(c => (!ch || c[0] == ch) && known.has(c[1])).length;
  if (!deck.length) {
    app.innerHTML = `<div class="pn c"><h2>Semua kartu hafal</h2><p>Mantap! Ulangi dari awal untuk latihan lagi.</p><button class="cta" id="rs">Ulang dari awal</button></div>`;
    $('#rs').onclick = () => {
      C.forEach(c => (!ch || c[0] == ch) && known.delete(c[1]));
      saveK();
      deck = [];
      fc();
    };
    return;
  }
  const c = deck[i];
  app.innerHTML = `<div class="bar"><i style="width:${kn / tot * 100}%"></i></div><div class="pn fc" id="card"><div class="tag">Bab ${c[0]} · ${kn} dari ${tot} hafal</div>${flip ? `<div class="a" style="white-space:pre-line">${c[2]}</div>` : `<div class="t">${c[1]}</div><div class="hint">Ketuk kartu untuk melihat penjelasan.</div>`}</div><div class="row"><button class="cta o" id="no">Belum hafal</button><button class="cta" id="yes">Hafal</button></div>`;
  $('#card').onclick = () => {
    flip = !flip;
    fc();
  };
  $('#no').onclick = () => {
    flip = false;
    i++;
    fc();
  };
  $('#yes').onclick = () => {
    known.add(c[1]);
    saveK();
    deck.splice(i, 1);
    flip = false;
    fc();
  };
}

function rg() {
  const L = C.filter(c => (!ch || c[0] == ch) && (c[1] + c[2]).toLowerCase().includes(search));
  const q = n => n.filter(x => !ch || x[0] == ch).length;
  app.innerHTML = `<div class="info3"><div><b>${L.length}</b>Topik</div><div><b>${q(B) + q(F) + q(M)}</b>Set soal</div><div><b>${C.filter(c => known.has(c[1])).length}</b>Kartu hafal</div></div><input id="s" placeholder="Cari istilah, misalnya admissible" value="${search}" style="margin-bottom:16px"><div class="pn">${L.map(c => `<div class="item"><div class="tag">Bab ${c[0]}</div><b>${c[1]}</b><p style="white-space:pre-line">${c[2]}</p></div>`).join('') || 'Tidak ada hasil.'}</div>`;
  const s = $('#s');
  s.oninput = () => {
    search = s.value.toLowerCase();
    const p = s.selectionStart;
    rg();
    $('#s').focus();
    $('#s').setSelectionRange(p, p);
  };
}

function es() {
  const d = new Set(LS.g('esai', [])),
    L = E.map((x, k) => [x, k]).filter(y => !ch || y[0][0] == ch);
  app.innerHTML = `<div class="pn"><h2>Kemungkinan soal esai</h2><p class="hint" style="margin:0 0 16px">Jawab di kertas, lalu ketuk soal untuk menandai sudah dilatih. ${d.size} dari ${E.length} selesai.</p>${L.map(y => `<button class="eq ${d.has(y[1]) ? 'dn' : ''}" data-q="${y[1]}"><span class="tag">Bab ${y[0][0]}</span>${y[0][1]}</button>`).join('')}</div>`;
  app.querySelectorAll('.eq').forEach(b => b.onclick = () => {
    const k = +b.dataset.q;
    d.has(k) ? d.delete(k) : d.add(k);
    LS.s('esai', [...d]);
    const y = window.scrollY;
    es();
    window.scrollTo(0, y);
  });
}

function go() {
  nav();
  ({ rg, fc, bs: () => flow('bs', B, BS, 1), mt: () => flow('mt', M, MT, 1), fi: () => flow('fi', F, FI, 1), es }[mode])();
}

$('#tabs').onclick = e => {
  const m = e.target.dataset.m;
  if (m) {
    mode = m;
    LS.s('mode', m);
    flip = false;
    go();
  }
};

$('#chips').onclick = e => {
  if (e.target.dataset.c != null) {
    ch = +e.target.dataset.c;
    LS.s('ch', ch);
    deck = [];
    flip = false;
    go();
  }
};

$('#rsall').onclick = () => {
  if (confirm('Hapus progres hafalan kartu?')) {
    known.clear();
    saveK();
    deck = [];
    go();
  }
};

go();
