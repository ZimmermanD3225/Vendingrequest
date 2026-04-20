(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initPrintButton();
    initConfirmForms();
    initSubmitLoadingState();
    initToast();
    initScrollReveal();
    initThemeToggle();
    initUserMenu();
    initRestockForm();
  });

  function initPrintButton() {
    var btn = document.getElementById('print-btn');
    if (btn) btn.addEventListener('click', function () { window.print(); });
  }

  function initConfirmForms() {
    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        var msg = form.getAttribute('data-confirm');
        if (!window.confirm(msg)) e.preventDefault();
      });
    });
  }

  // Disable the submit button and show a spinner while the request is in flight.
  // Plays nicely with server-rendered redirects (button re-enables on back-button nav).
  function initSubmitLoadingState() {
    document.querySelectorAll('form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        if (e.defaultPrevented) return;
        var btn = form.querySelector('button[type="submit"], button:not([type])');
        if (!btn || btn.hasAttribute('data-loading')) return;
        // Native required-field validation already cancels the submit; respect that.
        if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;
        btn.setAttribute('data-loading', '1');
        // If the browser ignores us and the form never submits, re-enable after 10s
        // so the UI isn't stuck.
        setTimeout(function () { btn.removeAttribute('data-loading'); }, 10000);
      });
    });
  }

  // Auto-dismiss any .toast on the page. Dismisses sooner on click.
  function initToast() {
    var toast = document.querySelector('.toast');
    if (!toast) return;
    var timer = setTimeout(hide, 3200);
    toast.addEventListener('click', function () {
      clearTimeout(timer);
      hide();
    });
    function hide() {
      toast.classList.add('hide');
      setTimeout(function () { toast.remove(); }, 300);
    }
  }

  // Flip between light and dark themes; persist the choice in localStorage.
  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (_) { /* private-mode etc. */ }
    });
  }

  function initRestockForm() {
    var addBtn = document.getElementById('add-restock-row');
    var container = document.getElementById('restock-items');
    if (!addBtn || !container) return;

    addBtn.addEventListener('click', function () {
      var row = document.createElement('div');
      row.className = 'restock-row';
      row.innerHTML = '<input type="text" name="item_name" placeholder="Product name" required autocomplete="off">'
        + '<input type="number" name="item_qty" placeholder="Qty" min="1" required style="width:80px;">'
        + '<button type="button" class="btn btn-sm btn-ghost restock-remove">&times;</button>';
      container.appendChild(row);
      row.querySelector('input').focus();
      updateRemoveButtons();
    });

    container.addEventListener('click', function (e) {
      if (e.target.classList.contains('restock-remove')) {
        e.target.closest('.restock-row').remove();
        updateRemoveButtons();
      }
    });

    function updateRemoveButtons() {
      var rows = container.querySelectorAll('.restock-row');
      rows.forEach(function (row, i) {
        var btn = row.querySelector('.restock-remove');
        if (btn) btn.style.display = rows.length > 1 ? '' : 'none';
      });
    }
  }

  function initUserMenu() {
    var toggle = document.getElementById('user-menu-toggle');
    var menu = toggle && toggle.closest('.user-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target)) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Fade the landing-page step cards in as they scroll into view.
  function initScrollReveal() {
    var targets = document.querySelectorAll('.step');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var idx = Array.prototype.indexOf.call(targets, el);
          el.style.transition = 'opacity .5s cubic-bezier(0.16, 1, 0.3, 1) ' + (idx * 80) + 'ms, transform .5s cubic-bezier(0.16, 1, 0.3, 1) ' + (idx * 80) + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        }
      });
    }, { threshold: 0.2 });
    targets.forEach(function (el) { io.observe(el); });
  }
})();
