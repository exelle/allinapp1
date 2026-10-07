(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  // Confirmation avant action sensible : <form data-confirm="Message">
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var m = f.getAttribute && f.getAttribute('data-confirm');
    if (m && !window.confirm(m)) { e.preventDefault(); return; }
    if (f.hasAttribute && f.hasAttribute('data-once')) { // anti double-clic sur la validation de commande
      var b = f.querySelector('[type=submit]');
      if (b) setTimeout(function () { b.disabled = true; b.textContent = 'Envoi en cours…'; }, 0);
    }
  });
  document.addEventListener('click', function (e) {
    var s = e.target.closest('[data-step]');
    if (s) { // sélecteur de quantité
      var input = s.parentElement.querySelector('input[type=number]');
      var min = parseInt(input.min || '1', 10), max = parseInt(input.max || '99', 10);
      var v = (parseInt(input.value, 10) || min) + parseInt(s.getAttribute('data-step'), 10);
      input.value = Math.max(min, Math.min(max, v));
      if (input.form && input.hasAttribute('data-autosubmit')) input.form.submit();
      return;
    }
    if (e.target.closest('[data-print]')) window.print();
  });
  document.addEventListener('change', function (e) {
    var i = e.target;
    if (i.matches && i.matches('input[data-autosubmit]') && i.form) i.form.submit();
  });
})();
