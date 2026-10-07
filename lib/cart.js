const { db, getSettings } = require('../db');
const { MAX_QTY } = require('../config');

const round2 = (n) => Math.round(n * 100) / 100;
const tracksStock = (p) => p.stock !== null && p.stock !== undefined;

function shipping(sousTotal, settings) {
  if (settings.livraisonGratuiteDes > 0 && sousTotal >= settings.livraisonGratuiteDes) return 0;
  return Number(settings.fraisLivraison) || 0;
}

// Résout le panier de la session contre la base : les prix et les stocks viennent
// TOUJOURS de la base, jamais du navigateur.
function resolve(req) {
  const cart = (req.session && req.session.cart) || {};
  const settings = getSettings();
  const lines = [];
  const notices = [];
  for (const id of Object.keys(cart)) {
    const p = db.get('products').find({ id }).value();
    if (!p || !p.actif || (tracksStock(p) && p.stock <= 0)) {
      notices.push('Un article n’est plus disponible et a été retiré de votre panier.');
      delete cart[id];
      continue;
    }
    let qte = Math.min(MAX_QTY, Math.max(1, parseInt(cart[id], 10) || 1));
    if (tracksStock(p) && qte > p.stock) {
      qte = p.stock;
      notices.push(`La quantité de « ${p.nom} » a été ajustée au stock disponible (${p.stock}).`);
    }
    cart[id] = qte;
    lines.push({ product: p, qte, total: round2(p.prix * qte) });
  }
  const sousTotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const frais = lines.length ? shipping(sousTotal, settings) : 0;
  const seuil = Number(settings.livraisonGratuiteDes) || 0;
  return {
    lines, notices, sousTotal, frais, total: round2(sousTotal + frais),
    count: lines.reduce((s, l) => s + l.qte, 0),
    resteGratuit: seuil > 0 && frais > 0 ? round2(seuil - sousTotal) : 0
  };
}

function setQty(req, id, qty) {
  if (!req.session.cart) req.session.cart = {};
  const q = Math.min(MAX_QTY, parseInt(qty, 10) || 0);
  if (q <= 0) delete req.session.cart[id];
  else req.session.cart[id] = q;
}
function add(req, id, qty) {
  const current = (req.session.cart && req.session.cart[id]) || 0;
  setQty(req, id, current + (parseInt(qty, 10) || 1));
}

module.exports = { resolve, setQty, add, shipping, round2, tracksStock };
