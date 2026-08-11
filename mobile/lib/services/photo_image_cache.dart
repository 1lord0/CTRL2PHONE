import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';

const photoImageCacheNamespace = 'ctrl2phone-photo-images-v1';
const photoImageCacheRetention = Duration(days: 3650);
const photoImageCacheObjectLimit = 2000;

String photoImageCacheKey({
  required String accountFingerprint,
  required String storagePath,
}) {
  final identity = '${accountFingerprint.trim()}\n${storagePath.trim()}';
  return sha256.convert(utf8.encode(identity)).toString();
}

/// Long-lived disk cache for Supabase photos.
///
/// Signed URLs are temporary access credentials, so they must never identify a
/// cached file. The stable cache key above isolates identical storage paths
/// between different Supabase projects while allowing URL refreshes to reuse
/// the bytes already stored on the phone.
class PhotoImageCache {
  PhotoImageCache._();

  static final CacheManager manager = CacheManager(
    Config(
      photoImageCacheNamespace,
      stalePeriod: photoImageCacheRetention,
      maxNrOfCacheObjects: photoImageCacheObjectLimit,
    ),
  );

  static Future<File> getFile({
    required String url,
    required String cacheKey,
  }) =>
      manager.getSingleFile(url, key: cacheKey);

  static Future<void> clear() => manager.emptyCache();
}
