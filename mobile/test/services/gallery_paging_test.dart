import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/gallery_paging.dart';

void main() {
  group('isVisiblePhotoName', () {
    test('shows ordinary screenshot names', () {
      expect(isVisiblePhotoName('photo.png'), true);
      expect(isVisiblePhotoName('a1b2-uuid.jpg'), true);
    });

    test('hides folder markers, the to_pc folder, hidden and empty/null names',
        () {
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

  group('collectOffsetPages', () {
    for (final count in [0, 1, 999, 1000, 1001]) {
      test('collects exactly $count rows', () async {
        final source = List.generate(count, (index) => 'file-$index');
        final offsets = <int>[];

        final result = await collectOffsetPages<String>(
          fetchPage: (offset, limit) async {
            offsets.add(offset);
            if (offset >= source.length) return [];
            final end = (offset + limit < source.length)
                ? offset + limit
                : source.length;
            return source.sublist(offset, end);
          },
          keyOf: (item) => item,
        );

        expect(result, source);
        expect(offsets.first, 0);
        if (count == 1000) expect(offsets, [0, 1000]);
        if (count == 1001) expect(offsets, [0, 1000]);
      });
    }

    test('rejects a backend that repeats a full page', () async {
      final repeated = List.generate(1000, (index) => 'file-$index');

      await expectLater(
        collectOffsetPages<String>(
          fetchPage: (_, __) async => repeated,
          keyOf: (item) => item,
        ),
        throwsStateError,
      );
    });
  });

  test('builds mixed root and to_pc deletion paths without markers', () {
    expect(
      buildStorageDeletionPaths(
        rootNames: ['root.png', 'to_pc', '.keep', '.hidden'],
        toPcNames: ['phone.png', '.keep', '.hidden'],
      ),
      ['root.png', 'to_pc/phone.png'],
    );
  });

  test('collects multi-page mixed root and to_pc objects', () async {
    final root = <String>[
      ...List.generate(999, (index) => 'root-$index.png'),
      'to_pc',
      '.keep',
    ];
    final toPc = <String>[
      ...List.generate(1000, (index) => 'phone-$index.png'),
      '.keep',
    ];
    final rootOffsets = <int>[];
    final toPcOffsets = <int>[];

    Future<List<String>> page(
      List<String> source,
      List<int> offsets,
      int offset,
      int limit,
    ) async {
      offsets.add(offset);
      if (offset >= source.length) return [];
      final end =
          (offset + limit < source.length) ? offset + limit : source.length;
      return source.sublist(offset, end);
    }

    final rootObjects = await collectOffsetPages<String>(
      fetchPage: (offset, limit) => page(root, rootOffsets, offset, limit),
      keyOf: (item) => item,
    );
    final toPcObjects = await collectOffsetPages<String>(
      fetchPage: (offset, limit) => page(toPc, toPcOffsets, offset, limit),
      keyOf: (item) => item,
    );
    final paths = buildStorageDeletionPaths(
      rootNames: rootObjects,
      toPcNames: toPcObjects,
    );

    expect(rootOffsets, [0, 1000]);
    expect(toPcOffsets, [0, 1000]);
    expect(paths, hasLength(1999));
    expect(paths, containsAll(['root-998.png', 'to_pc/phone-999.png']));
  });

  group('deleteStorageInBatches', () {
    test('uses bounded batches and counts only confirmed deletions', () async {
      final batchSizes = <int>[];
      final confirmed = await deleteStorageInBatches<int>(
        items: List.generate(205, (index) => index),
        deleteBatch: (batch) async {
          batchSizes.add(batch.length);
          return batch.length == 5 ? 3 : batch.length;
        },
      );

      expect(batchSizes, [100, 100, 5]);
      expect(confirmed, 203);
    });

    test('preserves confirmed count when a later batch fails', () async {
      var call = 0;
      final operation = deleteStorageInBatches<int>(
        items: [1, 2, 3, 4, 5],
        batchSize: 2,
        deleteBatch: (batch) async {
          call++;
          if (call == 2) throw StateError('network failed');
          return batch.length;
        },
      );

      await expectLater(
        operation,
        throwsA(
          isA<StorageDeletionException>()
              .having((error) => error.confirmedDeleted, 'confirmedDeleted', 2)
              .having((error) => error.cause, 'cause', isA<StateError>()),
        ),
      );
      expect(call, 2);
    });
  });
}
