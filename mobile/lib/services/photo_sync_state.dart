import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_service.dart';

/// Tracks which desktop→mobile gallery items were already fetched (signed URL resolved).
class PhotoSyncState {
  static const _keysPref = 'gallery_synced_keys';
  static const maxKeys = 2000;

  static String objectKey(String bucketRelativePath) => 'obj:$bucketRelativePath';

  static String makeKey(FileObject file) => objectKey(file.name);

  static String makeKeyFromPhoto(Photo photo) {
    final path = photo.storagePath;
    final slash = path.indexOf('/');
    final rel = slash >= 0 ? path.substring(slash + 1) : path;
    return objectKey(rel);
  }

  static Future<Set<String>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_keysPref) ?? [];
    return Set<String>.from(list);
  }

  static Future<void> save(Set<String> keys) async {
    final prefs = await SharedPreferences.getInstance();
    final trimmed = keys.toList();
    if (trimmed.length > maxKeys) {
      trimmed.removeRange(0, trimmed.length - maxKeys);
    }
    await prefs.setStringList(_keysPref, trimmed);
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keysPref);
  }
}