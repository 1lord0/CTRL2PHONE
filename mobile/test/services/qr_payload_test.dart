import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/qr_payload.dart';

void main() {
  group('parseQrPayload', () {
    String qr(Map<String, dynamic> m) => json.encode(m);

    test('accepts a valid https payload and extracts url/key/bucket', () {
      final r = parseQrPayload(
        qr({'url': 'https://abc.supabase.co', 'key': 'anon-key', 'bucket': 'shots'}),
      );
      expect(r.ok, true);
      expect(r.error, isNull);
      expect(r.url, 'https://abc.supabase.co');
      expect(r.key, 'anon-key');
      expect(r.bucket, 'shots');
    });

    test('trims surrounding whitespace on every field', () {
      final r = parseQrPayload(
        qr({'url': '  https://abc.supabase.co  ', 'key': '  k  ', 'bucket': '  b  '}),
      );
      expect(r.ok, true);
      expect(r.url, 'https://abc.supabase.co');
      expect(r.key, 'k');
      expect(r.bucket, 'b');
    });

    test('defaults the bucket to SCREENSHOTS when omitted or blank', () {
      final omitted = parseQrPayload(qr({'url': 'https://a.supabase.co', 'key': 'k'}));
      expect(omitted.ok, true);
      expect(omitted.bucket, kDefaultBucket);

      final blank = parseQrPayload(qr({'url': 'https://a.supabase.co', 'key': 'k', 'bucket': '   '}));
      expect(blank.ok, true);
      expect(blank.bucket, kDefaultBucket);
    });

    test('rejects a missing or empty url/key', () {
      for (final bad in [
        qr({'key': 'k'}), // no url
        qr({'url': 'https://a.supabase.co'}), // no key
        qr({'url': '', 'key': 'k'}),
        qr({'url': 'https://a.supabase.co', 'key': ''}),
      ]) {
        final r = parseQrPayload(bad);
        expect(r.ok, false, reason: bad);
        expect(r.error, 'QR kodunda Supabase URL veya anahtar bulunamadı.');
      }
    });

    test('rejects a non-https url (security: no attacker redirect)', () {
      final r = parseQrPayload(qr({'url': 'http://evil.example', 'key': 'k'}));
      expect(r.ok, false);
      expect(r.error, 'Güvenlik: QR adresi https:// ile başlamıyor, reddedildi.');
    });

    test('rejects undecodable JSON with the format error', () {
      final r = parseQrPayload('not-json{');
      expect(r.ok, false);
      expect(r.error, kQrFormatError);
    });

    test('rejects a JSON value that is not an object', () {
      final r = parseQrPayload('[1,2,3]');
      expect(r.ok, false);
      expect(r.error, kQrFormatError);
    });

    test('ignores unexpected extra fields', () {
      final r = parseQrPayload(
        qr({'url': 'https://a.supabase.co', 'key': 'k', 'bucket': 'b', 'evil': 'rm -rf'}),
      );
      expect(r.ok, true);
      expect(r.url, 'https://a.supabase.co');
    });
  });
}
