using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class KeyListener
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int VK_V = 0x56;
    private const int VK_X = 0x58;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_RETURN = 0x0D;
    private const int VK_M = 0x4D;
    private const int VK_Q = 0x51;

    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;

    // Monotonic clock — immune to wall-clock/NTP/DST changes that DateTime.Now suffers from.
    private static readonly Stopwatch _clock = Stopwatch.StartNew();
    private const long NoPress = -1;
    private static long _lastPressMs = NoPress;
    // Trigger key + double-press window are configurable at runtime via a
    // "CONFIG:<vk>:<ms>" line on stdin (sent by the Electron settings).
    private static volatile int _triggerVk = VK_LCONTROL;
    private static volatile int _thresholdMs = 400;

    private static volatile bool _selectionActive = false;
    private static volatile bool _ctrlHeld = false;
    private static volatile bool _shiftHeld = false;
    private static long _selectionActiveSinceMs = 0;
    // Safety valve: if Electron dies without sending INACTIVE, never block keys
    // (X/M/Esc/Enter/Q) globally forever — auto-release after this many ms.
    private const long SelectionMaxMs = 60000;

    public static void Main()
    {
        // Start a thread to read from stdin.
        // Handles "ACTIVE" and "INACTIVE" to toggle blocking, and exits when stdin closes.
        Thread stdinWatcher = new Thread(() =>
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim().ToUpper();
                    if (line == "ACTIVE")
                    {
                        // Write the timestamp BEFORE the volatile flag: the volatile
                        // store acts as a release barrier, so the hook thread that
                        // reads _selectionActive == true is guaranteed to also see
                        // this fresh start time (never a stale one from a prior run).
                        _selectionActiveSinceMs = _clock.ElapsedMilliseconds;
                        _selectionActive = true;
                    }
                    else if (line == "INACTIVE")
                    {
                        _selectionActive = false;
                    }
                    else if (line.StartsWith("CONFIG:"))
                    {
                        // CONFIG:<triggerVkDecimal>:<thresholdMs>
                        string[] parts = line.Substring("CONFIG:".Length).Split(':');
                        if (parts.Length == 2)
                        {
                            int vk, ms;
                            if (int.TryParse(parts[0], out vk) && vk > 0)
                            {
                                _triggerVk = vk;
                            }
                            if (int.TryParse(parts[1], out ms) && ms >= 100 && ms <= 2000)
                            {
                                _thresholdMs = ms;
                            }
                            // A new trigger invalidates any half-finished tap.
                            _lastPressMs = NoPress;
                        }
                    }
                }
            }
            catch {}
            Environment.Exit(0);
        });
        stdinWatcher.IsBackground = true;
        stdinWatcher.Start();

        _hookID = SetHook(_proc);
        Application.Run();
        UnhookWindowsHookEx(_hookID);
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc,
                GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    private delegate IntPtr LowLevelKeyboardProc(
        int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr HookCallback(
        int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode >= 0)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                // Snapshot the volatile config once so a CONFIG arriving mid-callback
                // can't make the two checks below use different trigger values.
                int triggerVk = _triggerVk;
                int thresholdMs = _thresholdMs;
                bool isKeyUp = wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;
                bool isKeyDown = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;

                // Track modifier key states
                if (vkCode == VK_LCONTROL || vkCode == VK_RCONTROL)
                {
                    _ctrlHeld = isKeyDown;
                }
                if (vkCode == VK_LSHIFT || vkCode == VK_RSHIFT)
                {
                    _shiftHeld = isKeyDown;
                }

                // Any non-trigger key pressed in between two taps invalidates the
                // pending tap. This stops Ctrl+C / Ctrl+V bursts (and combos like
                // Ctrl+Shift+...) from being misread as a double-press.
                if (isKeyDown && vkCode != triggerVk)
                {
                    _lastPressMs = NoPress;
                }

                if (vkCode == triggerVk && isKeyUp)
                {
                    long now = _clock.ElapsedMilliseconds;
                    if (_lastPressMs != NoPress && now - _lastPressMs <= thresholdMs)
                    {
                        Console.WriteLine("DOUBLE_CTRL");
                        Console.Out.Flush();
                        _lastPressMs = NoPress;
                    }
                    else
                    {
                        _lastPressMs = now;
                    }
                }

                // Ctrl+Shift+V — global clipboard send (works outside selection mode)
                if (vkCode == VK_V && isKeyDown && _ctrlHeld && _shiftHeld)
                {
                    Console.WriteLine("CTRL_SHIFT_V");
                    Console.Out.Flush();
                    return (IntPtr)1; // Block the key
                }

                // Watchdog: auto-release a stuck selection so global key blocking can
                // never persist if the Electron side crashed mid-session.
                if (_selectionActive && _clock.ElapsedMilliseconds - _selectionActiveSinceMs > SelectionMaxMs)
                {
                    _selectionActive = false;
                }

                // If selection is active, block these keys on both down and up events
                if (_selectionActive)
                {
                    if (vkCode == VK_X || vkCode == VK_M || vkCode == VK_ESCAPE || vkCode == VK_RETURN || vkCode == VK_Q)
                    {
                        if (isKeyUp)
                        {
                            if (vkCode == VK_X) Console.WriteLine("KEY_X");
                            else if (vkCode == VK_M) Console.WriteLine("KEY_M");
                            else if (vkCode == VK_ESCAPE) Console.WriteLine("KEY_ESCAPE");
                            else if (vkCode == VK_RETURN) Console.WriteLine("KEY_RETURN");
                            else if (vkCode == VK_Q) Console.WriteLine("KEY_Q");
                            Console.Out.Flush();
                        }
                        return (IntPtr)1; // Block key from reaching other applications
                    }
                }
            }
        }
        catch
        {
            // Never let an exception escape the callback: Windows silently unhooks a
            // throwing low-level hook, which would kill all key handling.
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook,
        LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode,
        IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}
