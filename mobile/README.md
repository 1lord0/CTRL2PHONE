# Ctrl2Phone Mobile

Flutter companion for the Ctrl2Phone desktop application. It keeps the photo
gallery and AI Action task inbox as separate data layers.

## Run and verify

```powershell
flutter pub get
flutter analyze
flutter test
flutter run
```

To produce the tested Android debug package:

```powershell
flutter build apk --debug
```

The APK is written to `build/app/outputs/flutter-apk/app-debug.apk`.

## Pairing

1. Apply the desktop-generated Supabase security SQL once.
2. Enable Anonymous Sign-Ins in Supabase Auth.
3. Open the desktop settings and generate a fresh QR code.
4. Scan it from mobile settings and save.

Legacy QRs still configure photo sync. A schema-v2 QR additionally contains a
10-minute, one-time Action channel invite. The mobile app exchanges that invite
immediately; it never writes the invite token to disk. Anonymous auth session
tokens and the claimed channel ID are stored with `flutter_secure_storage`.

## Task inbox behavior

- The bottom navigation has separate **Fotoğraflar** and **Görevler** screens.
- Task workflow versions only move forward; a late Realtime event cannot replace
  a newer result.
- Realtime is backed by serialized polling, so transient subscription failures
  recover without concurrent writes.
- The newest 100 tasks are cached per Supabase connection and channel, capped at
  2 MiB. Cached tasks remain readable offline.
- Read, pinned, and archived state is stored per mobile user through the
  `set_action_task_user_state` RPC.
- Signing out removes the local Action session, channel, and offline task cache.
