import 'package:ctrl2phone_mobile/providers/photos_provider.dart';
import 'package:ctrl2phone_mobile/services/gallery_cache.dart';
import 'package:ctrl2phone_mobile/services/photo_sync_state.dart';
import 'package:ctrl2phone_mobile/services/supabase_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeSupabaseService extends SupabaseService {
  final DateTime now;
  int refreshCalls = 0;
  int fetchSingleCalls = 0;
  int stopCalls = 0;
  List<Photo> pagePhotos = [];
  List<Photo> newPhotos = [];
  void Function(String name)? bucketCallback;

  FakeSupabaseService(this.now) : super(now: () => now);

  Photo signed(Photo photo, String suffix) => photo.copyWith(
        url: 'https://signed.example/$suffix',
        urlExpiresAt: now.add(const Duration(hours: 6)),
      );

  @override
  Future<Photo> refreshSignedUrl(Photo photo) async {
    refreshCalls++;
    return signed(photo, 'refresh-$refreshCalls');
  }

  @override
  Future<Photo> ensureFreshPhoto(Photo photo) async {
    if (photo.hasUsableUrl(now,
        refreshWindow: SupabaseService.signedUrlRefreshWindow)) {
      return photo;
    }
    return refreshSignedUrl(photo);
  }

  @override
  Future<PhotoPage> getPhotos({
    int limit = 50,
    int offset = 0,
    Set<String> knownKeys = const {},
    bool onlySignNew = false,
  }) async =>
      PhotoPage(
          photos: pagePhotos, hasMore: false, fetchedCount: pagePhotos.length);

  @override
  Future<List<Photo>> getNewPhotosOnly({
    required Set<String> knownKeys,
    int limit = 100,
  }) async =>
      newPhotos;

  @override
  Future<Photo?> fetchPhotoByStorageName(
    String storageName, {
    required Set<String> knownKeys,
  }) async {
    fetchSingleCalls++;
    return null;
  }

  @override
  Future<void> listenForBucketInserts(
      void Function(String name) onInsert) async {
    bucketCallback = onInsert;
  }

  @override
  Future<void> stopBucketListener() async {
    stopCalls++;
  }
}

Photo photoAt(
  DateTime now, {
  String id = 'photo-1',
  String url = 'https://signed.example/original',
  DateTime? expiresAt,
}) =>
    Photo(
      id: id,
      storagePath: 'screenshots/$id.png',
      originalName: '$id.png',
      uploadedAt: now.subtract(const Duration(minutes: 1)),
      url: url,
      urlExpiresAt: expiresAt,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final now = DateTime.utc(2026, 8, 6, 12);

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<PhotosProvider> seededProvider(
    FakeSupabaseService service,
    Photo photo,
  ) async {
    final cache = GalleryCache();
    final sync = PhotoSyncState();
    await cache.saveFingerprint('account-a');
    await cache.save([photo]);
    await sync.save({PhotoSyncState.makeKeyFromPhoto(photo)});
    final provider = PhotosProvider(
      service: service,
      galleryCache: cache,
      syncState: sync,
      now: () => now,
    );
    await provider.initialize(accountFingerprint: 'account-a');
    return provider;
  }

  test('cold start refreshes an expired cached signed URL', () async {
    final service = FakeSupabaseService(now);
    final provider = await seededProvider(
      service,
      photoAt(now, expiresAt: now.subtract(const Duration(seconds: 1))),
    );

    expect(service.refreshCalls, 1);
    expect(provider.photos.single.url, 'https://signed.example/refresh-1');
    expect(
        provider.photos.single.urlExpiresAt, now.add(const Duration(hours: 6)));
  });

  test('cold start refreshes a URL near expiry', () async {
    final service = FakeSupabaseService(now);
    await seededProvider(
      service,
      photoAt(now, expiresAt: now.add(const Duration(minutes: 4))),
    );

    expect(service.refreshCalls, 1);
  });

  test('cold start keeps a URL with sufficient lifetime', () async {
    final service = FakeSupabaseService(now);
    await seededProvider(
      service,
      photoAt(now, expiresAt: now.add(const Duration(minutes: 6))),
    );

    expect(service.refreshCalls, 0);
  });

  test('duplicate merge replaces transient URL and metadata in place',
      () async {
    final service = FakeSupabaseService(now);
    final provider = PhotosProvider(service: service, now: () => now);
    await provider.initialize(accountFingerprint: 'account-a');
    service.pagePhotos = [
      photoAt(now, expiresAt: now.add(const Duration(hours: 6))),
    ];
    await provider.loadPhotos();

    service.newPhotos = [
      photoAt(
        now,
        url: 'https://signed.example/replacement',
        expiresAt: now.add(const Duration(hours: 7)),
      ),
    ];
    await provider.refresh();

    expect(provider.photos, hasLength(1));
    expect(provider.photos.single.url, 'https://signed.example/replacement');
  });

  test('account switch clears old gallery and sync state', () async {
    final service = FakeSupabaseService(now);
    final provider = await seededProvider(
      service,
      photoAt(now, expiresAt: now.add(const Duration(hours: 6))),
    );

    await provider.prepareForAccount('account-b');

    expect(provider.photos, isEmpty);
    expect(await GalleryCache().load(), isEmpty);
    expect(await GalleryCache().loadFingerprint(), 'account-b');
    expect(await PhotoSyncState().load(), isEmpty);
  });

  test('listener callback is ignored after dispose', () async {
    final service = FakeSupabaseService(now);
    final provider = PhotosProvider(service: service, now: () => now);
    await provider.initialize(accountFingerprint: 'account-a');
    await provider.listenForNewPhotos();
    final callback = service.bucketCallback!;

    provider.dispose();
    callback('late-photo.png');
    await Future<void>.delayed(Duration.zero);

    expect(service.fetchSingleCalls, 0);
  });
}
