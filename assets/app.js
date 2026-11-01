(() => {
  'use strict';

  // ──────────────────────────────────────────────────────────────
  // IMPORTANT — run fix_coordinates.py before deploying.
  // JITTER_RADIUS below only separates intentionally co-located
  // markers (e.g., Bob Starr's Santa Rosa home + trailer). It does
  // not correct source-coordinate errors.
  // ──────────────────────────────────────────────────────────────

  // ==========================================================
  // Basemaps
  //   Vector styles: https://makewithmaplibre.com/basemaps/
  //   Satellite: inline raster styles. Esri and USGS imagery have a
  //   georeferencing offset of roughly 5–30 m in the Bay Area; use
  //   vector basemaps for pinpoint accuracy on forensic claims.
  // ==========================================================
  const BASEMAPS = [
    { id: 'ofm-dark',     label: 'Dark — OpenFreeMap',        url: 'https://tiles.openfreemap.org/styles/dark',      group: 'OpenFreeMap' },
    { id: 'ofm-positron', label: 'Positron — OpenFreeMap',    url: 'https://tiles.openfreemap.org/styles/positron',  group: 'OpenFreeMap' },
    { id: 'ofm-liberty',  label: 'Liberty — OpenFreeMap',     url: 'https://tiles.openfreemap.org/styles/liberty',   group: 'OpenFreeMap' },
    { id: 'ofm-bright',   label: 'Bright — OpenFreeMap',      url: 'https://tiles.openfreemap.org/styles/bright',    group: 'OpenFreeMap' },
    { id: 'ofm-fiord',    label: 'Fiord — OpenFreeMap',       url: 'https://tiles.openfreemap.org/styles/fiord',     group: 'OpenFreeMap' },
    { id: 'americana',    label: 'Americana — OSM Americana', url: 'https://americanamap.org/style.json',            group: 'OSM Americana' },
    { id: 'colorful',     label: 'Colorful — VersaTiles',     url: 'https://tiles.versatiles.org/assets/styles/colorful/style.json', group: 'VersaTiles' },
    { id: 'demotiles',    label: 'Demotiles — MapLibre',      url: 'https://demotiles.maplibre.org/style.json',      group: 'MapLibre' },

    // ── Satellite — reference only (imagery offsets apply) ─
    {
      id: 'eox-s2',
      label: 'Sentinel-2 — EOX Cloudless (reference)',
      group: 'Satellite (reference only)',
      style: {
        version: 8,
        sources: {
          'eox-s2': {
            type: 'raster',
            tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
            tileSize: 256,
            attribution: 'EOxCloudless by EOX (Contains modified Copernicus Sentinel data 2025)',
          },
        },
        layers: [{ id: 'eox-s2', type: 'raster', source: 'eox-s2' }],
      },
    },
    {
      id: 'esri-imagery',
      label: 'Satellite — Esri (reference)',
      group: 'Satellite (reference only)',
      style: {
        version: 8,
        sources: {
          'esri-imagery': {
            type: 'raster',
            tiles: ['https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          },
        },
        layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }],
      },
    },
    {
      id: 'usgs-imagery',
      label: 'Satellite — USGS (reference)',
      group: 'Satellite (reference only)',
      style: {
        version: 8,
        sources: {
          'usgs-imagery': {
            type: 'raster',
            tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 16,
            attribution: 'USGS The National Map',
          },
        },
        layers: [{ id: 'usgs-imagery', type: 'raster', source: 'usgs-imagery' }],
      },
    },
  ];

  const DEFAULT_BASEMAP = 'ofm-dark';
  const DATA_URL = 'data/zodiac_locations_enriched.geojson';
  const DEFAULT_VIEW = { center: [-121.7, 38.2], zoom: 6.2 };
  const JITTER_RADIUS = 0.0003; // ≈ 33 m — separates only co-located markers

  const CATEGORIES = {
    crime_scene:  { label: 'Crime scene',            color: '#ef4444' },
    victim:       { label: 'Victim / victim site',   color: '#3b82f6' },
    police:       { label: 'Police / investigation', color: '#06b6d4' },
    letter:       { label: 'Letter / postmark',      color: '#a855f7' },
    suspect:      { label: 'Suspect',                color: '#f59e0b' },
    landmark:     { label: 'Landmark',               color: '#22c55e' },
    city:         { label: 'City',                   color: '#94a3b8' },
    out_of_state: { label: 'Out of state',           color: '#64748b' },
  };

  const FIELD_ORDER = [
    ['summary', 'Summary'],
    ['description', 'Description'],
    ['context_label', 'Context'],
    ['context_type', 'Context type', 'chips'],
    ['principal_people', 'People', 'chips'],
    ['financial_legal', 'Financial / legal'],
    ['connections', 'Connections', 'chips'],
    ['similarities', 'Similarities'],
    ['geographic', 'Geography'],
    ['distance_to_suspects', 'Distance to suspects', 'kv'],
    ['relative_to_mt_diablo', 'Relative to Mt. Diablo'],
    ['note', 'Note'],
  ];

  const state = {
    visible: new Set(Object.keys(CATEGORIES)),
    labelsOn: false,
    basemap: DEFAULT_BASEMAP,
    data: null,
    selectedId: null,
    ready: false,
  };

  let map;

  // ----------------------------------------------------------
  // helpers
  // ----------------------------------------------------------
  const escapeHtml = (v) =>
    String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const humanize = (k) =>
    k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const resolveStyle = (bm) => (bm && (bm.url || bm.style)) || null;

  // ----------------------------------------------------------
  // data
  // ----------------------------------------------------------
  async function loadData() {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`Failed to load ${DATA_URL}: ${res.status} ${res.statusText}`);
    }
    const gj = await res.json();
    if (!gj || !Array.isArray(gj.features)) {
      throw new Error('Invalid GeoJSON: expected a FeatureCollection.');
    }
    gj.features.forEach((f, i) => {
      f.id = i;
      f.properties = f.properties || {};
      f.properties.feature_id = i;
    });
    applyJitter(gj.features);
    return gj;
  }

  // Separate overlapping points onto a small circle. Only groups with
  // identical rounded coordinates are displaced, and only by
  // JITTER_RADIUS — small enough that the base coordinate is still
  // visually correct at any reasonable zoom.
  function applyJitter(features) {
    const groups = new Map();
    features.forEach((f, i) => {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      const [lon, lat] = f.geometry.coordinates;
      const key = `${lon.toFixed(5)}|${lat.toFixed(5)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    for (const indices of groups.values()) {
      if (indices.length < 2) continue;
      indices.forEach((idx, k) => {
        const angle = (k / indices.length) * Math.PI * 2;
        const f = features[idx];
        f.geometry.coordinates = [
          f.geometry.coordinates[0] + Math.cos(angle) * JITTER_RADIUS,
          f.geometry.coordinates[1] + Math.sin(angle) * JITTER_RADIUS,
        ];
      });
    }
  }

  // ----------------------------------------------------------
  // map
  // ----------------------------------------------------------
  function createMap() {
    const bm = BASEMAPS.find((b) => b.id === state.basemap) || BASEMAPS[0];
    const styleArg = resolveStyle(bm);
    if (!styleArg) {
      throw new Error(`Default basemap "${bm.id}" has neither url nor style.`);
    }

    map = new maplibregl.Map({
      container: 'map',
      style: styleArg,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'bottom-left'
    );

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '© OpenStreetMap contributors · Basemaps: OpenFreeMap, OSM Americana, VersaTiles, MapLibre · Satellite (reference): EOX, Esri, USGS · Data: R. Graysmith (1986, 2002); M.F. Cole (2020)',
      }),
      'bottom-left'
    );

    // Single map-level click handler. Using queryRenderedFeatures avoids
    // stacking duplicate listeners across style swaps.
    map.on('click', (event) => {
      if (!map.getLayer('locations-circle')) return;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ['locations-circle'],
      });
      if (hits.length) openDetails(hits[0]);
      else closeDetails();
    });

    map.on('mousemove', (event) => {
      if (!map.getLayer('locations-circle')) return;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ['locations-circle'],
      });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
    });
  }

  function addDataLayers(gj) {
    if (map.getSource('locations')) {
      ['locations-halo', 'locations-circle', 'locations-selected', 'locations-label']
        .forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
      map.removeSource('locations');
    }

    map.addSource('locations', { type: 'geojson', data: gj });

    map.addLayer({
      id: 'locations-halo',
      type: 'circle',
      source: 'locations',
      paint: {
        'circle-radius': 10,
        'circle-color': 'rgba(255,255,255,0.18)',
        'circle-blur': 1,
      },
    });

    map.addLayer({
      id: 'locations-circle',
      type: 'circle',
      source: 'locations',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match',
          ['get', 'category'],
          'crime_scene', CATEGORIES.crime_scene.color,
          'victim', CATEGORIES.victim.color,
          'police', CATEGORIES.police.color,
          'letter', CATEGORIES.letter.color,
          'suspect', CATEGORIES.suspect.color,
          'landmark', CATEGORIES.landmark.color,
          'city', CATEGORIES.city.color,
          'out_of_state', CATEGORIES.out_of_state.color,
          '#94a3b8',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });

    map.addLayer({
      id: 'locations-selected',
      type: 'circle',
      source: 'locations',
      filter: ['==', ['get', 'feature_id'], state.selectedId ?? -1],
      paint: {
        'circle-radius': 12,
        'circle-color': 'transparent',
        'circle-stroke-color': '#fbbf24',
        'circle-stroke-width': 2.5,
      },
    });

    // Labels require glyphs; raster (satellite) styles have none.
    try {
      map.addLayer({
        id: 'locations-label',
        type: 'symbol',
        source: 'locations',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 12,
          visibility: state.labelsOn ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#f8fafc',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.4,
        },
      });
    } catch (err) {
      console.warn('Label layer skipped for this basemap (no glyphs).', err);
    }

    applyFilters();
  }

  function applyFilters() {
    if (!map) return;
    const filter = [
      'in',
      ['get', 'category'],
      ['literal', Array.from(state.visible)],
    ];
    ['locations-halo', 'locations-circle', 'locations-label'].forEach((id) => {
      if (map.getLayer(id)) map.setFilter(id, filter);
    });
    updateVisibleCount();
  }

  // ----------------------------------------------------------
  // basemap switching
  // ----------------------------------------------------------
  function buildBasemapSelect() {
    const sel = document.getElementById('basemap-select');
    if (!sel) return;

    const byGroup = new Map();
    for (const bm of BASEMAPS) {
      if (!byGroup.has(bm.group)) byGroup.set(bm.group, []);
      byGroup.get(bm.group).push(bm);
    }

    const html = [];
    for (const [group, items] of byGroup) {
      html.push(`<optgroup label="${escapeHtml(group)}">`);
      for (const bm of items) {
        html.push(
          `<option value="${escapeHtml(bm.id)}"${bm.id === state.basemap ? ' selected' : ''}>` +
          `${escapeHtml(bm.label)}</option>`
        );
      }
      html.push('</optgroup>');
    }
    sel.innerHTML = html.join('');
    sel.value = state.basemap;

    sel.addEventListener('change', (e) => setBasemap(e.target.value));
  }

  function setBasemap(id) {
    const bm = BASEMAPS.find((b) => b.id === id);
    if (!bm || !map) return;

    const previous = state.basemap;
    const styleArg = resolveStyle(bm);
    if (!styleArg) {
      console.warn(`Basemap "${id}" has neither url nor style.`);
      return;
    }

    state.basemap = id;
    map.setStyle(styleArg, { diff: false });

    let settled = false;
    const onStyleLoad = () => {
      if (settled) return;
      settled = true;
      restoreAfterStyleChange();
    };

    map.once('style.load', onStyleLoad);

    setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`Basemap "${id}" did not load; reverting to "${previous}".`);
      state.basemap = previous;
      const sel = document.getElementById('basemap-select');
      if (sel) sel.value = previous;
      const fallback = BASEMAPS.find((b) => b.id === previous);
      const fbStyle = resolveStyle(fallback);
      if (fbStyle) {
        map.setStyle(fbStyle, { diff: false });
        map.once('style.load', restoreAfterStyleChange);
      }
    }, 12000);
  }

  function restoreAfterStyleChange() {
    if (state.data) addDataLayers(state.data);

    // Raster basemaps ship no glyphs, so labels would be a no-op.
    const style = map.getStyle();
    const isRaster = !style || !style.glyphs;
    const labelsCb = document.getElementById('labels-toggle');
    if (labelsCb) {
      labelsCb.disabled = isRaster;
      if (isRaster && labelsCb.checked) {
        labelsCb.checked = false;
        state.labelsOn = false;
        if (map.getLayer('locations-label')) {
          map.setLayoutProperty('locations-label', 'visibility', 'none');
        }
      }
    }
  }

  // ----------------------------------------------------------
  // category panel
  // ----------------------------------------------------------
  function buildCategoryList(gj) {
    const counts = {};
    for (const f of gj.features) {
      const c = f.properties.category;
      counts[c] = (counts[c] || 0) + 1;
    }

    const items = [];
    for (const [key, cfg] of Object.entries(CATEGORIES)) {
      if (!counts[key]) continue;
      items.push(`
        <li data-cat="${escapeHtml(key)}">
          <input type="checkbox" checked aria-label="Toggle ${escapeHtml(cfg.label)}" />
          <span class="swatch" style="background:${cfg.color}"></span>
          <span class="label">${escapeHtml(cfg.label)}</span>
          <span class="count">${counts[key]}</span>
        </li>
      `);
    }
    const el = document.getElementById('category-list');
    if (el) el.innerHTML = items.join('');
    const total = document.getElementById('total-count');
    if (total) total.textContent = String(gj.features.length);
    updateVisibleCount();
  }

  function updateVisibleCount() {
    let sum = 0;
    document.querySelectorAll('#category-list li').forEach((li) => {
      if (state.visible.has(li.dataset.cat)) {
        sum += parseInt(li.querySelector('.count').textContent, 10);
      }
    });
    const el = document.getElementById('visible-count');
    if (el) el.textContent = String(sum);
  }

  function bindCategoryList() {
    const el = document.getElementById('category-list');
    if (!el) return;
    el.addEventListener('change', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const cat = li.dataset.cat;
      if (e.target.checked) state.visible.add(cat);
      else state.visible.delete(cat);
      applyFilters();
    });
  }

  // ----------------------------------------------------------
  // details panel
  // ----------------------------------------------------------
  function openDetails(feature) {
    const p = feature.properties || {};
    const cat = CATEGORIES[p.category] || {
      label: p.category || 'Unknown',
      color: '#94a3b8',
    };
    const coords = feature.geometry && feature.geometry.coordinates;
    const lon = coords ? coords[0] : NaN;
    const lat = coords ? coords[1] : NaN;

    state.selectedId = p.feature_id;

    const parts = [];
    parts.push(
      `<div class="badge"><span class="dot" style="background:${cat.color}"></span>${escapeHtml(cat.label)}</div>`
    );
    parts.push(`<h1>${escapeHtml(p.name || 'Unknown location')}</h1>`);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      parts.push(`<div class="coords">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</div>`);
    }

    const known = new Set(FIELD_ORDER.map(([k]) => k));
    for (const [key, label, type] of FIELD_ORDER) {
      const v = p[key];
      if (v == null || v === '') continue;
      parts.push(renderField(label, v, type));
    }

    const rest = Object.keys(p).filter(
      (k) => !known.has(k) && k !== 'name' && k !== 'category' && k !== 'feature_id'
    );
    if (rest.length) {
      parts.push('<hr />');
      for (const k of rest) {
        const v = p[k];
        if (v == null || v === '') continue;
        const t = Array.isArray(v) ? 'chips' : typeof v === 'object' ? 'kv' : undefined;
        parts.push(renderField(humanize(k), v, t));
      }
    }

    const panel = document.getElementById('details');
    const body = document.getElementById('details-body');
    if (!panel || !body) return;
    body.innerHTML = parts.join('');
    body.scrollTop = 0;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('details-open');

    if (map.getLayer('locations-selected')) {
      map.setFilter('locations-selected', ['==', ['get', 'feature_id'], p.feature_id]);
    }

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (window.innerWidth > 640) {
        map.easeTo({ center: [lon, lat], offset: [-200, 0], duration: 500 });
      } else {
        map.easeTo({ center: [lon, lat], duration: 500 });
      }
    }
  }

  function closeDetails() {
    state.selectedId = null;
    const panel = document.getElementById('details');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('details-open');
    if (map && map.getLayer('locations-selected')) {
      map.setFilter('locations-selected', ['==', ['get', 'feature_id'], -1]);
    }
  }

  function renderField(label, value, type) {
    const header = `<div class="lbl">${escapeHtml(label)}</div>`;
    let body;

    if (type === 'chips' && Array.isArray(value)) {
      body = `<div class="chips">${value
        .map((v) => `<span class="chip">${escapeHtml(v)}</span>`)
        .join('')}</div>`;
    } else if (type === 'kv' && value && typeof value === 'object' && !Array.isArray(value)) {
      const rows = Object.entries(value)
        .map(
          ([k, v]) =>
            `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div>`
        )
        .join('');
      body = `<div class="kv">${rows}</div>`;
    } else if (Array.isArray(value)) {
      body = `<div class="chips">${value
        .map((v) => `<span class="chip">${escapeHtml(String(v))}</span>`)
        .join('')}</div>`;
    } else {
      body = `<div class="val">${escapeHtml(String(value))}</div>`;
    }

    return `<div class="field">${header}${body}</div>`;
  }

  // ----------------------------------------------------------
  // toggles
  // ----------------------------------------------------------
  function bindToggles() {
    document.querySelectorAll('.row-buttons button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'all') {
          document.querySelectorAll('#category-list li').forEach((li) => {
            li.querySelector('input').checked = true;
            state.visible.add(li.dataset.cat);
          });
          applyFilters();
        } else if (action === 'none') {
          document.querySelectorAll('#category-list li').forEach((li) => {
            li.querySelector('input').checked = false;
          });
          state.visible.clear();
          applyFilters();
        } else if (action === 'reset') {
          map.flyTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom });
        }
      });
    });

    const controlsToggle = document.getElementById('controls-toggle');
    if (controlsToggle) {
      controlsToggle.addEventListener('click', () => {
        document.getElementById('controls').classList.toggle('collapsed');
      });
    }

    const detailsClose = document.getElementById('details-close');
    if (detailsClose) detailsClose.addEventListener('click', closeDetails);

    const labelsToggle = document.getElementById('labels-toggle');
    if (labelsToggle) {
      labelsToggle.addEventListener('change', (e) => {
        state.labelsOn = e.target.checked;
        if (map && map.getLayer('locations-label')) {
          map.setLayoutProperty(
            'locations-label',
            'visibility',
            state.labelsOn ? 'visible' : 'none'
          );
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetails();
    });
  }

  // ----------------------------------------------------------
  // error surface
  // ----------------------------------------------------------
  function showFatalError(message) {
    const el = document.createElement('div');
    el.className = 'panel';
    el.style.cssText =
      'top:16px;left:16px;right:16px;padding:16px 20px;' +
      'background:#7f1d1d;border-color:#b91c1c;color:#fef2f2;font-size:13px;';
    el.innerHTML =
      `<strong>Could not load location data.</strong> ${escapeHtml(message)}` +
      `<br /><span style="opacity:.8">Ensure <code>data/zodiac_locations_enriched.geojson</code> exists next to this page.</span>`;
    document.body.appendChild(el);
  }

  // ----------------------------------------------------------
  // boot
  // ----------------------------------------------------------
  async function bootstrap() {
    createMap();
    buildBasemapSelect();

    try {
      state.data = await loadData();
    } catch (err) {
      console.error(err);
      showFatalError(err.message);
      bindToggles();
      return;
    }

    const onMapReady = () => {
      if (state.ready) return;
      state.ready = true;
      try {
        addDataLayers(state.data);
        buildCategoryList(state.data);
        bindCategoryList();
        bindToggles();

        if (window.matchMedia('(max-width: 640px)').matches) {
          const controls = document.getElementById('controls');
          if (controls) controls.classList.add('collapsed');
        }
      } catch (err) {
        console.error(err);
        showFatalError(err.message);
      }
    };

    map.once('load', onMapReady);
    setTimeout(onMapReady, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
