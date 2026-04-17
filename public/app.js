document.addEventListener('DOMContentLoaded', function () {
  var printBtn = document.getElementById('print-btn');
  if (printBtn) {
    printBtn.addEventListener('click', function () { window.print(); });
  }

  // Any form with [data-confirm="..."] shows a native confirm() on submit.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var msg = form.getAttribute('data-confirm');
      if (!window.confirm(msg)) e.preventDefault();
    });
  });
});
