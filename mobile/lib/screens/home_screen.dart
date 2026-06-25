import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/supabase_service.dart';
import '../widgets/photo_card.dart';
import 'detail_screen.dart';
import 'settings_screen.dart';

// ============================================================
// Home Screen: Telefon Ana Ekranı — 3 Sütun Grid
// ============================================================
// • Fotoğraflar Supabase'den çekilir
// • 3 sütunlu grid görünümü
// • Pull-to-refresh desteği
// • Fotoğraf tıklama → DetailScreen (tam ekran + swipe)
// • Infinite scroll desteği (opsiyonel, basit tutuldu)
// ============================================================

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final SupabaseService _service = SupabaseService();

  List<Photo> _photos = [];
  bool _isLoading = false;
  bool _isRefreshing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPhotos();
  }

  // --- Veri Yükleme ---

  Future<void> _loadPhotos() async {
    if (_isLoading) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final photos = await _service.getPhotos(limit: 50);
      setState(() => _photos = photos);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _onRefresh() async {
    setState(() => _isRefreshing = true);
    await _loadPhotos();
    setState(() => _isRefreshing = false);
  }

  // --- Navigation ---

  void _onPhotoTap(int index) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DetailScreen(
          photos: _photos,
          initialIndex: index,
        ),
      ),
    );
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Çıkış Yap'),
        content: const Text('Supabase bağlantı bilgileri silinecek ve giriş ekranına dönülecektir. Emin misiniz?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Çıkış'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('supabase_url');
      await prefs.remove('supabase_anon_key');
      await prefs.remove('supabase_bucket');

      SupabaseService.clearClient();

      if (mounted) {
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const SettingsScreen(isInitialSetup: true)),
          (route) => false,
        );
      }
    }
  }

  // --- Build ---

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fotoğraf Galerisi'),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Yenile',
            onPressed: _isLoading ? null : _loadPhotos,
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Ayarlar',
            onPressed: () async {
              final result = await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SettingsScreen(isInitialSetup: false)),
              );
              if (result == true) {
                _loadPhotos();
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Çıkış Yap',
            onPressed: () => _logout(),
          ),
        ],
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    // Hata durumu
    if (_error != null && _photos.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
              const SizedBox(height: 16),
              Text(
                'Fotoğraflar yüklenemedi',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _loadPhotos,
                icon: const Icon(Icons.refresh),
                label: const Text('Tekrar Dene'),
              ),
            ],
          ),
        ),
      );
    }

    // İlk yükleme
    if (_isLoading && _photos.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Fotoğraflar yükleniyor...'),
          ],
        ),
      );
    }

    // Boş durum
    if (_photos.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('Henüz ekran görüntüsü yok. Masaüstünden gönderin.'),
        ),
      );
    }

    // Grid görünümü
    return RefreshIndicator(
      onRefresh: _onRefresh,
      child: GridView.builder(
        padding: const EdgeInsets.all(4),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 2,
          mainAxisSpacing: 2,
          childAspectRatio: 1.0,
        ),
        itemCount: _photos.length,
        itemBuilder: (ctx, index) {
          final photo = _photos[index];
          final imageUrl = _service.getPhotoUrl(photo.storagePath);

          return PhotoCard(
            imageUrl: imageUrl,
            onTap: () => _onPhotoTap(index),
          );
        },
      ),
    );
  }
}
