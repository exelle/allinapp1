# Boutique All in app — vente directe au grand public

Application web (Node.js) indépendante : vitrine e-commerce + back-office, **paiement à la
livraison uniquement**. Elle reprend le logo, la palette violette, la police Poppins légère et
l'installation sur téléphone (PWA) de l'application interne All in app, mais **n'a aucun lien
avec elle** : base de données, comptes et hébergement sont séparés.

## Ce que voient les clients
- **Introduction** (1re visite) : logo animé et slogan *The all in one startup*, puis **choix de la langue**
  (français ou arabe). Le choix est mémorisé (cookie technique) ; un bouton dans l'en-tête permet de
  changer à tout moment. Une page partagée (ex. un produit envoyé par WhatsApp) s'ouvre sur cette page
  après le choix. Le contenu reste lisible par les moteurs de recherche derrière l'écran d'accueil.
- **Arabe** : toute la vitrine est traduite et passe en écriture de droite à gauche (police Tajawal),
  prix en « درهم », pages légales comprises. Les noms/descriptions de produits et les bannières ont un
  champ arabe ; s'il est vide, la version française s'affiche. Le back-office reste en français.
- **5 catégories en pictogrammes** en haut de l'accueil : Achats généraux, Électroménager, Gadgets,
  Parfumerie, Skincare (un clic filtre, un second clic revient à tout).
- **Produits qui défilent automatiquement** sous les catégories (« Nouveautés » : les plus récents en
  stock, de la catégorie choisie). Le défilement se met en pause au survol ou au toucher et respecte le
  réglage « réduire les animations ».
- **Catalogue de 20 produits par page** avec **chargement automatique de la suite** en descendant
  (bouton « Charger plus » en secours, pagination classique sans JavaScript). Les produits épuisés passent en dernier.
- **Bannières promotionnelles** (modifiables, voir ci-dessous) : barre en haut de toutes les pages,
  grande bannière défilante sur l'accueil, bandeau sur l'accueil, les fiches produit, le panier et la confirmation.
- Fiche produit, panier, commande (sans compte, numéro marocain vérifié, consentement), confirmation
  avec référence, suivi par référence + téléphone, pages légales (**modèles à faire valider**).

## Ce que fait l'administrateur (`/admin`)
- **Tableau de bord** : nouvelles commandes, à expédier, CA livré du mois, stock bas, alertes de configuration.
- **Commandes** : filtres par statut, recherche, détail, changement de statut avec historique
  (Nouvelle → Confirmée → Expédiée → Livrée, ou Annulée / Retournée), boutons Appeler et WhatsApp,
  modification des coordonnées, note interne, **bon de livraison imprimable** (montant à encaisser),
  export CSV. Annuler ou retourner une commande **remet le stock en rayon**.
- **Produits** : ajout / modification / suppression, photo (redimensionnée automatiquement),
  prix, ancien prix, stock (vide = illimité), visibilité, **catégorie (parmi les 5)**, **nom et description en arabe**.
- **Bannières** : créer / modifier / activer / supprimer. Pour chacune : emplacement (barre, grande bannière,
  bandeau), ordre, titre / sous-titre / bouton en français et en arabe, lien (chemin du site ou https://),
  couleur, image (JPG/PNG, redimensionnée), et **dates de début et de fin** pour programmer une promotion
  (elle apparaît et disparaît toute seule ; le dernier jour est inclus, fuseau du Maroc).
- **Réglages** : frais de livraison, seuil de livraison offerte, contact affiché, informations légales.
- **Mot de passe**.

## Installation en local
Prérequis : Node.js 18+.
```bash
npm install
cp .env.example .env      # puis remplis SESSION_SECRET et ADMIN_PASSWORD
npm start                 # http://localhost:3000   (admin : http://localhost:3000/admin)
```
Sans `ADMIN_PASSWORD`, un mot de passe aléatoire est généré et affiché une seule fois dans la console (hors production).

## Mise en ligne (Railway, comme l'application interne)
1. Dépôt GitHub **privé** + nouveau service Railway (c'est une **deuxième application**, avec son propre volume).
2. **Volume persistant** monté sur `/data` : il contient la base ET les photos des produits.
3. Variables : `NODE_ENV=production`, `DATA_DIR=/data`, `SESSION_SECRET` (≥ 24 caractères aléatoires),
   `ADMIN_USERNAME`, `ADMIN_PASSWORD` (fort). **En production, l'application refuse de démarrer** si
   `SESSION_SECRET` ou `ADMIN_PASSWORD` manque.
4. Domaine HTTPS (Railway le fournit). `railpack.json` et `package-lock.json` sont fournis : ne pas les supprimer.
5. Se connecter à `/admin`, puis **Réglages** : frais de livraison, seuil, contact, informations légales.
   Ajouter les produits et **passer une commande de test** avant l'ouverture.

## Sécurité (déjà en place)
Jeton CSRF sur tous les formulaires · politique CSP stricte (aucun script en ligne) · cookies
HttpOnly / SameSite / Secure en production · session administrateur renouvelée à la connexion ·
mots de passe hashés (bcrypt) · limites de débit (connexion admin, commandes, suivi) · champ piège
anti-robots · prix et stocks **toujours recalculés côté serveur** (aucune triche possible depuis le
navigateur) · validation des numéros marocains · photos contrôlées et ré-encodées · export CSV protégé
contre l'injection de formules · la page de confirmation n'est visible que par le navigateur qui vient
de commander · aucun accès aux fichiers de données.

## Limites actuelles (à connaître)
- **Aucune notification** de nouvelle commande (ni email, ni SMS, ni WhatsApp) : consulter le tableau
  de bord régulièrement. C'est la prochaine amélioration utile.
- **Pas de paiement en ligne** (volontaire). Si besoin plus tard : contrat avec un établissement de paiement marocain.
- Le panier est conservé en mémoire : un redémarrage du serveur vide les paniers en cours (pas les commandes).
- Base de données en fichier JSON : adaptée à un démarrage (quelques milliers de commandes) ; prévoir
  PostgreSQL si le volume grandit beaucoup.
- Photos et images de bannières : JPG ou PNG (8 Mo max). Les polices (Poppins, Tajawal pour l'arabe) sont chargées depuis Google Fonts.
- **Traductions arabes** : rédigées avec soin mais à **faire relire par un arabophone** (interface et pages légales) avant l'ouverture.
- Le défilement automatique des produits et des bannières est géré par `public/js/promo.js` (aucune bibliothèque externe).
- **Sauvegardes** : copier régulièrement le dossier `DATA_DIR`.

## Tests
`python3 tests/e2e.py` (nécessite `pip install requests pillow`) : démarre le serveur sur un dossier
temporaire et vérifie ~350 points (parcours d'achat, stock et surbooking, sécurité, photos, langues français / arabe,
catégories, défilement, chargement progressif, bannières et programmation, administration, persistance,
démarrage en production).

## Structure
```
server.js · config.js · db.js          démarrage, chemins (DATA_DIR), base JSON
routes/shop.js · routes/admin.js       vitrine publique · back-office
lib/                                   panier, commandes (stock), images, validation, CSRF, formats,
                                       i18n.js (textes FR/AR), categories.js, banners.js
views/                                 pages EJS (shop/, admin/, partials/)
public/                                css (app.css = charte commune, shop.css = vitrine), js, logo, icônes, PWA
tests/e2e.py                           test de bout en bout
```
