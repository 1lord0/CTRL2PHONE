import 'dart:convert';

/// Default bucket used when a pairing QR omits one.
const String kDefaultBucket = 'SCREENSHOTS';

const String kQrFormatError = 'QR kodu okunamadı: Geçersiz veri formatı.';
const _uuidPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const _inviteTokenPattern = r'^[A-Za-z0-9_-]{43}$';

class ActionPairingPayload {
  final String channelId;
  final String inviteToken;
  final DateTime inviteExpiresAt;

  const ActionPairingPayload({
    required this.channelId,
    required this.inviteToken,
    required this.inviteExpiresAt,
  });
}

/// Pure, validated representation of a desktop pairing QR.
class QrPayloadResult {
  final bool ok;
  final String? error;
  final String url;
  final String key;
  final String bucket;
  final ActionPairingPayload? actionPairing;

  const QrPayloadResult._({
    required this.ok,
    this.error,
    this.url = '',
    this.key = '',
    this.bucket = '',
    this.actionPairing,
  });

  factory QrPayloadResult.success({
    required String url,
    required String key,
    required String bucket,
    ActionPairingPayload? actionPairing,
  }) =>
      QrPayloadResult._(
        ok: true,
        url: url,
        key: key,
        bucket: bucket,
        actionPairing: actionPairing,
      );

  factory QrPayloadResult.failure(String error) =>
      QrPayloadResult._(ok: false, error: error);
}

/// Parses both legacy photo-only QRs and schema-v2 action pairing QRs.
///
/// The action invite is deliberately returned only in memory. Callers must
/// exchange it immediately and must never persist it.
QrPayloadResult parseQrPayload(String raw, {DateTime? now}) {
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
    return QrPayloadResult.failure(
        'QR kodunda Supabase URL veya anahtar bulunamadı.');
  }
  if (!url.startsWith('https://')) {
    return QrPayloadResult.failure(
        'Güvenlik: QR adresi https:// ile başlamıyor, reddedildi.');
  }

  ActionPairingPayload? actionPairing;
  final pairingValue = decoded['actionPairing'];
  if (pairingValue != null) {
    if (decoded['schemaVersion'] != 2 || pairingValue is! Map) {
      return QrPayloadResult.failure('Geçersiz görev eşleştirme bilgisi.');
    }

    final channelId = (pairingValue['channelId'] ?? '').toString().trim();
    final inviteToken = (pairingValue['inviteToken'] ?? '').toString().trim();
    final expiresAt = DateTime.tryParse(
      (pairingValue['inviteExpiresAt'] ?? '').toString().trim(),
    )?.toUtc();
    final currentTime = (now ?? DateTime.now()).toUtc();

    if (pairingValue['version'] != 1 ||
        !RegExp(_uuidPattern).hasMatch(channelId) ||
        !RegExp(_inviteTokenPattern).hasMatch(inviteToken) ||
        expiresAt == null ||
        !expiresAt.isAfter(currentTime) ||
        expiresAt.isAfter(currentTime.add(const Duration(minutes: 31)))) {
      return QrPayloadResult.failure(
          'Görev eşleştirme daveti geçersiz veya süresi dolmuş.');
    }

    actionPairing = ActionPairingPayload(
      channelId: channelId,
      inviteToken: inviteToken,
      inviteExpiresAt: expiresAt,
    );
  }

  return QrPayloadResult.success(
    url: url,
    key: key,
    bucket: bucket.isEmpty ? kDefaultBucket : bucket,
    actionPairing: actionPairing,
  );
}
