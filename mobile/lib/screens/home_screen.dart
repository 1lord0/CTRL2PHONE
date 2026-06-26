import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/supabase_service.dart';
import '../providers/photos_provider.dart';
import '../widgets/photo_card.dart';
import 'detail_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PhotosProvider>().loadPhotos();
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      context.read<PhotosProvider>().loadMore();
    }
  }

  Future<void> _onRefresh() async {
    await context.read<PhotosProvider>().refresh();
  }

  void _onPhotoTap(List<Photo> photos, int index) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DetailScreen(
          photos: photos,
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
        content: const Text(
            'Supabase bağlantı bilgileri silinecek ve giriş ekranına dönülecektir. Emin misiniz?'),
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
          MaterialPageRoute(
              builder: (_) => const SettingsScreen(isInitialSetup: true)),
          (route) => false,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final provider = context.watch<PhotosProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Fotoğraf Galerisi'),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Yenile',
            onPressed: provider.isLoading ? null : () => provider.refresh(),
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Ayarlar',
            onPressed: () async {
              final result = await Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        const SettingsScreen(isInitialSetup: false)),
              );
              if (result == true) {
                provider.refresh();
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
      body: _buildBody(theme, provider),
    );
  }

  Widget _buildBody(ThemeData theme, PhotosProvider provider) {
    if (provider.error != null && provider.photos.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline,
                  size: 48, color: theme.colorScheme.error),
              const SizedBox(height: 16),
              Text(
                'Fotoğraflar yüklenemedi',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                provider.error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: () => provider.refresh(),
                icon: const Icon(Icons.refresh),
                label: const Text('Tekrar Dene'),
              ),
            ],
          ),
        ),
      );
    }

    if (provider.isLoading && provider.photos.isEmpty) {
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

    if (provider.photos.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('Henüz ekran görüntüsü yok. Masaüstünden gönderin.'),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _onRefresh,
      child: GridView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.all(4),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 2,
          mainAxisSpacing: 2,
          childAspectRatio: 1.0,
        ),
        itemCount: provider.photos.length + (provider.isLoading && provider.photos.isNotEmpty ? 1 : 0),
        itemBuilder: (ctx, index) {
          if (index == provider.photos.length) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            );
          }
          final photo = provider.photos[index];
          final imageUrl = SupabaseService().getPhotoUrl(photo.storagePath);

          return PhotoCard(
            imageUrl: imageUrl,
            onTap: () => _onPhotoTap(provider.photos, index),
          );
        },
      ),
    );
  }
}
