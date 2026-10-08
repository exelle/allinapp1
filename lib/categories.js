// Les 5 catégories de la boutique, avec leur pictogramme (traits fins, même style que le reste de la charte).
const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const CATEGORIES = [
  { key: 'general', icon: `<svg ${A}><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>` },
  { key: 'electromenager', icon: `<svg ${A}><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13.5" r="4"/><path d="M8 6.5h2"/></svg>` },
  { key: 'gadgets', icon: `<svg ${A}><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H5a1 1 0 0 1-1-1v-4z"/><path d="M20 14h-3v5h2a1 1 0 0 0 1-1v-4z"/></svg>` },
  { key: 'parfumerie', icon: `<svg ${A}><path d="M9 3h6v3H9z"/><path d="M7 9h10v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9z"/><path d="M10 13h4"/></svg>` },
  { key: 'skincare', icon: `<svg ${A}><path d="M12 3c3 4 6 7 6 10.5A6 6 0 0 1 6 13.5C6 10 9 7 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/></svg>` }
];
const KEYS = CATEGORIES.map((c) => c.key);
// Un produit dont la catégorie est inconnue (ancienne saisie libre) est rangé dans « Achats généraux ».
const catKey = (p) => (KEYS.includes(p.categorie) ? p.categorie : 'general');
module.exports = { CATEGORIES, KEYS, catKey };
