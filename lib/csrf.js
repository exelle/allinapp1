const crypto = require('crypto');

// Jeton créé à la demande : une fonction (et non une valeur) est exposée aux vues, de sorte
// qu'une session n'est ouverte que si la page contient réellement un formulaire.
function attach(req, res, next) {
  res.locals.csrf = () => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    return req.session.csrf;
  };
  next();
}

function verify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const expected = String((req.session && req.session.csrf) || '');
  const ok = expected && sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) {
    return res.status(403).render('error', {
      title: 'Session expirée', message: 'Votre session a expiré. Rechargez la page et recommencez.'
    });
  }
  next();
}

// Les formulaires multipart sont vérifiés dans la route, après lecture par multer.
function verifyUnlessMultipart(req, res, next) {
  if (req.is('multipart/form-data')) return next();
  return verify(req, res, next);
}

module.exports = { attach, verify, verifyUnlessMultipart };
