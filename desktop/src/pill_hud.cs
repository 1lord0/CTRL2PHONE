using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

/// <summary>
/// Windows native Spotlight pill — güvenilir tıklama/sürükleme.
/// </summary>
sealed class PillHudForm : Form
{
    const int MinW = 220;
    const int MaxW = 720;
    const int MinH = 44;
    const int MaxH = 80;
    const int DragSlop = 8;
    const int PadL = 14;
    const int PadR = 18;
    const int IconSize = 30;
    const int Gap = 10;

    static readonly Color BgTop = Color.FromArgb(255, 22, 30, 48);
    static readonly Color BgBottom = Color.FromArgb(255, 14, 19, 32);
    static readonly Color BgCaptureTop = Color.FromArgb(255, 26, 38, 62);
    static readonly Color BgCaptureBottom = Color.FromArgb(255, 16, 24, 42);
    static readonly Color TextMuted = Color.FromArgb(255, 137, 161, 199);
    static readonly Color TextBright = Color.FromArgb(255, 229, 238, 252);
    static readonly Color Accent = Color.FromArgb(255, 79, 140, 255);
    static readonly Color BorderSoft = Color.FromArgb(48, 148, 187, 255);
    static readonly Color BorderActive = Color.FromArgb(120, 79, 140, 255);
    static readonly Color IconBg = Color.FromArgb(36, 255, 255, 255);

    readonly Label _status;
    readonly Button _open;
    readonly Font _statusFont;
    readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
    readonly AutoResetEvent _outboxSignal = new AutoResetEvent(false);
    readonly System.Windows.Forms.Timer _pulseTimer;

    bool _pressing;
    bool _dragging;
    bool _hovered;
    bool _capturing;
    bool _statusBright;
    float _pulse;
    Point _pressScreen;
    Point _dragAnchor;
    int _maxTextW = 520;

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int w, int h);

    [DllImport("user32.dll")]
    static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

    public PillHudForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = BgBottom;
        ForeColor = TextMuted;
        Font = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        _statusFont = new Font("Segoe UI", 9.25f, FontStyle.Regular, GraphicsUnit.Point);
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Width = 320;
        Height = 52;

        _open = new Button
        {
            Text = string.Empty,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(IconSize, IconSize),
            Location = new Point(PadL, (MinH - IconSize) / 2),
            TabStop = false,
            Cursor = Cursors.Hand,
            BackColor = Color.Transparent,
            ForeColor = Color.Transparent,
        };
        _open.FlatAppearance.BorderSize = 0;
        _open.FlatAppearance.MouseOverBackColor = Color.Transparent;
        _open.FlatAppearance.MouseDownBackColor = Color.Transparent;

        _status = new Label
        {
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleLeft,
            Location = new Point(PadL + IconSize + Gap, 0),
            Size = new Size(Width - (PadL + IconSize + Gap + PadR), MinH),
            Text = "Hazır",
            Cursor = Cursors.Hand,
            BackColor = Color.Transparent,
            ForeColor = TextMuted,
            Font = _statusFont,
        };

        Controls.Add(_status);
        Controls.Add(_open);

        WirePointer(_open);
        WirePointer(_status);
        WirePointer(this);

        MouseEnter += delegate { _hovered = true; Invalidate(); };
        MouseLeave += delegate { if (!ClientRectangle.Contains(PointToClient(Control.MousePosition))) { _hovered = false; Invalidate(); } };

        _pulseTimer = new System.Windows.Forms.Timer { Interval = 40 };
        _pulseTimer.Tick += delegate
        {
            _pulse += _capturing ? 0.12f : 0.08f;
            if (_pulse > Math.PI * 2f) _pulse -= (float)(Math.PI * 2);
            if (_capturing || _statusBright) Invalidate();
        };
        _pulseTimer.Start();

        ApplyRoundRegion();
    }

    void WirePointer(Control c)
    {
        c.MouseDown += OnPressDown;
        c.MouseMove += OnPressMove;
        c.MouseUp += OnPressUp;
        c.MouseEnter += delegate { _hovered = true; Invalidate(); };
        c.MouseLeave += delegate
        {
            Point p = PointToClient(Control.MousePosition);
            _hovered = ClientRectangle.Contains(p);
            Invalidate();
        };
    }

    void Emit(string msg)
    {
        _outbox.Enqueue(msg);
        _outboxSignal.Set();
    }

    void ApplyRoundRegion()
    {
        int r = Math.Max(8, Height / 2);
        IntPtr hrgn = CreateRoundRectRgn(0, 0, Width + 1, Height + 1, r * 2, r * 2);
        if (hrgn != IntPtr.Zero) SetWindowRgn(Handle, hrgn, true);
    }

    GraphicsPath CapsulePath(Rectangle bounds)
    {
        int r = Math.Max(8, bounds.Height / 2);
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, r * 2, r * 2, 180, 90);
        path.AddArc(bounds.Right - r * 2, bounds.Y, r * 2, r * 2, 270, 90);
        path.AddArc(bounds.Right - r * 2, bounds.Bottom - r * 2, r * 2, r * 2, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - r * 2, r * 2, r * 2, 90, 90);
        path.CloseFigure();
        return path;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var bounds = new Rectangle(0, 0, Width, Height);

        Color top = _capturing ? BgCaptureTop : (_hovered || _statusBright ? Color.FromArgb(255, 24, 32, 50) : BgTop);
        Color bottom = _capturing ? BgCaptureBottom : (_hovered || _statusBright ? Color.FromArgb(255, 16, 22, 36) : BgBottom);

        using (var path = CapsulePath(new Rectangle(0, 0, Width - 1, Height - 1)))
        using (var brush = new LinearGradientBrush(bounds, top, bottom, LinearGradientMode.Vertical))
        {
            g.FillPath(brush, path);
        }

        float glow = _capturing ? (0.55f + 0.35f * (float)Math.Sin(_pulse)) : (_statusBright ? 0.45f : 0f);
        Color border = Color.FromArgb(
            (int)(48 + glow * 80),
            (int)(148 + glow * 20),
            (int)(187 + glow * 10),
            255);
        if (_capturing) border = Color.FromArgb((int)(90 + 50 * Math.Sin(_pulse)), 79, 140, 255);

        using (var path = CapsulePath(new Rectangle(0, 0, Width - 1, Height - 1)))
        using (var pen = new Pen(border, 1f))
        {
            g.DrawPath(pen, path);
        }

        using (var highlight = new Pen(Color.FromArgb(28, 255, 255, 255), 1f))
        {
            int r = Math.Max(8, Height / 2);
            g.DrawLine(highlight, r, 1, Width - r, 1);
        }

        var iconRect = new Rectangle(PadL, Math.Max(0, (Height - IconSize) / 2), IconSize, IconSize);
        using (var iconPath = new GraphicsPath())
        {
            iconPath.AddEllipse(iconRect);
            using (var iconBrush = new SolidBrush(IconBg))
            using (var iconPen = new Pen(Color.FromArgb(40, 255, 255, 255), 1f))
            {
                g.FillPath(iconBrush, iconPath);
                g.DrawPath(iconPen, iconPath);
            }
        }
        TextRenderer.DrawText(
            g,
            "\u2315",
            new Font("Segoe UI", 11f, FontStyle.Regular),
            iconRect,
            TextBright,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

        Color textColor = _statusBright || _capturing ? TextBright : TextMuted;
        var textRect = new Rectangle(
            PadL + IconSize + Gap,
            0,
            Width - (PadL + IconSize + Gap + PadR),
            Height);
        TextRenderer.DrawText(
            g,
            _status.Text,
            _statusFont,
            textRect,
            textColor,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    void OnPressDown(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        _pressing = true;
        _dragging = false;
        _pressScreen = Control.MousePosition;
        _dragAnchor = Location;
    }

    void OnPressMove(object sender, MouseEventArgs e)
    {
        if (!_pressing || (Control.MouseButtons & MouseButtons.Left) == 0) return;
        Point cur = Control.MousePosition;
        int dx = cur.X - _pressScreen.X;
        int dy = cur.Y - _pressScreen.Y;
        if (!_dragging && (Math.Abs(dx) >= DragSlop || Math.Abs(dy) >= DragSlop)) _dragging = true;
        if (_dragging) Location = new Point(_dragAnchor.X + dx, _dragAnchor.Y + dy);
    }

    void OnPressUp(object sender, MouseEventArgs e)
    {
        if (!_pressing || e.Button != MouseButtons.Left) return;
        if (!_dragging) Emit("PILL_TOGGLE");
        else Emit("PILL_MOVED:" + Location.X + ":" + Location.Y);
        _pressing = false;
        _dragging = false;
    }

    void SetStatusText(string text)
    {
        string oneLine = (text ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        if (oneLine.Length == 0) oneLine = " ";
        _status.Text = oneLine;
        ResizeToStatus(oneLine);
        Invalidate();
    }

    void ResizeToStatus(string text)
    {
        int textSlot = _maxTextW;
        Size textSize;
        using (Graphics g = CreateGraphics())
        {
            Size single = TextRenderer.MeasureText(g, text, _statusFont, new Size(int.MaxValue, MaxH), TextFormatFlags.SingleLine);
            textSize = single.Width <= textSlot
                ? single
                : TextRenderer.MeasureText(g, text, _statusFont, new Size(textSlot, MaxH), TextFormatFlags.WordBreak);
        }

        int chrome = PadL + IconSize + Gap + PadR;
        int w = Math.Min(MaxW, Math.Max(MinW, chrome + textSize.Width + 6));
        int h = Math.Min(MaxH, Math.Max(MinH, textSize.Height + 14));
        if (w == Width && h == Height) return;

        Width = w;
        Height = h;
        _open.Location = new Point(PadL, Math.Max(0, (h - IconSize) / 2));
        _status.Location = new Point(PadL + IconSize + Gap, 0);
        _status.Size = new Size(w - (PadL + IconSize + Gap + PadR), h);
        ApplyRoundRegion();
        Emit("PILL_RESIZED:" + w + ":" + h);
        Invalidate();
    }

    void SetCapturing(bool on)
    {
        _capturing = on;
        Invalidate();
    }

    void FlashActive()
    {
        _statusBright = true;
        Invalidate();
        var t = new System.Windows.Forms.Timer { Interval = 2400 };
        t.Tick += delegate
        {
            t.Stop();
            t.Dispose();
            _statusBright = false;
            Invalidate();
        };
        t.Start();
    }

    void HandleCommand(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        if (line.StartsWith("STATUS:")) SetStatusText(line.Substring(7));
        else if (line.StartsWith("POS:"))
        {
            string[] p = line.Substring(4).Split(':');
            int x, y;
            if (p.Length >= 2 && int.TryParse(p[0], out x) && int.TryParse(p[1], out y)) Location = new Point(x, y);
        }
        else if (line.StartsWith("SIZE:"))
        {
            string[] p = line.Substring(5).Split(':');
            int w, h;
            if (p.Length >= 2 && int.TryParse(p[0], out w) && int.TryParse(p[1], out h))
            {
                Width = Math.Min(MaxW, Math.Max(MinW, w));
                Height = Math.Min(MaxH, Math.Max(MinH, h));
                _open.Location = new Point(PadL, Math.Max(0, (Height - IconSize) / 2));
                _status.Size = new Size(Width - (PadL + IconSize + Gap + PadR), Height);
                ApplyRoundRegion();
                Invalidate();
            }
        }
        else if (line.StartsWith("MAXW:"))
        {
            int mw;
            if (int.TryParse(line.Substring(5), out mw) && mw > MinW)
                _maxTextW = Math.Min(MaxW - (PadL + IconSize + Gap + PadR), mw - (PadL + IconSize + Gap + PadR));
        }
        else if (line == "SHOW") { Show(); TopMost = true; }
        else if (line == "HIDE") Hide();
        else if (line.StartsWith("CAPTURE:")) SetCapturing(line.EndsWith("1"));
        else if (line == "ACTIVE") FlashActive();
        else if (line == "QUIT") Close();
    }

    [STAThread]
    public static void Main()
    {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        Console.InputEncoding = new System.Text.UTF8Encoding(false);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new PillHudForm();

        var outThread = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    form._outboxSignal.WaitOne(500);
                    string msg;
                    while (form._outbox.TryDequeue(out msg)) Console.WriteLine(msg);
                    Console.Out.Flush();
                }
            }
            catch { }
        });
        outThread.IsBackground = true;
        outThread.Start();

        var inThread = new Thread(() =>
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    string cmd = line;
                    form.BeginInvoke(new Action(() => form.HandleCommand(cmd)));
                }
            }
            catch { }
            try { form.BeginInvoke(new Action(() => form.Close())); } catch { }
        });
        inThread.IsBackground = true;
        inThread.Start();

        form.Shown += delegate { form.Emit("PILL_READY"); };
        Application.Run(form);
    }
}