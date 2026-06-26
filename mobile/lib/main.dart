import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'services/supabase_service.dart';
import 'providers/photos_provider.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final url = prefs.getString('supabase_url');
  final key = prefs.getString('supabase_anon_key');
  final bucket = prefs.getString('supabase_bucket') ?? 'SCREENSHOTS';

  bool isInitialized = false;
  if (url != null && key != null && url.isNotEmpty && key.isNotEmpty) {
    try {
      SupabaseService.initClient(url, key, bucket);
      isInitialized = true;
    } catch (e) {
      debugPrint('Supabase init failed: $e');
    }
  }

  runApp(PhoneApp(isInitialized: isInitialized));
}

class PhoneApp extends StatelessWidget {
  final bool isInitialized;
  const PhoneApp({super.key, required this.isInitialized});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => PhotosProvider()),
      ],
      child: MaterialApp(
        title: 'Phone Gallery',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.indigo,
            brightness: Brightness.light,
          ),
          useMaterial3: true,
        ),
        darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.indigo,
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
        ),
        home: isInitialized
            ? const HomeScreen()
            : const SettingsScreen(isInitialSetup: true),
      ),
    );
  }
}
