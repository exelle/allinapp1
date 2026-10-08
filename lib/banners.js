const { db } = require('../db');

const PLACEMENTS = { bar: 'Barre en haut de toutes les pages', hero: 'Grande bannière de l’accueil (défilante)', inline: 'Bandeau (accueil, fiche produit, panier, confirmation)' };
const COLORS = { violet: 'Violet', rose: 'Rose', vert: 'Vert', orange: 'Orange', bleu: 'Bleu', sombre: 'Sombre' };

// Date du jour au Maroc (AAAA-MM-JJ) : une promotion « jusqu'au 31 » reste visible toute la journée du 31.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
function statusOf(b, t = today()) {
  if (!b.actif) return 'desactivee';
  if (b.debut && b.debut > t) return 'programmee';
  if (b.fin && b.fin < t) return 'expiree';
  return 'active';
}
const isLive = (b) => statusOf(b) === 'active';
const sorted = (list) => list.slice().sort((a, b) => ((a.ordre || 0) - (b.ordre || 0)) || (new Date(a.createdAt) - new Date(b.createdAt)));
function live(placement) { return sorted(db.get('banners').value().filter((b) => b.emplacement === placement && isLive(b))); }

// Lien autorisé : chemin interne (/…) ou adresse https:// — jamais javascript:, data:, //hote…
function safeLink(v) {
  const s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  if (/^\/(?!\/)[A-Za-z0-9\-_/?=&%.#+~]*$/.test(s)) return s;
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s"'<>\\]*)?$/.test(s)) return s;
  return null;
}
const linkAttrs = (href) => (href && /^https:/.test(href) ? ' target="_blank" rel="noopener"' : '');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));

module.exports = { PLACEMENTS, COLORS, today, statusOf, isLive, live, sorted, safeLink, linkAttrs, isDate };
