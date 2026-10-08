const mad = (n, lang) => {
  n = Number(n) || 0;
  const hasDec = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2 }) + (lang === 'ar' ? ' درهم' : ' DH');
};
const date = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTime = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const loc = (lang) => (lang === 'ar' ? 'ar-MA' : 'fr-FR');
const dateL = (d, lang) => new Date(d).toLocaleDateString(loc(lang), { day: '2-digit', month: 'long', year: 'numeric' });
const dateTimeL = (d, lang) => new Date(d).toLocaleString(loc(lang), { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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

module.exports = { mad, date, dateTime, dateL, dateTimeL, STATUTS, waNumber };
