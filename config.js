const path = require('path');

// DATA_DIR contient la base (db.json) ET les photos produits (uploads/) :
// un seul volume persistant à monter en production.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

module.exports = {
  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  PRODUCT_UPLOAD_DIR: path.join(DATA_DIR, 'uploads', 'products'),
  IS_PROD: process.env.NODE_ENV === 'production',
  BANNER_UPLOAD_DIR: path.join(DATA_DIR, 'uploads', 'banners'),
  MAX_QTY: 20,
  PAGE_SIZE: 20 // produits par page (plus de 15)
};
