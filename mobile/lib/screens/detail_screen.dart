import 'dart:io';
import 'package:flutter/material.dart';
import 'package:photo_view/photo_view.dart';
import 'package:photo_view/photo_view_gallery.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:gal/gal.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import '../services/supabase_service.dart';

// ============================================================
// Detail Screen: Tam Ekran + Swipe + Zoom
// ============================================================
// • PageView.builder ile sağa/sola kaydırma (swipe)
// • PhotoView ile pinch-to-zoom
// • Siyah arka plan (galeri hissi)
// • Fotoğraf index'i ve toplam sayı göstergesi
// • AppBar'da geri butonu + fotoğraf adı
// • Hero transition (opsiyonel, basit tutuldu)
// ============================================================

class DetailScreen extends StatefulWidget {
  final List<Photo> photos;
  final int initialIndex;

  const DetailScreen({
    super.key,
    required this.photos,
    required this.initialIndex,
  });

  @override
  State<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> {
  late PageController _pageController;
  late int _currentIndex;

  // Zoom kontrolü
  final PhotoViewComputedScale _minScale = PhotoViewComputedScale.contained;
  final PhotoViewComputedScale _maxScale = PhotoViewComputedScale.covered * 2.5;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() => _currentIndex = index);
  }

  // --- Build ---

  @override
  Widget build(BuildContext context) {
    final currentPhoto = widget.photos[_currentIndex];

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.black.withValues(alpha: 0.4),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          currentPhoto.originalName ?? 'Fotoğraf',
          style: const TextStyle(color: Colors.white, fontSize: 14),
          overflow: TextOverflow.ellipsis,
        ),
        centerTitle: true,
        actions: [
          // Download button
          IconButton(
            icon: const Icon(Icons.download, color: Colors.white),
            tooltip: 'Galeriye Kaydet',
            onPressed: () => _downloadAndSave(currentPhoto),
          ),
          // Fotoğraf bilgisi
          IconButton(
            icon: const Icon(Icons.info_outline, color: Colors.white70),
            onPressed: () => _showPhotoInfo(currentPhoto),
          ),
        ],
      ),
      body: Stack(
        children: [
          // --- TAM EKRAN FOTOĞRAF GALERİSİ ---
          PhotoViewGallery.builder(
            scrollPhysics: const BouncingScrollPhysics(),
            builder: (context, index) {
              final photo = widget.photos[index];
              final url = photo.url;

              return PhotoViewGalleryPageOptions(
                imageProvider: CachedNetworkImageProvider(url),
                minScale: _minScale,
                maxScale: _maxScale,
                initialScale: PhotoViewComputedScale.contained,
                heroAttributes: PhotoViewHeroAttributes(
                  tag: 'photo_${photo.id}',
                ),
                errorBuilder: (context, error, stackTrace) => const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error, color: Colors.white, size: 48),
                      SizedBox(height: 8),
                      Text('Fotoğraf yüklenemedi', style: TextStyle(color: Colors.white70)),
                    ],
                  ),
                ),
              );
            },
            itemCount: widget.photos.length,
            loadingBuilder: (context, event) => const Center(
              child: CircularProgressIndicator(
                color: Colors.white,
                strokeWidth: 2,
              ),
            ),
            pageController: _pageController,
            onPageChanged: _onPageChanged,
            backgroundDecoration: const BoxDecoration(color: Colors.black),
            scrollDirection: Axis.horizontal, // Yatay swipe
          ),

          // --- ALT İNDİKATÖR ---
          Positioned(
            bottom: 32,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Sayı göstergesi
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      '${_currentIndex + 1} / ${widget.photos.length}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Sayfa noktaları (opsiyonel, çok fazla fotoğraf varsa gizlenebilir)
                  if (widget.photos.length <= 20)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(widget.photos.length, (index) {
                        return Container(
                          width: 6,
                          height: 6,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: index == _currentIndex
                                ? Colors.white
                                : Colors.white.withValues(alpha: 0.3),
                          ),
                        );
                      }),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // --- Fotoğraf İndirme ve Galeriye Kaydetme ---

  Future<void> _downloadAndSave(Photo photo) async {
    // Yükleniyor diyaloğu göster
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(
        child: CircularProgressIndicator(
          color: Colors.white,
        ),
      ),
    );

    try {
      final hasAccess = await Gal.hasAccess();
      if (!hasAccess) {
        final requestAccess = await Gal.requestAccess();
        if (!requestAccess) {
          if (mounted) {
            Navigator.pop(context); // Yükleniyor diyaloğunu kapat
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Galeriye kaydetmek için izin verilmedi.'),
                backgroundColor: Color(0xFF2A2A2A),
              ),
            );
          }
          return;
        }
      }

      // Signed URL zaten benzersiz token taşır; ayrı cache-buster eklemek
      // bağlantıyı bozar (çift '?'). Doğrudan kullan.
      final url = Uri.parse(photo.url);
      final response = await http.get(url);

      if (response.statusCode != 200) {
        throw Exception('Görsel indirilemedi (${response.statusCode})');
      }

      final tempDir = await getTemporaryDirectory();
      final tempFile = File('${tempDir.path}/${photo.originalName ?? 'screenshot.jpg'}');
      await tempFile.writeAsBytes(response.bodyBytes);

      await Gal.putImage(tempFile.path);

      if (mounted) {
        Navigator.pop(context); // Yükleniyor diyaloğunu kapat
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle_outline_rounded, color: Colors.greenAccent, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Görsel galeriye kaydedildi: ${photo.originalName}',
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              ],
            ),
            backgroundColor: const Color(0xFF141414),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context); // Yükleniyor diyaloğunu kapat
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Hata: ${e.toString()}'),
            backgroundColor: const Color(0xFF2A2A2A),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        );
      }
    }
  }

  // --- Fotoğraf Bilgisi Dialog ---

  void _showPhotoInfo(Photo photo) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.black.withValues(alpha: 0.9),
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Fotoğraf Bilgisi',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Divider(color: Colors.white24),
              _buildInfoRow('Dosya Adı', photo.originalName ?? 'Bilinmiyor'),
              _buildInfoRow('Boyut', '${photo.fileSize != null ? (photo.fileSize! / 1024).toStringAsFixed(1) : '?'} KB'),
              _buildInfoRow('Tür', photo.mimeType ?? 'image/jpeg'),
              _buildInfoRow('Yüklenme', _formatDate(photo.uploadedAt)),
              _buildInfoRow('Cihaz', photo.deviceId ?? 'Bilinmiyor'),
              _buildInfoRow('Storage Path', photo.storagePath),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              overflow: TextOverflow.ellipsis,
              maxLines: 2,
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime dt) {
    return '${dt.day.toString().padLeft(2, '0')}.${dt.month.toString().padLeft(2, '0')}.${dt.year} '
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
