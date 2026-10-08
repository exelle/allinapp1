const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { PRODUCT_UPLOAD_DIR, BANNER_UPLOAD_DIR } = require('../config');

// Redimensionne les photos : une photo de téléphone de 4 Mo devient ~80 Ko, ce qui
// compte énormément pour la vitesse du site sur mobile.
async function saveProductImage(buffer) {
  let img;
  try { img = await Jimp.read(buffer); }
  catch (e) { throw new Error('Image illisible. Utilisez un fichier JPG ou PNG valide.'); }
  img.background(0xFFFFFFFF); // PNG transparent -> fond blanc
  const base = uuid();
  const big = img.clone();
  if (big.bitmap.width > 1000 || big.bitmap.height > 1000) big.scaleToFit(1000, 1000);
  await big.quality(82).writeAsync(path.join(PRODUCT_UPLOAD_DIR, base + '.jpg'));
  const thumb = img.clone();
  if (thumb.bitmap.width > 480 || thumb.bitmap.height > 480) thumb.scaleToFit(480, 480);
  await thumb.quality(80).writeAsync(path.join(PRODUCT_UPLOAD_DIR, base + '-t.jpg'));
  return { photo: '/uploads/products/' + base + '.jpg', thumb: '/uploads/products/' + base + '-t.jpg' };
}

function removeProductImage(webPath) {
  if (!webPath) return;
  const file = path.resolve(PRODUCT_UPLOAD_DIR, path.basename(webPath));
  if (file.startsWith(path.resolve(PRODUCT_UPLOAD_DIR) + path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
}

// Bannière : largeur maximale 1600 px (la hauteur suit), fond blanc pour les PNG transparents.
async function saveBannerImage(buffer) {
  let img;
  try { img = await Jimp.read(buffer); }
  catch (e) { throw new Error('Image illisible. Utilisez un fichier JPG ou PNG valide.'); }
  img.background(0xFFFFFFFF);
  if (img.bitmap.width > 1600) img.resize(1600, Jimp.AUTO);
  const name = uuid() + '.jpg';
  fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });
  await img.quality(82).writeAsync(path.join(BANNER_UPLOAD_DIR, name));
  return { image: '/uploads/banners/' + name, width: img.bitmap.width, height: img.bitmap.height };
}
function removeBannerImage(webPath) {
  if (!webPath) return;
  const file = path.resolve(BANNER_UPLOAD_DIR, path.basename(webPath));
  if (file.startsWith(path.resolve(BANNER_UPLOAD_DIR) + path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { saveProductImage, removeProductImage, saveBannerImage, removeBannerImage };
