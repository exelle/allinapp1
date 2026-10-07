const mad = (n) => {
  n = Number(n) || 0;
  const hasDec = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2 }) + ' DH';
};
const date = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTime = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Statuts d'une commande (ordre logique du parcours)
const STATUTS = {
  nouvelle: 'Nouvelle',
  confirmee: 'Confirmée',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée',
  retournee: 'Retournée'
};

// "0612345678" -> "212612345678" (lien WhatsApp)
const waNumber = (tel) => '212' + String(tel || '').replace(/^0/, '');

module.exports = { mad, date, dateTime, STATUTS, waNumber };
