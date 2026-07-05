using System;
using System.Runtime.InteropServices;

class RoundWindow
{
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);

    [DllImport("user32.dll")]
    static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    const int DWMWA_NCRENDERING_POLICY = 2;
    const int DWMNCRP_DISABLED = 1;
    const int DWMWA_BORDER_COLOR = 34;
    const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    const int DWMWCP_DONOTROUND = 1;
    const int DWMWCP_ROUND = 2;
    // COLORREF BGR for #0a1222
    const int DWM_BORDER_PANEL = unchecked((int)0x0022100a);
    const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
    const int DWMSBT_NONE = 1;
    // Win11: fully transparent border (electron#51662 white rectangle fix)
    const int DWMWA_COLOR_NONE = unchecked((int)0xFFFFFFFE);

    static void DisableDwmChrome(IntPtr hwnd)
    {
        int policy = DWMNCRP_DISABLED;
        DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, ref policy, Marshal.SizeOf(typeof(int)));

        int corner = DWMWCP_DONOTROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, Marshal.SizeOf(typeof(int)));

        int backdrop = DWMSBT_NONE;
        DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, Marshal.SizeOf(typeof(int)));

        int border = DWMWA_COLOR_NONE;
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, Marshal.SizeOf(typeof(int)));
    }

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1) return 1;

            long hwndValue;
            if (!long.TryParse(args[0], out hwndValue)) return 2;
            IntPtr hwnd = new IntPtr(hwndValue);

            DisableDwmChrome(hwnd);

            if (args.Length >= 2 && args[1] == "clear")
            {
                SetWindowRgn(hwnd, IntPtr.Zero, true);
                return 0;
            }

            if (args.Length >= 2 && args[1] == "dwm")
            {
                return 0;
            }

            if (args.Length >= 2 && args[1] == "panel")
            {
                int corner = DWMWCP_ROUND;
                DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, Marshal.SizeOf(typeof(int)));

                int border = DWM_BORDER_PANEL;
                DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, Marshal.SizeOf(typeof(int)));

                int backdrop = DWMSBT_NONE;
                DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, Marshal.SizeOf(typeof(int)));
                return 0;
            }

            if (args.Length < 4) return 3;

            int width, height, radius;
            if (!int.TryParse(args[1], out width) ||
                !int.TryParse(args[2], out height) ||
                !int.TryParse(args[3], out radius))
            {
                return 4;
            }

            int ellipse = Math.Max(2, radius * 2);
            // Right/bottom exclusive — tam pencere boyutu, köşe taşması yok
            IntPtr region = CreateRoundRectRgn(0, 0, width, height, ellipse, ellipse);
            if (region == IntPtr.Zero) return 5;

            SetWindowRgn(hwnd, region, true);
            return 0;
        }
        catch
        {
            return 99;
        }
    }
}