require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { IS_PROD, UPLOAD_DIR, PRODUCT_UPLOAD_DIR } = require('./config');
const { ensureAdmin, getSettings } = require('./db');
const csrf = require('./lib/csrf');
const fmt = require('./lib/format');

// Contrôles de démarrage en production : on refuse de démarrer avec une config dangereuse.
if (IS_PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24)) {
  console.error('[boutique] SESSION_SECRET est obligatoire en production (24 caractères minimum).');
  process.exit(1);
}
fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
try { ensureAdmin(); } catch (e) { console.error('[boutique] ' + e.message); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const csp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"]
};
if (IS_PROD) csp.upgradeInsecureRequests = [];
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: csp }, crossOriginEmbedderPolicy: false }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1h' : 0, index: false }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'ignore' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

app.use(session({
  name: 'aia.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-a-changer-en-production',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore({ checkPeriod: 3600000, max: 20000 }),
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 7 * 24 * 3600 * 1000 }
}));

app.use(rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.RATE_LIMIT_PER_MIN, 10) || 240, standardHeaders: true, legacyHeaders: false }));

app.use((req, res, next) => {
  res.locals.fmt = fmt;
  res.locals.settings = getSettings();
  res.locals.cartCount = Object.values((req.session && req.session.cart) || {}).reduce((s, q) => s + (parseInt(q, 10) || 0), 0);
  res.locals.path = req.path;
  res.locals.isAdmin = !!(req.session && req.session.adminId);
  res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
  res.locals.flash = null;
  if (req.session && req.session.flash) { res.locals.flash = req.session.flash; delete req.session.flash; }
  next();
});
app.use(csrf.attach);
app.use(csrf.verifyUnlessMultipart);

app.use(require('./routes/shop'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('404', { title: 'Page introuvable' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[boutique] erreur :', err);
  res.status(500).render('error', { title: 'Erreur', message: 'Une erreur est survenue. Réessayez dans un instant.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[boutique] démarrée sur http://localhost:${PORT}`));
