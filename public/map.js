(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof L === 'undefined') return;
    initFullMap();
    initMiniMap();
  });

  var TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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
      var marker = L.marker([p.lat, p.lng]).addTo(map);
      var badge = p.new_count > 0
        ? '<span style="background:#0a0a0a;color:#fff;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600">' + p.new_count + ' new</span> '
        : '';
      marker.bindPopup(
        '<div style="min-width:160px">' +
          '<strong>' + esc(p.name) + '</strong>' +
          (p.location ? '<br><span style="color:#737373;font-size:13px">' + esc(p.location) + '</span>' : '') +
          (p.address ? '<br><span style="color:#a3a3a3;font-size:12px">' + esc(p.address) + '</span>' : '') +
          '<br style="line-height:2">' + badge +
          '<a href="/machines/' + p.id + '" style="font-size:13px;font-weight:500">View machine →</a>' +
        '</div>'
      );
      bounds.push([p.lat, p.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function initMiniMap() {
    var el = document.getElementById('mini-map');
    if (!el) return;
    var latInput = document.getElementById('lat');
    var lngInput = document.getElementById('lng');
    var addressInput = document.getElementById('address-input');
    var locateBtn = document.getElementById('locate-btn');
    var map = null;
    var marker = null;

    function showMap(lat, lng) {
      el.style.display = 'block';
      if (!map) {
        map = L.map(el, { zoomControl: true, scrollWheelZoom: false, dragging: true });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
        map.on('click', function (e) {
          setPin(e.latlng.lat, e.latlng.lng);
          reverseGeocode(e.latlng.lat, e.latlng.lng);
        });
      }
      setPin(lat, lng);
      map.setView([lat, lng], 15);
    }

    function setPin(lat, lng) {
      latInput.value = lat;
      lngInput.value = lng;
      if (marker) { marker.setLatLng([lat, lng]); }
      else { marker = L.marker([lat, lng]).addTo(map); }
    }

    function reverseGeocode(lat, lng) {
      fetch('/api/geocode-reverse?lat=' + lat + '&lng=' + lng)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok && d.display && addressInput) {
            addressInput.value = d.display;
          }
        })
        .catch(function () {});
    }

    if (locateBtn) {
      locateBtn.addEventListener('click', function () {
        if (!navigator.geolocation) return;
        locateBtn.setAttribute('data-loading', '1');
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            locateBtn.removeAttribute('data-loading');
            showMap(pos.coords.latitude, pos.coords.longitude);
            reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          },
          function () {
            locateBtn.removeAttribute('data-loading');
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }

    if (addressInput) {
      var debounce;
      addressInput.addEventListener('blur', function () {
        clearTimeout(debounce);
        var q = addressInput.value.trim();
        if (q.length < 5) return;
        fetch('/api/geocode?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) showMap(d.lat, d.lng); })
          .catch(function () {});
      });
    }

    if (latInput && latInput.value && lngInput.value) {
      showMap(parseFloat(latInput.value), parseFloat(lngInput.value));
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
