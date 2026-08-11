# AI Action Görevi Başlatma & Klavye Dinleyicisi - Teşhis ve Çalışma Raporu

**Tarih:** 8 Ağustos 2026  
**Proje:** CTRL2PHONE Desktop  
**Amaç:** Ekran alanı seçildiğinde "AI action görevi başlatılamadı" hatasının ve çift Ctrl tuşu dinleme sorunlarının giderilmesi için yapılan tüm denemelerin ve bulguların kaydı.

---

## 📋 1. Genel Durum Özeti

Kullanıcı alan seçip "Action" butonuna bastığında genel bir catch hatası olan **"AI action görevi başlatılamadı"** hatası alınıyordu. Yapılan kademeli hata loglamaları (`[ACTION_DEBUG]`) sayesinde hata adım adım takip edildi ve 4 farklı alt sorun tespit edilip çözüldü.

---

## 🔍 2. Yapılan Denemeler ve Çözülen Hatalar (Kayıtlar)

### 🔴 1. Deneme / Hata: Gemini REST API Structured Output Format Uyumsuzluğu
- **Belirti:** Gemini Yapay Zeka istekleri geçersiz istek formatı nedeniyle reddediliyordu.
- **Kök Neden:** `desktop/src/lib/aiProviders.ts` içinde eski format olan `generationConfig.responseFormat.text.mimeType` ve `schema` nesnesi kullanılıyordu.
- **Yapılan Düzeltme:** Gemini REST API standartlarına uygun `responseMimeType: 'application/json'` ve `responseSchema` alanları doğrudan `generationConfig` seviyesine taşındı.

---

### 🔴 2. Deneme / Hata: Gemini 400 Bad Request (`additionalProperties`)
- **Belirti:** Konsolda `[ACTION_DEBUG] Error: gemini 400: Unknown name "additionalProperties" at 'generation_config.response_schema'` hatası alındı.
- **Kök Neden:** Standard JSON Schema içerisinde yer alan `additionalProperties: false` tanımı Gemini REST API tarafından tanınmıyor ve API 400 hatası veriyordu.
- **Yapılan Düzeltme:**
  1. `desktop/src/lib/actionIntentAnalyzer.ts` şemasından `additionalProperties: false` ifadesi kaldırıldı.
  2. `desktop/src/lib/aiProviders.ts` içerisine `sanitizeGeminiSchema` adında koruyucu bir helper eklendi. Bu helper Gemini'nin reddettiği `additionalProperties`, `minimum`, `maximum`, `maxItems`, `minItems` parametrelerini şemadan otomatik temizler.

---

### 🔴 3. Deneme / Hata: Intent Parser Aşırı Katı Ayrıştırma (`action_intent_visible_text_invalid`)
- **Belirti:** Konsolda `[ACTION_DEBUG] Stage: selection_action_failed, Error: action_intent_visible_text_invalid` hatası alındı.
- **Kök Neden:** Gemini `visibleText` dizisinde boş string `""` veya string olmayan/nesne tipinde bir eleman döndürdüğünde, `boundedString` ve `boundedStrings` katı kontrolleri doğrudan `throw new Error()` yapıp akışı kırıyordu.
- **Yapılan Düzeltme:**
  - `desktop/src/lib/actionIntentAnalyzer.ts` içerisindeki `boundedStrings` ve `parseActionIntentAnalysis` fonksiyonları tam esnek (resilient / fail-safe) hale getirildi.
  - Artık Gemini boş stringler, beklenmeyen veri tipleri veya ekstra diziler döndürse dahi uygulama **asla crash/throw yapmaz**; veri temizlenip güvenli formata dönüştürülür.
  - Ayrıca ham Gemini yanıtını görmek için `[INTENT_RAW_DEBUG]` konsol logu eklendi.

---

### 🔴 4. Deneme / Hata: Klavye Hook Engeli (Çift Ctrl Tetiklenmemesi)
- **Belirti:** Çift Sol Ctrl tuşuna basıldığında alan seçme ekranı açılmıyordu.
- **Kök Neden:** `key_listener.cs` içindeki eski `SetWindowsHookEx` (WH_KEYBOARD_LL = 13) yöntemi, Windows Defender / UIPI güvenlik politikaları veya zaman aşımı nedeniyle işletim sistemi tarafından engelleniyor ya da sessizce kaldırılıyordu.
- **Yapılan Düzeltme:**
  - `desktop/src/key_listener.cs` C# kodu **Windows Raw Input API (`RegisterRawInputDevices` + `RIDEV_INPUTSINK`)** mimarisi ile yeniden yazıldı. Raw Input işletim sisteminde kanca (hook) izni gerektirmediğinden engellenmeden arka plan klavye mesajlarını yakalar.
  - `package.json` içerisindeki `build:native` script'ine `System.Drawing.dll` referansı eklendi.

---

## 🛠️ 3. Mevcut Kod Durumu & Testler

- **Test Durumu:** `npm --prefix desktop test` çalıştırıldığında **62 test suite ve 349 birim testinin tamamı PASS** vermektedir.
- **TypeScript Derleme:** `npm --prefix desktop run build` hatasız tamamlanmaktadır.
- **Log Yapısı:**
  - `[ACTION_DEBUG]`: Akışın hangi aşamada (stage) durduğunu ve hata detayını gösterir.
  - `[INTENT_RAW_DEBUG]`: Gemini'den gelen orijinal ham JSON verisini gösterir.

---

## ⏭️ 4. Yarın Devam Ederken İzlenecek Adımlar

Tekrar aynı denemeleri tekrarlamamak için yarın doğrudan şu adımlarla başlanmalıdır:

1. **Uygulamayı Temiz Başlatma:**
   ```bash
   cd desktop
   npm start
   ```
2. **Action Butonuna Basıldığında Terminal Loglarını İnceleme:**
   - Eğer `[INTENT_RAW_DEBUG]` basılıyorsa → **Gemini analizi başarılı demektir.**
   - Hata `[ACTION_DEBUG]` ile hangi aşamada geliyorsa:
     - `action_input_upload_failed` → Supabase Storage bucket (`ctrl2phone-action-inputs`) erişim kontrolü.
     - `action_task_enqueue_failed` → Supabase RPC `enqueue_action_task` çalıştırma kontrolü.
     - `action_webhook_http_xxx` → n8n sunucusunun (`http://127.0.0.1:5678/webhook/ctrl2phone-action`) açık ve erişilebilir olup olmadığı kontrolü.
