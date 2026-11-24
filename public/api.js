/* 噜包蛋之城 · standalone runtime
   Provides window.claude.use(...) on top of this site's own /api, so the page
   works the same way it did on Claude: db, user, assets, downloads, sample(place search). */
(() => {
  'use strict';
  const COLS = { 'movies': 'movies', 'meals': 'meals', 'trips': 'trips', 'private/invest/items': 'invest' };
  const st = { data: null, editor: false, loading: null, listeners: new Set() };
  const err = (code, message) => ({ code, message });

  async function api(method, path, body, headers = {}) {
    const opt = { method, credentials: 'same-origin', headers: { ...headers } };
    if (body !== undefined) {
      if (body instanceof Blob || body instanceof ArrayBuffer) opt.body = body;
      else { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
    }
    let r;
    try { r = await fetch(path, opt); } catch { throw err('unavailable', '网络连不上'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = r.status === 401 ? 'invalid_argument' : r.status === 507 ? 'quota_exceeded' : r.status === 415 ? 'unsupported_type' : r.status === 413 ? 'too_large' : 'unavailable';
      throw err(code, j.error || ('出错了（' + r.status + '）'));
    }
    return j;
  }
  async function load() {
    const j = await api('GET', '/api/data');
    st.data = j.docs || {}; st.editor = !!j.editor;
    st.listeners.forEach(l => { try { l(); } catch (e) { console.error(e); } });
  }
  function ensure() { return st.loading ||= load(); }
  const emit = () => st.listeners.forEach(l => { try { l(); } catch (e) { console.error(e); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.data) load().catch(() => {}); });
  setInterval(() => { if (document.visibilityState === 'visible' && st.data) load().catch(() => {}); }, 120000);

  const genId = () => [...crypto.getRandomValues(new Uint8Array(10))].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const meta = { fromCache: false, hasPendingWrites: false };
  function parse(path) {
    path = String(path).replace(/^\/+/, '');
    if (path === 'city/meta') return ['meta', 'city'];
    const p = path.split('/'); const id = p.pop();
    return [COLS[p.join('/')] || p.join('/'), id];
  }
  function sub(listener, onErr) {
    st.listeners.add(listener);
    ensure().then(listener).catch(e => onErr?.(e));
    return () => st.listeners.delete(listener);
  }
  function docRef(path) {
    const [col, id] = parse(path);
    const snap = () => { const d = st.data?.[col]?.[id]; return { id, exists: !!d, data: () => d, metadata: meta }; };
    const ref = {
      id, path,
      async get() { await ensure(); return snap(); },
      async set(data) { await api('PUT', `/api/doc/${col}/${encodeURIComponent(id)}`, data); (st.data[col] ||= {})[id] = JSON.parse(JSON.stringify(data)); emit(); },
      async update(patch) { await ensure(); const cur = st.data?.[col]?.[id]; if (!cur) throw err('invalid_argument', '不存在'); return ref.set({ ...cur, ...patch }); },
      async delete() { await api('DELETE', `/api/doc/${col}/${encodeURIComponent(id)}`); if (st.data?.[col]) delete st.data[col][id]; emit(); },
      onSnapshot(next, onErr) { return sub(() => next(snap()), onErr); },
      collection(sub) { return colRef(path + '/' + sub); },
    };
    return ref;
  }
  function colRef(path) {
    const col = COLS[path] || path;
    const snap = () => { const docs = Object.entries(st.data?.[col] || {}).map(([id, d]) => ({ id, exists: true, data: () => d, metadata: meta })); return { docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => [] }; };
    return {
      path,
      doc: id => docRef(path + '/' + (id || genId())),
      async add(data) { const r = docRef(path + '/' + genId()); await r.set(data); return r; },
      async get() { await ensure(); return snap(); },
      onSnapshot(next, onErr) { return sub(() => next(snap()), onErr); },
    };
  }
  const db = { doc: docRef, collection: colRef };
  const user = {
    can: async () => { await ensure(); return st.editor; },
    canEdit: async () => { await ensure(); return st.editor; },
    isOwner: () => st.editor,
    id: async () => 'me',
  };
  const assets = {
    async upload(blob, opts, wantedId) {
      const type = (opts && opts.type) || blob.type || 'image/jpeg';
      return api('POST', '/api/upload' + (wantedId ? '?id=' + encodeURIComponent(wantedId) : ''), blob, { 'content-type': type });
    },
    async delete(ref) { const id = String(ref).replace(/^.*\//, ''); return api('DELETE', '/api/photo/' + encodeURIComponent(id)); },
    async list() { const u = await api('GET', '/api/usage'); return { assets: [], usage: { files: u.files, bytes: u.bytes, maxFiles: 1e9, maxBytes: u.maxBytes } }; },
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: 'saved' };
    },
  };
  // Google Maps: load it before the page boots when a key is configured; fall back to the hand-drawn map otherwise
  window.LBD_READY = (async () => {
    let key = '';
    try { const r = await fetch('/api/config', { credentials: 'same-origin' }); key = (await r.json()).googleMapsKey || ''; } catch {}
    if (!key || /[?&]nogmaps\b/.test(location.search)) return;
    await Promise.race([
      new Promise((res, rej) => {
        window.__lbdGmapsReady = res;
        window.gm_authFailure = () => { console.warn('Google Maps key rejected'); const t = document.createElement('div'); t.className = 'toast err'; t.textContent = 'Google 地图的 API key 不能用（检查 key、计费账号和网址限制）。'; (document.getElementById('toasts') || document.body).appendChild(t); setTimeout(() => t.remove(), 8000); };
        const s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({ key, v: 'weekly', language: 'zh-CN', region: 'SG', loading: 'async', callback: '__lbdGmapsReady' });
        s.async = true; s.onerror = rej; document.head.appendChild(s);
      }).catch(() => {}),
      new Promise(r => setTimeout(r, 8000)),
    ]);
  })();
  // place search, used by the "搜这个地点" button
  window.LBD_LOCATE = async (q) => api('GET', '/api/locate?q=' + encodeURIComponent(q));

  window.claude = {
    async use(name) {
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'downloads') return downloads;
      if (name === 'assets' || name === 'sample') { try { await ensure(); } catch { return null; } return st.editor ? (name === 'assets' ? assets : {}) : null; }
      return null;
    },
  };

  /* ---------- editor login + import, rendered inside 城市设置 ---------- */
  window.LBD_AUTH = {
    html() {
      return st.editor
        ? `<div class="field"><span class="flabel">城主登录</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="chip invest">已登录，可以编辑</span><button class="btn small ghost" type="button" data-auth="logout">退出登录</button></div></div>`
        : `<div class="field"><label for="lbd-pass" class="flabel">城主登录</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="lbd-pass" type="password" autocomplete="current-password" placeholder="编辑密码" style="flex:1;min-width:160px;padding:8px 12px;border:2px solid var(--ink);border-radius:var(--r-sm);background:var(--card)"><button class="btn small primary" type="button" data-auth="login">登录</button></div><div class="hint">噜和蛋输入编辑密码后，才能添加、修改记录，也才能看到投资部。</div></div>`;
    },
    importHtml() {
      return st.editor ? `<button class="btn small" type="button" data-auth="import">从备份导入（.zip）</button>` : '';
    },
  };
  async function doLogin() {
    const inp = document.getElementById('lbd-pass'); const pw = inp?.value || '';
    if (!pw) { inp?.focus(); return; }
    try { await api('POST', '/api/login', { password: pw }); location.reload(); }
    catch (e) { alertBox(e.message || '登录失败'); }
  }
  function alertBox(msg) {
    const t = document.createElement('div'); t.className = 'toast err'; t.textContent = msg;
    (document.getElementById('toasts') || document.body).appendChild(t); setTimeout(() => t.remove(), 4000);
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-auth]'); if (!b) return;
    const a = b.dataset.auth;
    if (a === 'login') doLogin();
    if (a === 'logout') { await api('POST', '/api/logout').catch(() => {}); location.reload(); }
    if (a === 'import') pickImport();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lbd-pass') doLogin(); });

  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function pickImport() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.zip,application/zip';
    inp.onchange = () => inp.files[0] && runImport(inp.files[0]);
    inp.click();
  }
  async function runImport(file) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(63,48,36,.55);display:grid;place-items:center;padding:20px';
    box.innerHTML = `<div style="background:#FBF4E6;border:2.5px solid #3F3024;border-radius:18px;padding:22px 26px;max-width:420px;width:100%;font-family:inherit"><h3 style="margin:0 0 10px;font-size:22px">正在导入备份</h3><div id="imp-st">读取文件中…</div><div style="margin-top:14px;height:10px;border:2px solid #3F3024;border-radius:999px;overflow:hidden"><div id="imp-bar" style="height:100%;width:0;background:#F2B632"></div></div><div id="imp-done" style="margin-top:14px"></div></div>`;
    document.body.appendChild(box);
    const stEl = box.querySelector('#imp-st'), bar = box.querySelector('#imp-bar'), done = box.querySelector('#imp-done');
    try {
      if (typeof JSZip === 'undefined') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const zip = await JSZip.loadAsync(file);
      const data = JSON.parse(await zip.file('data.json').async('string'));
      const photos = Object.keys(zip.files).filter(n => n.startsWith('photos/') && !zip.files[n].dir);
      const docs = [];
      for (const [col, key] of [['movies', 'movies'], ['meals', 'meals'], ['trips', 'trips'], ['invest', 'invest']]) for (const d of (data[key] || [])) { const { id, ...rest } = d; if (id) docs.push([col, id, rest]); }
      if (data.meta && Object.keys(data.meta).length) docs.push(['meta', 'city', data.meta]);
      const total = photos.length + docs.length; let n = 0, failed = 0;
      const tick = () => { bar.style.width = (++n / total * 100).toFixed(1) + '%'; };
      for (const p of photos) {
        const id = p.slice(7);
        stEl.textContent = `上传照片 ${n + 1} / ${photos.length}…`;
        try { const blob = await zip.file(p).async('blob'); await assets.upload(blob, { type: data.photoTypes?.[id] || 'image/jpeg' }, id); } catch (e) { failed++; console.warn(p, e); }
        tick();
      }
      for (const [col, id, d] of docs) {
        stEl.textContent = `写入记录 ${n - photos.length + 1} / ${docs.length}…`;
        try { await api('PUT', `/api/doc/${col}/${encodeURIComponent(id)}`, d); } catch (e) { failed++; console.warn(col, id, e); }
        tick();
      }
      stEl.textContent = `导入完成：${docs.length} 条记录、${photos.length} 张照片${failed ? `，其中 ${failed} 项失败（可以再导入一次，已经成功的会被覆盖成同样的内容）` : '。'}`;
      done.innerHTML = `<button class="btn primary" type="button" onclick="location.reload()">刷新看看</button>`;
    } catch (e) {
      console.error(e);
      stEl.textContent = '导入失败：' + (e.message || '文件不对，请选择从旧网站导出的 luuegg-backup-日期.zip');
      done.innerHTML = `<button class="btn" type="button" onclick="this.closest('div[style]').parentElement.remove()">关闭</button>`;
    }
  }
})();
