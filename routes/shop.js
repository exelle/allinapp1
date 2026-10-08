const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSettings } = require('../db');
const cart = require('../lib/cart');
const orders = require('../lib/orders');
const banners = require('../lib/banners');
const { clean, normalizePhone, isId, validateClient } = require('../lib/validate');
const { CATEGORIES, KEYS, catKey } = require('../lib/categories');
const { IS_PROD, PAGE_SIZE } = require('../config');

const router = express.Router();
const soldOut = (p) => cart.tracksStock(p) && p.stock <= 0;
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const newest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
// Un bandeau « inline » différent selon la page quand plusieurs sont actifs.
const pickInline = (i) => { const l = banners.live('inline'); return l.length ? l[i % l.length] : null; };
const busy = (key) => (req, res) => res.status(429).render('error', { title: res.locals.t('too_many'), message: res.locals.t(key) });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, handler: busy('too_many_orders') });
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, handler: busy('too_many_search') });

// ---------- Choix de la langue ----------
router.get('/langue/:code', (req, res) => {
  const code = ['fr', 'ar'].includes(req.params.code) ? req.params.code : null;
  if (!code) return res.redirect('/');
  res.cookie('aia_lang', code, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' });
  const next = String(req.query.next || '/');
  // Redirection limitée aux chemins internes (jamais vers un autre site).
  res.redirect(/^\/(?![/\\])[^\r\n]*$/.test(next) && !next.startsWith('/langue') ? next : '/');
});

// ---------- Accueil : catégories, produits qui défilent, bannières, catalogue ----------
router.get('/', (req, res) => {
  const q = clean(req.query.q, 60).toLowerCase();
  const cat = KEYS.includes(req.query.cat) ? req.query.cat : '';
  let products = db.get('products').filter({ actif: true }).value();
  if (cat) products = products.filter((p) => catKey(p) === cat);
  if (q) products = products.filter((p) => `${p.nom} ${p.nomAr || ''} ${p.description || ''} ${p.descriptionAr || ''}`.toLowerCase().includes(q));
  products = products.slice().sort((a, b) => (soldOut(a) - soldOut(b)) || newest(a, b));
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const slice = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const base = '/' + ((cat || q) ? '?' + [cat ? 'cat=' + cat : '', q ? 'q=' + encodeURIComponent(q) : ''].filter(Boolean).join('&') : '');
  if (req.query.partial === '1') { // défilement automatique : le navigateur demande la page suivante (JSON)
    return res.render('partials/product_grid_items', { products: slice }, (err, html) => {
      if (err) return res.status(500).json({ error: true });
      res.json({ html, next: page < pages ? page + 1 : null });
    });
  }
  const strip = q ? [] : products.filter((p) => !soldOut(p)).sort(newest).slice(0, 18);
  res.render('shop/home', {
    title: null, description: res.locals.t('meta_desc'),
    cats: CATEGORIES, cat, q, strip, heroes: (!q && !cat && page === 1) ? banners.live('hero') : [], inline: pickInline(0),
    products: slice, total: products.length, page, pages, base, nextPage: page < pages ? page + 1 : null
  });
});

// ---------- Fiche produit ----------
router.get('/produit/:id', (req, res) => {
  const p = isId(req.params.id) ? db.get('products').find({ id: req.params.id }).value() : null;
  if (!p || !p.actif) return res.status(404).render('404', { title: res.locals.t('product_404') });
  const others = db.get('products').filter((x) => x.actif && x.id !== p.id && !soldOut(x)).value()
    .sort((a, b) => ((catKey(b) === catKey(p)) - (catKey(a) === catKey(p))) || newest(a, b)).slice(0, 4);
  res.render('shop/product', {
    title: res.locals.pn(p), description: res.locals.pd(p).replace(/\s+/g, ' ').slice(0, 155),
    ogImage: p.photo || null, p, others, soldOut: soldOut(p), ck: catKey(p), inline: pickInline(1),
    maxQty: Math.min(20, cart.tracksStock(p) ? p.stock : 20)
  });
});

// ---------- Panier ----------
router.post('/panier/ajouter', (req, res) => {
  const t = res.locals.t, id = req.body.productId;
  const p = isId(id) ? db.get('products').find({ id }).value() : null;
  if (!p || !p.actif || soldOut(p)) { flash(req, 'error', t('flash_unavailable')); return res.redirect('/'); }
  cart.add(req, id, Math.max(1, parseInt(req.body.qte, 10) || 1));
  const c = cart.resolve(req, t); // applique le plafond de stock
  if (c.notices.length) flash(req, 'error', c.notices[0]);
  else flash(req, 'ok', t('flash_added', { name: res.locals.pn(p) }));
  res.redirect(req.body.next === 'commande' ? '/commande' : '/produit/' + id);
});
router.get('/panier', (req, res) => res.render('shop/cart', { title: res.locals.t('cart_title'), c: cart.resolve(req, res.locals.t), inline: pickInline(2), noindex: true }));
router.post('/panier/maj', (req, res) => {
  Object.keys(req.body).forEach((k) => { const m = /^q_([0-9a-f-]{36})$/.exec(k); if (m) cart.setQty(req, m[1], req.body[k]); });
  res.redirect('/panier');
});
router.post('/panier/retirer', (req, res) => { if (isId(req.body.productId)) cart.setQty(req, req.body.productId, 0); res.redirect('/panier'); });

// ---------- Commande (paiement à la livraison) ----------
router.get('/commande', (req, res) => {
  const c = cart.resolve(req, res.locals.t);
  if (!c.lines.length) return res.redirect('/panier');
  res.render('shop/checkout', { title: res.locals.t('co_title'), c, values: {}, errors: c.notices, noindex: true });
});
router.post('/commande', orderLimiter, (req, res) => {
  const t = res.locals.t;
  if (req.body.website) return res.status(400).render('error', { title: t('err_title'), message: t('err_bot') }); // champ piège
  const c = cart.resolve(req, t);
  if (!c.lines.length) return res.redirect('/panier');
  const { values, errors } = validateClient(req.body, t);
  if (!req.body.consent) errors.push(t('err_consent'));
  if (c.notices.length) errors.push(...c.notices, t('err_recheck'));
  if (errors.length) return res.status(422).render('shop/checkout', { title: t('co_title'), c, values, errors, noindex: true });
  const order = orders.createOrder(c, values, res.locals.lang);
  req.session.cart = {};
  req.session.lastOrder = order.ref;
  res.redirect('/commande/confirmee/' + order.ref);
});
router.get('/commande/confirmee/:ref', (req, res) => {
  const ref = String(req.params.ref).toUpperCase();
  const order = db.get('orders').find({ ref }).value();
  // La confirmation (qui affiche l'adresse) n'est visible que par le navigateur qui vient de commander.
  if (!order || req.session.lastOrder !== ref) return res.redirect('/suivi');
  res.render('shop/confirmed', { title: res.locals.t('conf_title'), order, inline: pickInline(3), noindex: true });
});

// ---------- Suivi de commande (référence + téléphone) ----------
router.get('/suivi', (req, res) => res.render('shop/track', { title: res.locals.t('track_title'), order: null, error: null, noindex: true, ref: '' }));
router.post('/suivi', trackLimiter, (req, res) => {
  const t = res.locals.t, ref = clean(req.body.ref, 30).toUpperCase(), tel = normalizePhone(req.body.telephone);
  const order = tel ? db.get('orders').find((o) => o.ref === ref && o.client.telephone === tel).value() : null;
  if (!order) return res.status(404).render('shop/track', { title: t('track_title'), order: null, ref, error: t('track_err'), noindex: true });
  res.render('shop/track', { title: t('track_title'), order, error: null, ref, noindex: true });
});

// ---------- Pages légales ----------
const LEGAL = {
  'mentions-legales': { fr: 'Mentions légales', ar: 'الإشعارات القانونية' },
  'cgv': { fr: 'Conditions générales de vente', ar: 'شروط البيع العامة' },
  'confidentialite': { fr: 'Politique de confidentialité', ar: 'سياسة الخصوصية' },
  'livraison-retours': { fr: 'Livraison et retours', ar: 'التوصيل والإرجاع' }
};
router.get('/page/:slug', (req, res) => {
  const entry = LEGAL[req.params.slug];
  if (!entry) return res.status(404).render('404', { title: res.locals.t('e404_title') });
  res.render('shop/legal', { title: entry[res.locals.lang], slug: req.params.slug, s: getSettings() });
});

module.exports = router;
