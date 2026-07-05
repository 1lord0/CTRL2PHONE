import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'supabase_service.dart';

/// Persists the gallery list so cold starts do not re-sign every screenshot.
class GalleryCache {
  static const _photosPref = 'gallery_photos_cache';

  static Future<List<Photo>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_photosPref);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => Photo.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> save(List<Photo> photos) async {
    final prefs = await SharedPreferences.getInstance();
    final json = jsonEncode(photos.map((p) => p.toJson()).toList());
    await prefs.setString(_photosPref, json);
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_photosPref);
  }
}