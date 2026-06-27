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

    private static LowLevelKeyboardProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;
    private static DateTime _lastPress = DateTime.MinValue;
    private static readonly TimeSpan DoublePressThreshold = TimeSpan.FromMilliseconds(400);
    private static volatile bool _selectionActive = false;
    private static volatile bool _ctrlHeld = false;
    private static volatile bool _shiftHeld = false;

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
                        _selectionActive = true;
                    }
                    else if (line == "INACTIVE")
                    {
                        _selectionActive = false;
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
        if (nCode >= 0)
        {
            int vkCode = Marshal.ReadInt32(lParam);
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

            // Double Ctrl detection (left Ctrl only)
            if (vkCode == VK_LCONTROL && isKeyUp)
            {
                DateTime now = DateTime.Now;
                if (now - _lastPress <= DoublePressThreshold)
                {
                    Console.WriteLine("DOUBLE_CTRL");
                    Console.Out.Flush();
                    _lastPress = DateTime.MinValue;
                }
                else
                {
                    _lastPress = now;
                }
            }

            // Ctrl+Shift+V — global clipboard send (works outside selection mode)
            if (vkCode == VK_V && isKeyDown && _ctrlHeld && _shiftHeld)
            {
                Console.WriteLine("CTRL_SHIFT_V");
                Console.Out.Flush();
                return (IntPtr)1; // Block the key
            }
            
            // If selection is active, block these keys on both down and up events
            if (_selectionActive)
            {
                if (vkCode == VK_X || vkCode == VK_M || vkCode == VK_ESCAPE || vkCode == VK_RETURN)
                {
                    if (isKeyUp)
                    {
                        if (vkCode == VK_X) Console.WriteLine("KEY_X");
                        else if (vkCode == VK_M) Console.WriteLine("KEY_M");
                        else if (vkCode == VK_ESCAPE) Console.WriteLine("KEY_ESCAPE");
                        else if (vkCode == VK_RETURN) Console.WriteLine("KEY_RETURN");
                        Console.Out.Flush();
                    }
                    return (IntPtr)1; // Block key from reaching other applications
                }
            }
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
