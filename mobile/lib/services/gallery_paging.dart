// Pure gallery-paging helpers, extracted from SupabaseService so the filtering
// and pagination rules can be unit-tested without the Supabase SDK or a network.

/// Whether a storage object name should be shown in the gallery.
///
/// Hidden (dot) files, the `.keep` folder marker, the `to_pc` transfer folder,
/// and null names are excluded; everything else is a real screenshot.
bool isVisiblePhotoName(String? name) {
  if (name == null || name.isEmpty) return false;
  if (name.startsWith('.')) return false;
  if (name.endsWith('.keep')) return false;
  if (name == 'to_pc') return false;
  return true;
}

/// Whether the server likely has another page.
///
/// Pagination is decided on the RAW server count (before visibility filtering),
/// so hiding `.keep` / `to_pc` / hidden rows never cuts the gallery short. A full
/// page (raw count == requested limit) means there may be more; a short page means
/// the end was reached. `.list(limit: n)` never returns more than `n` rows, so this
/// is exactly the original `objects.length == limit` rule.
bool computeHasMore(int rawCount, int limit) => rawCount == limit;

const int storagePageSize = 1000;
const int storageDeleteBatchSize = 100;

typedef StoragePageFetcher<T> = Future<List<T>> Function(
  int offset,
  int limit,
);

/// Reads a stable, offset-based listing until the server returns a short page.
///
/// A repeated full page indicates that the backend ignored or failed to advance
/// the offset. Throwing is safer than looping forever or silently double-counting.
Future<List<T>> collectOffsetPages<T>({
  required StoragePageFetcher<T> fetchPage,
  required String Function(T item) keyOf,
  int pageSize = storagePageSize,
}) async {
  if (pageSize <= 0) {
    throw ArgumentError.value(pageSize, 'pageSize', 'must be positive');
  }

  final results = <T>[];
  final seenFullPages = <String>{};
  var offset = 0;

  while (true) {
    final page = await fetchPage(offset, pageSize);
    if (page.length > pageSize) {
      throw StateError(
          'Storage returned more rows than the requested page size.');
    }
    if (page.isEmpty) break;

    if (page.length == pageSize) {
      final signature = page.map(keyOf).join('\u0000');
      if (!seenFullPages.add(signature)) {
        throw StateError('Storage pagination repeated a full page.');
      }
    }

    results.addAll(page);
    if (page.length < pageSize) break;

    final nextOffset = offset + page.length;
    if (nextOffset <= offset) {
      throw StateError('Storage pagination did not advance.');
    }
    offset = nextOffset;
  }

  return results;
}

/// Produces the exact bucket-relative paths that purge is allowed to delete.
List<String> buildStorageDeletionPaths({
  required Iterable<String?> rootNames,
  required Iterable<String?> toPcNames,
}) {
  final paths = <String>{};
  for (final name in rootNames) {
    if (isVisiblePhotoName(name)) paths.add(name!);
  }
  for (final name in toPcNames) {
    if (isVisiblePhotoName(name)) paths.add('to_pc/$name');
  }
  return paths.toList(growable: false);
}

class StorageDeletionException implements Exception {
  final int confirmedDeleted;
  final Object cause;

  const StorageDeletionException(this.confirmedDeleted, this.cause);

  @override
  String toString() =>
      'Storage deletion failed after $confirmedDeleted confirmed deletions: $cause';
}

/// Deletes in bounded batches and returns only the count confirmed by the API.
Future<int> deleteStorageInBatches<T>({
  required List<T> items,
  required Future<int> Function(List<T> batch) deleteBatch,
  int batchSize = storageDeleteBatchSize,
}) async {
  if (batchSize <= 0) {
    throw ArgumentError.value(batchSize, 'batchSize', 'must be positive');
  }

  var confirmedDeleted = 0;
  for (var start = 0; start < items.length; start += batchSize) {
    final end =
        (start + batchSize < items.length) ? start + batchSize : items.length;
    final batch = items.sublist(start, end);
    try {
      final confirmedInBatch = await deleteBatch(batch);
      if (confirmedInBatch < 0 || confirmedInBatch > batch.length) {
        throw StateError('Storage returned an invalid deletion count.');
      }
      confirmedDeleted += confirmedInBatch;
    } catch (error) {
      throw StorageDeletionException(confirmedDeleted, error);
    }
  }
  return confirmedDeleted;
}
