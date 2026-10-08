const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { DATA_DIR, IS_PROD } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = low(new FileSync(path.join(DATA_DIR, 'db.json')));
db.defaults({ settings: {}, admins: [], products: [], orders: [], banners: [] }).write();

// Valeurs par défaut : à vérifier par l'administrateur dans « Réglages ».
const DEFAULT_SETTINGS = {
  fraisLivraison: 30,
  livraisonGratuiteDes: 300,
  contactTel: '',
  contactWhatsapp: '',
  contactEmail: '',
  raisonSociale: 'All in app',
  adresse: '',
  rc: '',
  ice: '',
  identifiantFiscal: '',
  configured: false
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...db.get('settings').value() };
}
function saveSettings(patch) {
  db.set('settings', { ...getSettings(), ...patch }).write();
}

function ensureAdmin() {
  if (db.get('admins').size().value() > 0) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (IS_PROD) throw new Error('ADMIN_PASSWORD est obligatoire en production au premier démarrage.');
    password = crypto.randomBytes(9).toString('base64url');
    console.log(`[boutique] Mot de passe admin généré : ${password} (identifiant : ${username}). Notez-le puis changez-le.`);
  }
  db.get('admins').push({
    id: uuid(), username, passwordHash: bcrypt.hashSync(password, 10), createdAt: new Date().toISOString()
  }).write();
}

module.exports = { db, getSettings, saveSettings, ensureAdmin, DEFAULT_SETTINGS };
