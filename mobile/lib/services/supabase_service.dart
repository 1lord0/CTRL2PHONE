import 'dart:io';
import 'dart:typed_data';
import 'package:supabase_flutter/supabase_flutter.dart';

// ============================================================
// Supabase Service: Dinamik Bağlantı + Storage Listeleme
// ============================================================

class SupabaseService {
  static SupabaseClient? _clientInstance;
  static String? _bucketName;

  static bool get isInitialized => _clientInstance != null;

  static void initClient(String url, String key, String bucket) {
    _clientInstance = SupabaseClient(url, key);
    _bucketName = bucket;
  }

  static void clearClient() {
    _clientInstance = null;
    _bucketName = null;
  }

  SupabaseClient? get _client => _clientInstance;
  String get bucketName => _bucketName ?? 'SCREENSHOTS';

  /// Supabase Storage bucket'ından ekran görüntülerini listeler.
  Future<List<Photo>> getPhotos({
    int limit = 50,
    int offset = 0,
  }) async {
    if (!isInitialized) {
      throw Exception('Supabase henüz başlatılmadı. Lütfen ayarlardan kurulum yapın.');
    }

    try {
      final List<FileObject> objects = await _client!.storage
          .from(bucketName)
          .list(
            searchOptions: SearchOptions(
              limit: limit,
              offset: offset,
              sortBy: const SortBy(column: 'created_at', order: 'desc'),
            ),
          );

      // Filtreleme: Klasörler veya gizli sistem dosyalarını temizle (to_pc klasörü dahil)
      final files = objects
          .where((obj) =>
              obj.name != null &&
              !obj.name.startsWith('.') &&
              !obj.name.endsWith('.keep') &&
              obj.name != 'to_pc')
          .toList();

      return files.map((file) {
        return Photo(
          id: file.id ?? file.name,
          storagePath: '$bucketName/${file.name}',
          originalName: file.name,
          fileSize: file.metadata?['size'] as int?,
          mimeType: file.metadata?['mimetype'] as String?,
          uploadedAt: DateTime.parse(file.createdAt ?? DateTime.now().toIso8601String()),
          deviceId: 'Desktop_App',
        );
      }).toList();
    } catch (e) {
      throw Exception('Ekran görüntüleri alınamadı: $e');
    }
  }

  /// Telefondan bilgisayara görsel göndermek için to_pc/ klasörüne yükler.
  Future<void> uploadToPC(Uint8List bytes, String fileName) async {
    if (!isInitialized) {
      throw Exception('Supabase henüz başlatılmadı. Lütfen ayarlardan kurulum yapın.');
    }

    try {
      final path = 'to_pc/$fileName';
      await _client!.storage.from(bucketName).uploadBinary(
            path,
            bytes,
            fileOptions: const FileOptions(
              contentType: 'image/png',
              upsert: true,
            ),
          );
    } catch (e) {
      throw Exception('Görsel yüklenemedi: $e');
    }
  }

  /// Belirli bir fotoğrafın public URL'sini oluşturur.
  String getPhotoUrl(String storagePath) {
    if (!isInitialized) return '';
    final fileName = storagePath.replaceFirst('$bucketName/', '');
    return _client!.storage
        .from(bucketName)
        .getPublicUrl(fileName);
  }

  /// Storage doluluğunu ve limitini döner (1 GB free tier limiti ile karşılaştırır)
  Future<Map<String, dynamic>> getStorageUsage() async {
    if (!isInitialized) {
      return {'usedBytes': 0, 'limitBytes': 1024 * 1024 * 1024, 'percentage': 0.0};
    }

    try {
      final List<FileObject> rootFiles = await _client!.storage.from(bucketName).list(
            searchOptions: const SearchOptions(limit: 1000),
          );
      
      List<FileObject> toPcFiles = [];
      try {
        toPcFiles = await _client!.storage.from(bucketName).list(
              path: 'to_pc',
              searchOptions: const SearchOptions(limit: 1000),
            );
      } catch (_) {
        // ignore if folder does not exist
      }

      int totalBytes = 0;
      for (final file in rootFiles) {
        if (file.name != 'to_pc') {
          totalBytes += file.metadata?['size'] as int? ?? 0;
        }
      }
      for (final file in toPcFiles) {
        totalBytes += file.metadata?['size'] as int? ?? 0;
      }

      const int limitBytes = 1024 * 1024 * 1024; // 1 GB
      double percentage = (totalBytes / limitBytes) * 100;
      if (percentage > 100.0) percentage = 100.0;

      return {
        'usedBytes': totalBytes,
        'limitBytes': limitBytes,
        'percentage': percentage,
      };
    } catch (e) {
      throw Exception('Doluluğu sorgulama hatası: $e');
    }
  }

  /// Storage bucket'ındaki tüm görselleri kalıcı olarak temizler
  Future<int> purgeStorage() async {
    if (!isInitialized) return 0;

    try {
      final List<FileObject> rootFiles = await _client!.storage.from(bucketName).list(
            searchOptions: const SearchOptions(limit: 1000),
          );

      List<FileObject> toPcFiles = [];
      try {
        toPcFiles = await _client!.storage.from(bucketName).list(
              path: 'to_pc',
              searchOptions: const SearchOptions(limit: 1000),
            );
      } catch (_) {}

      final List<String> filesToDelete = [];
      for (final file in rootFiles) {
        if (file.name != 'to_pc' && file.name != '.keep' && !file.name.startsWith('.')) {
          filesToDelete.add(file.name);
        }
      }
      for (final file in toPcFiles) {
        if (file.name != '.keep' && !file.name.startsWith('.')) {
          filesToDelete.add('to_pc/${file.name}');
        }
      }

      if (filesToDelete.isNotEmpty) {
        await _client!.storage.from(bucketName).remove(filesToDelete);
      }

      return filesToDelete.length;
    } catch (e) {
      throw Exception('Temizleme hatası: $e');
    }
  }
}

// ============================================================
// Photo Model
// ============================================================
class Photo {
  final String id;
  final String storagePath;
  final String? originalName;
  final int? fileSize;
  final String? mimeType;
  final DateTime uploadedAt;
  final String? deviceId;

  Photo({
    required this.id,
    required this.storagePath,
    this.originalName,
    this.fileSize,
    this.mimeType,
    required this.uploadedAt,
    this.deviceId,
  });

  factory Photo.fromJson(Map<String, dynamic> json) {
    return Photo(
      id: json['id'] as String,
      storagePath: json['storage_path'] as String,
      originalName: json['original_name'] as String?,
      fileSize: json['file_size'] as int?,
      mimeType: json['mime_type'] as String?,
      uploadedAt: DateTime.parse(json['uploaded_at'] as String),
      deviceId: json['device_id'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'storage_path': storagePath,
        'original_name': originalName,
        'file_size': fileSize,
        'mime_type': mimeType,
        'uploaded_at': uploadedAt.toIso8601String(),
        'device_id': deviceId,
      };
}
