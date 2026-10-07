# Notes pour la personne qui héberge la boutique

C'est une **application distincte** de l'application interne « confirmatrices » : nouveau dépôt Git,
nouveau service, **nouveau volume**, propre domaine.

1. Pousser ce dossier sur un dépôt GitHub privé, créer un service Railway depuis ce dépôt.
2. Ajouter un volume sur `/data` (base + photos produits).
3. Variables d'environnement : `NODE_ENV=production`, `DATA_DIR=/data`, `SESSION_SECRET`
   (≥ 24 caractères aléatoires : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`),
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
4. Le service refuse volontairement de démarrer en production si `SESSION_SECRET` ou `ADMIN_PASSWORD` est absent
   (lire les logs de démarrage en cas d'échec).
5. Générer le domaine, vérifier `https://…/` (vitrine) et `https://…/admin`.
6. Ne pas ajouter de champ `engines` dans `package.json` (cause d'échec de build Railpack constatée sur l'autre
   application) ; garder `railpack.json` et `package-lock.json`.
7. Sauvegardes : copie régulière du volume `/data`.
