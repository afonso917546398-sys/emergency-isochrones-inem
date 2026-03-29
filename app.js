(function() {
  // ─── Map Init ───
  const map = L.map('map', {
    center: [40.15, -8.15],
    zoom: 8,
    zoomControl: false,
    attributionControl: false,
    renderer: L.canvas()
  });

  // Base layer: OpenStreetMap
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // ─── Colors ───
  const COLORS = {
    aem: '#3b82f6',
    vmer: '#f59e0b',
    iso10: '#22c55e',
    iso20: '#eab308',
    iso30: '#f97316',
    iso60: '#ef4444'
  };

  // ─── State ───
  const pinState = {}; // key -> { enabled, marker, isoLayers: { '10': L.geoJSON, '20': ..., '30': ... } }
  const isoVisible = { '10': true, '20': true, '30': true, '60': false };

  // ─── Helpers ───
  function createIcon(color, size) {
    return L.divIcon({
      className: '',
      html: `<div style="
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border: 2px solid rgba(255,255,255,0.9);
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4), 0 0 0 3px ${color}33;
        transition: transform 0.15s;
      "></div>`,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2]
    });
  }

  function createIsoLayer(geometry, color, opacity, dashed) {
    return L.geoJSON(geometry, {
      style: {
        color: color,
        weight: 1.5,
        opacity: 0.35,
        fillColor: color,
        fillOpacity: opacity,
        dashArray: dashed ? '6 4' : null
      }
    });
  }

  // ─── Add pins ───
  function addPin(pin, layerType, initialEnabled = true) {
    const key = `${layerType}_${pin.name}`;
    const isAEM = layerType === 'aem';
    const isSIV = isAEM && pin.name.startsWith('SI');
    const color = !isAEM ? COLORS.vmer : isSIV ? '#10b981' : COLORS.aem;
    const typeLabel = !isAEM ? 'VMER' : isSIV ? 'SIV' : 'AEM';

    const marker = L.marker([pin.lat, pin.lon], { icon: createIcon(color, 12) });
    marker.bindPopup(`
      <div class="popup-name" style="color: ${color}">${pin.name}</div>
      <div class="popup-type">${typeLabel}</div>
      <div class="popup-coords">${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)}</div>
    `);
    marker.bindTooltip(pin.name, { permanent: false, direction: 'top', offset: [0, -10], className: 'marker-tooltip' });
    if (initialEnabled) marker.addTo(map);

    const isoLayers = {};
    const isoConfig = [
      { key: '60', color: COLORS.iso60, opacity: 0.04, dashed: true },
      { key: '30', color: COLORS.iso30, opacity: 0.07, dashed: true },
      { key: '20', color: COLORS.iso20, opacity: 0.10, dashed: false },
      { key: '10', color: COLORS.iso10, opacity: 0.14, dashed: false },
    ];

    isoConfig.forEach(cfg => {
      const geom = pin.isochrones[cfg.key];
      if (!geom) return;
      const layer = createIsoLayer(geom, cfg.color, cfg.opacity, cfg.dashed);
      if (initialEnabled && isoVisible[cfg.key]) layer.addTo(map);
      isoLayers[cfg.key] = layer;
    });

    const subGroup = layerType === 'vmer' ? 'vmer' :
      (pin.name.startsWith('SI') ? 'siv' : 'aem');
    pinState[key] = { enabled: initialEnabled, userEnabled: initialEnabled, marker, isoLayers, layerType, subGroup, pin };
  }

  ISOCHRONE_DATA.aem_codu_centro.forEach(p => addPin(p, 'aem'));
  ISOCHRONE_DATA.vmer_drc.forEach(p => addPin(p, 'vmer'));

  // ─── Hospital pins ───
  const hospitalState = {}; // key -> { enabled, marker, data }

  function addHospitalPin(h, index) {
    const key = `hospital_${index}`;
    const marker = L.marker([h.lat, h.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="
          width: 20px; height: 20px;
          background: white;
          border: 2px solid #16a34a;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: bold; color: #16a34a;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ">H</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      }),
      zIndexOffset: 500
    });
    marker.bindPopup(`
      <div class="popup-name" style="color:#16a34a">${h.name}</div>
      <div class="popup-coords">${h.lat.toFixed(6)}, ${h.lon.toFixed(6)}</div>
    `);
    marker.bindTooltip(h.name, { permanent: false, direction: 'top', offset: [0, -12], className: 'marker-tooltip' });
    marker.addTo(map);
    hospitalState[key] = { enabled: true, marker, data: h };
  }

  ISOCHRONE_DATA.hospitais.forEach((h, i) => addHospitalPin(h, i));

  function toggleHospital(key, enabled) {
    const state = hospitalState[key];
    if (!state) return;
    state.enabled = enabled;
    if (enabled) state.marker.addTo(map);
    else map.removeLayer(state.marker);
    rebuildSearchPopup();
  }

  // ─── Toggle individual pin ───
  function togglePin(key, enabled) {
    const state = pinState[key];
    if (!state) return;
    state.enabled = enabled;

    if (enabled) {
      state.marker.addTo(map);
      state.marker.setOpacity(1);
      Object.entries(state.isoLayers).forEach(([isoKey, layer]) => {
        if (isoVisible[isoKey]) {
          layer.addTo(map);
          layer.setStyle({ fillOpacity: layer.options?.style?.fillOpacity || 0.15, opacity: 0.6 });
        }
      });
    } else if (searchFilterActive) {
      // Dim instead of hide during search
      state.marker.addTo(map);
      state.marker.setOpacity(0.2);
      Object.values(state.isoLayers).forEach(layer => {
        layer.addTo(map);
        layer.setStyle({ fillOpacity: 0.02, opacity: 0.1 });
      });
    } else {
      map.removeLayer(state.marker);
      Object.values(state.isoLayers).forEach(layer => map.removeLayer(layer));
    }

    updateStats();
    rebuildSearchPopup();
  }

  // ─── Toggle iso band globally ───
  function toggleIso(isoKey, enabled) {
    isoVisible[isoKey] = enabled;
    Object.values(pinState).forEach(state => {
      if (!state.enabled) return;
      const layer = state.isoLayers[isoKey];
      if (!layer) return;
      if (enabled) layer.addTo(map);
      else map.removeLayer(layer);
    });
    rebuildSearchPopup();
  }

  // ─── Update stats ───
  function updateStats() {
    let aemActive = 0, sivActive = 0, vmerActive = 0;
    Object.values(pinState).forEach(s => {
      if (s.enabled) {
        if (s.subGroup === 'aem') aemActive++;
        else if (s.subGroup === 'siv') sivActive++;
        else vmerActive++;
      }
    });
    document.getElementById('stat-active').textContent = aemActive + sivActive + vmerActive;
    document.getElementById('stat-aem').textContent = aemActive;
    document.getElementById('stat-siv').textContent = sivActive;
    document.getElementById('stat-vmer').textContent = vmerActive;
  }

  // ─── Build sidebar pin list ───
  function buildPinList() {
    const container = document.getElementById('pinList');

    // Split AEM CODU Centro into AEM DRC (AE..) and SIV DRC (SI..)
    const aemPins = ISOCHRONE_DATA.aem_codu_centro.filter(p => p.name.startsWith('AE') || p.name.startsWith('HI'));
    const sivPins = ISOCHRONE_DATA.aem_codu_centro.filter(p => p.name.startsWith('SI'));

    const groups = [
      { id: 'aem', label: 'AEM', color: COLORS.aem, data: aemPins, type: 'aem' },
      { id: 'siv', label: 'SIV', color: '#10b981', data: sivPins, type: 'aem' },
      { id: 'vmer', label: 'VMER', color: COLORS.vmer, data: ISOCHRONE_DATA.vmer_drc, type: 'vmer' },
    ];

    // Hospital group
    const hospitalGroup = {
      id: 'hospitais', label: 'Hospitais', color: '#16a34a',
      data: ISOCHRONE_DATA.hospitais.map((h, i) => ({ ...h, _key: `hospital_${i}` }))
    };

    // Build hospital section
    const hGroupEl = document.createElement('div');
    hGroupEl.className = 'layer-group';
    const hHeader = document.createElement('div');
    hHeader.className = 'layer-header';
    hHeader.innerHTML = `
      <span class="layer-dot" style="background: #16a34a"></span>
      <span class="layer-name">Hospitais</span>
      <span class="layer-count">${hospitalGroup.data.length}</span>
      <button class="layer-toggle-all" data-group="hospitais" data-state="on">Todos</button>
    `;
    hGroupEl.appendChild(hHeader);

    const hToggleBtn = hHeader.querySelector('.layer-toggle-all');
    hToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newEnabled = hToggleBtn.dataset.state === 'off';
      hToggleBtn.dataset.state = newEnabled ? 'on' : 'off';
      hToggleBtn.textContent = newEnabled ? 'Todos' : 'Nenhum';
      hospitalGroup.data.forEach(h => {
        toggleHospital(h._key, newEnabled);
        const item = document.querySelector(`[data-pin-key="${h._key}"]`);
        if (item) {
          const cb = item.querySelector('.pin-checkbox');
          cb.classList.toggle('checked', newEnabled);
          cb.style.background = newEnabled ? '#16a34a' : 'transparent';
          item.classList.toggle('enabled', newEnabled);
        }
      });
    });

    hospitalGroup.data.forEach(h => {
      const item = document.createElement('div');
      item.className = 'pin-item enabled';
      item.dataset.pinKey = h._key;
      item.innerHTML = `
        <div class="pin-checkbox checked" style="background: #16a34a">
          <svg class="check-icon" viewBox="0 0 10 10">
            <polyline points="1.5 5 4 7.5 8.5 2.5" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="pin-name">${h.name}</span>
        <div class="pin-locate" title="Centrar no mapa">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
        </div>
      `;

      const checkbox = item.querySelector('.pin-checkbox');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const isEnabled = checkbox.classList.contains('checked');
        checkbox.classList.toggle('checked', !isEnabled);
        checkbox.style.background = !isEnabled ? '#16a34a' : 'transparent';
        item.classList.toggle('enabled', !isEnabled);
        toggleHospital(h._key, !isEnabled);
      });

      item.querySelector('.pin-name').addEventListener('click', () => {
        map.flyTo([h.lat, h.lon], 13, { duration: 0.8 });
        hospitalState[h._key].marker.openPopup();
      });

      item.querySelector('.pin-locate').addEventListener('click', (e) => {
        e.stopPropagation();
        map.flyTo([h.lat, h.lon], 13, { duration: 0.8 });
        hospitalState[h._key].marker.openPopup();
      });

      hGroupEl.appendChild(item);
    });

    container.appendChild(hGroupEl);

    groups.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'layer-group';

      // Header
      const header = document.createElement('div');
      header.className = 'layer-header';
      header.innerHTML = `
        <span class="layer-dot" style="background: ${group.color}"></span>
        <span class="layer-name">${group.label}</span>
        <span class="layer-count">${group.data.length}</span>
        <button class="layer-toggle-all" data-group="${group.id}" data-state="on">Todos</button>
      `;
      groupEl.appendChild(header);

      // Toggle all button
      const toggleAllBtn = header.querySelector('.layer-toggle-all');
      toggleAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentState = toggleAllBtn.dataset.state;
        const newEnabled = currentState === 'off';
        toggleAllBtn.dataset.state = newEnabled ? 'on' : 'off';
        toggleAllBtn.textContent = newEnabled ? 'Todos' : 'Nenhum';

        group.data.forEach(pin => {
          const key = `${group.type}_${pin.name}`;
          if (pinState[key]) pinState[key].userEnabled = newEnabled;
          togglePin(key, newEnabled);
          const checkbox = document.querySelector(`[data-pin-key="${key}"] .pin-checkbox`);
          if (checkbox) {
            checkbox.classList.toggle('checked', newEnabled);
            checkbox.style.background = newEnabled ? group.color : 'transparent';
          }
          const item = document.querySelector(`[data-pin-key="${key}"]`);
          if (item) item.classList.toggle('enabled', newEnabled);
        });
      });

      // Pin items
      group.data.forEach(pin => {
        const key = `${group.type}_${pin.name}`;
        const isEnabled = pinState[key]?.enabled ?? true;
        const item = document.createElement('div');
        item.className = isEnabled ? 'pin-item enabled' : 'pin-item';
        item.dataset.pinKey = key;
        item.innerHTML = `
          <div class="pin-checkbox ${isEnabled ? 'checked' : ''}" style="background: ${isEnabled ? group.color : 'transparent'}">
            <svg class="check-icon" viewBox="0 0 10 10">
              <polyline points="1.5 5 4 7.5 8.5 2.5" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="pin-name">${pin.name}</span>
          <div class="pin-locate" title="Centrar no mapa">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
          </div>
        `;

        // Click checkbox to toggle
        const checkbox = item.querySelector('.pin-checkbox');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          const isEnabled = checkbox.classList.contains('checked');
          checkbox.classList.toggle('checked', !isEnabled);
          checkbox.style.background = !isEnabled ? group.color : 'transparent';
          item.classList.toggle('enabled', !isEnabled);
          if (pinState[key]) pinState[key].userEnabled = !isEnabled;
          togglePin(key, !isEnabled);
        });

        // Click name to fly to pin
        item.querySelector('.pin-name').addEventListener('click', () => {
          map.flyTo([pin.lat, pin.lon], 12, { duration: 0.8 });
          pinState[key].marker.openPopup();
        });

        // Click locate icon
        item.querySelector('.pin-locate').addEventListener('click', (e) => {
          e.stopPropagation();
          map.flyTo([pin.lat, pin.lon], 12, { duration: 0.8 });
          pinState[key].marker.openPopup();
        });

        groupEl.appendChild(item);
      });

      container.appendChild(groupEl);
    });
  }

  buildPinList();

  // ─── Iso button toggles ───
  ['10', '20', '30', '60'].forEach(key => {
    const btn = document.getElementById(`btn-iso-${key}`);
    btn.addEventListener('click', () => {
      const isActive = btn.classList.contains(`active-${key}`);
      btn.classList.toggle(`active-${key}`, !isActive);
      toggleIso(key, !isActive);
    });
  });

  // ─── Search / Geocoding (Nominatim) ───
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const searchClear = document.getElementById('searchClear');
  let searchMarker = null;
  let searchTimeout = null;

  let selectedIdx = -1;

  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('li');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((li, i) => li.style.background = i === selectedIdx ? 'rgba(255,255,255,0.08)' : 'transparent');
      items[selectedIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((li, i) => li.style.background = i === selectedIdx ? 'rgba(255,255,255,0.08)' : 'transparent');
      items[selectedIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && selectedIdx >= 0 && selectedIdx < items.length) {
      e.preventDefault();
      items[selectedIdx].click();
      selectedIdx = -1;
    } else if (e.key === 'Escape') {
      searchResults.innerHTML = '';
      selectedIdx = -1;
    }
  });

  searchInput.addEventListener('input', () => {
    selectedIdx = -1;
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';

    clearTimeout(searchTimeout);
    if (q.length < 2) {
      searchResults.innerHTML = '';
      return;
    }

    searchTimeout = setTimeout(() => {
      // Detect coordinates (lat, lon) in various formats
      const coordMatch = q.match(/^\s*(-?\d+[.,]\d+)[\s,;/]+(-?\d+[.,]\d+)\s*$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1].replace(',', '.'));
        const lon = parseFloat(coordMatch[2].replace(',', '.'));
        if (lat >= 36 && lat <= 43 && lon >= -10 && lon <= -6) {
          searchResults.innerHTML = '';
          const li = document.createElement('li');
          li.innerHTML = `<span class="search-result-name">${lat.toFixed(6)}, ${lon.toFixed(6)}</span><span class="search-result-detail">Coordenadas GPS</span>`;
          li.addEventListener('click', () => {
            placeSearchMarker(lat, lon, `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
            searchResults.innerHTML = '';
            searchInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
          });
          searchResults.appendChild(li);
          return;
        }
      }

      // Detect postal code pattern (XXXX or XXXX-XXX)
      const postalMatch = q.match(/^(\d{4})(?:[-\s]?(\d{3}))?$/);

      if (postalMatch) {
        // Local postal code lookup (197K CP7 with GPS coordinates, offline)
        searchResults.innerHTML = '';

        if (typeof POSTAL_DATA !== 'undefined') {
          const lines = POSTAL_DATA.split('\n');
          const matches = [];
          const searchCP = postalMatch[2] ? `${postalMatch[1]}-${postalMatch[2]}` : postalMatch[1];
          for (const line of lines) {
            if (line.startsWith(searchCP)) {
              const parts = line.split('|');
              // Format: CP7|name|lat|lon
              matches.push({ cp: parts[0], loc: parts[1], lat: parseFloat(parts[2]), lon: parseFloat(parts[3]) });
              if (matches.length >= 8) break;
            }
          }

          matches.forEach(m => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="search-result-name">${m.cp} — ${m.loc}</span><span class="search-result-detail">Código Postal CTT</span>`;
            li.addEventListener('click', () => {
              // Direct local coordinates — no external API needed
              if (m.lat && m.lon && !isNaN(m.lat) && !isNaN(m.lon)) {
                const name = `${m.cp} — ${m.loc}`;
                placeSearchMarker(m.lat, m.lon, name);
                searchResults.innerHTML = '';
                searchInput.value = name;
              }
            });
            searchResults.appendChild(li);
          });
        }
        return;
      }

      // Non-postal: run Photon + Nominatim in parallel
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=pt&lat=40.2&lon=-8.2&location_bias_scale=5`;
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=pt&limit=5&addressdetails=1`;

      const photonPromise = fetch(photonUrl).then(r => r.json()).catch(() => ({ features: [] }));
      const nominatimPromise = fetch(nominatimUrl, { headers: { 'Accept-Language': 'pt' } }).then(r => r.json()).catch(() => []);

      Promise.all([photonPromise, nominatimPromise]).then(([photonData, nominatimData]) => {
        searchResults.innerHTML = '';
        const seen = new Set(); // deduplicate by rounded coords

        // Parse Photon results
        const photonResults = (photonData.features || [])
          .filter(f => !f.properties?.country || f.properties.country === 'Portugal')
          .map(f => {
            const p = f.properties || {};
            const coords = f.geometry?.coordinates;
            if (!coords) return null;
            const name = p.name || p.street || p.locality || p.hamlet || p.village || p.suburb || p.town || p.city || 'Local';
            const detailParts = [
              p.hamlet && p.hamlet !== name ? p.hamlet : null,
              p.village && p.village !== name ? p.village : null,
              p.town && p.town !== name ? p.town : null,
              p.city && p.city !== name ? p.city : null,
              p.county && p.county !== name ? p.county : null,
            ].filter(Boolean);
            return { name, detail: detailParts.slice(0, 2).join(', '), lat: coords[1], lon: coords[0] };
          }).filter(Boolean);

        // Parse Nominatim results
        const nominatimResults = (nominatimData || []).map(r => {
          const a = r.address || {};
          const postcode = a.postcode || '';
          const placeName = a.hamlet || a.village || a.town || a.city || a.suburb || r.display_name.split(',')[0];
          const name = placeName;
          const detailParts = [
            a.hamlet && a.village ? a.village : null,
            a.town && a.town !== placeName ? a.town : null,
            a.city && a.city !== placeName ? a.city : null,
            a.county && a.county !== placeName ? a.county : null,
          ].filter(Boolean);
          return { name, detail: detailParts.slice(0, 2).join(', '), lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
        });

        // Merge: Nominatim first (better for Portuguese localities), then Photon
        const merged = [...nominatimResults, ...photonResults];

        merged.forEach(r => {
          // Deduplicate by ~500m proximity
          const key = `${(r.lat).toFixed(3)}_${(r.lon).toFixed(3)}`;
          if (seen.has(key)) return;
          seen.add(key);

          const li = document.createElement('li');
          li.innerHTML = `<span class="search-result-name">${r.name}</span><span class="search-result-detail">${r.detail}</span>`;
          li.addEventListener('click', () => {
            placeSearchMarker(r.lat, r.lon, r.name);
            searchResults.innerHTML = '';
            searchInput.value = r.name;
          });
          searchResults.appendChild(li);
        });
      });
    }, 300);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchClear.style.display = 'none';
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }
    if (searchFilterActive) {
      restoreAllPins();
      restoreAllHospitals();
      searchFilterActive = false;
    }
    lastSearchData = null;
    clearRoute();
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-header')) {
      searchResults.innerHTML = '';
    }
  });

  // Check if a point is inside a GeoJSON polygon/multipolygon
  function pointInPolygon(lat, lon, geometry) {
    if (!geometry) return false;
    const pt = [lon, lat]; // GeoJSON uses [lon, lat]

    function inRing(pt, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > pt[1]) !== (yj > pt[1])) &&
            (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    }

    function inPolygon(pt, coords) {
      if (!inRing(pt, coords[0])) return false;
      for (let i = 1; i < coords.length; i++) {
        if (inRing(pt, coords[i])) return false; // hole
      }
      return true;
    }

    if (geometry.type === 'Polygon') {
      return inPolygon(pt, geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some(poly => inPolygon(pt, poly));
    }
    return false;
  }

  // Find which pins can reach a point within each time band
  function filterPinsByReach(lat, lon) {
    const reaching = []; // pins that reach within ANY time band

    Object.entries(pinState).forEach(([key, state]) => {


      // Check all time bands
      let bestBand = null;
      for (const band of ['10', '20', '30', '60']) {
        const geom = state.pin.isochrones[band];
        if (geom && pointInPolygon(lat, lon, geom)) {
          if (!bestBand) bestBand = band;
        }
      }

      const canReach = bestBand !== null;
      togglePin(key, canReach);

      // Update checkbox UI
      const item = document.querySelector(`[data-pin-key="${key}"]`);
      if (item) {
        const checkbox = item.querySelector('.pin-checkbox');
        const pinColor = state.subGroup === 'vmer' ? COLORS.vmer : state.subGroup === 'siv' ? '#10b981' : COLORS.aem;
        checkbox.classList.toggle('checked', canReach);
        checkbox.style.background = canReach ? pinColor : 'transparent';
        item.classList.toggle('enabled', canReach);
      }

      if (canReach) {
        state._bestBand = bestBand;
        reaching.push(state);
      }
    });

    return reaching;
  }

  // Restore all pins to enabled
  function restoreAllPins() {
    Object.entries(pinState).forEach(([key, state]) => {
      togglePin(key, true);
      const item = document.querySelector(`[data-pin-key="${key}"]`);
      if (item) {
        const checkbox = item.querySelector('.pin-checkbox');
        const color = state.layerType === 'aem' ? COLORS.aem : COLORS.vmer;
        checkbox.classList.add('checked');
        checkbox.style.background = color;
        item.classList.add('enabled');
      }
    });
  }

  let searchFilterActive = false;
  let lastSearchData = null; // stores { lat, lon, name, etaResults, hospitalETAs, bandSummary, reaching }
  let activeRoutePin = null;    // route from pin to location (blue)
  let activeRouteHosp = null;   // route from location to hospital (white)

  // Fetch route shape from OSRM and draw on map (matches pre-computed ETAs)
  // routeType: 'pin' (blue, meio→local) or 'hospital' (white, local→hospital)
  async function showRoute(fromLat, fromLon, toLat, toLon, routeType) {
    const color = routeType === 'hospital' ? '#ffffff' : '#3b82f6';
    const weight = routeType === 'hospital' ? 3 : 4;

    // Remove only the route of this type
    if (routeType === 'pin' && activeRoutePin) { map.removeLayer(activeRoutePin); activeRoutePin = null; }
    if (routeType === 'hospital' && activeRouteHosp) { map.removeLayer(activeRouteHosp); activeRouteHosp = null; }

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=simplified&geometries=geojson`;
      const resp = await fetch(url);
      if (!resp.ok) { drawStraightLine(fromLat, fromLon, toLat, toLon, color, weight, routeType); return; }
      const data = await resp.json();
      const geom = data.routes?.[0]?.geometry;
      if (!geom) { drawStraightLine(fromLat, fromLon, toLat, toLon, color, weight, routeType); return; }

      // GeoJSON coords are [lon, lat] — Leaflet needs [lat, lon]
      const coords = geom.coordinates.map(c => [c[1], c[0]]);
      const layer = L.polyline(coords, {
        color, weight, opacity: 0.85, lineCap: 'round', lineJoin: 'round'
      }).addTo(map);

      if (routeType === 'pin') activeRoutePin = layer;
      else activeRouteHosp = layer;

      // Fit to show both routes if both exist
      const bounds = L.latLngBounds([]);
      if (activeRoutePin) bounds.extend(activeRoutePin.getBounds());
      if (activeRouteHosp) bounds.extend(activeRouteHosp.getBounds());
      map.fitBounds(bounds, { padding: [60, 60] });
    } catch {
      drawStraightLine(fromLat, fromLon, toLat, toLon, color, weight, routeType);
    }
  }

  // Fallback: straight dashed line if routing fails
  function drawStraightLine(fromLat, fromLon, toLat, toLon, color, weight, routeType) {
    if (routeType === 'pin' && activeRoutePin) { map.removeLayer(activeRoutePin); activeRoutePin = null; }
    if (routeType === 'hospital' && activeRouteHosp) { map.removeLayer(activeRouteHosp); activeRouteHosp = null; }
    const layer = L.polyline(
      [[fromLat, fromLon], [toLat, toLon]],
      { color, weight, opacity: 0.6, dashArray: '8 6' }
    ).addTo(map);
    if (routeType === 'pin') activeRoutePin = layer;
    else activeRouteHosp = layer;
  }

  // Decode Valhalla polyline6 format
  function decodePolyline6(encoded) {
    const coords = [];
    let lat = 0, lon = 0, i = 0;
    while (i < encoded.length) {
      let shift = 0, result = 0, byte;
      do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      coords.push([lat / 1e6, lon / 1e6]);
    }
    return coords;
  }

  // Clear both routes
  function clearRoute() {
    if (activeRoutePin) { map.removeLayer(activeRoutePin); activeRoutePin = null; }
    if (activeRouteHosp) { map.removeLayer(activeRouteHosp); activeRouteHosp = null; }
  }

  // Global handler for popup route clicks
  window._refreshETAs = async function() {
    if (!lastSearchData) return;
    const { name, lat, lon } = lastSearchData;
    await placeSearchMarker(lat, lon, name);
  };

  window._showRouteFromPin = async function(fromLat, fromLon, toLat, toLon) {
    await showRoute(fromLat, fromLon, toLat, toLon, 'pin');
  };
  window._showRouteToHospital = async function(fromLat, fromLon, toLat, toLon) {
    await showRoute(fromLat, fromLon, toLat, toLon, 'hospital');
  };

  const EMERGENCY_SPEED_FACTOR = 1.3;
  const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route';

  // Conservative distance-based fallback ETA
  function fallbackETA(fromLat, fromLon, toLat, toLon) {
    const dlat = fromLat - toLat;
    const dlon = fromLon - toLon;
    const straightKm = Math.sqrt(dlat * dlat + dlon * dlon) * 111;
    const roadKm = straightKm * 1.6;
    return Math.round(roadKm / (50 / 60));
  }

  // ─── Pre-computed ETAs: 59 origins × 13K real locations (OSRM) ───
  const gridDests = (typeof GRID_ETAS !== 'undefined') ? GRID_ETAS.destinations : [];
  const gridETAData = (typeof GRID_ETAS !== 'undefined') ? GRID_ETAS.etas : {};

  function getGridETA(sourceName, lat, lon) {
    const etas = gridETAData[sourceName];
    if (!etas || gridDests.length === 0) return null;

    // Find nearest pre-computed destination
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < gridDests.length; i++) {
      const dlat = gridDests[i][0] - lat;
      const dlon = gridDests[i][1] - lon;
      const d = dlat * dlat + dlon * dlon;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // If nearest point is within ~3km, use its ETA directly
    if (bestDist < 0.001 && bestIdx >= 0 && etas[bestIdx] !== null) {
      return Math.round(etas[bestIdx] / EMERGENCY_SPEED_FACTOR);
    }

    // Otherwise interpolate from 3 nearest
    let nearest = [];
    for (let i = 0; i < gridDests.length; i++) {
      const dlat = gridDests[i][0] - lat;
      const dlon = gridDests[i][1] - lon;
      nearest.push({ idx: i, dist: Math.sqrt(dlat * dlat + dlon * dlon) });
    }
    nearest.sort((a, b) => a.dist - b.dist);
    nearest = nearest.slice(0, 3);

    let weightedSum = 0, weightSum = 0;
    for (const n of nearest) {
      const eta = etas[n.idx];
      if (eta === null) continue;
      const w = n.dist < 0.0001 ? 10000 : 1 / (n.dist * n.dist);
      weightedSum += eta * w;
      weightSum += w;
    }

    if (weightSum === 0) return null;
    return Math.round((weightedSum / weightSum) / EMERGENCY_SPEED_FACTOR);
  }

  // Get ETA between two points via OSRM with fallback
  // Returns { minutes, estimated } where estimated=true means fallback was used
  async function getETA(fromLat, fromLon, toLat, toLon) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const secs = data.routes?.[0]?.duration;
        if (secs) return { minutes: Math.round((secs / 60) / EMERGENCY_SPEED_FACTOR), estimated: false };
      }
    } catch { /* fallback */ }

    // Fallback: distance estimate
    const dlat = fromLat - toLat;
    const dlon = fromLon - toLon;
    const straightKm = Math.sqrt(dlat * dlat + dlon * dlon) * 111;
    const roadKm = straightKm * 1.6;
    return { minutes: Math.round(roadKm / (50 / 60)), estimated: true };
  }

  // Find 2 nearest main hospitals + 1 nearest SUB
  function findClosest3Hospitals(lat, lon) {
    const withDist = ISOCHRONE_DATA.hospitais.map((h, i) => {
      const dlat = h.lat - lat;
      const dlon = h.lon - lon;
      const dist = Math.sqrt(dlat * dlat + dlon * dlon) * 111; // approx km
      const isSub = h.name.startsWith('SUB ');
      return { ...h, _key: `hospital_${i}`, dist, isSub };
    });
    withDist.sort((a, b) => a.dist - b.dist);

    const mainHospitals = withDist.filter(h => !h.isSub).slice(0, 2);
    const nearestSub = withDist.filter(h => h.isSub).slice(0, 1);
    const result = [...mainHospitals, ...nearestSub];
    result.sort((a, b) => a.dist - b.dist);
    return result;
  }

  // Toggle hospital visibility during search (hide all, show only selected)
  function filterHospitals(selectedKeys) {
    Object.entries(hospitalState).forEach(([key, state]) => {
      const show = selectedKeys.includes(key);
      toggleHospital(key, show);
      const item = document.querySelector(`[data-pin-key="${key}"]`);
      if (item) {
        const cb = item.querySelector('.pin-checkbox');
        cb.classList.toggle('checked', show);
        cb.style.background = show ? '#16a34a' : 'transparent';
        item.classList.toggle('enabled', show);
      }
    });
  }

  function restoreAllHospitals() {
    Object.entries(hospitalState).forEach(([key, state]) => {
      toggleHospital(key, true);
      const item = document.querySelector(`[data-pin-key="${key}"]`);
      if (item) {
        const cb = item.querySelector('.pin-checkbox');
        cb.classList.add('checked');
        cb.style.background = '#16a34a';
        item.classList.add('enabled');
      }
    });
  }

  // Rebuild popup from cached data, respecting current toggle states
  function rebuildSearchPopup() {
    if (!lastSearchData || !searchMarker) return;
    const { name, lat, lon, etaResults, hospitalETAs, bandSummary } = lastSearchData;

    // Filter ETAs by currently enabled pins AND active time bands
    const activeETAs = etaResults.filter(r => {
      const key = `${r.layerType}_${r.originalName}`;
      const state = pinState[key];
      if (!state || !state.enabled) return false;
      // Check if the pin's best time band is currently toggled on
      if (!isoVisible[r.bestBand]) return false;
      return true;
    });

    // Filter hospitals by currently enabled
    const activeHospitals = hospitalETAs.filter(h => {
      const state = hospitalState[h._key];
      return state && state.enabled;
    });

    // Recount bands from active only
    const bandCounts = {};
    activeETAs.forEach(r => { bandCounts[r.bestBand] = (bandCounts[r.bestBand] || 0) + 1; });
    const activeBandSummary = ['10','20','30','60']
      .filter(b => bandCounts[b])
      .map(b => `${bandCounts[b]} em ${b} min`)
      .join(', ');

    let etaHtml = '';
    if (activeETAs.length > 0) {
      etaHtml = '<div style="margin-top:8px;border-top:1px solid #2a2d38;padding-top:8px;">';
      etaHtml += '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#565a6e;margin-bottom:4px;">ETA meios (emerg\u00eancia)</div>';
      etaHtml += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      const bandColors = {'10':'#22c55e','20':'#eab308','30':'#f97316','60':'#ef4444'};
      activeETAs.forEach(r => {
        const color = r.subGroup === 'vmer' ? '#f59e0b' : r.subGroup === 'siv' ? '#10b981' : '#3b82f6';
        let etaColor, etaLabel;
        if (r.estimated === 'distance') { etaColor = '#ef4444'; etaLabel = '<span style="font-size:8px;color:#ef4444;margin-left:3px;" title="Estimativa grosseira \u2014 baixa precis\u00e3o">\u26A0 impreciso</span>'; }
        else if (r.estimated === 'grid') { etaColor = '#f59e0b'; etaLabel = '<span style="font-size:8px;color:#f59e0b;margin-left:3px;" title="Estimativa por interpola\u00e7\u00e3o \u2014 precis\u00e3o moderada">\u2248 aprox.</span>'; }
        else { etaColor = '#e2e4ea'; etaLabel = ''; }
        const etaStr = `<strong style="color:${etaColor}">${r.eta} min</strong>${etaLabel}`;
        const bandColor = bandColors[r.bestBand] || '#565a6e';
        const bandBadge = `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${bandColor}22;color:${bandColor};margin-left:4px;">${r.bestBand}'</span>`;
        const distKm = Math.round(Math.sqrt((r.pinLat - lat) ** 2 + (r.pinLon - lon) ** 2) * 111);
        const distStr = `<span style="font-size:9px;color:#565a6e;margin-left:4px;">${distKm}km</span>`;
        const clickFn = `_showRouteFromPin(${r.pinLat},${r.pinLon},${lat},${lon})`;
        etaHtml += `<tr onclick="${clickFn}" style="cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='transparent'"><td style="padding:3px 2px;"><span style="color:${color};font-weight:600;">${r.name}</span>${bandBadge}${distStr}</td><td style="padding:3px 2px;text-align:right;">${etaStr}</td></tr>`;
      });
      etaHtml += '</table></div>';
    } else {
      etaHtml = '<div style="margin-top:6px;font-size:10px;color:#ef4444;">Nenhum meio ativo cobre esta localidade</div>';
    }

    let hospitalHtml = '';
    if (activeHospitals.length > 0) {
      hospitalHtml = '<div style="margin-top:8px;border-top:1px solid #2a2d38;padding-top:8px;">';
      hospitalHtml += '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#565a6e;margin-bottom:4px;">Hospitais mais pr\u00f3ximos</div>';
      hospitalHtml += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      activeHospitals.forEach(h => {
        let etaColor, etaLabel;
        if (h.estimated === 'distance') { etaColor = '#ef4444'; etaLabel = '<span style="font-size:8px;color:#ef4444;margin-left:3px;">\u26A0 impreciso</span>'; }
        else if (h.estimated === 'grid') { etaColor = '#f59e0b'; etaLabel = '<span style="font-size:8px;color:#f59e0b;margin-left:3px;">\u2248 aprox.</span>'; }
        else { etaColor = '#e2e4ea'; etaLabel = ''; }
        const etaStr = `<strong style="color:${etaColor}">${h.eta} min</strong>${etaLabel}`;
        const distStr = `<span style="font-size:9px;color:#565a6e;margin-left:4px;">${h.dist.toFixed(0)}km</span>`;
        const clickFn = `_showRouteToHospital(${lat},${lon},${h.lat},${h.lon})`;
        hospitalHtml += `<tr onclick="${clickFn}" style="cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"><td style="padding:3px 2px;"><span style="color:#16a34a;font-weight:bold;">H</span> <span style="color:#e2e4ea;">${h.name}</span>${distStr}</td><td style="padding:3px 2px;text-align:right;white-space:nowrap;">${etaStr}</td></tr>`;
      });
      hospitalHtml += '</table></div>';
    }

    // Check if any ETAs are estimated
    const hasEstimated = activeETAs.some(r => r.estimated) || activeHospitals.some(h => h.estimated);
    const refreshBtn = hasEstimated ? `<div style="margin-top:8px;text-align:center;"><button onclick="_refreshETAs()" style="background:#2a2d38;color:#8b8fa3;border:1px solid #353845;border-radius:6px;padding:5px 14px;font-size:10px;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.background='#353845';this.style.color='#e2e4ea'" onmouseout="this.style.background='#2a2d38';this.style.color='#8b8fa3'">\u21BB Recalcular ETAs</button></div>` : '';

    const popup = `
      <div class="popup-name" style="color:#dc2626">${name}</div>
      <div class="popup-coords">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
      <div style="margin-top:6px;font-size:11px;color:#8b8fa3;">
        <strong style="color:#e2e4ea;">${activeETAs.length}</strong> meio${activeETAs.length !== 1 ? 's' : ''} ativos ${activeETAs.length > 0 ? '(' + activeBandSummary + ')' : ''}
      </div>
      ${etaHtml}
      ${hospitalHtml}
      ${refreshBtn}
    `;
    searchMarker.setPopupContent(popup);
  }

  async function placeSearchMarker(lat, lon, name) {
    if (searchMarker) map.removeLayer(searchMarker);

    searchMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="search-marker"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      }),
      zIndexOffset: 1000
    });

    // Filter pins: isochrone coverage + pre-computed ETA coverage
    const reaching = filterPinsByReach(lat, lon);

    // Also add pins with pre-computed ETAs that aren't in isochrone reach
    if (typeof GRID_ETAS !== 'undefined') {
      const reachingNames = new Set(reaching.map(s => s.pin.name));
      Object.entries(pinState).forEach(([key, state]) => {
        if (!state.pin || reachingNames.has(state.pin.name)) return;
        const gridEta = getGridETA(state.pin.name, lat, lon);
        if (gridEta !== null && gridEta <= 90) {
          togglePin(key, true); // re-enable the pin on map
          state._bestBand = gridEta <= 10 ? '10' : gridEta <= 20 ? '20' : gridEta <= 30 ? '30' : '60';
          reaching.push(state);
          // Update sidebar checkbox
          const item = document.querySelector(`[data-pin-key="${key}"]`);
          if (item) {
            const cb = item.querySelector('.pin-checkbox');
            const pinColor = state.subGroup === 'vmer' ? COLORS.vmer : state.subGroup === 'siv' ? '#10b981' : COLORS.aem;
            cb.classList.add('checked');
            cb.style.background = pinColor;
            item.classList.add('enabled');
          }
        }
      });
    }

    searchFilterActive = true;

    // Count by band
    const bandCounts = {};
    reaching.forEach(s => { bandCounts[s._bestBand] = (bandCounts[s._bestBand] || 0) + 1; });
    const bandSummary = ['10','20','30','60']
      .filter(b => bandCounts[b])
      .map(b => `${bandCounts[b]} em ${b} min`)
      .join(', ');

    const loadingHtml = `
      <div class="popup-name" style="color:#dc2626">${name}</div>
      <div class="popup-coords">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
      <div style="margin-top:6px;font-size:10px;color:#565a6e;">A calcular ETAs...</div>
    `;
    searchMarker.bindPopup(loadingHtml, { maxWidth: 300, minWidth: 220 });
    searchMarker.addTo(map);
    map.flyTo([lat, lon], 11, { duration: 0.8 });
    searchMarker.openPopup();

    // ETAs: Pre-computed OSRM grid (primary) with Valhalla API fallback
    const closest3 = findClosest3Hospitals(lat, lon);
    let etaResults = [];
    let hospitalETAs = [];

    try {
      // 1) All vehicles → search point
      if (reaching.length > 0) {
        // Try pre-computed grid first (OSRM, accurate)
        let needsAPI = false;
        etaResults = reaching.map((state) => {
          const gridEta = getGridETA(state.pin.name, lat, lon);
          if (gridEta === null) needsAPI = true;
          return {
            name: state.pin.name, originalName: state.pin.name,
            layerType: state.layerType, subGroup: state.subGroup,
            bestBand: state._bestBand,
            eta: gridEta,
            estimated: gridEta ? false : 'pending',
            pinLat: state.pin.lat, pinLon: state.pin.lon
          };
        });

        // Fill gaps with Valhalla API if any grid misses
        if (needsAPI) {
          try {
            // OSRM table: sources (vehicles with missing ETAs) → destination (search point)
            const missing = etaResults.map((r, i) => r.eta === null ? i : -1).filter(i => i >= 0);
            const coords = missing.map(i => `${reaching[i].pin.lon},${reaching[i].pin.lat}`).join(';');
            const osrmUrl = `https://router.project-osrm.org/table/v1/driving/${coords};${lon},${lat}?sources=${missing.map((_, i) => i).join(';')}&destinations=${missing.length}`;
            const osrmResp = await fetch(osrmUrl);
            if (osrmResp.ok) {
              const osrmData = await osrmResp.json();
              if (osrmData.code === 'Ok') {
                missing.forEach((origIdx, i) => {
                  const secs = osrmData.durations?.[i]?.[0];
                  if (secs) {
                    etaResults[origIdx].eta = Math.round((secs / 60) / EMERGENCY_SPEED_FACTOR);
                    etaResults[origIdx].estimated = false;
                  }
                });
              }
            }
          } catch { /* OSRM failed */ }

          // Final fallback for any still-null ETAs
          etaResults.forEach(r => {
            if (r.eta === null) {
              r.eta = fallbackETA(r.pinLat, r.pinLon, lat, lon);
              r.estimated = 'distance';
            }
          });
        }
      }

      // 2) Search point → hospitals (grid first, then API fallback)
      if (closest3.length > 0) {
        let needsHospAPI = false;
        hospitalETAs = closest3.map((h) => {
          const gridEta = getGridETA(h.name, lat, lon);
          if (gridEta === null) needsHospAPI = true;
          return { ...h, eta: gridEta, estimated: gridEta ? false : 'pending' };
        });

        if (needsHospAPI) {
          try {
            const missing = hospitalETAs.map((h, i) => h.eta === null ? i : -1).filter(i => i >= 0);
            const hCoords = `${lon},${lat};` + missing.map(i => `${closest3[i].lon},${closest3[i].lat}`).join(';');
            const hUrl = `https://router.project-osrm.org/table/v1/driving/${hCoords}?sources=0&destinations=${missing.map((_, i) => i + 1).join(';')}`;
            const hResp = await fetch(hUrl);
            if (hResp.ok) {
              const hData = await hResp.json();
              if (hData.code === 'Ok') {
                missing.forEach((origIdx, i) => {
                  const secs = hData.durations?.[0]?.[i];
                  if (secs) {
                    hospitalETAs[origIdx].eta = Math.round((secs / 60) / EMERGENCY_SPEED_FACTOR);
                    hospitalETAs[origIdx].estimated = false;
                  }
                });
              }
            }
          } catch { /* OSRM failed */ }

          hospitalETAs.forEach(h => {
            if (h.eta === null) {
              h.eta = fallbackETA(lat, lon, h.lat, h.lon);
              h.estimated = 'distance';
            }
          });
        }
      }
    } catch (e) {
      // Fallback: grid then distance estimate
      if (etaResults.length === 0) {
        etaResults = reaching.map(state => {
          const gridEta = getGridETA(state.pin.name, lat, lon);
          return {
            name: state.pin.name, originalName: state.pin.name,
            layerType: state.layerType, subGroup: state.subGroup,
            bestBand: state._bestBand,
            eta: gridEta ?? fallbackETA(state.pin.lat, state.pin.lon, lat, lon),
            estimated: gridEta ? 'grid' : 'distance',
            pinLat: state.pin.lat, pinLon: state.pin.lon
          };
        });
      }
      if (hospitalETAs.length === 0) {
        hospitalETAs = closest3.map(h => {
          const gridEta = getGridETA(h.name, lat, lon);
          return { ...h, eta: gridEta ?? fallbackETA(lat, lon, h.lat, h.lon), estimated: gridEta ? 'grid' : 'distance' };
        });
      }
    }

    etaResults.sort((a, b) => (a.eta ?? 999) - (b.eta ?? 999));
    hospitalETAs.sort((a, b) => (a.eta ?? 999) - (b.eta ?? 999));

    // Toggle: hide all hospitals, show only the closest 3
    const selectedKeys = closest3.map(h => h._key);
    filterHospitals(selectedKeys);

    // Cache and show popup instantly
    lastSearchData = { name, lat, lon, etaResults, hospitalETAs, bandSummary };
    rebuildSearchPopup();
    searchMarker.openPopup();
  }

  // ─── Mobile sidebar toggle ───
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar when clicking map on mobile
  document.getElementById('map').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('open');
    }
  });

})();