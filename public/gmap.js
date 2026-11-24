/* 噜包蛋之城 · Google 地图版的地图组件
   Same interface as GeoMap (setPins / setRoutes / setVisited / setPick / flyTo / view / fitPins / readyP),
   used automatically when a Google Maps API key is configured (Cloudflare variable GOOGLE_MAPS_KEY). */
'use strict';
const zFromK = k => (k === Infinity ? 99 : k <= 0 ? -1 : Math.log2(1000 * k / 256));
let PinLayerClass = null;
function pinLayerClass() {
  if (PinLayerClass) return PinLayerClass;
  PinLayerClass = class extends google.maps.OverlayView {
    constructor(owner) { super(); this.owner = owner; this.div = document.createElement('div'); this.div.className = 'gpins'; this.items = []; }
    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.div); }
    onRemove() { this.div.remove(); }
    draw() {
      const proj = this.getProjection(); if (!proj) return;
      for (const it of this.items) {
        const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(it.lat, it.lng));
        if (p) { it.el.style.left = p.x + 'px'; it.el.style.top = p.y + 'px'; }
      }
    }
    set(items) { this.div.replaceChildren(...items.map(i => i.el)); this.items = items; this.draw(); }
  };
  return PinLayerClass;
}
const GPIN_SVG = c => `<svg class="gp-std" width="24" height="31" viewBox="-12 -29 24 31" aria-hidden="true"><path d="M0 0 C-2.5 -5 -9 -9.5 -9 -16 A9 9 0 1 1 9 -16 C9 -9.5 2.5 -5 0 0 Z" fill="${c}" stroke="#3F3024" stroke-width="1.6"/><circle cy="-16" r="3.6" fill="#FFFDF8"/></svg>`;
function gmapsPlaceUrl(name, placeId, lat, lng) {
  return placeId ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name || `${lat},${lng}`)}&query_place_id=${encodeURIComponent(placeId)}` : '';
}

class GMap {
  constructor(el, o = {}) {
    this.el = el;
    this.o = Object.assign({ height: 380, initial: 'sg', views: [['sg', '新加坡'], ['asia', '亚洲'], ['world', '世界']], pickable: false, labelK: 60, photoK: Infinity, legend: '', flat: false, onPick: null, onPlace: null }, o);
    this.pins = []; this.routes = []; this.visitedPts = null; this.pickPt = null; this.ready = false;
    el.classList.add('geomap', 'gmap'); if (this.o.flat) el.classList.add('flat');
    el.style.setProperty('--map-h', this.o.height + 'px');
    el.innerHTML = `<div class="map-loading">地图加载中…</div>`;
    this.readyP = this._init();
  }
  get W() { return this.el.clientWidth || 600; }
  async _init() {
    try {
      const { Map, InfoWindow, Polyline } = await google.maps.importLibrary('maps');
      this.Polyline = Polyline;
      const el = this.el; el.innerHTML = '';
      const box = document.createElement('div'); box.className = 'gmap-box'; el.appendChild(box);
      this.map = new Map(box, {
        center: { lat: 1.3521, lng: 103.8198 }, zoom: 11, gestureHandling: 'cooperative',
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: !!this.o.pickable,
        styles: [{ featureType: 'poi.business', stylers: [{ visibility: this.o.pickable ? 'on' : 'simplified' }] }],
      });
      this.info = new InfoWindow({ maxWidth: 280 });
      if (this.o.views?.length) {
        const vw = document.createElement('div'); vw.className = 'map-views';
        vw.innerHTML = this.o.views.map(([k, l]) => `<button type="button" data-v="${k}">${l}</button>`).join('');
        vw.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.view(b.dataset.v); });
        el.appendChild(vw);
      }
      if (this.o.legend) { const lg = document.createElement('div'); lg.className = 'map-legend'; lg.innerHTML = this.o.legend; el.appendChild(lg); }
      const Layer = pinLayerClass();
      this.layer = new Layer(this); this.layer.setMap(this.map);
      this.pickLayer = new Layer(this); this.pickLayer.setMap(this.map);
      this.map.addListener('zoom_changed', () => this._zoomClasses());
      this.map.addListener('click', e => this._onClick(e));
      this.ready = true;
      this._zoomClasses(); this._drawRoutes(); this._drawPins(); this._applyVisited(); this._drawPick();
      const init = this.o.initial;
      if (init === 'pins' && this.pins.length) this.fitPins(false);
      else if (init === 'pick' && this.pickPt) this.flyTo(this.pickPt, isSG(this.pickPt[0], this.pickPt[1]) ? 1400 : 300, false);
      else this.view(VIEWS[init] ? init : (this.o.fallback || 'sg'), false);
    } catch (e) {
      console.error(e);
      this.el.innerHTML = `<div class="map-loading">Google 地图没加载出来，检查一下 API key，或者刷新页面试试。</div>`;
    }
  }
  _zoomClasses() {
    const z = this.map.getZoom();
    this.el.classList.toggle('z-photo', z >= zFromK(this.o.photoK));
    this.el.classList.toggle('z-pinlbl', z >= zFromK(this.o.labelK));
  }
  async _onClick(e) {
    this.info.close();
    if (!this.o.pickable || !e.latLng) return;
    if (e.placeId) {
      e.stop();
      try {
        const { Place } = await google.maps.importLibrary('places');
        const pl = new Place({ id: e.placeId, requestedLanguage: 'zh-CN' });
        await pl.fetchFields({ fields: ['displayName', 'location', 'formattedAddress'] });
        const lat = pl.location.lat(), lng = pl.location.lng();
        this.setPick(lng, lat);
        this.o.onPlace?.({ lat, lng, name: pl.displayName || '', address: pl.formattedAddress || '', gmaps: gmapsPlaceUrl(pl.displayName, e.placeId, lat, lng) });
        return;
      } catch (err) { console.warn(err); }
    }
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    this.setPick(lng, lat); this.o.onPick?.(lng, lat);
  }
  _pinEl(d) {
    const el = document.createElement('div');
    el.className = 'gpin' + (d.photo ? ' has-photo' : '') + (d.kind === 'want' ? ' want' : '');
    el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', d.label || '');
    const color = d.kind === 'want' ? '#E9E1D3' : (String(d.color).startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(d.color.slice(4, -1)).trim() || '#3F9B82' : d.color);
    el.innerHTML = GPIN_SVG(color)
      + (d.photo ? `<span class="gp-photo"><img src="${esc(imgUrl(d.photo, true))}" alt="">${d.num ? `<b>${d.num}</b>` : ''}</span>` : '')
      + `<span class="gp-lbl">${esc(d.label || '')}</span>`;
    const open = ev => { ev.stopPropagation(); this._pop(d); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); } });
    return el;
  }
  _pop(d) {
    if (!d.popup) return;
    const c = document.createElement('div'); c.className = 'gpop'; c.innerHTML = d.popup;
    this.info.setContent(c); this.info.setPosition({ lat: d.lat, lng: d.lng });
    this.info.setOptions({ pixelOffset: new google.maps.Size(0, d.photo && this.el.classList.contains('z-photo') ? -50 : -30) });
    this.info.open({ map: this.map });
  }
  setPins(pins) { this.pins = pins; if (this.ready) this._drawPins(); }
  _drawPins() {
    const sorted = this.pins.slice().sort((a, b) => b.lat - a.lat);
    this.layer.set(sorted.map(d => ({ lat: d.lat, lng: d.lng, el: this._pinEl(d) })));
  }
  setRoutes(routes) { this.routes = routes; if (this.ready) this._drawRoutes(); }
  _drawRoutes() {
    (this.lines || []).forEach(l => l.setMap(null));
    const dash = { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 2.5, strokeColor: '#3F3024' };
    this.lines = this.routes.filter(r => r.pts.length > 1).map(r => new this.Polyline({
      map: this.map, path: r.pts.map(([lng, lat]) => ({ lat, lng })), strokeOpacity: 0, clickable: false,
      icons: [{ icon: { ...dash, strokeColor: r.kind === 'want' ? '#A8957F' : '#3F3024' }, offset: '0', repeat: '12px' }],
    }));
  }
  setVisited(pts) { this.visitedPts = pts; if (this.ready) this._applyVisited(); }
  async _applyVisited() {
    if (!this.visitedPts) return;
    const pts = this.visitedPts, key = JSON.stringify(pts);
    if (key === this._visKey) return; this._visKey = key;
    try {
      const [world, detail, prov] = await Promise.all([loadGeo('world'), loadGeo('detail'), loadGeo('provinces').catch(() => null)]);
      const hit = f => { const [[w, s], [e, n]] = d3.geoBounds(f); return pts.some(p => p[0] >= w - .01 && p[0] <= e + .01 && p[1] >= s - .01 && p[1] <= n + .01 && d3.geoContains(f, p)); };
      const detailCodes = new Set(detail.features.map(f => f.properties.a));
      const countries = [...world.features.filter(f => !detailCodes.has(f.properties.a)), ...detail.features].filter(hit);
      const provs = prov ? prov.features.filter(hit) : [];
      this.map.data.forEach(f => this.map.data.remove(f));
      this.map.data.addGeoJson({ type: 'FeatureCollection', features: [...countries.map(f => ({ ...f, properties: { lvl: 'c' } })), ...provs.map(f => ({ ...f, properties: { lvl: 'p' } }))] });
      this.map.data.setStyle(f => ({ clickable: false, fillColor: '#3F9B82', fillOpacity: f.getProperty('lvl') === 'p' ? 0.16 : 0.07, strokeColor: '#3F9B82', strokeOpacity: 0.5, strokeWeight: f.getProperty('lvl') === 'p' ? 0.8 : 1.2 }));
    } catch (e) { console.warn(e); }
  }
  setPick(lng, lat) { this.pickPt = lng == null ? null : [lng, lat]; if (this.ready) this._drawPick(); }
  _drawPick() {
    if (!this.pickPt) return this.pickLayer.set([]);
    const el = document.createElement('div'); el.className = 'gpin pick'; el.innerHTML = GPIN_SVG('#F2B632');
    this.pickLayer.set([{ lng: this.pickPt[0], lat: this.pickPt[1], el }]);
  }
  flyTo([lng, lat], k = 600, animate = true) {
    if (!this.map) return;
    const z = Math.max(2, Math.min(19, Math.round(zFromK(k) + Math.log2((this.W || 600) / 600))));
    this.map.setZoom(z); animate ? this.map.panTo({ lat, lng }) : this.map.setCenter({ lat, lng });
  }
  fitBounds([[w, s], [e, n]]) { if (this.map) this.map.fitBounds({ west: w, south: s, east: e, north: n }, 24); }
  view(name, animate = true) {
    if (name === 'pins') return this.fitPins(animate);
    if (VIEWS[name]) this.fitBounds(VIEWS[name]);
  }
  fitPins() {
    if (!this.pins.length) return this.view(this.o.fallback || 'sg');
    if (this.pins.length === 1) return this.flyTo([this.pins[0].lng, this.pins[0].lat], isSG(this.pins[0].lng, this.pins[0].lat) ? 2500 : 1500);
    let w = 180, e = -180, s = 90, n = -90;
    for (const p of this.pins) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    const pad = Math.max(0.004, (e - w) * 0.08, (n - s) * 0.08);
    this.fitBounds([[w - pad, s - pad], [e + pad, n + pad]]);
  }
  showPop(d) { this._pop(d); }
  hidePop() { this.info?.close(); }
  destroy() {}
}

/* place search through Google Places (used by 「搜这个地点」) */
async function googleLocate(query, hint) {
  const { Place } = await google.maps.importLibrary('places');
  const req = { textQuery: query, fields: ['id', 'displayName', 'location', 'formattedAddress'], language: 'zh-CN', maxResultCount: 1 };
  if (/新加坡/.test(hint || '')) req.locationBias = { center: { lat: 1.3521, lng: 103.8198 }, radius: 30000 };
  const { places } = await Place.searchByText(req);
  if (!places?.length) return { found: false, reason: '在 Google 地图上没搜到，试试加上城市名' };
  const p = places[0], lat = p.location.lat(), lng = p.location.lng();
  return { found: true, lat, lng, name_zh: p.displayName || query, name_local: '', area: p.formattedAddress || '', confidence: 'high', gmaps: gmapsPlaceUrl(p.displayName, p.id, lat, lng) };
}
