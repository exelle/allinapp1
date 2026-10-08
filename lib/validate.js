function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanMultiline(v, max) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
// Numéro marocain : 05/06/07 + 8 chiffres. Accepte +212, 00212, 212 et séparateurs.
function normalizePhone(v) {
  let p = String(v || '').replace(/[\s.\-()]/g, '');
  if (p.startsWith('+212')) p = '0' + p.slice(4);
  else if (p.startsWith('00212')) p = '0' + p.slice(5);
  else if (p.startsWith('212') && p.length === 12) p = '0' + p.slice(3);
  return /^0[5-7]\d{8}$/.test(p) ? p : null;
}
const isId = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);

const { make } = require('./i18n');
function validateClient(b, t = make('fr').t) {
  const values = {
    nom: clean(b.nom, 60),
    prenom: clean(b.prenom, 60),
    telephone: clean(b.telephone, 30),
    ville: clean(b.ville, 60),
    adresse: cleanMultiline(b.adresse, 200),
    commentaire: cleanMultiline(b.commentaire, 300)
  };
  const errors = [];
  if (!values.nom) errors.push(t('err_last'));
  if (!values.prenom) errors.push(t('err_first'));
  const tel = normalizePhone(values.telephone);
  if (!tel) errors.push(t('err_phone'));
  else values.telephone = tel;
  if (!values.ville) errors.push(t('err_city'));
  if (values.adresse.length < 8) errors.push(t('err_address'));
  return { values, errors };
}

module.exports = { clean, cleanMultiline, normalizePhone, isId, validateClient };
