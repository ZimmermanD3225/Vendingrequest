(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof L === 'undefined') return;
    initFullMap();
    initMiniMap();
    initAddressAutocomplete();
  });

  var TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'success');
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('hide'); }, 2600);
    setTimeout(function () { el.remove(); }, 3000);
  }

  // ------------------------------------------------------------------
  // Full map at /map — all machines as draggable pins
  // ------------------------------------------------------------------
  function initFullMap() {
    var el = document.getElementById('full-map');
    if (!el) return;
    var pins;
    try { pins = JSON.parse(el.getAttribute('data-pins') || '[]'); } catch (_) { pins = []; }

    var map = L.map(el, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);

    if (!pins.length) {
      map.setView([39.8, -98.6], 4);
      return;
    }

    var bounds = [];
    pins.forEach(function (p) {
      var marker = L.marker([p.lat, p.lng], { draggable: true }).addTo(map);
      marker.bindPopup(popupHtml(p));
      marker.on('dragend', function (e) {
        var ll = e.target.getLatLng();
        saveMachineLocation(p.id, ll.lat, ll.lng).then(function (res) {
          if (res.ok) {
            if (res.address) p.address = res.address;
            p.lat = ll.lat; p.lng = ll.lng;
            marker.setPopupContent(popupHtml(p));
            toast('Location updated for "' + p.name + '"', 'success');
          } else {
            marker.setLatLng([p.lat, p.lng]);
            toast('Could not save location', 'error');
          }
        });
      });
      bounds.push([p.lat, p.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function popupHtml(p) {
    var badge = p.new_count > 0
      ? '<span class="mpop-badge">' + p.new_count + ' new</span> '
      : '';
    return (
      '<div class="mpop">' +
        '<strong>' + esc(p.name) + '</strong>' +
        (p.location ? '<br><span class="mpop-sub">' + esc(p.location) + '</span>' : '') +
        (p.address ? '<br><span class="mpop-addr">' + esc(p.address) + '</span>' : '') +
        '<div class="mpop-foot">' + badge +
          '<a href="/machines/' + p.id + '">View →</a>' +
        '</div>' +
      '</div>'
    );
  }

  function saveMachineLocation(id, lat, lng) {
    var body = '_csrf=' + encodeURIComponent(getCsrfToken()) +
               '&lat=' + encodeURIComponent(lat) +
               '&lng=' + encodeURIComponent(lng);
    return fetch('/machines/' + id + '/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; });
  }

  // ------------------------------------------------------------------
  // Mini map on the machine-new form — click/drag the pin to place it
  // ------------------------------------------------------------------
  var miniState = { map: null, marker: null };

  function initMiniMap() {
    var el = document.getElementById('mini-map');
    if (!el) return;
    var latInput = document.getElementById('lat');
    var lngInput = document.getElementById('lng');
    var locateBtn = document.getElementById('locate-btn');

    if (locateBtn) {
      locateBtn.addEventListener('click', function () {
        if (!navigator.geolocation) return;
        locateBtn.setAttribute('data-loading', '1');
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            locateBtn.removeAttribute('data-loading');
            showMiniMap(pos.coords.latitude, pos.coords.longitude);
            reverseGeocodeToAddress(pos.coords.latitude, pos.coords.longitude);
          },
          function () { locateBtn.removeAttribute('data-loading'); },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }

    if (latInput && latInput.value && lngInput.value) {
      showMiniMap(parseFloat(latInput.value), parseFloat(lngInput.value));
    }
  }

  function showMiniMap(lat, lng) {
    var el = document.getElementById('mini-map');
    var hint = document.getElementById('map-hint');
    if (!el) return;
    el.style.display = 'block';
    if (hint) hint.style.display = 'block';

    if (!miniState.map) {
      miniState.map = L.map(el, { zoomControl: true, scrollWheelZoom: false, dragging: true });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(miniState.map);
      miniState.map.on('click', function (e) {
        setMiniPin(e.latlng.lat, e.latlng.lng);
        reverseGeocodeToAddress(e.latlng.lat, e.latlng.lng);
      });
    }
    setMiniPin(lat, lng);
    miniState.map.setView([lat, lng], 15);
    setTimeout(function () { miniState.map.invalidateSize(); }, 100);
  }

  function setMiniPin(lat, lng) {
    document.getElementById('lat').value = lat;
    document.getElementById('lng').value = lng;
    if (miniState.marker) {
      miniState.marker.setLatLng([lat, lng]);
    } else {
      miniState.marker = L.marker([lat, lng], { draggable: true }).addTo(miniState.map);
      miniState.marker.on('dragend', function (e) {
        var ll = e.target.getLatLng();
        document.getElementById('lat').value = ll.lat;
        document.getElementById('lng').value = ll.lng;
        reverseGeocodeToAddress(ll.lat, ll.lng);
      });
    }
  }

  function reverseGeocodeToAddress(lat, lng) {
    var input = document.getElementById('address-input');
    if (!input) return;
    fetch('/api/geocode-reverse?lat=' + lat + '&lng=' + lng)
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok && d.display) input.value = d.display; })
      .catch(function () {});
  }

  // ------------------------------------------------------------------
  // Address autocomplete — debounced suggestions against Nominatim
  // ------------------------------------------------------------------
  function initAddressAutocomplete() {
    var input = document.getElementById('address-input');
    var dropdown = document.getElementById('address-suggest');
    if (!input || !dropdown) return;

    var debounceId;
    var activeIndex = -1;
    var items = [];

    input.addEventListener('input', function () {
      clearTimeout(debounceId);
      var q = input.value.trim();
      if (q.length < 3) { hide(); return; }
      debounceId = setTimeout(function () { runSearch(q); }, 300);
    });

    input.addEventListener('keydown', function (e) {
      if (dropdown.hidden) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(items.length - 1, activeIndex + 1);
        renderActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
        renderActive();
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        pick(items[activeIndex]);
      } else if (e.key === 'Escape') {
        hide();
      }
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== input) hide();
    });

    function runSearch(q) {
      fetch('/api/geocode-suggest?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          items = (d.results || []).slice(0, 5);
          render();
        })
        .catch(function () {});
    }

    function render() {
      dropdown.innerHTML = '';
      if (!items.length) { hide(); return; }
      items.forEach(function (it, i) {
        var li = document.createElement('li');
        li.className = 'address-suggest-item';
        li.setAttribute('role', 'option');
        li.textContent = it.display;
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          pick(it);
        });
        li.addEventListener('mouseenter', function () {
          activeIndex = i;
          renderActive();
        });
        dropdown.appendChild(li);
      });
      activeIndex = -1;
      dropdown.hidden = false;
    }

    function renderActive() {
      Array.prototype.forEach.call(dropdown.children, function (el, i) {
        el.classList.toggle('active', i === activeIndex);
      });
    }

    function pick(item) {
      input.value = item.display;
      showMiniMap(item.lat, item.lng);
      hide();
    }

    function hide() {
      dropdown.hidden = true;
      activeIndex = -1;
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
})();
