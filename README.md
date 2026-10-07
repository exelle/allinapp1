# Boutique All in app — vente directe au grand public

Application web (Node.js) indépendante : vitrine e-commerce + back-office, **paiement à la
livraison uniquement**. Elle reprend le logo, la palette violette, la police Poppins légère et
l'installation sur téléphone (PWA) de l'application interne All in app, mais **n'a aucun lien
avec elle** : base de données, comptes et hébergement sont séparés.

## Ce que voient les clients
- **Accueil** : bannière, recherche, filtres par catégorie, grille de produits (prix barré et
  pastille de remise, mention « Épuisé »), pagination.
- **Fiche produit** : grande photo, description, stock restant, quantité, « Ajouter au panier »
  ou « Commander maintenant », produits similaires.
- **Panier** : quantités modifiables, livraison offerte au-delà d'un seuil (avec barre de progression).
- **Commande** : formulaire (nom, prénom, téléphone marocain, ville, adresse), case de
  consentement (CGV + confidentialité), **aucun compte à créer**.
- **Confirmation** avec référence de commande, puis **suivi** par référence + téléphone.
- Pages légales (mentions, CGV, confidentialité, livraison/retours) : **des modèles à faire valider**.

## Ce que fait l'administrateur (`/admin`)
- **Tableau de bord** : nouvelles commandes, à expédier, CA livré du mois, stock bas, alertes de configuration.
- **Commandes** : filtres par statut, recherche, détail, changement de statut avec historique
  (Nouvelle → Confirmée → Expédiée → Livrée, ou Annulée / Retournée), boutons Appeler et WhatsApp,
  modification des coordonnées, note interne, **bon de livraison imprimable** (montant à encaisser),
  export CSV. Annuler ou retourner une commande **remet le stock en rayon**.
- **Produits** : ajout / modification / suppression, photo (redimensionnée automatiquement),
  prix, ancien prix, stock (vide = illimité), visibilité, catégorie.
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
- Photos : JPG ou PNG (8 Mo max). La police Poppins est chargée depuis Google Fonts.
- **Sauvegardes** : copier régulièrement le dossier `DATA_DIR`.

## Tests
`python3 tests/e2e.py` (nécessite `pip install requests pillow`) : démarre le serveur sur un dossier
temporaire et vérifie ~200 points (parcours d'achat, stock et surbooking, sécurité, photos,
administration, persistance, démarrage en production).

## Structure
```
server.js · config.js · db.js          démarrage, chemins (DATA_DIR), base JSON
routes/shop.js · routes/admin.js       vitrine publique · back-office
lib/                                   panier, commandes (stock), images, validation, CSRF, formats
views/                                 pages EJS (shop/, admin/, partials/)
public/                                css (app.css = charte commune, shop.css = vitrine), js, logo, icônes, PWA
tests/e2e.py                           test de bout en bout
```
