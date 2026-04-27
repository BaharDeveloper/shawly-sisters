# Shawly Sisters — Proje Özeti

**Yerel Konum:** `C:\Users\hacer\Desktop\proje mum`
**GitHub:** https://github.com/BaharDeveloper/shawly-sisters
**Canlı Site:** https://bahardeveloper.github.io/shawly-sisters/

---

## ✅ Tamamlanan Özellikler

### Site & İçerik
- Statik site (HTML + CSS + JS), GitHub Pages üzerinde yayında
- Marka: **Shawly Sisters** — düğün hediyelikleri ve anma keepsake'leri
- Logo + marka adı header'da, mum emoji kaldırıldı
- 3 slide hero kaydırıcı (Düğün / Bebek-Doğum Günü / Kına-Nişan)
- "Tüm Koleksiyon" en üstte, ürün grid'i + kategori filtresi
- "Kategoriye Göre Alışveriş" kartları (otomatik kategori sayımı)
- Marka özellikleri şeridi (Custom Design, Fast Shipping, Elegant Packaging, Amazon Seller)
- Hakkımızda + İletişim (e-posta + WhatsApp kartları)
- Mobil uyumlu (responsive — telefon, tablet, masaüstü)

### Çoklu Dil (i18n)
- 4 dil: 🇬🇧 EN (varsayılan) · 🇹🇷 TR · 🇩🇪 DE · 🇪🇸 ES
- Header'daki dropdown ile anlık geçiş
- Seçilen dil tarayıcıya kayıtlı kalır
- Tüm UI metinleri (nav, hero, kategoriler, features, hakkımızda, iletişim, sepet, modallar, footer) çevrilmiş
- Ürün adları + açıklamaları her dilde
- Kategori adları, varyasyon adları çevrilmiş

### Ürünler (8 ürün, products.json)
1. Pashmina Şal (29 renk) — $5.99 / 25 adet $119.99 / 50, 100 paketler
2. Renkli Doğal Sabun (9 koku) — $2.49 / paketler
3. Tırtıklı Sabun — $1.89 / paketler
4. Silindir Mum — $24.99 / 10 adet
5. Wedding Mumluk (10 renk) — $2.79, 20 Heart $11.99 / paketler
6. Çiçekli Yelpaze — $2.49 / paketler
7. Çikolata Keepsake (35-300 adet) — Amazon birebir
8. Anma Mumluğu (Memorial) — $24.99 / 10 adet
- 36 ürün görseli (urunler/ klasöründe)
- Bundle (çoklu adet) seçimi
- Varyasyonlar (renk, koku, desen, folyo)
- Amazon mağaza linki her ürünün detayında
- Para birimi: USD ($) — Amazon ile birebir

### Müşteri Deneyimi
- Ürün kartlarına tıklayınca tam ekran detay modalı (galeri + bundle picker + varyasyon pill'leri)
- Lightbox: ana görsele tıklayarak tam ekran galeri + thumbnail şeridi
- Yüzen "Sepetim" butonu (sağ alt, sayaçlı)
- Tam ekran sepet paneli, sol üstte ← geri ok (ürünler bölümüne kaydırır)
- Kayıt + Giriş (kullanıcı adı, e-posta, telefon, şifre)
- Şifremi Unuttum: e-posta + 6 haneli kod ile sıfırlama
- Hesap menüsü (kullanıcı adına tıkla)
- Kayıt zorunlu sipariş; checkout'ta tam adres + (demo) kart bilgileri
- Sipariş tamamlandığında satıcıya Gmail bildirim sekmesi açar
- "Siparişlerim" — geçmiş siparişler, durum etiketleri (Hazırlanıyor / Kargoda / Teslim), tahmini 3 iş günü teslim
- WhatsApp Yardım Al butonu (+90 536 405 16 82)

### Yönetim Paneli
- Footer'daki gizli "Yönetici Girişi" linki (kullanıcı oturumu varken otomatik gizlenir)
- Tek şifreli giriş (ilk girişte belirlenen şifre kalıcı hash olarak kaydedilir)
- Başarılı admin girişinde Gmail bildirim e-postası açılır
- 3 sekmeli panel: ➕ Yeni Ürün Oluştur · 📋 Mevcut Ürünler · 📦 Siparişler (kırmızı sayı rozeti)
- Ürün ekle/düzenle/sil
- Ürün formu: ad (200 char), kategori (önerili), fiyat (kargo dahil), açıklama (5000 char), 10 görsel, Amazon linki
- Bundle (çoklu adet) tanımlama: dinamik satırlar (etiket / adet / fiyat)
- Varyasyon tanımlama: dinamik satırlar (ad / virgülle ayrılmış seçenekler)
- 🚀 Yayınla butonu: GitHub Personal Access Token ile `products.json` otomatik repo'ya push (cihazlar arası senkronizasyon)

### Cihazlar Arası Senkronizasyon
- `products.json` repo'da, sayfa yüklenince otomatik fetch
- Çeviri alanları eksikse yayınlanmış sürümden çekilir (yerel düzenlemeler korunur)
- Yönetici "🚀 Yayınla" ile değişiklikleri herkes için yayınlar

### SEO
- Genişletilmiş title + meta description + keywords
- Open Graph (Facebook/WhatsApp/LinkedIn paylaşımı)
- Twitter Card
- Self-canonical link
- Hreflang (en + x-default)
- Görünmez `<h1>` keyword-rich brand description
- JSON-LD: Organization + WebSite + Store schemas
- robots.txt + sitemap.xml
- Favicon + apple-touch-icon
- Tüm görsellere `loading="lazy"` + width/height + decoding="async"
- Modal başlıkları `data-i18n` ile çoklu dil

---

## 📁 Dosya Yapısı

```
proje mum/
├── index.html              # Ana sayfa + tüm modallar
├── styles.css              # Tüm stiller (responsive)
├── script.js               # Site mantığı (~1800 satır)
├── products.json           # Ürün veritabanı (8 ürün, 4 dilde)
├── logo.jpg                # Shawly Sisters logosu
├── favicon.ico             # Favicon
├── robots.txt              # SEO crawler izni + sitemap referansı
├── sitemap.xml             # XML sitemap (hreflang ile)
├── README.md               # Proje açıklaması
├── PROJE_OZETI.md          # Bu dosya
├── .gitignore
└── urunler/                # Ürün görselleri (36 dosya)
    ├── pashmina/           # 5 görsel
    ├── sabun-renkli/       # 5 görsel
    ├── sabun-tirikli/      # 4 görsel
    ├── silindir-mum/       # 5 görsel
    ├── wedding-mumluk/     # 4 görsel
    ├── yelpaze/            # 4 görsel
    ├── cikolata/           # 4 görsel
    └── cenaze-mumluk/      # 4 görsel
```

---

## 🔑 Önemli Bilgiler

- **Yönetici şifresi:** Tarayıcına kayıtlı, başka bir cihazda ilk girişte yenisini belirlersin
- **GitHub PAT (Yayınla için):** İlk kullanımda GitHub'dan üretilip kaydedilir
- **Owner e-posta:** shawlysisters@gmail.com
- **WhatsApp/Telefon:** +90 536 405 16 82
- **Para birimi:** USD ($)
- **Tahmini teslim:** 3 iş günü (Cumartesi/Pazar atlanır)

---

## 🚀 Yeni Cihazda Çalışmaya Başlamak

1. Tarayıcıda **https://bahardeveloper.github.io/shawly-sisters/** aç
2. Yönetici olarak giriş için footer → "Yönetici Girişi" → şifre belirle
3. Ürün ekle / düzenle
4. **🚀 Yayınla** butonu ile GitHub'a otomatik push (PAT ile)

## 🔧 Yerel Geliştirme

```bash
cd "C:/Users/hacer/Desktop/proje mum"
# Tarayıcıda index.html'i aç
start "" "index.html"
# Değişiklik yap, sonra:
git add -A && git commit -m "..." && git push
```

---

## 📊 SEO Denetim Sonucu (27 Nisan 2026)

| Kategori | Önce | Sonra |
|---|---|---|
| `<h1>` | ❌ Yok | ✅ Görünmez, keyword-rich |
| Meta description | ❌ Yok | ✅ 238 char |
| Open Graph | ❌ Yok | ✅ 9 etiket + alternate locales |
| Twitter Card | ❌ Yok | ✅ summary_large_image |
| Canonical | ❌ Yok | ✅ Self-canonical |
| Hreflang | ❌ Yok | ✅ en + x-default |
| Schema (JSON-LD) | ❌ 0 | ✅ Organization + WebSite + Store |
| robots.txt | ❌ 404 | ✅ Allow + sitemap |
| sitemap.xml | ❌ 404 | ✅ Hreflang annotated |
| Favicon | ❌ 404 | ✅ icon + apple-touch-icon |
| Görsel `loading="lazy"` | 0 / 11 | 8 / 11 |
| Görsel boyutları | 0 / 11 | 9 / 11 |
| Modal H3 i18n | 0 etiket | 22 etiket |
| Console hatası | 1 (favicon 404) | 0 |

### Hâlâ Yapılabilecek (uzun vadeli)
- Görselleri WebP'ye dönüştür + responsive boyutlar (~25MB → ~5MB)
- Her ürün için ayrı Product schema (rich snippet için)
- Her ürün için ayrı URL (build script veya hash routing)
- Google Search Console + Bing Webmaster Tools'a kayıt
- Wedding planning içerik blog'u (uzun kuyruk anahtar kelimeler için)
