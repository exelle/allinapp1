const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { v4: uuid } = require('uuid');
const { db, getSettings, saveSettings } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { verify } = require('../lib/csrf');
const { clean, cleanMultiline, normalizePhone, isId, validateClient } = require('../lib/validate');
const { changeStatus, STATUT_KEYS } = require('../lib/orders');
const { saveProductImage, removeProductImage, saveBannerImage, removeBannerImage } = require('../lib/images');
const { STATUTS } = require('../lib/format');
const fmtLib = require('../lib/format');
const { make } = require('../lib/i18n');
const { CATEGORIES, KEYS: CAT_KEYS } = require('../lib/categories');
const bn = require('../lib/banners');

const router = express.Router();
// Le back-office reste toujours en français, quelle que soit la langue choisie dans la vitrine.
const FR = make('fr');
router.use((req, res, next) => {
  Object.assign(res.locals, {
    lang: 'fr', dir: 'ltr', langChosen: true, t: FR.t, th: FR.th, cats: CATEGORIES,
    mad: (n) => fmtLib.mad(n), catLabel: (k) => FR.t('cat_' + (CAT_KEYS.includes(k) ? k : 'general')), bars: []
  });
  next();
});
const DUMMY_HASH = bcrypt.hashSync('mot-de-passe-factice', 10); // égalise le temps de réponse
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('admin/login', { title: 'Connexion', noindex: true, error: 'Trop de tentatives. Réessayez dans quelques minutes.' }) });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    if (!ok) req.badFile = true;
    cb(null, ok);
  }
});
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const page = (res, view, nav, data) => res.render('admin/' + view, { nav, noindex: true, ...data });
const num = (v, def) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : def; };

// ---------- Connexion ----------
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Connexion', noindex: true, error: null });
});
router.post('/login', loginLimiter, (req, res, next) => {
  const admin = db.get('admins').find({ username: clean(req.body.username, 60).toLowerCase() }).value();
  const ok = bcrypt.compareSync(String(req.body.password || ''), admin ? admin.passwordHash : DUMMY_HASH);
  if (!admin || !ok) return res.status(401).render('admin/login', { title: 'Connexion', noindex: true, error: 'Identifiant ou mot de passe incorrect.' });
  req.session.regenerate((err) => { // nouvel identifiant de session à la connexion (anti fixation)
    if (err) return next(err);
    req.session.adminId = admin.id;
    req.session.cookie.maxAge = 8 * 3600 * 1000;
    req.session.save(() => res.redirect('/admin'));
  });
});
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireAdmin);

// ---------- Tableau de bord ----------
router.get('/', (req, res) => {
  const orders = db.get('orders').value();
  const products = db.get('products').value();
  const s = getSettings();
  const now = new Date();
  const deliveredThisMonth = orders.filter((o) => {
    if (o.statut !== 'livree') return false;
    const h = [...o.historique].reverse().find((x) => x.statut === 'livree');
    const d = new Date(h ? h.date : o.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const warnings = [];
  if (!s.configured) warnings.push({ text: 'Vérifiez vos réglages : frais de livraison et seuil de livraison offerte sont encore ceux par défaut.', link: '/admin/reglages' });
  if (!s.adresse || !s.rc || !s.ice) warnings.push({ text: 'Complétez vos informations légales (adresse, RC, ICE) : elles apparaissent dans les mentions légales et les CGV.', link: '/admin/reglages' });
  if (!products.length) warnings.push({ text: 'Votre catalogue est vide : ajoutez votre premier produit.', link: '/admin/produits/nouveau' });
  page(res, 'dashboard', 'dashboard', {
    title: 'Tableau de bord', warnings,
    kpi: {
      nouvelles: orders.filter((o) => o.statut === 'nouvelle').length,
      aExpedier: orders.filter((o) => o.statut === 'confirmee').length,
      caMois: deliveredThisMonth.reduce((t, o) => t + o.total, 0),
      livreesMois: deliveredThisMonth.length
    },
    stockBas: products.filter((p) => p.actif && p.stock !== null && p.stock !== undefined && p.stock <= 3),
    recent: orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8)
  });
});

// ---------- Commandes ----------
router.get('/commandes', (req, res) => {
  const all = db.get('orders').value();
  const statut = STATUT_KEYS.includes(req.query.statut) ? req.query.statut : '';
  const q = clean(req.query.q, 60).toLowerCase();
  const counts = { tous: all.length };
  STATUT_KEYS.forEach((k) => { counts[k] = all.filter((o) => o.statut === k).length; });
  let list = all.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (statut) list = list.filter((o) => o.statut === statut);
  if (q) list = list.filter((o) => `${o.ref} ${o.client.nom} ${o.client.prenom} ${o.client.telephone} ${o.client.ville}`.toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(list.length / 20));
  const pg = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  page(res, 'orders', 'orders', { title: 'Commandes', orders: list.slice((pg - 1) * 20, pg * 20), counts, statut, q, page: pg, pages });
});

router.get('/commandes/:id', (req, res) => {
  const order = isId(req.params.id) ? db.get('orders').find({ id: req.params.id }).value() : null;
  if (!order) return res.status(404).render('404', { title: 'Commande introuvable' });
  page(res, 'order', 'orders', { title: order.ref, order, errors: [] });
});

router.post('/commandes/:id/statut', (req, res) => {
  const statut = String(req.body.statut || '');
  const done = isId(req.params.id) && changeStatus(req.params.id, statut, cleanMultiline(req.body.note, 200));
  flash(req, done ? 'ok' : 'error', done ? `Statut mis à jour : ${STATUTS[statut]}.` : 'Statut invalide.');
  res.redirect('/admin/commandes/' + req.params.id);
});

router.post('/commandes/:id/client', (req, res) => {
  const ref = isId(req.params.id) ? db.get('orders').find({ id: req.params.id }) : null;
  if (!ref || !ref.value()) return res.redirect('/admin/commandes');
  const { values, errors } = validateClient(req.body);
  if (errors.length) { res.status(422); return page(res, 'order', 'orders', { title: ref.value().ref, order: { ...ref.value(), client: { ...ref.value().client, ...values } }, errors }); }
  ref.assign({ client: values }).write();
  flash(req, 'ok', 'Coordonnées du client mises à jour.');
  res.redirect('/admin/commandes/' + req.params.id);
});

router.post('/commandes/:id/note', (req, res) => {
  if (isId(req.params.id)) db.get('orders').find({ id: req.params.id }).assign({ noteInterne: cleanMultiline(req.body.noteInterne, 500) }).write();
  flash(req, 'ok', 'Note enregistrée.');
  res.redirect('/admin/commandes/' + req.params.id);
});

router.get('/commandes/:id/imprimer', (req, res) => {
  const order = isId(req.params.id) ? db.get('orders').find({ id: req.params.id }).value() : null;
  if (!order) return res.status(404).render('404', { title: 'Commande introuvable' });
  res.render('admin/order_print', { title: 'Bon de livraison ' + order.ref, order, noindex: true });
});

// Export CSV (les cellules commençant par = + - @ sont neutralisées : injection de formules Excel)
const csvCell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
router.get('/export.csv', (req, res) => {
  const rows = [['Référence', 'Date', 'Statut', 'Nom', 'Prénom', 'Téléphone', 'Ville', 'Adresse', 'Articles', 'Sous-total DH', 'Livraison DH', 'Total à encaisser DH']];
  db.get('orders').value().slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach((o) => {
    rows.push([o.ref, o.createdAt.slice(0, 10), STATUTS[o.statut], o.client.nom, o.client.prenom, o.client.telephone, o.client.ville,
      o.client.adresse.replace(/\n/g, ' '), o.lignes.map((l) => `${l.qte}x ${l.nom}`).join(' | '), o.sousTotal, o.fraisLivraison, o.total]);
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="commandes-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\n'));
});

// ---------- Produits ----------
const sortedProducts = () => db.get('products').value().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
router.get('/produits', (req, res) => page(res, 'products', 'products', { title: 'Produits', products: sortedProducts() }));
router.get('/produits/nouveau', (req, res) => page(res, 'product_form', 'products', { title: 'Nouveau produit', p: null, errors: [] }));

function readProductForm(b, existing) {
  const stockRaw = String(b.stock == null ? '' : b.stock).trim();
  const p = {
    nom: clean(b.nom, 100),
    categorie: b.categorie ? (CAT_KEYS.includes(b.categorie) ? b.categorie : null) : 'general',
    nomAr: clean(b.nomAr, 100),
    descriptionAr: cleanMultiline(b.descriptionAr, 2000),
    prix: num(b.prix, NaN),
    ancienPrix: String(b.ancienPrix || '').trim() === '' ? null : num(b.ancienPrix, NaN),
    stock: stockRaw === '' ? null : Math.max(0, parseInt(stockRaw, 10)),
    description: cleanMultiline(b.description, 2000),
    actif: b.actif === 'on'
  };
  const errors = [];
  if (!p.nom) errors.push('Le nom du produit est obligatoire.');
  if (p.categorie === null) errors.push('Catégorie invalide.');
  if (!Number.isFinite(p.prix) || p.prix <= 0) errors.push('Indiquez un prix valide (supérieur à 0).');
  if (p.ancienPrix !== null && (!Number.isFinite(p.ancienPrix) || p.ancienPrix <= p.prix)) errors.push('L’ancien prix doit être supérieur au prix actuel (ou laissez vide).');
  if (p.stock !== null && !Number.isFinite(p.stock)) errors.push('Le stock doit être un nombre entier (ou laissez vide : illimité).');
  return { p, errors };
}
const withUpload = (req, res, next) => upload.single('photo')(req, res, (err) => {
  if (err) { req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (8 Mo maximum).' : 'Photo refusée.'; }
  else if (req.badFile) { req.uploadError = 'Format de photo non accepté (JPG ou PNG uniquement).'; }
  next();
});

router.post('/produits', withUpload, verify, async (req, res, next) => {
  try {
    const { p, errors } = readProductForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    let img = {};
    if (!errors.length && req.file) { try { img = await saveProductImage(req.file.buffer); } catch (e) { errors.push(e.message); } }
    if (errors.length) return res.status(422).render('admin/product_form', { title: 'Nouveau produit', nav: 'products', noindex: true, p: { ...p, id: null }, errors });
    db.get('products').push({ id: uuid(), ...p, photo: img.photo || null, thumb: img.thumb || null, createdAt: new Date().toISOString() }).write();
    flash(req, 'ok', 'Produit ajouté.');
    res.redirect('/admin/produits');
  } catch (e) { next(e); }
});

router.get('/produits/:id', (req, res) => {
  const p = isId(req.params.id) ? db.get('products').find({ id: req.params.id }).value() : null;
  if (!p) return res.status(404).render('404', { title: 'Produit introuvable' });
  page(res, 'product_form', 'products', { title: 'Modifier ' + p.nom, p, errors: [] });
});

router.post('/produits/:id', withUpload, verify, async (req, res, next) => {
  try {
    const ref = isId(req.params.id) ? db.get('products').find({ id: req.params.id }) : null;
    const cur = ref && ref.value();
    if (!cur) return res.status(404).render('404', { title: 'Produit introuvable' });
    const { p, errors } = readProductForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    let img = null;
    if (!errors.length && req.file) { try { img = await saveProductImage(req.file.buffer); } catch (e) { errors.push(e.message); } }
    if (errors.length) return res.status(422).render('admin/product_form', { title: 'Modifier ' + cur.nom, nav: 'products', noindex: true, p: { ...cur, ...p }, errors });
    let photo = cur.photo, thumb = cur.thumb;
    if (img) { removeProductImage(cur.photo); removeProductImage(cur.thumb); photo = img.photo; thumb = img.thumb; }
    else if (req.body.supprimerPhoto === 'on') { removeProductImage(cur.photo); removeProductImage(cur.thumb); photo = null; thumb = null; }
    ref.assign({ ...p, photo, thumb }).write();
    flash(req, 'ok', 'Produit mis à jour.');
    res.redirect('/admin/produits');
  } catch (e) { next(e); }
});

router.post('/produits/:id/supprimer', (req, res) => {
  const cur = isId(req.params.id) ? db.get('products').find({ id: req.params.id }).value() : null;
  if (cur) { removeProductImage(cur.photo); removeProductImage(cur.thumb); db.get('products').remove({ id: cur.id }).write(); flash(req, 'ok', 'Produit supprimé.'); }
  res.redirect('/admin/produits');
});

// ---------- Bannières promotionnelles ----------
const bannerList = () => bn.sorted(db.get('banners').value()).sort((a, b) => a.emplacement.localeCompare(b.emplacement));
const withBannerUpload = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (8 Mo maximum).' : 'Image refusée.';
  else if (req.badFile) req.uploadError = 'Format d’image non accepté (JPG ou PNG uniquement).';
  next();
});
function readBannerForm(b) {
  const lien = b.lien && String(b.lien).trim() ? bn.safeLink(b.lien) : '';
  const v = {
    emplacement: bn.PLACEMENTS[b.emplacement] ? b.emplacement : null,
    titre: clean(b.titre, 90), titreAr: clean(b.titreAr, 90),
    sousTitre: clean(b.sousTitre, 140), sousTitreAr: clean(b.sousTitreAr, 140),
    bouton: clean(b.bouton, 30), boutonAr: clean(b.boutonAr, 30),
    lien, couleur: bn.COLORS[b.couleur] ? b.couleur : 'violet',
    ordre: Math.min(999, Math.max(0, parseInt(b.ordre, 10) || 0)),
    actif: b.actif === 'on', debut: clean(b.debut, 10), fin: clean(b.fin, 10)
  };
  const errors = [];
  if (!v.emplacement) errors.push('Choisissez un emplacement.');
  if (!v.titre) errors.push('Le titre (français) est obligatoire.');
  if (lien === null) errors.push('Lien invalide : utilisez un chemin du site (exemple : /?cat=skincare) ou une adresse commençant par https://.');
  if (v.debut && !bn.isDate(v.debut)) errors.push('Date de début invalide.');
  if (v.fin && !bn.isDate(v.fin)) errors.push('Date de fin invalide.');
  if (v.debut && v.fin && bn.isDate(v.debut) && bn.isDate(v.fin) && v.fin < v.debut) errors.push('La date de fin doit être postérieure à la date de début.');
  return { v: { ...v, lien: lien || '' }, errors };
}
const bannerView = (res, status, title, b, errors) => res.status(status).render('admin/banner_form', { title, nav: 'banners', noindex: true, b, errors, placements: bn.PLACEMENTS, colors: bn.COLORS });

router.get('/bannieres', (req, res) => {
  const list = bannerList().map((b) => ({ ...b, statut: bn.statusOf(b) }));
  page(res, 'banners', 'banners', { title: 'Bannières', banners: list, placements: bn.PLACEMENTS });
});
router.get('/bannieres/nouveau', (req, res) => bannerView(res, 200, 'Nouvelle bannière', { emplacement: 'hero', couleur: 'violet', actif: true, ordre: 0 }, []));
router.post('/bannieres', withBannerUpload, verify, async (req, res, next) => {
  try {
    const { v, errors } = readBannerForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    let img = {};
    if (!errors.length && req.file && v.emplacement !== 'bar') { try { img = await saveBannerImage(req.file.buffer); } catch (e) { errors.push(e.message); } }
    if (errors.length) return bannerView(res, 422, 'Nouvelle bannière', { ...v, id: null }, errors);
    db.get('banners').push({ id: uuid(), ...v, image: img.image || null, createdAt: new Date().toISOString() }).write();
    flash(req, 'ok', 'Bannière ajoutée.');
    res.redirect('/admin/bannieres');
  } catch (e) { next(e); }
});
router.get('/bannieres/:id', (req, res) => {
  const b = isId(req.params.id) ? db.get('banners').find({ id: req.params.id }).value() : null;
  if (!b) return res.status(404).render('404', { title: 'Bannière introuvable' });
  bannerView(res, 200, 'Modifier la bannière', b, []);
});
router.post('/bannieres/:id', withBannerUpload, verify, async (req, res, next) => {
  try {
    const ref = isId(req.params.id) ? db.get('banners').find({ id: req.params.id }) : null;
    const cur = ref && ref.value();
    if (!cur) return res.status(404).render('404', { title: 'Bannière introuvable' });
    const { v, errors } = readBannerForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    let img = null;
    if (!errors.length && req.file && v.emplacement !== 'bar') { try { img = await saveBannerImage(req.file.buffer); } catch (e) { errors.push(e.message); } }
    if (errors.length) return bannerView(res, 422, 'Modifier la bannière', { ...cur, ...v }, errors);
    let image = cur.image;
    if (img) { removeBannerImage(cur.image); image = img.image; }
    else if (req.body.supprimerImage === 'on' || v.emplacement === 'bar') { removeBannerImage(cur.image); image = null; }
    ref.assign({ ...v, image }).write();
    flash(req, 'ok', 'Bannière mise à jour.');
    res.redirect('/admin/bannieres');
  } catch (e) { next(e); }
});
router.post('/bannieres/:id/basculer', (req, res) => {
  const ref = isId(req.params.id) ? db.get('banners').find({ id: req.params.id }) : null;
  if (ref && ref.value()) { ref.assign({ actif: !ref.value().actif }).write(); flash(req, 'ok', ref.value().actif ? 'Bannière activée.' : 'Bannière désactivée.'); }
  res.redirect('/admin/bannieres');
});
router.post('/bannieres/:id/supprimer', (req, res) => {
  const cur = isId(req.params.id) ? db.get('banners').find({ id: req.params.id }).value() : null;
  if (cur) { removeBannerImage(cur.image); db.get('banners').remove({ id: cur.id }).write(); flash(req, 'ok', 'Bannière supprimée.'); }
  res.redirect('/admin/bannieres');
});

// ---------- Réglages ----------
router.get('/reglages', (req, res) => page(res, 'settings', 'settings', { title: 'Réglages', s: getSettings(), errors: [] }));
router.post('/reglages', (req, res) => {
  const b = req.body;
  const patch = {
    fraisLivraison: num(b.fraisLivraison, NaN),
    livraisonGratuiteDes: num(b.livraisonGratuiteDes, NaN),
    contactTel: clean(b.contactTel, 30),
    contactWhatsapp: clean(b.contactWhatsapp, 30),
    contactEmail: clean(b.contactEmail, 80),
    raisonSociale: clean(b.raisonSociale, 100),
    adresse: cleanMultiline(b.adresse, 200),
    rc: clean(b.rc, 40), ice: clean(b.ice, 40), identifiantFiscal: clean(b.identifiantFiscal, 40)
  };
  const errors = [];
  if (!Number.isFinite(patch.fraisLivraison)) errors.push('Les frais de livraison doivent être un nombre (0 pour livraison gratuite).');
  if (!Number.isFinite(patch.livraisonGratuiteDes)) errors.push('Le seuil de livraison offerte doit être un nombre (0 pour le désactiver).');
  if (patch.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.contactEmail)) errors.push('Adresse email invalide.');
  if (patch.contactTel && !normalizePhone(patch.contactTel)) errors.push('Téléphone invalide (numéro marocain attendu).');
  if (patch.contactWhatsapp && !normalizePhone(patch.contactWhatsapp)) errors.push('Numéro WhatsApp invalide (numéro marocain attendu).');
  if (!patch.raisonSociale) errors.push('La raison sociale est obligatoire.');
  if (errors.length) return res.status(422).render('admin/settings', { title: 'Réglages', nav: 'settings', noindex: true, s: { ...getSettings(), ...patch }, errors });
  patch.contactTel = patch.contactTel ? normalizePhone(patch.contactTel) : '';
  patch.contactWhatsapp = patch.contactWhatsapp ? normalizePhone(patch.contactWhatsapp) : '';
  saveSettings({ ...patch, configured: true });
  flash(req, 'ok', 'Réglages enregistrés.');
  res.redirect('/admin/reglages');
});

// ---------- Mot de passe ----------
router.get('/mot-de-passe', (req, res) => page(res, 'password', 'password', { title: 'Mot de passe', error: null }));
router.post('/mot-de-passe', (req, res) => {
  const admin = db.get('admins').find({ id: req.session.adminId });
  const a = admin.value();
  const { current, next, confirm } = { current: String(req.body.current || ''), next: String(req.body.next || ''), confirm: String(req.body.confirm || '') };
  let error = null;
  if (!a || !bcrypt.compareSync(current, a.passwordHash)) error = 'Mot de passe actuel incorrect.';
  else if (next.length < 10) error = 'Le nouveau mot de passe doit faire au moins 10 caractères.';
  else if (next !== confirm) error = 'Les deux mots de passe ne correspondent pas.';
  if (error) return res.status(422).render('admin/password', { title: 'Mot de passe', nav: 'password', noindex: true, error });
  admin.assign({ passwordHash: bcrypt.hashSync(next, 10) }).write();
  flash(req, 'ok', 'Mot de passe mis à jour.');
  res.redirect('/admin/mot-de-passe');
});

module.exports = router;
