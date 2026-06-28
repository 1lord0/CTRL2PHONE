import 'dart:convert';

/// Default bucket used when a pairing QR omits one.
const String kDefaultBucket = 'SCREENSHOTS';

/// Error shown when the QR is not decodable JSON / not an object. Exposed so the
/// UI can render it with the same (non-alarming) styling as before.
const String kQrFormatError = 'QR Kod okuma hatası: Geçersiz veri formatı.';

/// Outcome of parsing a pairing-QR payload. Pure data — no Flutter/Supabase deps,
/// so it can be unit-tested without a device or a live client.
class QrPayloadResult {
  final bool ok;

  /// User-facing reason when [ok] is false (matches the on-screen snackbars).
  final String? error;

  final String url;
  final String key;
  final String bucket;

  const QrPayloadResult._({
    required this.ok,
    this.error,
    this.url = '',
    this.key = '',
    this.bucket = '',
  });

  factory QrPayloadResult.success({
    required String url,
    required String key,
    required String bucket,
  }) =>
      QrPayloadResult._(ok: true, url: url, key: key, bucket: bucket);

  factory QrPayloadResult.failure(String error) => QrPayloadResult._(ok: false, error: error);
}

/// Parse and validate a scanned pairing-QR payload (`{"url","key","bucket"}` JSON).
///
/// Security: only `https://` URLs are accepted, so a malicious QR cannot point the
/// app at an attacker-controlled server. Returns a [QrPayloadResult.failure] with a
/// user-facing reason instead of throwing, so callers can surface it directly.
QrPayloadResult parseQrPayload(String raw) {
  dynamic decoded;
  try {
    decoded = json.decode(raw);
  } catch (_) {
    return QrPayloadResult.failure(kQrFormatError);
  }

  if (decoded is! Map) {
    return QrPayloadResult.failure(kQrFormatError);
  }

  final url = (decoded['url'] ?? '').toString().trim();
  final key = (decoded['key'] ?? '').toString().trim();
  final bucket = (decoded['bucket'] ?? '').toString().trim();

  if (url.isEmpty || key.isEmpty) {
    return QrPayloadResult.failure('QR kodunda Supabase URL veya anahtar bulunamadı.');
  }

  if (!url.startsWith('https://')) {
    return QrPayloadResult.failure('Güvenlik: QR adresi https:// ile başlamıyor, reddedildi.');
  }

  return QrPayloadResult.success(
    url: url,
    key: key,
    bucket: bucket.isEmpty ? kDefaultBucket : bucket,
  );
}
