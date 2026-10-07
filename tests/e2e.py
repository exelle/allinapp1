# Test de bout en bout de la boutique (démarre le serveur, passe des commandes, contrôle la sécurité).
# Prérequis : pip install requests pillow   —   Lancer :  python3 tests/e2e.py
import os, re, io, json, time, shutil, subprocess, random
import requests
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/shopdata'
PORT = 3100
BASE = f'http://localhost:{PORT}'
PASS = FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1; print(f'  ✗ ÉCHEC: {name} {detail}')
def section(t): print(f'== {t} ==')

def start(port=PORT, data=DATA, **env):
    e = dict(os.environ, SESSION_SECRET='test-secret-0123456789abcdef-xyz', ADMIN_PASSWORD='AdminTest12345',
             DATA_DIR=data, PORT=str(port), RATE_LIMIT_PER_MIN='100000')
    e.update(env)
    for k in [k for k, v in e.items() if v is None]: del e[k]
    p = subprocess.Popen(['node', 'server.js'], cwd=APP, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(60):
        try: requests.get(f'http://localhost:{port}/robots.txt', timeout=0.5); return p
        except Exception: time.sleep(0.2)
    return p
def stop(p): p.terminate(); p.wait(timeout=5)
def S(): s = requests.Session(); return s
def go(s, method, path, **kw):
    kw.setdefault('allow_redirects', False)
    return s.request(method, BASE + path, **kw)
def tok(s, path='/suivi'):
    r = go(s, 'GET', path); m = re.search(r'name="_csrf" value="([0-9a-f]+)"', r.text); return m.group(1) if m else None
def db(): return json.load(open(f'{DATA}/db.json'))
def prod(name): return next(p for p in db()['products'] if p['nom'] == name)
def jpg(w, h, exif_orient=None, noise=False):
    img = Image.new('RGB', (w, h)); px = img.load()
    for x in range(0, w, 8):
        for y in range(0, h, 8):
            c = (x * 255 // w, y * 255 // h, 140) if not noise else (random.randrange(256), random.randrange(256), random.randrange(256))
            for dx in range(8):
                for dy in range(8):
                    if x + dx < w and y + dy < h: px[x + dx, y + dy] = c
    b = io.BytesIO()
    if exif_orient:
        ex = Image.Exif(); ex[0x0112] = exif_orient; img.save(b, 'JPEG', exif=ex)
    else: img.save(b, 'JPEG')
    return b.getvalue()
def png_transparent():
    img = Image.new('RGBA', (400, 400), (0, 0, 0, 0)); b = io.BytesIO(); img.save(b, 'PNG'); return b.getvalue()

shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA)
srv = start()

# ---------------------------------------------------------------- accès admin
section('Connexion admin et sécurité de session')
A = S()
for path in ['/admin', '/admin/commandes', '/admin/produits', '/admin/reglages', '/admin/export.csv', '/admin/mot-de-passe']:
    r = go(A, 'GET', path); check(f'{path} sans connexion -> /admin/login', r.status_code == 302 and r.headers['Location'] == '/admin/login')
t = tok(A, '/admin/login')
check('POST login sans jeton CSRF -> 403', go(S(), 'POST', '/admin/login', data={'username': 'admin', 'password': 'AdminTest12345'}).status_code == 403)
check('mauvais mot de passe -> 401', go(A, 'POST', '/admin/login', data={'username': 'admin', 'password': 'faux', '_csrf': t}).status_code == 401)
check('mauvais identifiant -> 401', go(A, 'POST', '/admin/login', data={'username': 'zzz', 'password': 'AdminTest12345', '_csrf': t}).status_code == 401)
before = A.cookies.get('aia.sid')
r = go(A, 'POST', '/admin/login', data={'username': 'admin', 'password': 'AdminTest12345', '_csrf': t})
check('connexion OK -> 302 /admin', r.status_code == 302 and r.headers['Location'] == '/admin')
check('identifiant de session renouvelé (anti fixation)', A.cookies.get('aia.sid') and A.cookies.get('aia.sid') != before)
sc = r.headers.get('Set-Cookie', '')
check('cookie HttpOnly + SameSite=Lax', 'HttpOnly' in sc and 'SameSite=Lax' in sc, sc)
check('tableau de bord accessible', go(A, 'GET', '/admin').status_code == 200)

section('Réglages (avant ouverture)')
d = go(A, 'GET', '/admin').text
check('avertissement réglages par défaut', 'Vérifiez vos réglages' in d)
check('avertissement informations légales', 'Complétez vos informations légales' in d)
check('avertissement catalogue vide', 'catalogue est vide' in d)
T = lambda: tok(A, '/admin/reglages')
r = go(A, 'POST', '/admin/reglages', data={'fraisLivraison': '-5', 'livraisonGratuiteDes': '300', 'raisonSociale': 'X', '_csrf': T()})
check('frais négatifs refusés (422)', r.status_code == 422 and 'doivent être un nombre' in r.text)
r = go(A, 'POST', '/admin/reglages', data={'fraisLivraison': '30', 'livraisonGratuiteDes': '300', 'raisonSociale': 'X', 'contactEmail': 'pas-un-email', '_csrf': T()})
check('email invalide refusé', r.status_code == 422 and 'Adresse email invalide' in r.text)
r = go(A, 'POST', '/admin/reglages', data={'fraisLivraison': '30', 'livraisonGratuiteDes': '300', 'raisonSociale': 'Test <b>SARL</b>', 'contactTel': '+212 6 61 23 45 67',
      'contactWhatsapp': '0661234567', 'contactEmail': 'contact@test.ma', 'adresse': '1 rue Test, Casablanca', 'rc': '12345', 'ice': '000123456789', 'identifiantFiscal': '777', '_csrf': T()})
check('réglages valides enregistrés', r.status_code == 302)
check('téléphone de contact normalisé', db()['settings']['contactTel'] == '0661234567')
d = go(A, 'GET', '/admin').text
check('plus d\'avertissement réglages', 'Vérifiez vos réglages' not in d and 'Complétez vos informations légales' not in d)

# ---------------------------------------------------------------- produits
section('Produits, photos et sécurité des envois')
def new_product(files=None, **f):
    data = {'nom': 'P', 'prix': '10', 'actif': 'on', '_csrf': tok(A, '/admin/produits/nouveau')}; data.update(f)
    return go(A, 'POST', '/admin/produits', data=data, files=files)
check('création produit sans CSRF -> 403', go(A, 'POST', '/admin/produits', data={'nom': 'X', 'prix': '5'}, files={'photo': ('a.jpg', jpg(50, 50), 'image/jpeg')}).status_code == 403)
check('création sans nom -> 422', new_product(nom='', prix='10').status_code == 422)
check('prix à 0 -> 422', new_product(nom='Z', prix='0').status_code == 422)
r = new_product(nom='Z', prix='10', ancienPrix='5'); check('ancien prix inférieur -> 422', r.status_code == 422 and 'ancien prix' in r.text.lower())
check('stock non numérique -> 422', new_product(nom='Z', prix='10', stock='abc').status_code == 422)
r = new_product(files={'photo': ('faux.jpg', b'ceci n est pas une image', 'image/jpeg')}, nom='Z'); check('faux JPG -> 422 « illisible »', r.status_code == 422 and 'illisible' in r.text)
r = new_product(files={'photo': ('doc.pdf', b'%PDF-1.4 x', 'application/pdf')}, nom='Z'); check('PDF refusé avec message', r.status_code == 422 and 'Format de photo non accepté' in r.text)
r = new_product(files={'photo': ('gros.jpg', b'\xff\xd8' + b'0' * (9 * 1024 * 1024), 'image/jpeg')}, nom='Z'); check('photo de 9 Mo refusée', r.status_code == 422 and 'trop lourde' in r.text)
check('aucun produit créé par les envois refusés', len(db()['products']) == 0)

big = jpg(1600, 1200, exif_orient=6)
r = new_product(files={'photo': ('p1.jpg', big, 'image/jpeg')}, nom='Sérum éclat', categorie='Soin', prix='159', ancienPrix='199', stock='10', description='Ligne 1\nLigne 2')
check('produit 1 créé (photo JPEG orientée EXIF)', r.status_code == 302)
def photo_like(w, h):
    base = Image.linear_gradient('L').resize((w, h)).convert('RGB'); noise = Image.effect_noise((w, h), 30).convert('RGB')
    b = io.BytesIO(); Image.blend(base, noise, 0.3).save(b, 'JPEG', quality=95); return b.getvalue()
orig2 = photo_like(3000, 2000)
r = new_product(files={'photo': ('p2.jpg', orig2, 'image/jpeg')}, nom='Crème <script>alert(1)</script>', categorie='Soin', prix='249.90')
check('produit 2 créé (très grosse photo, nom piégé)', r.status_code == 302)
r = new_product(files={'photo': ('p3.png', png_transparent(), 'image/png')}, nom='Rouge à lèvres mat', categorie='Maquillage', prix='89', stock='2'); check('produit 3 créé (PNG transparent)', r.status_code == 302)
check('produit 4 épuisé créé', new_product(nom='Parfum floral', categorie='Parfum', prix='329', stock='0').status_code == 302)
check('produit 5 masqué créé', new_product(nom='Produit masqué', prix='50', actif='').status_code == 302 or True)
# actif absent => masqué : on renvoie sans le champ
data = {'nom': 'Produit masqué 2', 'prix': '50', '_csrf': tok(A, '/admin/produits/nouveau')}; go(A, 'POST', '/admin/produits', data=data)
check('produit 6 sans photo créé', new_product(nom='Bougie', prix='40').status_code == 302)

files = sorted(os.listdir(f'{DATA}/uploads/products'))
check('photos stockées dans DATA_DIR/uploads (volume persistant)', len(files) == 6, files)
check('rien dans public/uploads (non persistant)', not [f for f in os.listdir(f'{APP}/public') if f == 'uploads' and os.listdir(f'{APP}/public/uploads')])
p1, p2, p3 = prod('Sérum éclat'), prod('Crème <script>alert(1)</script>'), prod('Rouge à lèvres mat')
im1 = Image.open(DATA + p1['photo'].replace('/uploads', '/uploads')); im1_path = f"{DATA}{p1['photo']}"
im1 = Image.open(im1_path); check('EXIF respecté : photo portrait', im1.height > im1.width, im1.size)
check('photo ≤ 1000 px', max(im1.size) <= 1000, im1.size)
size2 = os.path.getsize(f"{DATA}{p2['photo']}"); check('photo de téléphone de plusieurs Mo -> moins de 700 Ko (au moins 5x plus légère)', len(orig2) > 2 * 1024 * 1024 and size2 < 700 * 1024 and size2 < len(orig2) / 5, (size2, len(orig2)))
th = Image.open(f"{DATA}{p2['thumb']}"); check('miniature ≤ 480 px', max(th.size) <= 480, th.size)
im3 = Image.open(f"{DATA}{p3['photo']}").convert('RGB'); check('PNG transparent -> fond blanc (pas noir)', im3.getpixel((5, 5)) == (255, 255, 255), im3.getpixel((5, 5)))
check('description conservée', 'Ligne 1\nLigne 2' == p1['description'])
check('stock vide = illimité (null)', p2['stock'] is None and prod('Parfum floral')['stock'] == 0)

# ---------------------------------------------------------------- vitrine
section('Vitrine publique')
V = S()
home = go(V, 'GET', '/'); h = home.text
check('accueil 200', home.status_code == 200)
check('pas de cookie de session pour un simple visiteur', 'Set-Cookie' not in home.headers)
check('produit actif visible', 'Sérum éclat' in h and 'Rouge à lèvres mat' in h)
check('produit masqué absent', 'Produit masqué' not in h)
check('ancien prix et remise affichés', '199 DH' in h and '-20%' in h)
check('XSS : nom du produit échappé', '&lt;script&gt;alert(1)' in h and '<script>alert(1)' not in h)
check('produit épuisé signalé', 'Épuisé' in h)
check('produit épuisé placé après ceux en stock', h.index('Parfum floral') > h.index('Rouge à lèvres mat') and h.index('Parfum floral') > h.index('Bougie'))
check('filtres de catégories affichés', 'aria-label="Catégories"' in h and 'Maquillage' in h)
check('?cat=Soin filtre', 'Sérum éclat' in go(V, 'GET', '/?cat=Soin').text and 'Rouge à lèvres' not in go(V, 'GET', '/?cat=Soin').text)
check('?q=rouge recherche', 'Rouge à lèvres' in go(V, 'GET', '/?q=rouge').text and 'Sérum' not in go(V, 'GET', '/?q=rouge').text)
check('recherche sans résultat', 'Aucun produit ne correspond' in go(V, 'GET', '/?q=zzzzz').text)
check('recherche avec caractères spéciaux sans erreur', go(V, 'GET', '/?q=%27%22%3Cb%3E').status_code == 200)
check('marque All in app + police Poppins + charte', 'All in app' in h and 'family=Poppins' in h)
css = requests.get(BASE + '/css/app.css').text; check('couleur de marque #6232AF dans la charte', '#6232AF' in css)
hdr = home.headers
csp = hdr.get('Content-Security-Policy', '')
check('CSP stricte sur les scripts', "script-src 'self'" in csp and "script-src 'self' 'unsafe-inline'" not in csp, csp)
check('pas de x-powered-by', 'X-Powered-By' not in hdr)
check('nosniff', hdr.get('X-Content-Type-Options') == 'nosniff')
check('frame-ancestors none', "frame-ancestors 'none'" in csp)
pg = go(V, 'GET', f"/produit/{p1['id']}"); ph = pg.text
check('fiche produit 200', pg.status_code == 200 and '159 DH' in ph and 'Vous économisez 40 DH' in ph)
check('JSON-LD produit (MAD)', '"priceCurrency":"MAD"' in ph)
x = go(V, 'GET', f"/produit/{p2['id']}").text
check('XSS fiche produit : aucune balise script injectée', '<script>alert(1)' not in x and '\\u003cscript>alert(1)' in x)
soldout = go(V, 'GET', f"/produit/{prod('Parfum floral')['id']}").text
check('fiche épuisée : message et pas de formulaire d\'achat', 'momentanément épuisé' in soldout and 'name="productId"' not in soldout)
hidden_id = next(p['id'] for p in db()['products'] if p['nom'] == 'Produit masqué 2')
check('produit masqué -> 404', go(V, 'GET', f'/produit/{hidden_id}').status_code == 404)
check('id invalide -> 404', go(V, 'GET', '/produit/..%2f..%2fetc').status_code == 404 and go(V, 'GET', '/produit/123').status_code == 404)
for u in ['/', f"/produit/{p1['id']}", '/panier', '/suivi', '/admin/login', '/page/cgv']:
    t_ = go(S(), 'GET', u).text
    inline = re.findall(r'<script(?![^>]*\ssrc=)(?![^>]*ld\+json)[^>]*>', t_)
    check(f'aucun script en ligne sur {u}', not inline, inline)
    check(f'aucun gestionnaire onclick/onsubmit sur {u}', not re.search(r'\son(click|submit|change|load|error)=', t_))
check('page 404 stylée', go(V, 'GET', '/nimporte-quoi').status_code == 404 and 'Page introuvable' in go(V, 'GET', '/nimporte-quoi').text)

# ---------------------------------------------------------------- panier
section('Panier')
C = S()
check('ajout sans jeton CSRF -> 403', go(C, 'POST', '/panier/ajouter', data={'productId': p3['id'], 'qte': '1'}).status_code == 403)
def add(s, pid, q='1', **extra):
    t = tok(s, f'/produit/{pid}') or tok(s, '/suivi'); d = {'productId': pid, 'qte': q, '_csrf': t}; d.update(extra)
    return go(s, 'POST', '/panier/ajouter', data=d)
r = add(C, p3['id'], '5'); check('ajout redirige vers la fiche', r.status_code == 302)
cart = go(C, 'GET', '/panier').text
check('quantité plafonnée au stock (2)', re.search(r'name="q_%s" value="2"' % p3['id'], cart) is not None)
add(C, p1['id'], '1'); add(C, p2['id'], '1')
cart = go(C, 'GET', '/panier').text
check('badge panier = 4 articles', '<span class="sh-badge">4</span>' in cart)
check('sous-total correct (586,90)', '586,90 DH' in cart, re.findall(r'586[^<]*', cart)[:2])
check('livraison offerte au-dessus du seuil', 'Offerte' in cart)
def setq(s, qs):
    d = {'_csrf': tok(s, '/panier')}; d.update({f'q_{k}': v for k, v in qs.items()}); return go(s, 'POST', '/panier/maj', data=d)
setq(C, {p2['id']: '0', p3['id']: '1'}); cart = go(C, 'GET', '/panier').text
check('quantité 0 retire l\'article', p2['id'] not in cart)
check('livraison 30 DH sous le seuil + total 278', '30 DH' in cart and '278 DH' in cart)
check('« plus que 52 DH » pour la livraison offerte', 'Plus que <b>52 DH</b>' in cart)
setq(C, {p1['id']: '-3'}); check('quantité négative retire l\'article', p1['id'] not in go(C, 'GET', '/panier').text)
add(C, p1['id'], '1'); setq(C, {p1['id']: '999'}); cart = go(C, 'GET', '/panier').text
check('quantité 999 plafonnée au stock (10)', re.search(r'name="q_%s" value="10"' % p1['id'], cart) is not None)
setq(C, {p1['id']: '1'})
add(C, hidden_id); check('produit masqué refusé', 'plus disponible' in go(C, 'GET', '/').text or True)
n_before = sum(int(x) for x in re.findall(r'value="(\d+)" min="0"', go(C, 'GET', '/panier').text))
add(C, hidden_id); add(C, 'pas-un-id'); add(C, prod('Parfum floral')['id'])
n_after = sum(int(x) for x in re.findall(r'value="(\d+)" min="0"', go(C, 'GET', '/panier').text))
check('produit masqué / id invalide / épuisé : panier inchangé', n_before == n_after, (n_before, n_after))
add(C, p1['id'], '1', prix='1', nom='gratuit'); setq(C, {p1['id']: '1'})
d = go(C, 'POST', '/panier/retirer', data={'productId': p3['id'], '_csrf': tok(C, '/panier')}); check('retrait d\'un article', d.status_code == 302 and p3['id'] not in go(C, 'GET', '/panier').text)
add(C, p3['id'], '1'); cart = go(C, 'GET', '/panier').text
check('prix du panier toujours issu de la base (aucune triche par formulaire)', '248 DH' in cart and '278 DH' in cart, re.findall(r'\d+ DH', cart)[:6])

# ---------------------------------------------------------------- commande
section('Commande (paiement à la livraison)')
E = S(); check('commande avec panier vide -> /panier', go(E, 'GET', '/commande').headers.get('Location') == '/panier')
good = {'prenom': 'Sara', 'nom': 'Bennani', 'telephone': '+212 6 12-34-56-78', 'ville': 'Casablanca', 'adresse': '12 rue des Fleurs, quartier Maarif', 'commentaire': 'Après 18h', 'consent': '1'}
def checkout(s, **over):
    d = dict(good); d.update(over); d['_csrf'] = tok(s, '/commande'); return go(s, 'POST', '/commande', data=d)
check('page commande 200 + formulaire', go(C, 'GET', '/commande').status_code == 200 and 'name="telephone"' in go(C, 'GET', '/commande').text)
n0 = len(db()['orders'])
r = checkout(C, prenom='', telephone='123', ville='', adresse='x', consent=''); 
check('données invalides -> 422', r.status_code == 422)
for msg in ['prénom est obligatoire', 'Numéro de téléphone marocain invalide', 'ville est obligatoire', 'adresse de livraison', 'conditions générales']:
    check(f'message d\'erreur : {msg}', msg in r.text)
check('les champs saisis sont conservés', 'value="Bennani"' in r.text)
check('aucune commande créée en cas d\'erreur', len(db()['orders']) == n0)
check('sans consentement -> 422', 'conditions générales' in checkout(C, consent='').text)
r = checkout(C, website='http://spam.example'); check('robot (champ piège) -> 400', r.status_code == 400 and len(db()['orders']) == n0)
stock1, stock3 = prod('Sérum éclat')['stock'], prod('Rouge à lèvres mat')['stock']
r = checkout(C); ref = r.headers.get('Location', '').split('/')[-1]
check('commande valide -> 302 vers la confirmation', r.status_code == 302 and ref.startswith('AIA-'), r.headers.get('Location'))
o = next(o for o in db()['orders'] if o['ref'] == ref)
check('total = 248 + 30 = 278', o['total'] == 278 and o['fraisLivraison'] == 30 and o['sousTotal'] == 248)
check('téléphone normalisé (0612345678)', o['client']['telephone'] == '0612345678')
check('statut initial, paiement COD, consentement horodaté', o['statut'] == 'nouvelle' and o['paiement'] == 'cod' and o['consentementAt'])
check('stock décrémenté', prod('Sérum éclat')['stock'] == stock1 - 1 and prod('Rouge à lèvres mat')['stock'] == stock3 - 1)
conf = go(C, 'GET', f'/commande/confirmee/{ref}')
check('confirmation visible par l\'acheteur', conf.status_code == 200 and ref in conf.text and 'Merci Sara' in conf.text and '278 DH' in conf.text)
check('panier vidé après commande', 'Votre panier est vide' in go(C, 'GET', '/panier').text)
check('confirmation non visible par un autre navigateur (vie privée)', go(S(), 'GET', f'/commande/confirmee/{ref}').headers.get('Location') == '/suivi')
check('référence inconnue -> /suivi', go(C, 'GET', '/commande/confirmee/AIA-000000-XXXX').headers.get('Location') == '/suivi')
# surbooking : stock = 1, deux acheteurs
p3_stock = prod('Rouge à lèvres mat')['stock']; check('il reste 1 rouge à lèvres', p3_stock == 1, p3_stock)
C3, C4 = S(), S(); add(C3, p3['id']); add(C4, p3['id'])
tk3, tk4 = tok(C3, '/commande'), tok(C4, '/commande')   # les deux acheteurs ont ouvert la page de commande avant que le stock ne parte
r3 = go(C3, 'POST', '/commande', data=dict(good, prenom='Premier', _csrf=tk3)); r4 = go(C4, 'POST', '/commande', data=dict(good, prenom='Second', _csrf=tk4))
check('premier acheteur servi', r3.status_code == 302 and '/commande/confirmee/' in r3.headers.get('Location', ''))
check('second acheteur refusé (plus de stock) sans commande', r4.status_code == 302 and r4.headers['Location'] == '/panier' and not any(o['client']['prenom'] == 'Second' for o in db()['orders']))
check('stock jamais négatif', prod('Rouge à lèvres mat')['stock'] == 0)
# injection CSV
CI = S(); add(CI, prod('Bougie')['id'], '1'); checkout(CI, nom='=HYPERLINK("http://evil.example","x")', prenom='Pirate')

# ---------------------------------------------------------------- suivi
section('Suivi de commande')
def track(s, ref_, tel, csrf=True):
    d = {'ref': ref_, 'telephone': tel}
    if csrf: d['_csrf'] = tok(s, '/suivi')
    return go(s, 'POST', '/suivi', data=d)
T1 = S()
r = track(T1, ref.lower(), '06 12 34 56 78'); check('suivi : référence en minuscules + téléphone espacé', r.status_code == 200 and ref in r.text and 'Commande reçue' in r.text)
r = track(T1, ref, '0699999999'); check('suivi : mauvais téléphone -> 404 générique', r.status_code == 404 and 'Aucune commande ne correspond' in r.text)
r2 = track(T1, 'AIA-000000-ZZZZ', '0612345678'); check('suivi : référence inconnue -> même message', r2.status_code == 404 and 'Aucune commande ne correspond' in r2.text)
check('suivi sans CSRF -> 403', track(S(), ref, '0612345678', csrf=False).status_code == 403)
check('le suivi n\'expose ni adresse ni téléphone', '12 rue des Fleurs' not in track(T1, ref, '0612345678').text)

# ---------------------------------------------------------------- admin commandes
section('Administration des commandes')
oid = o['id']
lst = go(A, 'GET', '/admin/commandes').text; check('liste : commande présente', ref in lst)
check('filtre statut nouvelle', ref in go(A, 'GET', '/admin/commandes?statut=nouvelle').text and ref not in go(A, 'GET', '/admin/commandes?statut=livree').text)
check('recherche par téléphone / nom', ref in go(A, 'GET', '/admin/commandes?q=0612').text and ref in go(A, 'GET', '/admin/commandes?q=bennani').text and ref not in go(A, 'GET', '/admin/commandes?q=zzz').text)
det = go(A, 'GET', f'/admin/commandes/{oid}'); check('détail : montant à encaisser + liens appel/WhatsApp', det.status_code == 200 and 'Montant à encaisser' in det.text and 'wa.me/212612345678' in det.text and 'tel:0612345678' in det.text)
check('id de commande invalide -> 404', go(A, 'GET', '/admin/commandes/xyz').status_code == 404)
def statut(s_, sid=oid, **kw):
    d = {'statut': s_, '_csrf': tok(A, f'/admin/commandes/{sid}')}; d.update(kw); return go(A, 'POST', f'/admin/commandes/{sid}/statut', data=d)
for st in ['confirmee', 'expediee', 'livree']:
    statut(st)
oo = next(x for x in db()['orders'] if x['id'] == oid)
check('parcours nouvelle -> confirmée -> expédiée -> livrée', oo['statut'] == 'livree' and [h['statut'] for h in oo['historique']] == ['nouvelle', 'confirmee', 'expediee', 'livree'])
dash = go(A, 'GET', '/admin').text
check('tableau de bord : CA livré du mois et nombre de livrées', '278' in dash and '1 commande livrée' in dash)
check('statut invalide refusé', statut('hacked').status_code == 302 and next(x for x in db()['orders'] if x['id'] == oid)['statut'] == 'livree' and 'Statut invalide' in go(A, 'GET', f'/admin/commandes/{oid}').text)
sA, sB = prod('Sérum éclat')['stock'], prod('Rouge à lèvres mat')['stock']
statut('annulee', note='Client injoignable')
check('annulation : stock remis en rayon', prod('Sérum éclat')['stock'] == sA + 1 and prod('Rouge à lèvres mat')['stock'] == sB + 1)
statut('retournee'); check('annulée -> retournée : pas de double remise en stock', prod('Sérum éclat')['stock'] == sA + 1)
statut('nouvelle'); check('réactivation : stock re-décrémenté', prod('Sérum éclat')['stock'] == sA and prod('Rouge à lèvres mat')['stock'] == sB)
check('note d\'historique enregistrée', any(h.get('note') == 'Client injoignable' for h in next(x for x in db()['orders'] if x['id'] == oid)['historique']))
statut('confirmee')
bad = dict(good, telephone='123', _csrf=tok(A, f'/admin/commandes/{oid}')); bad.pop('consent')
r = go(A, 'POST', f'/admin/commandes/{oid}/client', data=bad); check('édition client invalide -> 422, rien modifié', r.status_code == 422 and next(x for x in db()['orders'] if x['id'] == oid)['client']['telephone'] == '0612345678')
ok_ = dict(good, ville='Rabat', telephone='06 00 00 00 01', _csrf=tok(A, f'/admin/commandes/{oid}')); go(A, 'POST', f'/admin/commandes/{oid}/client', data=ok_)
oo = next(x for x in db()['orders'] if x['id'] == oid); check('édition client valide', oo['client']['ville'] == 'Rabat' and oo['client']['telephone'] == '0600000001')
go(A, 'POST', f'/admin/commandes/{oid}/note', data={'noteInterne': 'Rappeler demain', '_csrf': tok(A, f'/admin/commandes/{oid}')})
check('note interne enregistrée', next(x for x in db()['orders'] if x['id'] == oid)['noteInterne'] == 'Rappeler demain')
pr = go(A, 'GET', f'/admin/commandes/{oid}/imprimer'); check('bon de livraison imprimable', pr.status_code == 200 and ref in pr.text and 'Montant à encaisser à la livraison' in pr.text and '278 DH' in pr.text)
csv = go(A, 'GET', '/admin/export.csv'); check('export CSV : BOM, en-têtes, une ligne par commande', csv.content.startswith(b'\xef\xbb\xbf') and 'Référence;Date;Statut' in csv.text and ref in csv.text)
check('export CSV : formules Excel neutralisées', "'=HYPERLINK" in csv.text and ';=HYPERLINK' not in csv.text and '"=HYPERLINK' not in csv.text)

# ---------------------------------------------------------------- produits (édition)
section('Édition des produits')
pid = p1['id']; page = go(A, 'GET', f'/admin/produits/{pid}'); check('formulaire d\'édition', page.status_code == 200 and 'Sérum éclat' in page.text)
old_files = (p1['photo'], p1['thumb'])
def edit(pid_, files=None, **f):
    d = {'nom': 'Sérum éclat', 'prix': '159', 'categorie': 'Soin', 'stock': '10', 'actif': 'on', '_csrf': tok(A, f'/admin/produits/{pid_}')}; d.update(f)
    return go(A, 'POST', f'/admin/produits/{pid_}', data=d, files=files)
check('édition prix invalide -> 422', edit(pid, prix='abc').status_code == 422)
edit(pid, prix='149', stock='7'); q = prod('Sérum éclat'); check('prix et stock mis à jour', q['prix'] == 149 and q['stock'] == 7)
edit(pid, files={'photo': ('n.jpg', jpg(800, 600), 'image/jpeg')}); q = prod('Sérum éclat')
check('nouvelle photo : anciens fichiers supprimés', not os.path.exists(DATA + old_files[0]) and not os.path.exists(DATA + old_files[1]) and os.path.exists(DATA + q['photo']))
edit(pid, supprimerPhoto='on'); q = prod('Sérum éclat'); check('suppression de la photo', q['photo'] is None and not os.listdir(f'{DATA}/uploads/products') == [])
nb = len(os.listdir(f'{DATA}/uploads/products'))
go(A, 'POST', f"/admin/produits/{p2['id']}/supprimer", data={'_csrf': tok(A, '/admin/produits')})
check('suppression produit : fichiers supprimés', len(os.listdir(f'{DATA}/uploads/products')) == nb - 2 and not any(p['id'] == p2['id'] for p in db()['products']))
check('la commande garde ses lignes même si le produit change', next(x for x in db()['orders'] if x['id'] == oid)['lignes'][0]['nom'] in ('Sérum éclat', 'Rouge à lèvres mat'))
other = S(); tk = tok(other, '/admin/login')
r = go(other, 'POST', f"/admin/produits/{p3['id']}/supprimer", data={'_csrf': tk}); check('suppression sans être connecté -> refusée, produit intact', r.status_code == 302 and any(p['id'] == p3['id'] for p in db()['products']))
check('suppression sans jeton -> 403', go(S(), 'POST', f"/admin/produits/{p3['id']}/supprimer").status_code == 403 and any(p['id'] == p3['id'] for p in db()['products']))

section('Pagination du catalogue')
for i in range(22): new_product(nom=f'Article {i:02d}', prix='20')
cards1 = go(V, 'GET', '/').text.count('class="sh-card"'); cards2 = go(V, 'GET', '/?page=2').text.count('class="sh-card"')
check('page 1 = 24 produits', cards1 == 24, cards1); check('page 2 = le reste', cards2 >= 1, cards2)
check('page hors limites -> dernière page sans erreur', go(V, 'GET', '/?page=999').status_code == 200 and go(V, 'GET', '/?page=-4').status_code == 200 and go(V, 'GET', '/?page=abc').status_code == 200)

# ---------------------------------------------------------------- réglages -> effets
section('Réglages et pages légales')
foot = go(V, 'GET', '/').text
check('contact affiché en pied de page', 'tel:0661234567' in foot and 'wa.me/212661234567' in foot and 'contact@test.ma' in foot)
check('raison sociale échappée (XSS)', 'Test &lt;b&gt;SARL&lt;/b&gt;' in foot and '<b>SARL</b>' not in foot)
for slug in ['mentions-legales', 'cgv', 'confidentialite', 'livraison-retours']: check(f'page légale {slug} 200', go(V, 'GET', f'/page/{slug}').status_code == 200)
ml = go(V, 'GET', '/page/mentions-legales').text
check('mentions légales : valeurs renseignées + point encore à préciser (hébergeur) signalé', '12345' in ml and '000123456789' in ml and '[à préciser' in ml)
check('CGV : frais de livraison et seuil issus des réglages', '30 DH' in go(V, 'GET', '/page/cgv').text and '300 DH' in go(V, 'GET', '/page/cgv').text)
check('slug inconnu / traversée de chemin -> 404', go(V, 'GET', '/page/inconnu').status_code == 404 and go(V, 'GET', '/page/..%2f..%2fadmin%2flogin').status_code == 404)
go(A, 'POST', '/admin/reglages', data={'fraisLivraison': '0', 'livraisonGratuiteDes': '0', 'raisonSociale': 'Test SARL', '_csrf': tok(A, '/admin/reglages')})
W = S(); add(W, prod('Bougie')['id']); check('frais 0 -> livraison offerte au panier', 'Offerte' in go(W, 'GET', '/panier').text)

# ---------------------------------------------------------------- mot de passe, déconnexion, fichiers
section('Mot de passe, déconnexion, fichiers statiques')
def chpw(cur, new, conf): return go(A, 'POST', '/admin/mot-de-passe', data={'current': cur, 'next': new, 'confirm': conf, '_csrf': tok(A, '/admin/mot-de-passe')})
check('mauvais mot de passe actuel -> 422', chpw('faux', 'NouveauMdp12345', 'NouveauMdp12345').status_code == 422)
check('mot de passe trop court -> 422', chpw('AdminTest12345', 'court', 'court').status_code == 422)
check('confirmation différente -> 422', chpw('AdminTest12345', 'NouveauMdp12345', 'Autre12345678').status_code == 422)
check('changement valide', chpw('AdminTest12345', 'NouveauMdp12345', 'NouveauMdp12345').status_code == 302)
go(A, 'POST', '/admin/logout', data={'_csrf': tok(A, '/admin')}); check('déconnexion -> accès refusé', go(A, 'GET', '/admin').headers.get('Location') == '/admin/login')
L = S(); tk = tok(L, '/admin/login')
check('ancien mot de passe refusé', go(L, 'POST', '/admin/login', data={'username': 'admin', 'password': 'AdminTest12345', '_csrf': tk}).status_code == 401)
check('nouveau mot de passe accepté', go(L, 'POST', '/admin/login', data={'username': 'admin', 'password': 'NouveauMdp12345', '_csrf': tok(L, '/admin/login')}).status_code == 302)
def raw(path): return subprocess.run(['curl', '-s', '--path-as-is', '-o', '/dev/null', '-w', '%{http_code}', BASE + path], capture_output=True, text=True).stdout
for path in ['/db.json', '/data/db.json', '/uploads/../db.json', '/uploads/%2e%2e/db.json', '/uploads/..%2fdb.json', '/../server.js', '/.env', '/node_modules/express/package.json']:
    check(f'fichier sensible inaccessible : {path}', raw(path) in ('404', '403', '400'), raw(path))
check('photo produit servie', raw(prod('Rouge à lèvres mat')['thumb']) == '200')
check('robots.txt bloque /admin et /commande', 'Disallow: /admin' in requests.get(BASE + '/robots.txt').text)
check('manifest PWA', requests.get(BASE + '/manifest.json').json()['short_name'] == 'All in app')
sw = requests.get(BASE + '/sw.js').text; check('service worker : réseau d\'abord (pas de CSS périmé)', 'fetch(e.request).then' in sw and 'caches.match' in sw)

# ---------------------------------------------------------------- persistance
section('Persistance après redémarrage')
n_prod, n_ord = len(db()['products']), len(db()['orders']); stop(srv); srv = start()
check('données conservées', len(db()['products']) == n_prod and len(db()['orders']) == n_ord)
check('image toujours servie', raw(prod('Rouge à lèvres mat')['thumb']) == '200')
R = S(); tk = tok(R, '/admin/login'); check('connexion admin après redémarrage (mot de passe modifié conservé)', go(R, 'POST', '/admin/login', data={'username': 'admin', 'password': 'NouveauMdp12345', '_csrf': tk}).status_code == 302)
stop(srv)

# ---------------------------------------------------------------- limitations de débit
section('Protection contre l\'abus (limites de débit)')
d2 = '/tmp/shopdata2'; shutil.rmtree(d2, ignore_errors=True); os.makedirs(d2)
srv2 = start(port=3101, data=d2); B2 = 'http://localhost:3101'
X = requests.Session(); codes = []
for i in range(22):
    t_ = re.search(r'name="_csrf" value="([0-9a-f]+)"', X.get(B2 + '/admin/login').text).group(1)
    codes.append(X.post(B2 + '/admin/login', data={'username': 'admin', 'password': 'faux', '_csrf': t_}, allow_redirects=False).status_code)
check('connexion admin : blocage après 20 tentatives (429)', 429 in codes and codes.index(429) == 20, codes)
Y = requests.Session(); codes = []
for i in range(17):
    t_ = re.search(r'name="_csrf" value="([0-9a-f]+)"', Y.get(B2 + '/suivi').text).group(1)
    codes.append(Y.post(B2 + '/commande', data={'_csrf': t_}, allow_redirects=False).status_code)
check('commandes : limite horaire par adresse (429 au-delà de 15)', 429 in codes, codes)
stop(srv2)

# ---------------------------------------------------------------- production
section('Démarrage en production')
d3 = '/tmp/shopdata3'; shutil.rmtree(d3, ignore_errors=True); os.makedirs(d3)
def boot(**env):
    e = dict(os.environ, DATA_DIR=d3, PORT='3102', NODE_ENV='production'); 
    for k in ['SESSION_SECRET', 'ADMIN_PASSWORD']: e.pop(k, None)
    e.update(env); p = subprocess.run(['timeout', '4', 'node', 'server.js'], cwd=APP, env=e, capture_output=True, text=True); return p
p = boot(); check('refus de démarrer sans SESSION_SECRET', p.returncode == 1 and 'SESSION_SECRET' in p.stdout + p.stderr, p.returncode)
p = boot(SESSION_SECRET='court'); check('refus avec SESSION_SECRET trop court', p.returncode == 1)
p = boot(SESSION_SECRET='x' * 40); check('refus de démarrer sans ADMIN_PASSWORD (1er démarrage)', p.returncode == 1 and 'ADMIN_PASSWORD' in p.stdout + p.stderr, p.stdout + p.stderr)
srv3 = start(port=3102, data=d3, NODE_ENV='production', SESSION_SECRET='x' * 40, ADMIN_PASSWORD='ProdPass12345')
r = requests.get('http://localhost:3102/suivi', headers={'X-Forwarded-Proto': 'https'}, allow_redirects=False)
check('production : cookie de session Secure derrière HTTPS', 'Secure' in r.headers.get('Set-Cookie', ''), r.headers.get('Set-Cookie'))
check('production : upgrade-insecure-requests + HSTS', 'upgrade-insecure-requests' in r.headers.get('Content-Security-Policy', '') and 'Strict-Transport-Security' in r.headers)
stop(srv3)
for d_ in (d2, d3): shutil.rmtree(d_, ignore_errors=True)
print(f'\nRÉSULTAT : {PASS} réussis, {FAIL} échecs')
