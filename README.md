<div align="center">

# ⌨️ Ctrl2Phone

**Double-tap Ctrl → Select area → Send to Gemini or your Phone**

*Çift Ctrl → Alan seç → Gemini'a veya Telefonuna gönder*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://www.electronjs.org/)
[![Flutter](https://img.shields.io/badge/Flutter-Mobile_App-02569B?logo=flutter)](https://flutter.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Storage-3ECF8E?logo=supabase)](https://supabase.com/)

<br>
<img src="assets/demo_preview.png" alt="Ctrl2Phone Mockup" width="70%">

</div>

---


## 🇬🇧 English

### What is Ctrl2Phone?

Ctrl2Phone is an open-source desktop + mobile system that lets you:

1. **Double-tap Left Ctrl** to freeze your screen
2. **Draw a selection** with your mouse
3. **Press X** → Paste it directly into Gemini Web
4. **Press M** → Send it to your phone's gallery via Supabase

No cloud accounts needed on our side — **you bring your own Supabase** (free tier works perfectly).

### ✨ Features

| Feature | Description |
|---|---|
| 🖥️ **Instant Screen Freeze** | Double Ctrl captures your display in <30ms (RAM-based, no disk write) |
| ✂️ **Pixel-Perfect Selection** | Draw any rectangle, multi-monitor aware |
| 🤖 **Multi-provider AI** | Press X to send the selection to Gemini, Claude, OpenAI or a local model — or paste into Gemini Web (default, no key needed) |
| 📱 **Phone Sync** | Press M to upload to Supabase → open mobile app → image in your gallery |
| 📋 **Universal Clipboard** | Sync clipboard text/links bidirectionally: PC-to-Phone (Ctrl+Shift+V / button) and Phone-to-PC (FAB button) |
| 📷 **QR Setup** | Scan QR code from desktop app to configure mobile app instantly |
| 🔒 **Privacy First** | Your keys, your storage. No third-party servers. Fully open source |
| 🌐 **English / Türkçe UI** | Interface language follows your OS by default; switch EN/TR in settings |
| 🎯 **Smart Key Blocking** | Hotkeys only intercept when selection overlay is active (won't mute YouTube!) |
| 🖼️ **Lossless PNG** | Screenshots uploaded in full PNG quality |

### 🏗️ Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Desktop App    │     │     Supabase      │     │   Mobile App     │
│   (Electron)     │────▶│   Storage Bucket  │◀────│   (Flutter)      │
│                  │     │                   │     │                  │
│ • C# Key Hook   │     │ • PNG files       │     │ • QR Scanner     │
│ • Screen Capture │     │ • Signed URLs     │     │ • Gallery Save   │
│ • Gemini Paste   │     │ • Free tier OK    │     │ • Auto Download  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### 📥 Downloads

You can download the pre-compiled installer for Windows (`.exe`) and the Android application (`.apk`) directly from Google Drive:
👉 **[Download Ctrl2Phone (Windows & Android)](https://drive.google.com/drive/u/0/folders/1ux5WS0Wt8KEGsiJrXqTOhdoDFR1wMANM)**

### 🚀 Quick Start

#### Desktop App

```bash
# Clone the repo
git clone https://github.com/1lord0/ctrl2phone.git
cd ctrl2phone/desktop

# Install dependencies
npm install

# Run
npm start
```

1. Enter your **Supabase URL**, **Anon Key**, and **Bucket Name** in the settings panel
2. Click **"Ayarları kaydet"** (Save Settings)
3. Double-tap **Left Ctrl** anywhere → draw selection → **X** (Gemini) or **M** (Phone)

#### Mobile App (Flutter)

```bash
cd ctrl2phone/mobile
flutter pub get
flutter run
```

1. Open the app → tap **QR Scan** in settings
2. Scan the QR code shown on the desktop app
3. Browse and download your screenshots to your gallery

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` `Ctrl` (double tap) | Open selection overlay |
| `X` or `Enter` | Send selection to your AI provider (Gemini web by default; or Gemini/Claude/OpenAI/local API with the reply shown in-app) |
| `M` | Upload selection to Supabase (→ Phone) |
| `Ctrl + Shift + V` | Send your PC clipboard text/link to your phone instantly (works globally) |
| `Esc` | Cancel selection |
| `Q` | Quit application |

> The **trigger key** (Left Ctrl by default — choose Left/Right Ctrl, Alt or Shift) and the **double-tap window** (ms) are configurable in the desktop app settings.

### 🤖 AI Providers

Pressing **X** sends the selected region to whichever backend you pick in **Settings → AI provider**:

| Provider | Needs a key? | Notes |
|---|---|---|
| **Gemini (web)** | No | Default. Pastes the crop into `gemini.google.com` in a built-in window |
| **Gemini API** | Yes | Google AI Studio key; reply shown in-app |
| **Claude API** | Yes | Anthropic key; defaults to `claude-opus-4-8`, reply shown in-app |
| **OpenAI API** | Yes | OpenAI key; defaults to `gpt-4o`, reply shown in-app |
| **Custom (OpenAI-compatible)** | Optional | Point the **base URL** at a local server (Ollama, LM Studio) or a gateway (OpenRouter) |

Your API key is stored **encrypted on your device** (Electron `safeStorage`) and is sent only to the provider you choose. With any API provider the model's reply appears directly in the app's response pane — no browser needed. The prompt note (top of settings) is sent alongside the image.

### 📋 Prerequisites

- **Node.js** 18+ and **npm**
- **Windows 10/11** (C# key listener is Windows-only)
- **Supabase** account (free tier: [supabase.com](https://supabase.com))
- **Flutter** 3.x (for mobile app)

### 🔨 Building the C# Key Listener

There are **two** small C# Windows helpers that must be compiled before running:

- `key_listener.exe` — the global double-Ctrl hotkey listener.
- `photo_dropper.exe` — the floating drag-and-drop panel shown when a photo arrives from your phone. **If you skip this, phone→PC sync still copies the image to your clipboard, but the panel won't appear.**

```powershell
# From the desktop/src directory
cd ctrl2phone/desktop/src

# Using csc (C# compiler) — included with Windows SDK or Visual Studio
csc /target:winexe /out:key_listener.exe key_listener.cs
csc /target:winexe /out:photo_dropper.exe photo_dropper.cs
```

> ⚠️ **Do not commit `key_listener.exe` / `photo_dropper.exe` to Git.** They are already listed in `.gitignore`.

### 🔒 Security Notes

- **Use your Supabase Anon Key**, never the Service Key. The Service Key bypasses Row Level Security (RLS) and must never be put into a client app or a QR code.
- **Run the one-time security setup.** In the desktop app click the **🔒 Secure Setup (RLS)** button (labeled *"Güvenli Kurulum…"*): it copies a SQL snippet and opens your Supabase SQL Editor — paste it and press **Run**. It makes your bucket **private** and scopes the anon key to *only* that bucket.
- The app reads images through **short-lived signed URLs** (not permanent public links), so the gallery keeps working after the bucket is private, and there is no forever-public handle to your screenshots. Filenames are random UUIDs, so they can't be enumerated.
- ⚠️ **Until you run the setup SQL the bucket is PUBLIC** — anyone who learns your project URL + bucket name can read every screenshot. Treat the pairing QR code (which carries your anon key) like a password.
- 📄 For assets, trust boundaries, attacker scenarios and residual risks, see the [**Threat Model**](docs/THREAT_MODEL.md).

<details><summary>The SQL the button runs (for bucket <code>screenshots</code>)</summary>

```sql
update storage.buckets set public = false where name = 'screenshots';

create policy "ctrl2phone_select_screenshots" on storage.objects
  for select to anon, authenticated using (bucket_id = 'screenshots');
create policy "ctrl2phone_insert_screenshots" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'screenshots');
create policy "ctrl2phone_update_screenshots" on storage.objects
  for update to anon, authenticated using (bucket_id = 'screenshots') with check (bucket_id = 'screenshots');
create policy "ctrl2phone_delete_screenshots" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'screenshots');

-- Realtime push (instant phone↔PC sync instead of polling) — best-effort.
-- 'storage' is a private schema, so anon needs a table GRANT (not just RLS) to
-- receive change events. Both steps are non-fatal: if your role lacks permission
-- they're skipped (NOTICE) without rolling back the policies above — enable
-- storage.objects under Database → Publications in the dashboard instead.
do $$ begin
  grant select on storage.objects to anon, authenticated;
exception when others then raise notice 'grant skipped: %', sqlerrm; end $$;
do $$ begin
  alter publication supabase_realtime add table storage.objects;
exception when others then raise notice 'publication skipped: %', sqlerrm; end $$;
```
The in-app button generates this for *your* actual bucket name. See [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
</details>

### 🔧 Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Storage** → Create a new bucket (e.g., `screenshots`)
3. Copy your **Project URL** and **anon key** from Settings → API
4. Paste them into the Ctrl2Phone desktop app and click **Save settings**
5. Click **🔒 Secure Setup (RLS)** and run the SQL it copies — this makes the bucket **private** and locks the anon key to this one bucket (see [Security Notes](#-security-notes))

> ⚠️ Older versions told you to make the bucket **Public**. Don't — run the Secure Setup instead. The app reads images through short-lived **signed URLs**, so a private bucket works end-to-end and your screenshots are never world-readable.

---

## 🇹🇷 Türkçe

### Ctrl2Phone Nedir?

Ctrl2Phone, masaüstünden ekran görüntüsü alıp **Gemini Web**'e yapıştırmanı veya tek tuşla **telefonunun galerisine** göndermenini sağlayan açık kaynak bir sistemdir.

### ✨ Özellikler

- ⌨️ **Çift Ctrl** ile ekranı dondur, fareyle alan seç
- 🤖 **X tuşu** ile seçimi Gemini Web'e yapıştır
- 📱 **M tuşu** ile seçimi Supabase üzerinden telefonuna gönder
- 📷 **QR Kod** ile mobil uygulamayı anında bağla
- 🔒 **Gizlilik**: Kendi Supabase hesabın, kendi anahtarların. Üçüncü parti sunucu yok
- 🖼️ **Kayıpsız PNG** kalitesinde ekran görüntüsü
- 🎯 **Akıllı Tuş Engelleme**: Kısayollar sadece seçim modu açıkken çalışır

### 📥 İndir (Hazır Kurulum)

Windows kurulum programını (`.exe`) ve Android uygulamasını (`.apk`) doğrudan Google Drive üzerinden indirebilirsiniz:
👉 **[Ctrl2Phone İndir (Windows & Android)](https://drive.google.com/drive/u/0/folders/1ux5WS0Wt8KEGsiJrXqTOhdoDFR1wMANM)**

### 🚀 Hızlı Başlangıç

#### Masaüstü Uygulaması

```bash
git clone https://github.com/1lord0/ctrl2phone.git
cd ctrl2phone/desktop
npm install
npm start
```

1. Ayarlar panelinden **Supabase URL**, **Anon Key** ve **Bucket Name** girin
2. **"Ayarları kaydet"** butonuna tıklayın
3. Herhangi bir yerde **sol Ctrl'e iki kere** basın → alan seçin → **X** (Gemini) veya **M** (Telefon)

#### Mobil Uygulama (Flutter — Android & iOS)

```bash
cd ctrl2phone/mobile
flutter pub get
```

**Android:**
```bash
flutter run
```

**iOS (macOS + Xcode gerektirir):**
```bash
cd ios
pod install
cd ..
flutter run
```

> **iOS Release Build:** Code signing gereklidir. `flutter build ipa --release` komutunu kullanmadan önce Apple Developer hesabı, sertifika ve provisioning profile ayarlamalısınız. Detaylar için [Flutter iOS deployment docs](https://docs.flutter.dev/deployment/ios) bakın.

1. Uygulamayı açın → Ayarlar'dan **QR Tara** butonuna dokunun
2. Masaüstü uygulamasında görünen QR kodu tarayın
3. Ekran görüntülerinizi galerinize indirin

### 🔧 Supabase Kurulumu

1. [supabase.com](https://supabase.com) adresinde yeni proje oluşturun (ücretsiz)
2. **Storage** → Yeni bucket oluşturun (örn: `screenshots`)
3. Settings → API'den **Project URL** ve **anon key** değerlerini kopyalayın
4. Ctrl2Phone masaüstü uygulamasına yapıştırıp **Ayarları kaydet** deyin
5. **🔒 Güvenli Kurulum (RLS)** butonuna basıp kopyalanan SQL'i çalıştırın — bu, bucket'ı **gizli** yapar ve anon anahtarını yalnızca bu bucket ile sınırlar (bkz. [Güvenlik Notları](#-güvenlik-notları))

> ⚠️ Eski sürümler bucket'ı **Public** yapmanızı söylüyordu. Yapmayın — bunun yerine Güvenli Kurulum'u çalıştırın. Uygulama görselleri kısa ömürlü **signed URL**'lerle okuduğu için gizli bucket uçtan uca çalışır ve ekran görüntüleriniz herkese açık olmaz.

### 📋 Universal Clipboard (Pano Eşitleme)

Bilgisayarınız ile telefonunuz arasında metin veya bağlantıları (link) anlık olarak kopyalayıp eşitleyebilirsiniz:

1. **PC → Telefon**: Bilgisayarınızda kopyaladığınız herhangi bir metin veya bağlantıyı panodayken **`Ctrl + Shift + V`** kısayoluna basarak veya arayüzdeki **"Panoyu Telefona Gönder"** butonuna tıklayarak anlık olarak telefonunuzun panosuna gönderebilirsiniz. Telefonunuzda anında bir bildirim görünecektir.
2. **Telefon → PC**: Mobil uygulamada sağ alttaki butona tıklayıp **"Panodan Gönder"** veya **"Metin Yaz"** seçeneğini kullanarak telefonunuzdaki metni anlık olarak bilgisayarınızın panosuna aktarabilirsiniz. Bilgisayarınızda bir bildirim penceresi açılacaktır.

> 💡 Pano verileriniz Supabase Realtime (WebSocket) ile anlık iletildikten hemen sonra veritabanından otomatik olarak silinir, böylece veritabanınız temiz ve güvenli kalır.

### 🔨 C# Key Listener Derleme

Çalıştırılmadan önce derlenmesi gereken **iki** küçük C# Windows yardımcısı var:

- `key_listener.exe` — global çift-Ctrl kısayol dinleyicisi.
- `photo_dropper.exe` — telefondan görsel geldiğinde açılan sürükle-bırak paneli. **Bunu derlemezseniz telefon→PC eşitlemesi görseli yine panoya kopyalar, ancak panel açılmaz.**

```powershell
cd ctrl2phone/desktop/src

# csc kullanarak (Windows SDK veya Visual Studio ile gelir)
csc /target:winexe /out:key_listener.exe key_listener.cs
csc /target:winexe /out:photo_dropper.exe photo_dropper.cs
```

> ⚠️ **`key_listener.exe` / `photo_dropper.exe`'yi Git'e commit etmeyin.** `.gitignore`'da zaten listelenmiştir.

### 🔒 Güvenlik Notları

- **Supabase Service Key yerine Anon Key kullanın.** Service Key, Row Level Security (RLS) kurallarını bypass eder; bir client uygulamaya veya QR koduna **asla** konmamalıdır.
- **Tek seferlik güvenlik kurulumunu yapın.** Masaüstü uygulamasındaki **🔒 Güvenli Kurulum (RLS)** butonuna basın: bir SQL parçacığını panoya kopyalar ve Supabase SQL Editör'ü açar — yapıştırıp **Run** deyin. Bucket'ı **gizli** yapar ve anon anahtarını *yalnızca* o bucket ile sınırlar.
- Uygulama görselleri **kısa ömürlü signed URL**'lerle okur (kalıcı public link değil); böylece bucket gizli olunca da galeri çalışır ve ekran görüntülerine sonsuza dek açık bir bağlantı kalmaz. Dosya adları rastgele UUID'dir, tahmin/enumerasyon yapılamaz.
- ⚠️ **Kurulum SQL'ini çalıştırana kadar bucket PUBLIC'tir** — proje URL'i + bucket adını öğrenen herkes tüm ekran görüntülerini okuyabilir. Eşleştirme QR kodunu (anon anahtarını taşır) bir şifre gibi koruyun.

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Desktop App | Electron.js |
| Global Hotkeys | C# (Low-level keyboard hook) |
| Screen Capture | `screenshot-desktop` (native) |
| Cloud Storage | Supabase Storage |
| Mobile App | Flutter + Dart |
| QR Generation | `qrcode` (Node.js) |

## 📁 Project Structure

```
ctrl2phone/
├── desktop/                  # Electron desktop app (TypeScript → compiled to .js)
│   ├── src/
│   │   ├── main.ts           # Main process (capture, AI routing, upload, hotkeys)
│   │   ├── preload.ts        # contextBridge IPC bridge
│   │   ├── renderer.ts       # Settings UI + i18n application
│   │   ├── overlay.ts        # Selection + annotation overlay logic
│   │   ├── types.ts          # Shared types (AppSettings, BridgeAPI)
│   │   ├── lib/              # Pure, unit-tested logic
│   │   │   ├── geometry.ts    # Crop / scale / virtual-bounds math
│   │   │   ├── aiProviders.ts # Multi-provider AI request builders + parsers
│   │   │   ├── supabaseSetup.ts # RLS setup SQL generator
│   │   │   └── i18n.ts        # EN/TR string dictionaries + locale resolver
│   │   ├── overlay.html / overlay.css / styles.css
│   │   ├── key_listener.cs    # C# global keyboard hook source (compile to .exe)
│   │   └── photo_dropper.cs   # C# phone→PC drag-drop panel (compile to .exe)
│   ├── test/                 # Jest unit tests (geometry, aiProviders, i18n, …)
│   ├── index.html            # Main window
│   └── package.json
├── mobile/                   # Flutter mobile app
│   └── ...
├── docs/
│   └── THREAT_MODEL.md       # Security threat model
├── LICENSE
└── README.md
```

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Made with ❤️ by [Eren](https://github.com/1lord0)**

⭐ Star this repo if you find it useful!

</div>
