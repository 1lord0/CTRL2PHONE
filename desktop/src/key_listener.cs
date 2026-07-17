using System;
using System.Collections.Concurrent;
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
    private const int VK_C = 0x43;
    private const int VK_F = 0x46;
    private const int VK_Q = 0x51;
    private const int VK_SPACE = 0x20;

    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;

    private static readonly Stopwatch _clock = Stopwatch.StartNew();
    private const long NoPress = -1;
    private static long _lastPressMs = NoPress;
    private static volatile int _triggerVk = VK_LCONTROL;
    private static volatile int _thresholdMs = 400;

    private static volatile bool _selectionActive = false;
    private static volatile bool _panelOpen = false;
    private static volatile bool _ctrlHeld = false;
    private static volatile bool _shiftHeld = false;
    private static long _selectionActiveSinceMs = 0;
    private const long SelectionMaxMs = 60000;

    // Never write to stdout inside the hook — it blocks the global input chain (mouse lag).
    private static readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
    private static readonly AutoResetEvent _outboxSignal = new AutoResetEvent(false);

    private static void Emit(string message)
    {
        _outbox.Enqueue(message);
        _outboxSignal.Set();
    }

    public static void Main()
    {
        Thread outboxThread = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    _outboxSignal.WaitOne(500);
                    string line;
                    while (_outbox.TryDequeue(out line))
                    {
                        Console.WriteLine(line);
                    }
                    Console.Out.Flush();
                }
            }
            catch
            {
                Environment.Exit(0);
            }
        });
        outboxThread.IsBackground = true;
        outboxThread.Start();

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
                        _selectionActiveSinceMs = _clock.ElapsedMilliseconds;
                        _selectionActive = true;
                    }
                    else if (line == "INACTIVE")
                    {
                        _selectionActive = false;
                    }
                    else if (line == "PANEL_OPEN")
                    {
                        _panelOpen = true;
                    }
                    else if (line == "PANEL_CLOSED")
                    {
                        _panelOpen = false;
                    }
                    else if (line.StartsWith("CONFIG:"))
                    {
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
                            _lastPressMs = NoPress;
                        }
                    }
                }
            }
            catch { }
            Environment.Exit(0);
        });
        stdinWatcher.IsBackground = true;
        stdinWatcher.Start();

        _hookID = SetHook(_proc);
        if (_hookID != IntPtr.Zero)
        {
            Emit("READY");
        }
        else
        {
            Emit("HOOK_FAILED");
        }
        Application.Run();
        UnhookWindowsHookEx(_hookID);
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        return SetWindowsHookEx(WH_KEYBOARD_LL, proc, IntPtr.Zero, 0);
    }

    private delegate IntPtr LowLevelKeyboardProc(
        int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr HookCallback(
        int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0)
        {
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        try
        {
            int vkCode = Marshal.ReadInt32(lParam);
            int triggerVk = _triggerVk;
            int thresholdMs = _thresholdMs;
            bool isKeyUp = wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;
            bool isKeyDown = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;

            if (vkCode == VK_LCONTROL || vkCode == VK_RCONTROL)
            {
                _ctrlHeld = isKeyDown;
            }
            else if (vkCode == VK_LSHIFT || vkCode == VK_RSHIFT)
            {
                _shiftHeld = isKeyDown;
            }

            if (_selectionActive)
            {
                if (_clock.ElapsedMilliseconds - _selectionActiveSinceMs > SelectionMaxMs)
                {
                    _selectionActive = false;
                }
                else if (vkCode == VK_X || vkCode == VK_M || vkCode == VK_C ||
                         vkCode == VK_ESCAPE || vkCode == VK_RETURN || vkCode == VK_Q)
                {
                    if (isKeyUp)
                    {
                        if (vkCode == VK_X) Emit("KEY_X");
                        else if (vkCode == VK_M) Emit("KEY_M");
                        else if (vkCode == VK_C) Emit("KEY_C");
                        else if (vkCode == VK_ESCAPE) Emit("KEY_ESCAPE");
                        else if (vkCode == VK_RETURN) Emit("KEY_RETURN");
                        else if (vkCode == VK_Q) Emit("KEY_Q");
                    }
                    return (IntPtr)1;
                }
            }

            if (isKeyDown && _ctrlHeld && _shiftHeld)
            {
                if (vkCode == VK_V)
                {
                    Emit("CTRL_SHIFT_V");
                    return (IntPtr)1;
                }
                if (vkCode == VK_SPACE)
                {
                    Emit("CTRL_SHIFT_SPACE");
                    return (IntPtr)1;
                }
            }

            if (!_selectionActive && _panelOpen && vkCode == VK_ESCAPE && isKeyUp)
            {
                Emit("SPOTLIGHT_DISMISS");
                return (IntPtr)1;
            }

            if (isKeyDown && vkCode != triggerVk)
            {
                _lastPressMs = NoPress;
            }

            if (vkCode == triggerVk && isKeyUp)
            {
                long now = _clock.ElapsedMilliseconds;
                if (_lastPressMs != NoPress && now - _lastPressMs <= thresholdMs)
                {
                    Emit("DOUBLE_CTRL");
                    _lastPressMs = NoPress;
                }
                else
                {
                    _lastPressMs = now;
                }
            }
        }
        catch
        {
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