import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'supabase_service.dart';

/// Persists the gallery list so cold starts do not re-sign every screenshot.
class GalleryCache {
  static const _photosPref = 'gallery_photos_cache';
  static const _fingerprintPref = 'gallery_account_fingerprint';
  final Future<SharedPreferences> Function() _preferences;

  GalleryCache({Future<SharedPreferences> Function()? preferences})
      : _preferences = preferences ?? SharedPreferences.getInstance;

  Future<List<Photo>> load() async {
    final prefs = await _preferences();
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

  Future<void> save(List<Photo> photos) async {
    final prefs = await _preferences();
    final json = jsonEncode(photos.map((p) => p.toJson()).toList());
    await prefs.setString(_photosPref, json);
  }

  Future<String?> loadFingerprint() async {
    final prefs = await _preferences();
    return prefs.getString(_fingerprintPref);
  }

  Future<void> saveFingerprint(String fingerprint) async {
    final prefs = await _preferences();
    await prefs.setString(_fingerprintPref, fingerprint);
  }

  Future<void> clear({bool includeFingerprint = true}) async {
    final prefs = await _preferences();
    await prefs.remove(_photosPref);
    if (includeFingerprint) await prefs.remove(_fingerprintPref);
  }
}
