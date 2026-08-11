import 'dart:convert';

import 'package:ctrl2phone_mobile/services/qr_payload.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseQrPayload', () {
    String qr(Map<String, dynamic> value) => jsonEncode(value);
    final now = DateTime.utc(2026, 8, 7, 12);

    test('accepts a legacy photo-only payload', () {
      final result = parseQrPayload(qr({
        'url': ' https://abc.supabase.co ',
        'key': ' anon-key ',
        'bucket': ' shots ',
      }));

      expect(result.ok, isTrue);
      expect(result.url, 'https://abc.supabase.co');
      expect(result.key, 'anon-key');
      expect(result.bucket, 'shots');
      expect(result.actionPairing, isNull);
    });

    test('defaults an omitted bucket', () {
      final result = parseQrPayload(
        qr({'url': 'https://a.supabase.co', 'key': 'k'}),
      );
      expect(result.ok, isTrue);
      expect(result.bucket, kDefaultBucket);
    });

    test('accepts a valid schema-v2 one-time action invite', () {
      final result = parseQrPayload(
        qr({
          'schemaVersion': 2,
          'url': 'https://a.supabase.co',
          'key': 'k',
          'bucket': 'SCREENSHOTS',
          'actionPairing': {
            'version': 1,
            'channelId': '123e4567-e89b-42d3-a456-426614174000',
            'inviteToken': 'A' * 43,
            'inviteExpiresAt':
                now.add(const Duration(minutes: 10)).toIso8601String(),
          },
        }),
        now: now,
      );

      expect(result.ok, isTrue);
      expect(result.actionPairing?.channelId,
          '123e4567-e89b-42d3-a456-426614174000');
      expect(result.actionPairing?.inviteToken, 'A' * 43);
    });

    test('rejects expired and overlong action invites', () {
      for (final expiry in [
        now.subtract(const Duration(seconds: 1)),
        now.add(const Duration(minutes: 32)),
      ]) {
        final result = parseQrPayload(
          qr({
            'schemaVersion': 2,
            'url': 'https://a.supabase.co',
            'key': 'k',
            'actionPairing': {
              'version': 1,
              'channelId': '123e4567-e89b-42d3-a456-426614174000',
              'inviteToken': 'A' * 43,
              'inviteExpiresAt': expiry.toIso8601String(),
            },
          }),
          now: now,
        );
        expect(result.ok, isFalse);
      }
    });

    test('rejects malformed action identifiers and tokens', () {
      final result = parseQrPayload(
        qr({
          'schemaVersion': 2,
          'url': 'https://a.supabase.co',
          'key': 'k',
          'actionPairing': {
            'version': 1,
            'channelId': '../not-a-uuid',
            'inviteToken': 'short',
            'inviteExpiresAt':
                now.add(const Duration(minutes: 5)).toIso8601String(),
          },
        }),
        now: now,
      );
      expect(result.ok, isFalse);
    });

    test('rejects missing credentials, insecure URLs, and non-JSON input', () {
      expect(parseQrPayload(qr({'key': 'k'})).ok, isFalse);
      expect(
        parseQrPayload(qr({'url': 'http://evil.example', 'key': 'k'})).ok,
        isFalse,
      );
      expect(parseQrPayload('not-json{').error, kQrFormatError);
      expect(parseQrPayload('[1,2,3]').error, kQrFormatError);
    });
  });
}
