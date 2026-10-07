const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSettings } = require('../db');
const cart = require('../lib/cart');
const orders = require('../lib/orders');
const { clean, normalizePhone, isId, validateClient } = require('../lib/validate');

const router = express.Router();
const PAGE_SIZE = 24;
const soldOut = (p) => cart.tracksStock(p) && p.stock <= 0;
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', { title: 'Trop de demandes', message: 'Trop de commandes depuis cette connexion. Réessayez plus tard.' }) });
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', { title: 'Trop de demandes', message: 'Trop de recherches. Réessayez dans quelques minutes.' }) });

// ---------- Accueil / catalogue ----------
router.get('/', (req, res) => {
  const q = clean(req.query.q, 60).toLowerCase();
  const cat = clean(req.query.cat, 60);
  let products = db.get('products').filter({ actif: true }).value();
  const categories = [...new Set(products.map((p) => p.categorie).filter(Boolean))].sort();
  if (cat) products = products.filter((p) => p.categorie === cat);
  if (q) products = products.filter((p) => `${p.nom} ${p.description || ''} ${p.categorie || ''}`.toLowerCase().includes(q));
  products = products.slice().sort((a, b) => (soldOut(a) - soldOut(b)) || (new Date(b.createdAt) - new Date(a.createdAt)));
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  res.render('shop/home', {
    title: null, description: 'Boutique en ligne All in app — paiement à la livraison.',
    products: products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: products.length,
    categories, cat, q, page, pages, soldOut
  });
});

// ---------- Fiche produit ----------
router.get('/produit/:id', (req, res) => {
  const p = isId(req.params.id) ? db.get('products').find({ id: req.params.id }).value() : null;
  if (!p || !p.actif) return res.status(404).render('404', { title: 'Produit introuvable' });
  const others = db.get('products').filter((x) => x.actif && x.id !== p.id).value()
    .filter((x) => !soldOut(x))
    .sort((a, b) => ((b.categorie === p.categorie) - (a.categorie === p.categorie)) || (new Date(b.createdAt) - new Date(a.createdAt)))
    .slice(0, 4);
  res.render('shop/product', {
    title: p.nom, description: (p.description || '').replace(/\s+/g, ' ').slice(0, 155),
    ogImage: p.photo || null, p, others, soldOut: soldOut(p), maxQty: Math.min(20, cart.tracksStock(p) ? p.stock : 20)
  });
});

// ---------- Panier ----------
router.post('/panier/ajouter', (req, res) => {
  const id = req.body.productId;
  const p = isId(id) ? db.get('products').find({ id }).value() : null;
  if (!p || !p.actif || soldOut(p)) { flash(req, 'error', 'Ce produit n’est plus disponible.'); return res.redirect('/'); }
  cart.add(req, id, Math.max(1, parseInt(req.body.qte, 10) || 1));
  const c = cart.resolve(req); // applique le plafond de stock
  if (c.notices.length) flash(req, 'error', c.notices[0]);
  else flash(req, 'ok', `« ${p.nom} » a été ajouté à votre panier.`);
  res.redirect(req.body.next === 'commande' ? '/commande' : '/produit/' + id);
});

router.get('/panier', (req, res) => {
  const c = cart.resolve(req);
  res.render('shop/cart', { title: 'Panier', c, noindex: true });
});

router.post('/panier/maj', (req, res) => {
  Object.keys(req.body).forEach((k) => {
    const m = /^q_([0-9a-f-]{36})$/.exec(k);
    if (m) cart.setQty(req, m[1], req.body[k]);
  });
  res.redirect('/panier');
});

router.post('/panier/retirer', (req, res) => {
  if (isId(req.body.productId)) cart.setQty(req, req.body.productId, 0);
  res.redirect('/panier');
});

// ---------- Commande (paiement à la livraison) ----------
router.get('/commande', (req, res) => {
  const c = cart.resolve(req);
  if (!c.lines.length) return res.redirect('/panier');
  res.render('shop/checkout', { title: 'Commande', c, values: {}, errors: c.notices, noindex: true });
});

router.post('/commande', orderLimiter, (req, res) => {
  if (req.body.website) { // champ piège : seuls les robots le remplissent
    return res.status(400).render('error', { title: 'Erreur', message: 'Votre demande n’a pas pu être traitée.' });
  }
  const c = cart.resolve(req);
  if (!c.lines.length) return res.redirect('/panier');
  const { values, errors } = validateClient(req.body);
  if (!req.body.consent) errors.push('Vous devez accepter les conditions générales de vente et la politique de confidentialité.');
  if (c.notices.length) errors.push(...c.notices, 'Vérifiez votre panier puis validez à nouveau.');
  if (errors.length) return res.status(422).render('shop/checkout', { title: 'Commande', c, values, errors, noindex: true });
  const order = orders.createOrder(c, values);
  req.session.cart = {};
  req.session.lastOrder = order.ref;
  res.redirect('/commande/confirmee/' + order.ref);
});

router.get('/commande/confirmee/:ref', (req, res) => {
  const ref = String(req.params.ref).toUpperCase();
  const order = db.get('orders').find({ ref }).value();
  // La confirmation (qui affiche l'adresse) n'est visible que par le navigateur qui vient de commander.
  if (!order || req.session.lastOrder !== ref) return res.redirect('/suivi');
  res.render('shop/confirmed', { title: 'Commande enregistrée', order, noindex: true });
});

// ---------- Suivi de commande (référence + téléphone) ----------
router.get('/suivi', (req, res) => res.render('shop/track', { title: 'Suivre ma commande', order: null, error: null, noindex: true, ref: '' }));
router.post('/suivi', trackLimiter, (req, res) => {
  const ref = clean(req.body.ref, 30).toUpperCase();
  const tel = normalizePhone(req.body.telephone);
  const order = tel ? db.get('orders').find((o) => o.ref === ref && o.client.telephone === tel).value() : null;
  if (!order) {
    return res.status(404).render('shop/track', { title: 'Suivre ma commande', order: null, ref,
      error: 'Aucune commande ne correspond à cette référence et à ce numéro.', noindex: true });
  }
  res.render('shop/track', { title: 'Suivre ma commande', order, error: null, ref, noindex: true });
});

// ---------- Pages légales ----------
const LEGAL = {
  'mentions-legales': 'Mentions légales',
  'cgv': 'Conditions générales de vente',
  'confidentialite': 'Politique de confidentialité',
  'livraison-retours': 'Livraison et retours'
};
router.get('/page/:slug', (req, res) => {
  const title = LEGAL[req.params.slug];
  if (!title) return res.status(404).render('404', { title: 'Page introuvable' });
  res.render('shop/legal', { title, slug: req.params.slug, s: getSettings() });
});

module.exports = router;
