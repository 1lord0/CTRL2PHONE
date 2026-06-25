import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

// ============================================================
// Photo Card: Grid'deki tek bir fotoğraf öğesi
// ============================================================
// • CachedNetworkImage: Hızlı tekrar yüklenme, önbellek
// • Placeholder: Yüklenirken CircularProgressIndicator
// • Error: Kırmızı hata ikonu
// • Tap: Tam ekran açma
// ============================================================

class PhotoCard extends StatelessWidget {
  final String imageUrl;
  final VoidCallback onTap;

  const PhotoCard({
    super.key,
    required this.imageUrl,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Hero(
        tag: imageUrl,
        child: Container(
          color: Colors.grey[200],
          child: CachedNetworkImage(
            imageUrl: imageUrl,
            fit: BoxFit.cover,
            placeholder: (context, url) => Container(
              color: Colors.grey[300],
              child: const Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                  ),
                ),
              ),
            ),
            errorWidget: (context, url, error) => Container(
              color: Colors.grey[300],
              child: const Icon(
                Icons.error,
                color: Colors.red,
                size: 24,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
