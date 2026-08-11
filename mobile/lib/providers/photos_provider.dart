import 'dart:async';
import 'package:flutter/material.dart';
import '../services/gallery_cache.dart';
import '../services/photo_image_cache.dart';
import '../services/photo_sync_state.dart';
import '../services/supabase_service.dart';

class PhotosProvider extends ChangeNotifier {
  final SupabaseService _service;
  final GalleryCache _galleryCache;
  final PhotoSyncState _syncState;
  final DateTime Function() _now;
  final Future<void> Function() _clearImageCache;

  List<Photo> _photos = [];
  bool _isLoading = false;
  bool _isRefreshing = false;
  String? _error;
  int _offset = 0;
  bool _hasMore = true;
  bool _initialized = false;
  Set<String> _syncedKeys = {};
  Timer? _fallbackPoll;
  String? _accountFingerprint;
  int _listenerGeneration = 0;
  bool _disposed = false;

  static const int _limit = 50;
  static const Duration _fallbackInterval = Duration(seconds: 15);

  PhotosProvider({
    SupabaseService? service,
    GalleryCache? galleryCache,
    PhotoSyncState? syncState,
    DateTime Function()? now,
    Future<void> Function()? clearImageCache,
  })  : _service = service ?? SupabaseService(),
        _galleryCache = galleryCache ?? GalleryCache(),
        _syncState = syncState ?? PhotoSyncState(),
        _now = now ?? DateTime.now,
        _clearImageCache = clearImageCache ?? PhotoImageCache.clear;

  List<Photo> get photos => _photos;
  bool get isLoading => _isLoading;
  bool get isRefreshing => _isRefreshing;
  String? get error => _error;
  bool get hasMore => _hasMore;

  String get accountFingerprint {
    final fingerprint = _accountFingerprint;
    if (fingerprint == null) {
      throw StateError('Fotoğraf önbelleği için hesap kimliği hazır değil.');
    }
    return fingerprint;
  }

  String cacheKeyFor(Photo photo) {
    return photoImageCacheKey(
      accountFingerprint: accountFingerprint,
      storagePath: photo.storagePath,
    );
  }

  Future<void> initialize({String? accountFingerprint}) async {
    final fingerprint =
        accountFingerprint ?? SupabaseService.accountFingerprint;
    if (fingerprint == null) return;
    if (_initialized && _accountFingerprint == fingerprint) return;

    final cachedFingerprint = await _galleryCache.loadFingerprint();
    if (cachedFingerprint != fingerprint) {
      await _clearImageCache();
      await _galleryCache.clear();
      await _syncState.clear();
      await _galleryCache.saveFingerprint(fingerprint);
    }

    _accountFingerprint = fingerprint;
    _syncedKeys = await _syncState.load();
    _photos = await _galleryCache.load();
    await _refreshExpiringPhotos();
    _initialized = true;
    if (!_disposed) notifyListeners();
  }

  Future<void> _persistGallery() async {
    await _syncState.save(_syncedKeys);
    await _galleryCache.save(_photos);
    final fingerprint = _accountFingerprint;
    if (fingerprint != null) await _galleryCache.saveFingerprint(fingerprint);
  }

  void _markSynced(Photo photo) {
    _syncedKeys.add(PhotoSyncState.makeKeyFromPhoto(photo));
  }

  int _galleryIndex(Photo photo) {
    final key = PhotoSyncState.makeKeyFromPhoto(photo);
    return _photos.indexWhere(
      (p) =>
          p.id == photo.id ||
          p.storagePath == photo.storagePath ||
          PhotoSyncState.makeKeyFromPhoto(p) == key,
    );
  }

  Future<void> _mergeNewPhotos(List<Photo> incoming,
      {bool prepend = true}) async {
    final fresh = <Photo>[];
    var changed = false;
    for (final photo in incoming) {
      final existing = _galleryIndex(photo);
      if (existing >= 0) {
        _photos[existing] = photo;
        changed = true;
      } else {
        fresh.add(photo);
        changed = true;
      }
      _markSynced(photo);
    }
    if (!changed) return;

    if (prepend) {
      _photos.insertAll(0, fresh);
    } else {
      _photos.addAll(fresh);
    }
    await _persistGallery();
    if (!_disposed) notifyListeners();
  }

  Future<void> _refreshExpiringPhotos() async {
    var changed = false;
    for (var index = 0; index < _photos.length; index++) {
      final photo = _photos[index];
      if (photo.hasUsableUrl(_now(),
          refreshWindow: SupabaseService.signedUrlRefreshWindow)) {
        continue;
      }
      try {
        _photos[index] = await _service.refreshSignedUrl(photo);
        changed = true;
      } on SignedUrlException catch (error) {
        _error = error.message;
      }
      if (_disposed) return;
    }
    if (changed) await _persistGallery();
  }

  Future<Photo> ensureFreshPhotoAt(int index) async {
    final current = _photos[index];
    final refreshed = await _service.ensureFreshPhoto(current);
    if (!identical(refreshed, current)) {
      _photos[index] = refreshed;
      await _persistGallery();
      if (!_disposed) notifyListeners();
    }
    return refreshed;
  }

  Future<void> loadPhotos({bool refresh = false}) async {
    if (_isLoading) return;
    await initialize();

    _isLoading = true;
    _error = null;
    if (!_disposed) notifyListeners();

    try {
      if (refresh) {
        final newOnes = await _service.getNewPhotosOnly(knownKeys: _syncedKeys);
        await _mergeNewPhotos(newOnes, prepend: true);
        return;
      }

      final page = await _service.getPhotos(
        limit: _limit,
        offset: _offset,
        knownKeys: _syncedKeys,
        onlySignNew: _offset == 0 && _photos.isEmpty,
      );
      await _mergeNewPhotos(page.photos, prepend: false);
      _hasMore = page.hasMore;
      _offset += page.fetchedCount;
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> refresh() async {
    _isRefreshing = true;
    if (!_disposed) notifyListeners();
    await loadPhotos(refresh: true);
    _isRefreshing = false;
    if (!_disposed) notifyListeners();
  }

  Future<void> loadMore() async {
    if (!_hasMore || _isLoading) return;
    await loadPhotos();
  }

  Future<void> _pollNewPhotos() async {
    if (_isLoading || _isRefreshing) return;
    try {
      final newOnes = await _service.getNewPhotosOnly(knownKeys: _syncedKeys);
      await _mergeNewPhotos(newOnes, prepend: true);
    } catch (e) {
      debugPrint('Gallery fallback poll error: $e');
    }
  }

  Future<void> _addSinglePhoto(String storageName) async {
    if (_isLoading) return;
    try {
      final photo = await _service.fetchPhotoByStorageName(
        storageName,
        knownKeys: _syncedKeys,
      );
      if (photo == null) return;
      await _mergeNewPhotos([photo], prepend: true);
    } catch (e) {
      debugPrint('Single photo sync error: $e');
    }
  }

  void clearError() {
    _error = null;
    if (!_disposed) notifyListeners();
  }

  /// Realtime push + 15s fallback — only new desktop uploads, no full gallery re-sign.
  Future<void> listenForNewPhotos() async {
    final generation = ++_listenerGeneration;
    await _service.listenForBucketInserts((name) {
      if (_disposed || generation != _listenerGeneration) return;
      if (name.startsWith('to_pc/')) return;
      final base = name.split('/').last;
      if (base.startsWith('.')) return;
      _addSinglePhoto(name);
    });

    if (_disposed || generation != _listenerGeneration) {
      await _service.stopBucketListener();
      return;
    }

    _fallbackPoll?.cancel();
    _fallbackPoll = Timer.periodic(_fallbackInterval, (_) => _pollNewPhotos());
  }

  Future<void> stopRealtime() async {
    _listenerGeneration++;
    _fallbackPoll?.cancel();
    _fallbackPoll = null;
    await _service.stopBucketListener();
  }

  Future<void> clearGalleryCache({String? nextFingerprint}) async {
    _photos = [];
    _syncedKeys = {};
    _offset = 0;
    _hasMore = true;
    await _syncState.clear();
    await _galleryCache.clear();
    await _clearImageCache();
    _accountFingerprint = nextFingerprint;
    if (nextFingerprint != null) {
      await _galleryCache.saveFingerprint(nextFingerprint);
    }
    _initialized = false;
    if (!_disposed) notifyListeners();
  }

  Future<void> prepareForAccount(String? nextFingerprint) async {
    await stopRealtime();
    if (_accountFingerprint != nextFingerprint) {
      await clearGalleryCache(nextFingerprint: nextFingerprint);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(stopRealtime());
    super.dispose();
  }
}
