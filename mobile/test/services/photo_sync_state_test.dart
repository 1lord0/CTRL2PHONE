import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/photo_sync_state.dart';
import 'package:ctrl2phone_mobile/services/supabase_service.dart';

void main() {
  group('PhotoSyncState keys', () {
    test('objectKey is stable for storage paths', () {
      expect(
        PhotoSyncState.objectKey('screenshot_abc.png'),
        'obj:screenshot_abc.png',
      );
    });

    test('makeKeyFromPhoto uses bucket-relative path', () {
      final key = PhotoSyncState.makeKeyFromPhoto(
        Photo(
          id: 'any-id',
          storagePath: 'screenshots/screenshot_abc.png',
          uploadedAt: DateTime.parse('2026-01-01T12:00:00Z'),
        ),
      );
      expect(key, 'obj:screenshot_abc.png');
    });
  });
}