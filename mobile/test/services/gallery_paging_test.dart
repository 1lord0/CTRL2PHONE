import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/gallery_paging.dart';

void main() {
  group('isVisiblePhotoName', () {
    test('shows ordinary screenshot names', () {
      expect(isVisiblePhotoName('photo.png'), true);
      expect(isVisiblePhotoName('a1b2-uuid.jpg'), true);
    });

    test('hides folder markers, the to_pc folder, hidden and empty/null names', () {
      expect(isVisiblePhotoName('.keep'), false);
      expect(isVisiblePhotoName('something.keep'), false);
      expect(isVisiblePhotoName('to_pc'), false);
      expect(isVisiblePhotoName('.hidden'), false);
      expect(isVisiblePhotoName(''), false);
      expect(isVisiblePhotoName(null), false);
    });
  });

  group('computeHasMore', () {
    test('a full page (raw count == limit) signals more', () {
      expect(computeHasMore(50, 50), true);
    });

    test('a short page signals the end', () {
      expect(computeHasMore(10, 50), false);
      expect(computeHasMore(0, 50), false);
    });

    test('matches the original objects.length == limit rule', () {
      // .list(limit: n) never returns more than n, so equality is the only true case.
      expect(computeHasMore(49, 50), false);
      expect(computeHasMore(50, 50), true);
    });
  });
}
