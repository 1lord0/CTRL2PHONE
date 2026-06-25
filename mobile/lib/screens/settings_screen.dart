import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/supabase_service.dart';
import 'home_screen.dart';
import 'qr_scanner_screen.dart';

class SettingsScreen extends StatefulWidget {
  final bool isInitialSetup;
  const SettingsScreen({super.key, this.isInitialSetup = false});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _urlController = TextEditingController();
  final _keyController = TextEditingController();
  final _bucketController = TextEditingController();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadCurrentSettings();
  }

  Future<void> _loadCurrentSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _urlController.text = prefs.getString('supabase_url') ?? '';
      _keyController.text = prefs.getString('supabase_anon_key') ?? '';
      _bucketController.text = prefs.getString('supabase_bucket') ?? 'SCREENSHOTS';
    });
  }

  Future<void> _saveSettings() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final url = _urlController.text.trim();
    final key = _keyController.text.trim();
    final bucket = _bucketController.text.trim();

    try {
      // Girilen bilgilerle geçici bir istemci oluşturup bağlantıyı test et
      final tempClient = SupabaseClient(url, key);
      await tempClient.storage.from(bucket).list(
            searchOptions: const SearchOptions(limit: 1),
          );

      // Başarılı ise SharedPreferences'a kaydet
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('supabase_url', url);
      await prefs.setString('supabase_anon_key', key);
      await prefs.setString('supabase_bucket', bucket);

      // Servis nesnesini ilklendir
      SupabaseService.initClient(url, key, bucket);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ayarlar başarıyla kaydedildi!')),
        );
        
        if (widget.isInitialSetup) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (_) => const HomeScreen()),
          );
        } else {
          Navigator.pop(context, true); // Değişiklik yapıldığını belirtmek için true dön
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Bağlantı Hatası: Bilgileri kontrol edin. ($e)'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _keyController.dispose();
    _bucketController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isInitialSetup ? 'Kurulum' : 'Supabase Ayarları'),
        centerTitle: true,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(
                  Icons.settings_suggest_rounded,
                  size: 64,
                  color: Colors.indigo,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Supabase Bağlantısı',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Ekran görüntülerini senkronize etmek için Supabase projenizin API detaylarını girin.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey, fontSize: 13),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: () async {
                    final result = await Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const QrScannerScreen()),
                    );
                    if (result != null && result is String) {
                      try {
                        final Map<String, dynamic> data = json.decode(result);
                        if (data.containsKey('url') && data.containsKey('key')) {
                          setState(() {
                            _urlController.text = data['url'] ?? '';
                            _keyController.text = data['key'] ?? '';
                            _bucketController.text = data['bucket'] ?? 'SCREENSHOTS';
                          });
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('QR kod bilgileri başarıyla yüklendi!')),
                          );
                        }
                      } catch (e) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('QR Kod okuma hatası: Geçersiz veri formatı.')),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.qr_code_scanner_rounded),
                  label: const Text('Masaüstünden QR Kod ile Eşitle'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.indigo.withValues(alpha: 0.1),
                    foregroundColor: Colors.indigo,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _urlController,
                  decoration: const InputDecoration(
                    labelText: 'Supabase URL',
                    hintText: 'https://xxxx.supabase.co',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.link),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) return 'Lütfen URL girin';
                    if (!val.startsWith('http')) return 'Geçersiz URL formatı';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _keyController,
                  decoration: const InputDecoration(
                    labelText: 'Supabase Anon/Service Key',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.vpn_key),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) return 'Lütfen API anahtarı girin';
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _bucketController,
                  decoration: const InputDecoration(
                    labelText: 'Storage Bucket Adı',
                    hintText: 'SCREENSHOTS',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.folder),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) return 'Lütfen bucket adı girin';
                    return null;
                  },
                ),
                const SizedBox(height: 28),
                ElevatedButton(
                  onPressed: _isLoading ? null : _saveSettings,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.indigo,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Text('Kaydet ve Bağlan', style: TextStyle(fontSize: 16)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
