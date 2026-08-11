import 'package:ctrl2phone_mobile/services/photo_image_cache.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('signed URL changes do not change the persistent image cache key', () {
    final first = photoImageCacheKey(
      accountFingerprint: 'account-a',
      storagePath: 'screenshots/photo-1.png',
    );
    final afterUrlRefresh = photoImageCacheKey(
      accountFingerprint: 'account-a',
      storagePath: 'screenshots/photo-1.png',
    );

    expect(afterUrlRefresh, first);
  });

  test('cache key isolates accounts that use the same storage path', () {
    final first = photoImageCacheKey(
      accountFingerprint: 'account-a',
      storagePath: 'screenshots/photo-1.png',
    );
    final second = photoImageCacheKey(
      accountFingerprint: 'account-b',
      storagePath: 'screenshots/photo-1.png',
    );

    expect(second, isNot(first));
  });

  test('cache key distinguishes different storage objects', () {
    final first = photoImageCacheKey(
      accountFingerprint: 'account-a',
      storagePath: 'screenshots/photo-1.png',
    );
    final second = photoImageCacheKey(
      accountFingerprint: 'account-a',
      storagePath: 'screenshots/photo-2.png',
    );

    expect(second, isNot(first));
  });
}
