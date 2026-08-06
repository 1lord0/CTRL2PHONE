import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_service.dart';

/// Tracks which desktop→mobile gallery items were already fetched (signed URL resolved).
class PhotoSyncState {
  static const _keysPref = 'gallery_synced_keys';
  static const maxKeys = 2000;
  final Future<SharedPreferences> Function() _preferences;

  PhotoSyncState({Future<SharedPreferences> Function()? preferences})
      : _preferences = preferences ?? SharedPreferences.getInstance;

  static String objectKey(String bucketRelativePath) =>
      'obj:$bucketRelativePath';

  static String makeKey(FileObject file) => objectKey(file.name);

  static String makeKeyFromPhoto(Photo photo) {
    final path = photo.storagePath;
    final slash = path.indexOf('/');
    final rel = slash >= 0 ? path.substring(slash + 1) : path;
    return objectKey(rel);
  }

  Future<Set<String>> load() async {
    final prefs = await _preferences();
    final list = prefs.getStringList(_keysPref) ?? [];
    return Set<String>.from(list);
  }

  Future<void> save(Set<String> keys) async {
    final prefs = await _preferences();
    final trimmed = keys.toList();
    if (trimmed.length > maxKeys) {
      trimmed.removeRange(0, trimmed.length - maxKeys);
    }
    await prefs.setStringList(_keysPref, trimmed);
  }

  Future<void> clear() async {
    final prefs = await _preferences();
    await prefs.remove(_keysPref);
  }
}
