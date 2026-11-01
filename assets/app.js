(() => {
  'use strict';

  // ----- config -----
  const BASEMAP_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const DATA_URL = 'data/zodiac_locations_enriched.geojson';
  const DEFAULT_VIEW = { center: [-121.7, 38.2], zoom: 6.2 };
  const JITTER_RADIUS = 0.0012; // degrees, for co-located markers

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
    data: null,
    ready: false,
  };

  let map;

  // ----- utilities -----
  const escapeHtml = (v) =>
    String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const humanize = (k) =>
    k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // ----- data -----
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

  // ----- map -----
  function createMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: BASEMAP_URL,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 1,
      maxZoom: 16,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'bottom-right'
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '© OpenStreetMap · © CARTO · Data: R. Graysmith, <i>Zodiac</i> (1986)',
      }),
      'bottom-right'
    );

    // Close the panel when clicking bare map
    map.on('click', (event) => {
      if (!map.getLayer('locations-circle')) return;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ['locations-circle'],
      });
      if (hits.length === 0) closeDetails();
    });
  }

  function addDataLayers(gj) {
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
      filter: ['==', ['get', 'feature_id'], -1],
      paint: {
        'circle-radius': 12,
        'circle-color': 'transparent',
        'circle-stroke-color': '#fbbf24',
        'circle-stroke-width': 2.5,
      },
    });

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
        visibility: 'none',
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
      },
    });

    applyFilters();

    map.on('click', 'locations-circle', (event) => {
      const feature = event.features && event.features[0];
      if (feature) openDetails(feature);
    });
    map.on('mouseenter', 'locations-circle', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'locations-circle', () => {
      map.getCanvas().style.cursor = '';
    });
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

  // ----- category panel -----
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
    document.getElementById('category-list').innerHTML = items.join('');
    document.getElementById('total-count').textContent = String(gj.features.length);
    updateVisibleCount();
  }

  function updateVisibleCount() {
    let sum = 0;
    document.querySelectorAll('#category-list li').forEach((li) => {
      if (state.visible.has(li.dataset.cat)) {
        sum += parseInt(li.querySelector('.count').textContent, 10);
      }
    });
    document.getElementById('visible-count').textContent = String(sum);
  }

  function bindCategoryList() {
    document.getElementById('category-list').addEventListener('change', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const cat = li.dataset.cat;
      if (e.target.checked) state.visible.add(cat);
      else state.visible.delete(cat);
      applyFilters();
    });
  }

  // ----- details panel -----
  function openDetails(feature) {
    const p = feature.properties || {};
    const cat = CATEGORIES[p.category] || {
      label: p.category || 'Unknown',
      color: '#94a3b8',
    };
    const coords = feature.geometry && feature.geometry.coordinates;
    const lon = coords ? coords[0] : NaN;
    const lat = coords ? coords[1] : NaN;

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
        map.easeTo({
          center: [lon, lat],
          offset: [-200, 0],
          duration: 500,
        });
      } else {
        map.easeTo({ center: [lon, lat], duration: 500 });
      }
    }
  }

  function closeDetails() {
    document.getElementById('details').classList.remove('open');
    document.getElementById('details').setAttribute('aria-hidden', 'true');
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

  // ----- toggles -----
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

    document.getElementById('controls-toggle').addEventListener('click', () => {
      document.getElementById('controls').classList.toggle('collapsed');
    });

    document.getElementById('details-close').addEventListener('click', closeDetails);

    document.getElementById('globe-toggle').addEventListener('change', (e) => {
      const type = e.target.checked ? 'globe' : 'mercator';
      try {
        map.setProjection({ type });
      } catch (err) {
        console.warn('Globe projection not available.', err);
        e.target.checked = !e.target.checked;
        alert('Globe projection is not supported in this browser. Try a recent Chrome, Safari, or Firefox.');
      }
    });

    document.getElementById('labels-toggle').addEventListener('change', (e) => {
      state.labelsOn = e.target.checked;
      if (map && map.getLayer('locations-label')) {
        map.setLayoutProperty(
          'locations-label',
          'visibility',
          state.labelsOn ? 'visible' : 'none'
        );
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetails();
    });
  }

  // ----- error surface -----
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

  // ----- boot -----
  async function bootstrap() {
    createMap();

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
          document.getElementById('controls').classList.add('collapsed');
        }
      } catch (err) {
        console.error(err);
        showFatalError(err.message);
      }
    };

    map.once('load', onMapReady);
    // Fallback in case the style never finishes loading
    setTimeout(onMapReady, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
