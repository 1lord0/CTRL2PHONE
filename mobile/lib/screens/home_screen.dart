import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
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
  Map<String, dynamic>? _storageUsage;
  bool _loadingStorage = false;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<PhotosProvider>();
      provider.loadPhotos();
      provider.listenForNewPhotos();
      _fetchStorageUsage();
      _startClipboardListener();
    });
  }

  void _startClipboardListener() {
    SupabaseService.subscribeToClipboard((content) {
      Clipboard.setData(ClipboardData(text: content));
      if (mounted) {
        final preview = content.length > 80 ? '${content.substring(0, 80)}...' : content;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.content_paste, color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Expanded(child: Text('Panoya kopyalandı: $preview')),
              ],
            ),
            backgroundColor: Colors.indigo,
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 3),
          ),
        );
      }
    });
  }

  Future<void> _fetchStorageUsage() async {
    if (!mounted) return;
    setState(() => _loadingStorage = true);
    try {
      final usage = await SupabaseService().getStorageUsage();
      if (mounted) {
        setState(() {
          _storageUsage = usage;
          _loadingStorage = false;
        });
      }
    } catch (e) {
      debugPrint('Failed to fetch storage usage: $e');
      if (mounted) {
        setState(() => _loadingStorage = false);
      }
    }
  }
  Future<void> _purgeStorage() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Depolamayı Temizle'),
        content: const Text(
            'Supabase bulut depolama içerisindeki tüm görseller (to_pc dahil) KALICI olarak silinecektir. Emin misiniz?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Temizle'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      setState(() => _loadingStorage = true);
      try {
        final count = await SupabaseService().purgeStorage();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Temizlik başarılı! $count dosya silindi.'),
              backgroundColor: Colors.green,
            ),
          );
          context.read<PhotosProvider>().refresh();
          _fetchStorageUsage();
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Temizlik hatası: $e'),
              backgroundColor: Colors.red,
            ),
          );
          setState(() => _loadingStorage = false);
        }
      }
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    SupabaseService.unsubscribeClipboard();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      context.read<PhotosProvider>().loadMore();
    }
  }

  Future<void> _onRefresh() async {
    await Future.wait([
      context.read<PhotosProvider>().refresh(),
      _fetchStorageUsage(),
    ]);
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showSourcePicker(context),
        icon: const Icon(Icons.send_rounded),
        label: const Text('Bilgisayara Gönder'),
      ),
    );
  }

  Widget _buildBody(ThemeData theme, PhotosProvider provider) {
    return Column(
      children: [
        _buildStorageIndicator(theme),
        Expanded(
          child: _buildMainContent(theme, provider),
        ),
      ],
    );
  }

  Widget _buildStorageIndicator(ThemeData theme) {
    if (_storageUsage == null) return const SizedBox.shrink();

    final used = _storageUsage!['usedBytes'] as int;
    final limit = _storageUsage!['limitBytes'] as int;
    final pct = _storageUsage!['percentage'] as double;

    final usedMb = used / (1024 * 1024);
    final limitMb = limit / (1024 * 1024);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest?.withOpacity(0.4) ?? theme.colorScheme.surfaceVariant.withOpacity(0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  children: [
                    Icon(Icons.cloud_queue_rounded, size: 16, color: theme.colorScheme.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Supabase Depolama',
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Row(
                children: [
                  Text(
                    '${usedMb.toStringAsFixed(1)} MB / ${limitMb.toStringAsFixed(0)} MB (%${pct.toStringAsFixed(1)})',
                    style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: Icon(Icons.delete_sweep_rounded, size: 18, color: Colors.red.shade400),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    tooltip: 'Temizle',
                    onPressed: _purgeStorage,
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: pct / 100,
              backgroundColor: theme.colorScheme.surfaceContainerHighest ?? theme.colorScheme.surfaceVariant,
              valueColor: AlwaysStoppedAnimation<Color>(
                pct > 90 ? Colors.red : (pct > 75 ? Colors.orange : theme.colorScheme.primary),
              ),
              minHeight: 6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainContent(ThemeData theme, PhotosProvider provider) {
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

          return PhotoCard(
            imageUrl: photo.url,
            onTap: () => _onPhotoTap(provider.photos, index),
          );
        },
      ),
    );
  }

  final ImagePicker _picker = ImagePicker();

  Future<void> _pickAndUploadImage(ImageSource source) async {
    try {
      final XFile? image = await _picker.pickImage(
        source: source,
        imageQuality: 85,
      );
      if (image == null) return;

      if (!mounted) return;
      _showUploadDialog(context, message: 'Fotoğraf bilgisayara gönderiliyor...');

      final bytes = await image.readAsBytes();
      final extension = image.path.split('.').last.toLowerCase();
      final fileName = 'upload_${DateTime.now().millisecondsSinceEpoch}.$extension';
      await SupabaseService().uploadToPC(bytes, fileName);

      if (!mounted) return;
      Navigator.pop(context); // Close loading dialog

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Fotoğraf başarıyla bilgisayara gönderildi!'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      Navigator.pop(context); // Close loading dialog if open

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gönderim hatası: $e'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _pickAndUploadMultipleImages() async {
    try {
      final List<XFile> images = await _picker.pickMultiImage(
        imageQuality: 85,
      );
      if (images.isEmpty) return;

      if (!mounted) return;
      _showUploadDialog(context, message: 'Fotoğraflar gönderiliyor (0/${images.length})...');

      for (int i = 0; i < images.length; i++) {
        if (i > 0 && mounted) {
          Navigator.pop(context); // Pop previous progress dialog
          _showUploadDialog(context, message: 'Fotoğraflar gönderiliyor ($i/${images.length})...');
        }

        final image = images[i];
        final bytes = await image.readAsBytes();
        final extension = image.path.split('.').last.toLowerCase();
        
        final timestamp = DateTime.now().millisecondsSinceEpoch + i;
        final fileName = 'upload_${timestamp}_$i.$extension';
        
        await SupabaseService().uploadToPC(bytes, fileName);
      }

      if (!mounted) return;
      Navigator.pop(context); // Close loading dialog

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${images.length} fotoğraf başarıyla bilgisayara gönderildi!'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      Navigator.pop(context); // Close loading dialog if open

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gönderim hatası: $e'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _showUploadDialog(BuildContext context, {String message = 'Fotoğraf bilgisayara gönderiliyor...'}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          content: Row(
            children: [
              const CircularProgressIndicator(),
              const SizedBox(width: 20),
              Expanded(child: Text(message)),
            ],
          ),
        );
      },
    );
  }

  void _showSourcePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final theme = Theme.of(context);
        return Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Bilgisayara Gönder',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Seçtiğiniz fotoğraf anında bilgisayarınızın panosuna kopyalanacaktır.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _SourceOption(
                    icon: Icons.camera_alt_rounded,
                    label: 'Kamera',
                    onTap: () {
                      Navigator.pop(context);
                      _pickAndUploadImage(ImageSource.camera);
                    },
                  ),
                  _SourceOption(
                    icon: Icons.photo_library_rounded,
                    label: 'Galeri',
                    onTap: () {
                      Navigator.pop(context);
                      _pickAndUploadMultipleImages();
                    },
                  ),
                  _SourceOption(
                    icon: Icons.link_rounded,
                    label: 'Link/Metin',
                    onTap: () {
                      Navigator.pop(context);
                      _showClipboardSendDialog(context);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

  void _showClipboardSendDialog(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        final theme = Theme.of(context);
        final textController = TextEditingController();
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Container(
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            ),
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Bilgisayara Metin/Link Gönder',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Metin veya link anında bilgisayarınızın panosuna kopyalanacaktır.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: textController,
                  maxLines: 3,
                  decoration: InputDecoration(
                    hintText: 'Metin veya link yazın...',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    filled: true,
                  ),
                  autofocus: true,
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final messenger = ScaffoldMessenger.of(context);
                          Navigator.pop(context);
                          try {
                            final clipData = await Clipboard.getData(Clipboard.kTextPlain);
                            final text = clipData?.text;
                            if (text == null || text.trim().isEmpty) {
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('Panoda metin bulunamadı'),
                                  backgroundColor: Colors.orange,
                                  behavior: SnackBarBehavior.floating,
                                ),
                              );
                              return;
                            }
                            await SupabaseService().sendClipboardText(text.trim());
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Panodan gönderildi: ${text.trim().length > 50 ? '${text.trim().substring(0, 50)}...' : text.trim()}'),
                                backgroundColor: Colors.green,
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          } catch (e) {
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Hata: $e'),
                                backgroundColor: Colors.red,
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          }
                        },
                        icon: const Icon(Icons.content_paste),
                        label: const Text('Panodan Gönder'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () async {
                          final text = textController.text.trim();
                          if (text.isEmpty) return;
                          final messenger = ScaffoldMessenger.of(context);
                          Navigator.pop(context);
                          try {
                            await SupabaseService().sendClipboardText(text);
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Gönderildi: ${text.length > 50 ? '${text.substring(0, 50)}...' : text}'),
                                backgroundColor: Colors.green,
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          } catch (e) {
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Hata: $e'),
                                backgroundColor: Colors.red,
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          }
                        },
                        icon: const Icon(Icons.send_rounded),
                        label: const Text('Gönder'),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SourceOption extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _SourceOption({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 110,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          border: Border.all(color: theme.colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Icon(icon, size: 36, color: theme.colorScheme.primary),
            const SizedBox(height: 8),
            Text(
              label,
              style: theme.textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
