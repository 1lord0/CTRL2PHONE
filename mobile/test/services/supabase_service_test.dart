import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/supabase_service.dart';

void main() {
  group('SupabaseService', () {
    setUp(() async {
      await SupabaseService.clearClient();
    });

    test('isInitialized returns false by default', () {
      expect(SupabaseService.isInitialized, false);
    });

    test('isInitialized returns true after initClient', () {
      SupabaseService.initClient(
          'https://test.supabase.co', 'test-key', 'test-bucket');
      expect(SupabaseService.isInitialized, true);
    });

    test('clearClient resets initialization', () async {
      SupabaseService.initClient(
          'https://test.supabase.co', 'test-key', 'test-bucket');
      await SupabaseService.clearClient();
      expect(SupabaseService.isInitialized, false);
    });

    test('missing client surfaces a typed signed URL error', () async {
      final photo = Photo(
        id: 'photo',
        storagePath: 'screenshots/photo.png',
        uploadedAt: DateTime.utc(2026),
      );

      await expectLater(
        SupabaseService().refreshSignedUrl(photo),
        throwsA(isA<SignedUrlException>()),
      );
    });
  });

  group('clipboard contract', () {
    test('accepts text at the Unicode character limit', () {
      final text = List.filled(clipboardContentMaxLength, '😀').join();

      expect(validateClipboardText(text), isNull);
    });

    test('rejects text above the Unicode character limit', () {
      final text = List.filled(clipboardContentMaxLength + 1, '😀').join();

      expect(
        validateClipboardText(text),
        'Pano metni en fazla $clipboardContentMaxLength karakter olabilir.',
      );
    });

    test('rejects empty and whitespace-only clipboard text', () {
      expect(validateClipboardText(' \n\t '), 'Pano metni boş olamaz.');
    });
  });
}
