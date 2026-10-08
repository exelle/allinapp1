// Carrousels (barre et bannières), produits qui défilent, chargement progressif du catalogue.
// Toutes les fonctions sont idempotentes ; AIA.init(racine) peut être rappelée sans risque.
(function () {
  document.documentElement.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shown = function (el) { return el.offsetParent !== null || el.getClientRects().length > 0; };

  function initCarousel(el) {
    if (el.getAttribute('data-ready')) return; el.setAttribute('data-ready', '1');
    var slides = [].slice.call(el.querySelectorAll('[data-slide]'));
    if (slides.length < 2) return;
    var dotsBox = el.querySelector('[data-dots]'), dots = [], i = 0, timer = null;
    var interval = parseInt(el.getAttribute('data-interval') || '5500', 10);
    function mark(k, on) {
      slides[k].classList.toggle('on', on); slides[k].setAttribute('aria-hidden', on ? 'false' : 'true');
      if (slides[k].tagName === 'A') slides[k].setAttribute('tabindex', on ? '0' : '-1');
      if (dots[k]) { dots[k].classList.toggle('on', on); if (on) dots[k].setAttribute('aria-current', 'true'); else dots[k].removeAttribute('aria-current'); }
    }
    function go(n) { mark(i, false); i = (n + slides.length) % slides.length; mark(i, true); }
    if (dotsBox) slides.forEach(function (s, k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sh-dot' + (k === 0 ? ' on' : '');
      b.setAttribute('aria-label', (k + 1) + ' / ' + slides.length);
      b.addEventListener('click', function () { go(k); play(); }); dotsBox.appendChild(b); dots.push(b);
    });
    slides.forEach(function (s, k) { if (k > 0 && s.tagName === 'A') s.setAttribute('tabindex', '-1'); });
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function play() { stop(); if (reduce) return; timer = setInterval(function () { if (shown(el)) go(i + 1); }, interval); }
    el.addEventListener('mouseenter', stop); el.addEventListener('mouseleave', play);
    el.addEventListener('focusin', stop); el.addEventListener('focusout', play);
    play();
  }

  function initStrip(el) {
    if (el.getAttribute('data-ready')) return; el.setAttribute('data-ready', '1');
    var track = el.querySelector('.sh-strip-track'); if (!track || !track.children.length) return;
    [].slice.call(track.children).forEach(function (it) { // copie pour une boucle sans coupure
      var c = it.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.setAttribute('inert', ''); track.appendChild(c);
    });
    var pos = 0, paused = false, resume = null, speed = 0.45; // ~27 px/s : lent et lisible
    var half = function () { return track.scrollWidth / 2; };
    function pause() { paused = true; if (resume) clearTimeout(resume); }
    function later() { if (resume) clearTimeout(resume); resume = setTimeout(function () { pos = el.scrollLeft; paused = false; }, 2500); }
    ['mouseenter', 'touchstart', 'focusin', 'pointerdown', 'wheel'].forEach(function (ev) { el.addEventListener(ev, pause, { passive: true }); });
    ['mouseleave', 'touchend', 'focusout', 'pointerup'].forEach(function (ev) { el.addEventListener(ev, later, { passive: true }); });
    el.addEventListener('scroll', function () { if (paused) { var h = half(); if (h && el.scrollLeft >= h) el.scrollLeft -= h; } }, { passive: true });
    if (reduce) return; // réglage « réduire les animations » : défilement manuel uniquement
    (function frame() {
      if (!paused && shown(el)) { pos += speed; var h = half(); if (h && pos >= h) pos -= h; el.scrollLeft = pos; }
      requestAnimationFrame(frame);
    })();
  }

  function initInfinite(grid) {
    if (grid.getAttribute('data-ready')) return; grid.setAttribute('data-ready', '1');
    var wrap = document.querySelector('[data-more]'), btn = wrap && wrap.querySelector('[data-more-btn]');
    var next = parseInt(grid.getAttribute('data-next') || '0', 10), base = grid.getAttribute('data-url') || '/', busy = false, io = null;
    if (!next || !wrap) return;
    var label = btn ? btn.textContent : '';
    function load() {
      if (busy || !next) return; busy = true;
      if (btn) { btn.disabled = true; btn.textContent = btn.getAttribute('data-loading') || '…'; }
      var url = base + (base.indexOf('?') > -1 ? '&' : '?') + 'page=' + next + '&partial=1';
      fetch(url, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          grid.insertAdjacentHTML('beforeend', d.html); next = d.next || 0; busy = false;
          if (!next) { wrap.hidden = true; if (io) io.disconnect(); } else if (btn) { btn.disabled = false; btn.textContent = label; }
        })
        .catch(function () { busy = false; if (btn) { btn.disabled = false; btn.textContent = label; } });
    }
    if (btn) btn.addEventListener('click', load);
    if ('IntersectionObserver' in window) { io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) load(); }, { rootMargin: '600px 0px' }); io.observe(wrap); }
  }

  var AIA = window.AIA = {
    init: function (root) {
      root = root || document;
      [].forEach.call(root.querySelectorAll('[data-carousel]'), initCarousel);
      [].forEach.call(root.querySelectorAll('[data-strip]'), initStrip);
      [].forEach.call(root.querySelectorAll('[data-infinite]'), initInfinite);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { AIA.init(document); });
  else AIA.init(document);
})();
