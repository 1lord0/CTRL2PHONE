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
      final photos = await _service.getPhotos(limit: _limit, offset: _offset);
      _photos.addAll(photos);
      _hasMore = photos.length == _limit;
      _offset += photos.length;
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
}
