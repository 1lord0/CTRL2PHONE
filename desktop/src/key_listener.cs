using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class KeyListener : Form
{
    private const int WM_INPUT = 0x00FF;
    private const int RID_INPUT = 0x10000003;
    private const int RIM_TYPEKEYBOARD = 1;

    private const ushort HID_USAGE_PAGE_GENERIC = 0x01;
    private const ushort HID_USAGE_KEYBOARD = 0x06;
    private const uint RIDEV_INPUTSINK = 0x00000100;

    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_CONTROL = 0x11;

    private static readonly Stopwatch _clock = Stopwatch.StartNew();
    private const long NoPress = -1;
    private static long _lastPressMs = NoPress;
    private static volatile int _triggerVk = VK_LCONTROL;
    private static volatile int _thresholdMs = 400;

    private static volatile bool _selectionActive = false;
    private static volatile bool _panelOpen = false;

    private static volatile bool _ctrlDown = false;
    private static volatile bool _shiftDown = false;

    private static readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
    private static readonly AutoResetEvent _outboxSignal = new AutoResetEvent(false);

    private static void Emit(string message)
    {
        _outbox.Enqueue(message);
        _outboxSignal.Set();
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTHEADER
    {
        public uint dwType;
        public uint dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWKEYBOARD
    {
        public ushort MakeCode;
        public ushort Flags;
        public ushort Reserved;
        public ushort VKey;
        public uint Message;
        public uint ExtraInformation;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUT
    {
        public RAWINPUTHEADER header;
        public RAWKEYBOARD keyboard;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, out RAWINPUT pData, ref uint pcbSize, uint cbSizeHeader);

    public KeyListener()
    {
        this.WindowState = FormWindowState.Minimized;
        this.ShowInTaskbar = false;
        this.FormBorderStyle = FormBorderStyle.None;
        this.Size = new System.Drawing.Size(0, 0);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RAWINPUTDEVICE[] rid = new RAWINPUTDEVICE[1];
        rid[0].usUsagePage = HID_USAGE_PAGE_GENERIC;
        rid[0].usUsage = HID_USAGE_KEYBOARD;
        rid[0].dwFlags = RIDEV_INPUTSINK;
        rid[0].hwndTarget = this.Handle;

        if (RegisterRawInputDevices(rid, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
        {
            Emit("READY");
        }
        else
        {
            Emit("HOOK_FAILED:" + Marshal.GetLastWin32Error());
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            uint dwSize = 0;
            RAWINPUT dummyInput;
            GetRawInputData(m.LParam, RID_INPUT, out dummyInput, ref dwSize, (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER)));

            if (dwSize > 0)
            {
                RAWINPUT raw;
                if (GetRawInputData(m.LParam, RID_INPUT, out raw, ref dwSize, (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER))) == dwSize)
                {
                    if (raw.header.dwType == RIM_TYPEKEYBOARD)
                    {
                        ushort vkey = raw.keyboard.VKey;
                        bool isUp = (raw.keyboard.Flags & 1) != 0;
                        bool isE0 = (raw.keyboard.Flags & 2) != 0;

                        int vkCode = vkey;
                        if (vkey == VK_CONTROL)
                        {
                            vkCode = isE0 ? VK_RCONTROL : VK_LCONTROL;
                        }

                        if (vkey == VK_CONTROL || vkey == VK_LCONTROL || vkey == VK_RCONTROL)
                        {
                            _ctrlDown = !isUp;
                        }
                        else if (vkey == 0x10 || vkey == 0xA0 || vkey == 0xA1) // VK_SHIFT, LSHIFT, RSHIFT
                        {
                            _shiftDown = !isUp;
                        }

                        int triggerVk = _triggerVk;
                        int thresholdMs = _thresholdMs;

                        if (vkCode == triggerVk && isUp)
                        {
                            long now = _clock.ElapsedMilliseconds;
                            long delta = _lastPressMs != NoPress ? now - _lastPressMs : -1;
                            if (_lastPressMs != NoPress && delta <= thresholdMs)
                            {
                                Emit("DOUBLE_CTRL");
                                _lastPressMs = NoPress;
                            }
                            else
                            {
                                _lastPressMs = now;
                            }
                        }
                        
                        if (!isUp) // Key Down events
                        {
                            if (_ctrlDown && _shiftDown && vkey == 0x56) // V
                            {
                                Emit("CTRL_SHIFT_V");
                            }
                            else if (_ctrlDown && _shiftDown && vkey == 0x20) // Space
                            {
                                Emit("CTRL_SHIFT_SPACE");
                            }

                            if (_selectionActive)
                            {
                                if (vkey == 0x41) Emit("KEY_A");
                                else if (vkey == 0x58) Emit("KEY_X");
                                else if (vkey == 0x4D) Emit("KEY_M");
                                else if (vkey == 0x43) Emit("KEY_C");
                                else if (vkey == 0x51) Emit("KEY_Q");
                                else if (vkey == 0x0D) Emit("KEY_RETURN");
                                else if (vkey == 0x1B) Emit("KEY_ESCAPE");
                            }
                        }
                    }
                }
            }
        }
        base.WndProc(ref m);
    }

    [STAThread]
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
                        _selectionActive = true;
                    }
                    else if (line == "INACTIVE")
                    {
                        _selectionActive = false;
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

        Application.Run(new KeyListener());
    }
}