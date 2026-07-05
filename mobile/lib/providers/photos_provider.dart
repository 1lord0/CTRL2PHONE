import 'dart:async';
import 'package:flutter/material.dart';
import '../services/gallery_cache.dart';
import '../services/photo_sync_state.dart';
import '../services/supabase_service.dart';

class PhotosProvider extends ChangeNotifier {
  final SupabaseService _service = SupabaseService();

  List<Photo> _photos = [];
  bool _isLoading = false;
  bool _isRefreshing = false;
  String? _error;
  int _offset = 0;
  bool _hasMore = true;
  bool _initialized = false;
  Set<String> _syncedKeys = {};
  Timer? _fallbackPoll;

  static const int _limit = 50;
  static const Duration _fallbackInterval = Duration(seconds: 15);

  List<Photo> get photos => _photos;
  bool get isLoading => _isLoading;
  bool get isRefreshing => _isRefreshing;
  String? get error => _error;
  bool get hasMore => _hasMore;

  Future<void> initialize() async {
    if (_initialized) return;
    _syncedKeys = await PhotoSyncState.load();
    _photos = await GalleryCache.load();
    _initialized = true;
    notifyListeners();
  }

  Future<void> _persistGallery() async {
    await PhotoSyncState.save(_syncedKeys);
    await GalleryCache.save(_photos);
  }

  void _markSynced(Photo photo) {
    _syncedKeys.add(PhotoSyncState.makeKeyFromPhoto(photo));
  }

  bool _alreadyInGallery(Photo photo) {
    final key = PhotoSyncState.makeKeyFromPhoto(photo);
    return _photos.any(
      (p) =>
          p.id == photo.id ||
          p.storagePath == photo.storagePath ||
          PhotoSyncState.makeKeyFromPhoto(p) == key,
    );
  }

  Future<void> _mergeNewPhotos(List<Photo> incoming, {bool prepend = true}) async {
    final fresh = <Photo>[];
    for (final photo in incoming) {
      if (_alreadyInGallery(photo)) continue;
      fresh.add(photo);
      _markSynced(photo);
    }
    if (fresh.isEmpty) return;

    if (prepend) {
      _photos.insertAll(0, fresh);
    } else {
      _photos.addAll(fresh);
    }
    await _persistGallery();
    notifyListeners();
  }

  Future<void> loadPhotos({bool refresh = false}) async {
    if (_isLoading) return;
    await initialize();

    _isLoading = true;
    _error = null;
    notifyListeners();

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
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    _isRefreshing = true;
    notifyListeners();
    await loadPhotos(refresh: true);
    _isRefreshing = false;
    notifyListeners();
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
    notifyListeners();
  }

  /// Realtime push + 15s fallback — only new desktop uploads, no full gallery re-sign.
  void listenForNewPhotos() {
    _service.listenForBucketInserts((name) {
      if (name.startsWith('to_pc/')) return;
      final base = name.split('/').last;
      if (base.startsWith('.')) return;
      _addSinglePhoto(name);
    });

    _fallbackPoll?.cancel();
    _fallbackPoll = Timer.periodic(_fallbackInterval, (_) => _pollNewPhotos());
  }

  void stopRealtime() {
    _fallbackPoll?.cancel();
    _fallbackPoll = null;
    _service.stopBucketListener();
  }

  Future<void> clearGalleryCache() async {
    _photos = [];
    _syncedKeys = {};
    _offset = 0;
    _hasMore = true;
    await PhotoSyncState.clear();
    await GalleryCache.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    stopRealtime();
    super.dispose();
  }
}