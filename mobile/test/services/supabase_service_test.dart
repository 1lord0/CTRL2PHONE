import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/services/supabase_service.dart';

void main() {
  group('SupabaseService', () {
    setUp(() {
      SupabaseService.clearClient();
    });

    test('isInitialized returns false by default', () {
      expect(SupabaseService.isInitialized, false);
    });

    test('isInitialized returns true after initClient', () {
      SupabaseService.initClient('https://test.supabase.co', 'test-key', 'test-bucket');
      expect(SupabaseService.isInitialized, true);
    });

    test('clearClient resets initialization', () {
      SupabaseService.initClient('https://test.supabase.co', 'test-key', 'test-bucket');
      SupabaseService.clearClient();
      expect(SupabaseService.isInitialized, false);
    });
  });
}
