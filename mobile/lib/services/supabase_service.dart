import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'gallery_paging.dart';
import 'photo_sync_state.dart';
import 'connection_settings_store.dart';

const int clipboardContentMaxLength = 10000;

String? validateClipboardText(String text) {
  if (text.trim().isEmpty) {
    return 'Pano metni boş olamaz.';
  }
  if (text.runes.length > clipboardContentMaxLength) {
    return 'Pano metni en fazla $clipboardContentMaxLength karakter olabilir.';
  }
  return null;
}

// ============================================================
// Supabase Service: Dinamik Bağlantı + Storage Listeleme
// ============================================================

class SupabaseService {
  static const signedUrlLifetime = Duration(hours: 6);
  static const signedUrlRefreshWindow = Duration(minutes: 5);
  static SupabaseClient? _clientInstance;
  static String? _bucketName;
  static String? _accountFingerprint;
  static RealtimeChannel? _galleryChannel;
  final DateTime Function() _now;

  SupabaseService({DateTime Function()? now}) : _now = now ?? DateTime.now;

  static bool get isInitialized => _clientInstance != null;

  static SupabaseClient? get client => _clientInstance;
  static String? get accountFingerprint => _accountFingerprint;

  static void initClient(String url, String key, String bucket) {
    _clientInstance = SupabaseClient(url, key);
    _bucketName = bucket;
    _accountFingerprint = connectionFingerprint(url, bucket);
  }

  static Future<void> clearClient() async {
    await unsubscribeClipboard();
    await SupabaseService().stopBucketListener();
    _clientInstance = null;
    _bucketName = null;
    _accountFingerprint = null;
  }

  /// Live updates: subscribe to INSERTs on this bucket's storage.objects so the
  /// gallery refreshes the instant the desktop uploads a screenshot. Requires
  /// the one-time setup SQL (publication + anon SELECT). No-op until configured.
  Future<void> listenForBucketInserts(
      void Function(String name) onInsert) async {
    await stopBucketListener();
    final client = _clientInstance;
    if (client == null) return;

    final channel = client.channel('ctrl2phone-gallery');
    channel
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'storage',
          table: 'objects',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'bucket_id',
            // bucket_id == bucket name for user-created Supabase buckets.
            value: bucketName,
          ),
          callback: (payload) {
            final name = payload.newRecord['name'] as String?;
            if (name != null) onInsert(name);
          },
        )
        .subscribe();
    _galleryChannel = channel;
  }

  Future<void> stopBucketListener() async {
    final ch = _galleryChannel;
    if (ch != null) {
      _galleryChannel = null;
      await _clientInstance?.removeChannel(ch);
    }
  }

  SupabaseClient? get _client => _clientInstance;
  String get bucketName => _bucketName ?? 'SCREENSHOTS';

  Future<Photo> _buildPhotoFromFile(FileObject file) async {
    final photo = Photo(
      id: file.id ?? file.name,
      storagePath: '$bucketName/${file.name}',
      originalName: file.name,
      fileSize: file.metadata?['size'] as int?,
      mimeType: file.metadata?['mimetype'] as String?,
      uploadedAt:
          DateTime.parse(file.createdAt ?? DateTime.now().toIso8601String()),
      deviceId: 'Desktop_App',
    );
    return refreshSignedUrl(photo);
  }

  Future<Photo> refreshSignedUrl(Photo photo) async {
    final client = _client;
    if (client == null) {
      throw const SignedUrlException('Supabase bağlantısı etkin değil.');
    }
    final prefix = '$bucketName/';
    final storageName = photo.storagePath.startsWith(prefix)
        ? photo.storagePath.substring(prefix.length)
        : photo.storagePath;
    try {
      final url = await client.storage
          .from(bucketName)
          .createSignedUrl(storageName, signedUrlLifetime.inSeconds);
      return photo.copyWith(
        url: url,
        urlExpiresAt: _now().toUtc().add(signedUrlLifetime),
      );
    } catch (error) {
      throw SignedUrlException(
        'Özel bucket için signed URL oluşturulamadı. RLS ve bucket ayarlarını kontrol edin.',
        error,
      );
    }
  }

  Future<Photo> ensureFreshPhoto(Photo photo) async {
    if (photo.hasUsableUrl(_now(), refreshWindow: signedUrlRefreshWindow)) {
      return photo;
    }
    return refreshSignedUrl(photo);
  }

  /// Lists bucket root and returns only photos not yet synced (no repeat signing).
  Future<List<Photo>> getNewPhotosOnly({
    required Set<String> knownKeys,
    int limit = 100,
  }) async {
    if (!isInitialized) {
      throw Exception(
          'Supabase henüz başlatılmadı. Lütfen ayarlardan kurulum yapın.');
    }

    final List<FileObject> objects =
        await _client!.storage.from(bucketName).list(
              searchOptions: SearchOptions(
                limit: limit,
                offset: 0,
                sortBy: const SortBy(column: 'created_at', order: 'desc'),
              ),
            );

    final files = objects.where((obj) => isVisiblePhotoName(obj.name)).toList();
    final photos = <Photo>[];

    for (final file in files) {
      final key = PhotoSyncState.makeKey(file);
      if (knownKeys.contains(key)) continue;
      photos.add(await _buildPhotoFromFile(file));
    }

    return photos;
  }

  /// Realtime INSERT: resolve a single new desktop upload without listing the bucket.
  Future<Photo?> fetchPhotoByStorageName(
    String storageName, {
    required Set<String> knownKeys,
  }) async {
    if (!isInitialized) return null;
    final base = storageName.split('/').last;
    if (!isVisiblePhotoName(base)) return null;

    final pathKey = PhotoSyncState.objectKey(storageName);
    if (knownKeys.contains(pathKey)) return null;

    return refreshSignedUrl(Photo(
      id: storageName,
      storagePath: '$bucketName/$storageName',
      originalName: base,
      uploadedAt: DateTime.now(),
      deviceId: 'Desktop_App',
    ));
  }

  /// Supabase Storage bucket'ından ekran görüntülerini listeler.
  Future<PhotoPage> getPhotos({
    int limit = 50,
    int offset = 0,
    Set<String> knownKeys = const {},
    bool onlySignNew = false,
  }) async {
    if (!isInitialized) {
      throw Exception(
          'Supabase henüz başlatılmadı. Lütfen ayarlardan kurulum yapın.');
    }

    try {
      final List<FileObject> objects =
          await _client!.storage.from(bucketName).list(
                searchOptions: SearchOptions(
                  limit: limit,
                  offset: offset,
                  sortBy: const SortBy(column: 'created_at', order: 'desc'),
                ),
              );

      // Sayfalamayı HAM sunucu sayısına göre yap (filtrelemeden önce); böylece
      // .keep / to_pc / gizli kayıtları gizlemek galeriyi erken kesmez.
      final bool hasMore = computeHasMore(objects.length, limit);

      // Filtreleme: Klasörler veya gizli sistem dosyalarını temizle (to_pc klasörü dahil)
      final files =
          objects.where((obj) => isVisiblePhotoName(obj.name)).toList();

      final photos = <Photo>[];
      for (final file in files) {
        if (onlySignNew) {
          final key = PhotoSyncState.makeKey(file);
          if (knownKeys.contains(key)) continue;
        }
        photos.add(await _buildPhotoFromFile(file));
      }

      return PhotoPage(
        photos: photos,
        hasMore: hasMore,
        fetchedCount: objects.length,
      );
    } on SignedUrlException {
      rethrow;
    } catch (e) {
      throw Exception('Ekran görüntüleri alınamadı: $e');
    }
  }

  /// Telefondan bilgisayara görsel göndermek için to_pc/ klasörüne yükler.
  Future<void> uploadToPC(Uint8List bytes, String fileName) async {
    if (!isInitialized) {
      throw Exception(
          'Supabase henüz başlatılmadı. Lütfen ayarlardan kurulum yapın.');
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

  /// Storage doluluğunu ve limitini döner (1 GB free tier limiti ile karşılaştırır)
  Future<Map<String, dynamic>> getStorageUsage() async {
    if (!isInitialized) {
      return {
        'usedBytes': 0,
        'limitBytes': 1024 * 1024 * 1024,
        'percentage': 0.0
      };
    }

    try {
      final client = _client!;
      final bucket = bucketName;
      final rootFiles = await _listAllStorageObjects(client, bucket);
      final toPcFiles = await _listAllStorageObjects(
        client,
        bucket,
        path: 'to_pc',
      );

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
      final client = _client!;
      final bucket = bucketName;
      final rootFiles = await _listAllStorageObjects(client, bucket);
      final toPcFiles = await _listAllStorageObjects(
        client,
        bucket,
        path: 'to_pc',
      );
      final filesToDelete = buildStorageDeletionPaths(
        rootNames: rootFiles.map((file) => file.name),
        toPcNames: toPcFiles.map((file) => file.name),
      );

      return deleteStorageInBatches<String>(
        items: filesToDelete,
        deleteBatch: (batch) async {
          final removed = await client.storage.from(bucket).remove(batch);
          return removed.length;
        },
      );
    } on StorageDeletionException {
      rethrow;
    } catch (e) {
      throw Exception('Temizleme hatası: $e');
    }
  }

  Future<List<FileObject>> _listAllStorageObjects(
    SupabaseClient client,
    String bucket, {
    String? path,
  }) {
    final storage = client.storage.from(bucket);
    return collectOffsetPages<FileObject>(
      fetchPage: (offset, limit) => storage.list(
        path: path,
        searchOptions: SearchOptions(
          limit: limit,
          offset: offset,
          sortBy: const SortBy(column: 'name', order: 'asc'),
        ),
      ),
      keyOf: (file) => file.name,
    );
  }

  // ============================================================
  // Clipboard Sync: Metin/Link Paylaşımı (Polling)
  // ============================================================

  static Timer? _clipboardTimer;
  static bool _isPollingClipboard = false;
  static Future<void>? _clipboardInFlight;
  static int _clipboardGeneration = 0;
  static String? _lastProcessedClipboardId;

  /// Masaüstünden gelen metinleri dinlemek için 1.5 saniyelik polling başlatır.
  /// [onReceived] callback'i yeni metin geldiğinde çağrılır.
  static Future<void> subscribeToClipboard(
      void Function(String content) onReceived) async {
    if (!isInitialized || _clientInstance == null) return;

    await unsubscribeClipboard();
    final generation = ++_clipboardGeneration;
    final client = _clientInstance!;

    _clipboardTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) {
      if (_isPollingClipboard) return;
      _isPollingClipboard = true;
      final operation = () async {
        try {
          final List<dynamic> response = await client
              .from('clipboard_sync')
              .select()
              .eq('source', 'desktop')
              .order('created_at', ascending: true)
              .limit(1);

          if (generation != _clipboardGeneration) return;
          if (response.isNotEmpty) {
            final row = response.first;
            final id = row['id'] as String?;
            if (id != _lastProcessedClipboardId) {
              _lastProcessedClipboardId = id;
              final content = row['content'] as String?;
              if (content != null && content.isNotEmpty) {
                onReceived(content);
              }
            }

            if (id != null && generation == _clipboardGeneration) {
              await client.from('clipboard_sync').delete().eq('id', id);
            }
          }
        } catch (e) {
          debugPrint('Clipboard polling error: $e');
        } finally {
          _isPollingClipboard = false;
        }
      }();
      _clipboardInFlight = operation;
      operation.whenComplete(() {
        if (identical(_clipboardInFlight, operation)) _clipboardInFlight = null;
      });
    });

    debugPrint('Clipboard polling initialized (1.5s)');
  }

  /// Polling'i kapatır.
  static Future<void> unsubscribeClipboard() async {
    _clipboardGeneration++;
    _clipboardTimer?.cancel();
    _clipboardTimer = null;
    await _clipboardInFlight;
    _clipboardInFlight = null;
    _isPollingClipboard = false;
    debugPrint('Clipboard polling stopped');
  }

  /// Telefondaki metni masaüstüne göndermek için clipboard_sync tablosuna INSERT eder.
  Future<void> sendClipboardText(String text) async {
    final validationError = validateClipboardText(text);
    if (validationError != null) {
      throw Exception(validationError);
    }
    if (!isInitialized) {
      throw Exception('Supabase henüz başlatılmadı.');
    }

    try {
      await _client!.from('clipboard_sync').insert({
        'content': text,
        'source': 'mobile',
      });
    } catch (e) {
      throw Exception('Metin gönderilemedi: $e');
    }
  }
}

// ============================================================
// Photo Page — bir sayfa sonucu + sayfalama bilgisi
// ============================================================
class PhotoPage {
  /// Görüntülenecek (filtrelenmiş) fotoğraflar.
  final List<Photo> photos;

  /// Sunucuda daha fazla sayfa olup olmadığı (ham sayıya göre).
  final bool hasMore;

  /// Sunucudan dönen HAM kayıt sayısı (offset ilerletmek için).
  final int fetchedCount;

  const PhotoPage({
    required this.photos,
    required this.hasMore,
    required this.fetchedCount,
  });
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

  /// Görüntüleme/indirme için çözülmüş (signed veya public) URL.
  final String url;
  final DateTime? urlExpiresAt;

  Photo({
    required this.id,
    required this.storagePath,
    this.originalName,
    this.fileSize,
    this.mimeType,
    required this.uploadedAt,
    this.deviceId,
    this.url = '',
    this.urlExpiresAt,
  });

  bool hasUsableUrl(DateTime now,
      {Duration refreshWindow = const Duration(minutes: 5)}) {
    final expiry = urlExpiresAt;
    return url.isNotEmpty &&
        expiry != null &&
        expiry.isAfter(now.toUtc().add(refreshWindow));
  }

  Photo copyWith({String? url, DateTime? urlExpiresAt}) => Photo(
        id: id,
        storagePath: storagePath,
        originalName: originalName,
        fileSize: fileSize,
        mimeType: mimeType,
        uploadedAt: uploadedAt,
        deviceId: deviceId,
        url: url ?? this.url,
        urlExpiresAt: urlExpiresAt ?? this.urlExpiresAt,
      );

  factory Photo.fromJson(Map<String, dynamic> json) {
    return Photo(
      id: json['id'] as String,
      storagePath: json['storage_path'] as String,
      originalName: json['original_name'] as String?,
      fileSize: json['file_size'] as int?,
      mimeType: json['mime_type'] as String?,
      uploadedAt: DateTime.parse(json['uploaded_at'] as String),
      deviceId: json['device_id'] as String?,
      url: json['url'] as String? ?? '',
      urlExpiresAt: json['url_expires_at'] == null
          ? null
          : DateTime.tryParse(json['url_expires_at'] as String),
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
        'url': url,
        'url_expires_at': urlExpiresAt?.toUtc().toIso8601String(),
      };
}

class SignedUrlException implements Exception {
  final String message;
  final Object? cause;

  const SignedUrlException(this.message, [this.cause]);

  @override
  String toString() => message;
}
