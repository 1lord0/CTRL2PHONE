import 'package:flutter/material.dart';
import '../services/supabase_service.dart';

class PhotosProvider extends ChangeNotifier {
  final SupabaseService _service = SupabaseService();

  List<Photo> _photos = [];
  bool _isLoading = false;
  bool _isRefreshing = false;
  String? _error;
  int _offset = 0;
  bool _hasMore = true;

  static const int _limit = 50;

  List<Photo> get photos => _photos;
  bool get isLoading => _isLoading;
  bool get isRefreshing => _isRefreshing;
  String? get error => _error;
  bool get hasMore => _hasMore;

  Future<void> loadPhotos({bool refresh = false}) async {
    if (_isLoading) return;

    if (refresh) {
      _offset = 0;
      _hasMore = true;
      _photos = [];
    }

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final page = await _service.getPhotos(limit: _limit, offset: _offset);
      _photos.addAll(page.photos);
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

  void clearError() {
    _error = null;
    notifyListeners();
  }

  /// Start live updates: refresh the gallery the instant the desktop uploads a
  /// new screenshot (Realtime push instead of manual pull-to-refresh).
  void listenForNewPhotos() {
    _service.listenForBucketInserts((name) {
      final base = name.split('/').last;
      // A new root object (not the to_pc/ outbox, not a hidden file) is a fresh
      // screenshot coming from the desktop.
      if (!name.startsWith('to_pc/') && !base.startsWith('.')) {
        refresh();
      }
    });
  }

  void stopRealtime() {
    _service.stopBucketListener();
  }

  @override
  void dispose() {
    stopRealtime();
    super.dispose();
  }
}
