// 噜包蛋之城 · back end (Cloudflare Pages Function)
// Bindings set in the Cloudflare dashboard:
//   DB            → D1 database   (records)
//   PHOTOS        → R2 bucket     (photos)
//   EDIT_PASSWORD → secret        (the editors' password)

const PUBLIC_COLS = ['movies', 'meals', 'trips', 'meta'];
const ALL_COLS = [...PUBLIC_COLS, 'invest'];          // invest is only visible to editors
const MAX_BYTES = 9 * 1024 ** 3;                      // stay under R2's 10 GB free tier
const MAX_PHOTO = 20 * 1024 * 1024;
const COOKIE = 'lbd_auth';
const DAYS = 180;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY (col, id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, size INTEGER NOT NULL, type TEXT, created_at INTEGER)'),
  ]);
  schemaReady = true;
}

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (status, error) => json({ error }, status);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function isEditor(request, env) {
  if (!env.EDIT_PASSWORD) return false;
  const m = (request.headers.get('Cookie') || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  return safeEqual(sig, await hmac(env.EDIT_PASSWORD, 'lbd:' + exp));
}
const validId = id => /^[A-Za-z0-9_.:@+~-]{1,100}$/.test(id || '');
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

async function usage(db) {
  const r = await db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM photos').first();
  return { files: r.files, bytes: r.bytes, maxBytes: MAX_BYTES };
}

export async function onRequest({ request, env, params }) {
  if (!env.DB || !env.PHOTOS) return fail(500, '网站还没连上数据库或照片空间：请在 Cloudflare 后台的 Bindings 里添加 DB 和 PHOTOS，然后重新部署。');
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || '').split('/').filter(Boolean);
  const route = parts[0] || '';
  const method = request.method;
  const editor = await isEditor(request, env);

  try {
    // ----- auth -----
    if (route === 'login' && method === 'POST') {
      if (!env.EDIT_PASSWORD) return fail(500, '还没设置编辑密码（EDIT_PASSWORD）。');
      const { password } = await request.json().catch(() => ({}));
      if (!safeEqual(String(password || ''), env.EDIT_PASSWORD)) { await sleep(800); return fail(401, '密码不对'); }
      const exp = Date.now() + DAYS * 86400000;
      const token = exp + '.' + await hmac(env.EDIT_PASSWORD, 'lbd:' + exp);
      return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` });
    }
    if (route === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
    if (route === 'me') return json({ editor });
    // public browser config: the Google Maps key is meant to be public and restricted to this site's address in Google Cloud
    if (route === 'config') return json({ googleMapsKey: env.GOOGLE_MAPS_KEY || '' });

    // ----- read everything (small personal site: one request) -----
    if (route === 'data' && method === 'GET') {
      const cols = editor ? ALL_COLS : PUBLIC_COLS;
      const rows = await env.DB.prepare(`SELECT col, id, data FROM docs WHERE col IN (${cols.map(() => '?').join(',')})`).bind(...cols).all();
      const docs = Object.fromEntries(cols.map(c => [c, {}]));
      for (const r of rows.results) { try { docs[r.col][r.id] = JSON.parse(r.data); } catch {} }
      return json({ editor, docs });
    }

    if (route === 'usage') return json(await usage(env.DB));

    // ----- everything below changes data: editors only -----
    if (!editor) return fail(401, '请先在「城市设置」里登录');

    if (route === 'doc') {
      const [, col, id] = parts;
      if (!ALL_COLS.includes(col) || !validId(id)) return fail(400, '路径不对');
      if (method === 'PUT') {
        const text = await request.text();
        if (text.length > 256 * 1024) return fail(413, '这条记录太大了');
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, '数据格式不对');
        await env.DB.prepare('INSERT OR REPLACE INTO docs (col, id, data, updated_at) VALUES (?, ?, ?, ?)').bind(col, id, JSON.stringify(data), Date.now()).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(col, id).run();
        return json({ ok: true });
      }
    }

    if (route === 'upload' && method === 'POST') {
      const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(type)) return fail(415, '只能上传 JPG、PNG、WebP 或 GIF 图片（HEIC 请先转成 JPG）');
      const buf = await request.arrayBuffer();
      if (!buf.byteLength) return fail(400, '空文件');
      if (buf.byteLength > MAX_PHOTO) return fail(413, '照片太大了（超过 20MB）');
      const u = await usage(env.DB);
      if (u.bytes + buf.byteLength > MAX_BYTES) return fail(507, '照片空间快满了（快到 10GB 免费额度），先删掉一些不用的照片吧');
      const wanted = url.searchParams.get('id');
      const id = wanted && /^[A-Za-z0-9]{8,64}$/.test(wanted) ? wanted : randomId();
      await env.PHOTOS.put(id, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
      await env.DB.prepare('INSERT OR REPLACE INTO photos (id, size, type, created_at) VALUES (?, ?, ?, ?)').bind(id, buf.byteLength, type, Date.now()).run();
      return json({ id, url: '/photo/' + id, sizeBytes: buf.byteLength, contentType: type });
    }

    if (route === 'photo' && method === 'DELETE') {
      const id = parts[1];
      if (!/^[A-Za-z0-9]{8,64}$/.test(id || '')) return fail(400, '照片 id 不对');
      await env.PHOTOS.delete(id);
      const r = await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
      return json({ deleted: (r.meta?.changes || 0) > 0 });
    }

    // place search (OpenStreetMap Nominatim; light personal use)
    if (route === 'locate' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
      if (!q) return fail(400, '缺少地点名称');
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: '1', 'accept-language': 'zh-CN,zh,en', namedetails: '1' }), { headers: { 'User-Agent': 'luuegg-personal-site/1.0 (pages.dev)' } });
      if (!r.ok) return fail(502, '地点搜索暂时用不了');
      const arr = await r.json();
      if (!arr.length) return json({ found: false, reason: '没搜到，试试加上城市名，或者换英文/当地语言的名字' });
      const p = arr[0], nd = p.namedetails || {};
      return json({ found: true, lat: +p.lat, lng: +p.lon, name_zh: nd['name:zh'] || nd['name:zh-Hans'] || (p.name || q), name_local: nd.name || '', area: p.display_name, confidence: (p.importance || 0) > 0.3 ? 'high' : 'medium' });
    }

    return fail(404, '没有这个接口');
  } catch (e) {
    return fail(500, '服务器出错了：' + (e && e.message || e));
  }
}
