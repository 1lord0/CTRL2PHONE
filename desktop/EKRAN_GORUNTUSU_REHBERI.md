# Ekran Görüntüsü ve Telefe Aktarım Sistemi Rehberi

Bu proje, masaüstünden hızlıca ekran görüntüsü alıp bunu **Gemini Web**'e yapıştırmanızı veya tek bir tuşla **Supabase Storage** aracılığıyla doğrudan **telefonunuzun galerisine** göndermenizi sağlayan entegre bir sistemdir.

---

## 🛠️ Sistem Bileşenleri ve Yapısı

Sistem iki ana parçadan oluşmaktadır:
1. **Masaüstü Ekran Aracı (Electron.js + C# Global Hook)**: Ekran görüntüsü alma, klavye kısayollarını izleme ve Supabase'e yükleme işlemlerini yapar.
2. **Mobil Uygulama (Flutter)**: Supabase'deki en güncel ekran görüntüsünü bulup telefonun fotoğraf galerisine kaydeder.

---

## 🖥️ 1. Masaüstü Uygulaması Detayları

### ⌨️ Global Klavye Kısayolları (C# Hook)
* Arka planda klavyeyi dinlemek için C# dilinde yazılmış ve optimize edilmiş [key_listener.cs](file:///c:/Users/eren/Desktop/Yeni%20klas%C3%B6r/src/key_listener.cs) programı kullanılmaktadır. Bu kod `csc.exe` ile [key_listener.exe](file:///c:/Users/eren/Desktop/Yeni%20klas%C3%B6r/src/key_listener.exe) olarak derlenmiştir.
* **Çift Sol Ctrl**: Ekran görüntüsü alma katmanını (overlay) tetikler ve ekranı dondurur.
* **X veya Enter**: Seçilen alanı kırpar, panoya (clipboard) kopyalar ve Gemini Web arayüzünü ön plana getirerek otomatik olarak komut satırına yapıştırır.
* **M**: Seçilen alanı kırpar, benzersiz bir dosya adı vererek Supabase Storage bucket'ına yükler.
* **Escape**: Seçim modunu iptal eder ve katmanı kapatır.

> [!NOTE]
> **Akıllı Tuş Engelleme (Blocking Hook)**:
> Klavye dinleyicisi, arka plandaki diğer programların (örneğin YouTube'un `M` tuşu ile sesi kısması gibi) etkilenmemesi için **sadece seçim katmanı açıkken** kısayol tuşlarını (`M`, `X`, `Enter`, `Escape`) engeller. Seçim katmanı kapalıyken klavye girişleri diğer programlara normal bir şekilde iletilir.

### 💾 Kalıcı Ayarlar Sistemi
* Uygulamaya girdiğiniz Supabase ayarları (URL, Anon Key, Bucket adı) bilgisayarınızdaki kullanıcı verileri klasöründe (`AppData\Roaming\gemini-screen-helper\settings.json`) kalıcı olarak saklanır. Uygulama yeniden başlatıldığında otomatik olarak yüklenir.

### ⚡ Performans ve Önbellek (Cache) Yönetimi
* Ekran görüntüsü disk yerine tamamen RAM üzerinde (Base64 JPEG biçiminde) işlenir. Bu sayede dondurma işlemi `< 30ms` içinde gerçekleşir.
* Supabase'e yükleme yapılırken resmin CDN tarafından önbelleğe alınmasını önlemek için HTTP isteğinde `'cache-control': '0'` başlığı iletilir.
* Dosya çakışmalarını önlemek için her görsel `screenshot_<timestamp>.jpg` formatında benzersiz bir isimle kaydedilir.

---

## 📱 2. Mobil Uygulama (Flutter) Detayları

### 📥 Dinamik Görsel İndirme
* Uygulamanın ana ekranında Supabase Storage'dan görselleri listeleyen ve galeriye indiren bir arayüz bulunmaktadır.
* Butona tıklandığında, uygulama Supabase Storage API'sine (`/storage/v1/object/list/SCREENSHOTS`) bir `POST` isteği göndererek en son yüklenen benzersiz dosya adını (tarihe göre sıralı) çeker.
* Çekilen bu dinamik dosya adı ile doğrudan indirme isteği atılır.

### 🖼️ Galeriye Kaydetme
* Telefona indirilen görsel, **`gal`** kütüphanesi kullanılarak doğrudan telefonun yerel fotoğraf galerisine kaydedilir.
* **Android Yapılandırması**: `AndroidManifest.xml` dosyasına `WRITE_EXTERNAL_STORAGE` (max SDK 29) izni ve eski cihazlar için `requestLegacyExternalStorage="true"` desteği eklendi.
* **iOS Yapılandırması**: `Info.plist` dosyasına Apple'ın onay süreçleri için gerekli olan `NSPhotoLibraryAddUsageDescription` ve `NSPhotoLibraryUsageDescription` açıklama metinleri eklendi.

---

## 🚀 3. Kurulum ve Çalıştırma Adımları

### Adım 1: Masaüstü Uygulamasını Çalıştırın ve Ayarlayın
1. Masaüstü klasöründe terminali açıp bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
2. Uygulamayı başlatın:
   ```bash
   npm run dev
   ```
3. Açılan uygulamadaki ayarlar panelini doldurun:
   * **Supabase URL**: `https://YOUR_PROJECT.supabase.co`
   * **Supabase Anon/Service Key**: (Supabase projenizden aldığınız uzun `eyJ...` ile başlayan anahtar)
   * **Supabase Bucket Name**: `SCREENSHOTS` (Büyük harflerle yazılması zorunludur)
4. **"Ayarları kaydet"** butonuna tıklayın.

### Adım 2: Ekran Görüntüsü Alıp Gönderin
1. Herhangi bir ekrandayken hızlıca **sol Ctrl tuşuna iki kere** basın.
2. Ekran donacak ve karacaktır. Fareyle istediğiniz alanı seçin.
3. Seçtikten sonra klavyeden **`M`** tuşuna basın. Seçim katmanı kapanacak ve görsel Supabase Storage içine benzersiz bir isimle yüklenecektir.

### Adım 3: Telefonunuza İndirin
1. Mobil uygulamanızı telefonunuzda çalıştırın.
2. Ana ekrandaki **"Ekran Görselini Al"** butonuna dokunun.
3. Uygulama otomatik olarak en son yüklediğiniz resmi bulacak, indirecek ve telefonunuzun galerisine kaydedecektir. Ekranın altında başarı bildirimi görünecektir.
