<div align="center">

# ⌨️ Ctrl2Phone

**Double-tap Ctrl → Select area → Send to Gemini or your Phone**

*Çift Ctrl → Alan seç → Gemini'a veya Telefonuna gönder*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://www.electronjs.org/)
[![Flutter](https://img.shields.io/badge/Flutter-Mobile_App-02569B?logo=flutter)](https://flutter.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Storage-3ECF8E?logo=supabase)](https://supabase.com/)

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
| 🤖 **Gemini Integration** | Press X to paste selection directly into Gemini Web |
| 📱 **Phone Sync** | Press M to upload to Supabase → open mobile app → image in your gallery |
| 📷 **QR Setup** | Scan QR code from desktop app to configure mobile app instantly |
| 🔒 **Privacy First** | Your keys, your storage. No third-party servers. Fully open source |
| 🎯 **Smart Key Blocking** | Hotkeys only intercept when selection overlay is active (won't mute YouTube!) |
| 🖼️ **Lossless PNG** | Screenshots uploaded in full PNG quality |

### 🏗️ Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Desktop App    │     │     Supabase      │     │   Mobile App     │
│   (Electron)     │────▶│   Storage Bucket  │◀────│   (Flutter)      │
│                  │     │                   │     │                  │
│ • C# Key Hook   │     │ • PNG files       │     │ • QR Scanner     │
│ • Screen Capture │     │ • Public URLs     │     │ • Gallery Save   │
│ • Gemini Paste   │     │ • Free tier OK    │     │ • Auto Download  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

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
| `X` or `Enter` | Send selection to Gemini Web |
| `M` | Upload selection to Supabase (→ Phone) |
| `Esc` | Cancel selection |
| `Q` | Quit application |

### 📋 Prerequisites

- **Node.js** 18+ and **npm**
- **Windows 10/11** (C# key listener is Windows-only)
- **Supabase** account (free tier: [supabase.com](https://supabase.com))
- **Flutter** 3.x (for mobile app)

### 🔧 Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Storage** → Create a new bucket (e.g., `screenshots`)
3. Set the bucket to **Public**
4. Copy your **Project URL** and **anon key** from Settings → API
5. Paste them into the Ctrl2Phone desktop app

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

#### Mobil Uygulama (Flutter)

```bash
cd ctrl2phone/mobile
flutter pub get
flutter run
```

1. Uygulamayı açın → Ayarlar'dan **QR Tara** butonuna dokunun
2. Masaüstü uygulamasında görünen QR kodu tarayın
3. Ekran görüntülerinizi galerinize indirin

### 🔧 Supabase Kurulumu

1. [supabase.com](https://supabase.com) adresinde yeni proje oluşturun (ücretsiz)
2. **Storage** → Yeni bucket oluşturun (örn: `screenshots`)
3. Bucket'ı **Public** yapın
4. Settings → API'den **Project URL** ve **anon key** değerlerini kopyalayın
5. Ctrl2Phone masaüstü uygulamasına yapıştırın

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
├── desktop/                # Electron desktop app
│   ├── src/
│   │   ├── main.js         # Main process (capture, upload, hotkeys)
│   │   ├── preload.js      # IPC bridge
│   │   ├── renderer.js     # UI logic
│   │   ├── overlay.js      # Selection overlay logic
│   │   ├── overlay.html    # Overlay window
│   │   ├── overlay.css     # Overlay styles
│   │   ├── styles.css      # Main window styles
│   │   ├── key_listener.cs # C# global keyboard hook source
│   │   └── key_listener.exe# Compiled key listener (build yourself)
│   ├── index.html          # Main window
│   └── package.json
├── mobile/                 # Flutter mobile app
│   └── ...
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
