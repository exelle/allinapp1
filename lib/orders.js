const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { db } = require('../db');
const { STATUTS } = require('./format');

const STATUT_KEYS = Object.keys(STATUTS);
const INACTIVE = ['annulee', 'retournee'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 (lisibilité au téléphone)

function makeRef() {
  const d = new Date();
  const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  for (;;) {
    let r = '';
    for (let i = 0; i < 4; i++) r += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const ref = `AIA-${yymmdd}-${r}`;
    if (!db.get('orders').find({ ref }).value()) return ref;
  }
}

function adjustStock(lignes, sign) {
  lignes.forEach((l) => {
    const p = db.get('products').find({ id: l.productId });
    const v = p.value();
    if (v && v.stock !== null && v.stock !== undefined) {
      p.assign({ stock: Math.max(0, v.stock + sign * l.qte) }).write();
    }
  });
}

// Crée la commande à partir d'un panier déjà résolu (prix/stock vérifiés côté serveur).
function createOrder(cart, client, lang) {
  const now = new Date().toISOString();
  const lignes = cart.lines.map((l) => ({
    productId: l.product.id, nom: l.product.nom, nomAr: l.product.nomAr || null, prix: l.product.prix, qte: l.qte, thumb: l.product.thumb || null
  }));
  const order = {
    id: uuid(), ref: makeRef(), client,
    lignes, sousTotal: cart.sousTotal, fraisLivraison: cart.frais, total: cart.total,
    paiement: 'cod', statut: 'nouvelle', lang: lang === 'ar' ? 'ar' : 'fr',
    historique: [{ statut: 'nouvelle', date: now, note: '' }],
    noteInterne: '', stockRestitue: false, consentementAt: now, createdAt: now
  };
  adjustStock(lignes, -1);
  db.get('orders').push(order).write();
  return order;
}

// Change le statut ; remet le stock en rayon si la commande est annulée/retournée.
function changeStatus(orderId, statut, note) {
  const ref = db.get('orders').find({ id: orderId });
  const o = ref.value();
  if (!o || !STATUT_KEYS.includes(statut)) return null;
  const patch = {
    statut,
    historique: [...o.historique, { statut, date: new Date().toISOString(), note: note || '' }]
  };
  const nowInactive = INACTIVE.includes(statut);
  if (nowInactive && !o.stockRestitue) { adjustStock(o.lignes, +1); patch.stockRestitue = true; }
  else if (!nowInactive && o.stockRestitue) { adjustStock(o.lignes, -1); patch.stockRestitue = false; }
  ref.assign(patch).write();
  return ref.value();
}

module.exports = { createOrder, changeStatus, STATUT_KEYS, INACTIVE };
