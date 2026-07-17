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
/// Tüm görsel tek OnPaint'te çizilir (çocuk kontrol yok → çift çizim/bulanıklık yok).
/// </summary>
sealed class PillHudForm : Form
{
    const int MinW = 220;
    const int MaxW = 720;
    const int MinH = 44;
    const int MaxH = 80;
    const int PadL = 14;
    const int PadR = 18;
    const int IconSize = 30;
    const int Gap = 10;
    const int CS_DROPSHADOW = 0x20000;

    // TransparencyKey: köşeler tam şeffaf → SetWindowRgn sert kırpımının beyaz halesi yok.
    static readonly Color TransparentKey = Color.FromArgb(255, 1, 2, 3);

    static readonly Color BgTop = Color.FromArgb(255, 25, 34, 56);
    static readonly Color BgBottom = Color.FromArgb(255, 13, 18, 31);
    static readonly Color BgHoverTop = Color.FromArgb(255, 31, 42, 68);
    static readonly Color BgHoverBottom = Color.FromArgb(255, 17, 24, 40);
    static readonly Color BgCaptureTop = Color.FromArgb(255, 28, 42, 72);
    static readonly Color BgCaptureBottom = Color.FromArgb(255, 16, 25, 46);
    static readonly Color TextMuted = Color.FromArgb(255, 143, 166, 202);
    static readonly Color TextBright = Color.FromArgb(255, 232, 240, 253);
    static readonly Color Accent = Color.FromArgb(255, 91, 149, 255);
    static readonly Color AccentSoft = Color.FromArgb(255, 132, 176, 255);

    readonly Font _statusFont;
    readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
    readonly AutoResetEvent _outboxSignal = new AutoResetEvent(false);
    readonly System.Windows.Forms.Timer _animTimer;

    string _statusText = "Hazır";
    bool _pressing;
    bool _hovered;
    bool _capturing;
    bool _statusBright;
    float _hoverT;   // 0..1 yumuşak hover geçişi
    float _pressT;   // 0..1 basılıyken hafif koyulaşma
    float _pulse;
    Point _targetLocation;
    bool _slideAnimating;
    int _maxTextW = 520;

    // Overlay seçim modundayken pill odak çalmamalı — aksi halde ilk seferde fare/klavye ölü kalır.
    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ClassStyle |= CS_DROPSHADOW; // kapsülün altına yumuşak sistem gölgesi
            return cp;
        }
    }

    public PillHudForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = TransparentKey;
        TransparencyKey = TransparentKey;
        ForeColor = TextMuted;
        Cursor = Cursors.Hand;
        Font = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        _statusFont = new Font("Segoe UI", 9.25f, FontStyle.Regular, GraphicsUnit.Point);
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Width = 320;
        Height = 52;

        MouseDown += OnPressDown;
        MouseMove += OnPressMove;
        MouseUp += OnPressUp;
        MouseEnter += delegate { _hovered = true; };
        MouseLeave += delegate
        {
            _hovered = ClientRectangle.Contains(PointToClient(Control.MousePosition));
        };

        // Tek animasyon zamanlayıcısı: hover/press geçişleri + yakalama nabzı.
        _animTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _animTimer.Tick += delegate
        {
            bool dirty = false;

            if (_slideAnimating)
            {
                int distance = _targetLocation.Y - Location.Y;
                if (Math.Abs(distance) <= 2)
                {
                    Location = _targetLocation;
                    _slideAnimating = false;
                }
                else
                {
                    Location = new Point(_targetLocation.X, Location.Y + Math.Max(1, (int)Math.Round(distance * 0.34f)));
                }
            }

            float hoverTarget = _hovered ? 1f : 0f;
            if (Math.Abs(_hoverT - hoverTarget) > 0.01f)
            {
                _hoverT += (hoverTarget - _hoverT) * 0.28f;
                dirty = true;
            }

            float pressTarget = _pressing ? 1f : 0f;
            if (Math.Abs(_pressT - pressTarget) > 0.01f)
            {
                _pressT += (pressTarget - _pressT) * 0.45f;
                dirty = true;
            }

            if (_capturing || _statusBright)
            {
                _pulse += _capturing ? 0.14f : 0.09f;
                if (_pulse > Math.PI * 2f) _pulse -= (float)(Math.PI * 2);
                dirty = true;
            }

            if (dirty) Invalidate();
        };
        _animTimer.Start();

    }

    void Emit(string msg)
    {
        _outbox.Enqueue(msg);
        _outboxSignal.Set();
    }

    static GraphicsPath CapsulePath(Rectangle bounds)
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

    static Color Lerp(Color a, Color b, float t)
    {
        t = Math.Max(0f, Math.Min(1f, t));
        return Color.FromArgb(
            (int)(a.A + (b.A - a.A) * t),
            (int)(a.R + (b.R - a.R) * t),
            (int)(a.G + (b.G - a.G) * t),
            (int)(a.B + (b.B - a.B) * t));
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var bounds = new Rectangle(0, 0, Width, Height);
        var capsule = new Rectangle(0, 0, Width - 1, Height - 1);

        g.Clear(TransparentKey);

        // ── Zemin: durum + hover + basış karışımı ──
        Color top = Lerp(BgTop, BgHoverTop, _hoverT);
        Color bottom = Lerp(BgBottom, BgHoverBottom, _hoverT);
        if (_capturing)
        {
            top = BgCaptureTop;
            bottom = BgCaptureBottom;
        }
        // Basılıyken çok hafif koyulaştır (dokunsal geri bildirim).
        top = Lerp(top, Color.FromArgb(255, top.R * 4 / 5, top.G * 4 / 5, top.B * 4 / 5), _pressT * 0.6f);
        bottom = Lerp(bottom, Color.FromArgb(255, bottom.R * 4 / 5, bottom.G * 4 / 5, bottom.B * 4 / 5), _pressT * 0.6f);

        using (var path = CapsulePath(capsule))
        using (var brush = new LinearGradientBrush(bounds, top, bottom, LinearGradientMode.Vertical))
        {
            g.FillPath(brush, path);
        }

        // ── Kenarlık: bekleme → hover → yakalama nabzı ──
        Color border;
        if (_capturing)
        {
            int pulseA = (int)(110 + 70 * Math.Sin(_pulse));
            border = Color.FromArgb(pulseA, Accent);
        }
        else if (_statusBright)
        {
            border = Color.FromArgb(120, AccentSoft);
        }
        else
        {
            border = Lerp(Color.FromArgb(52, 148, 187, 255), Color.FromArgb(110, 148, 187, 255), _hoverT);
        }
        using (var path = CapsulePath(capsule))
        using (var pen = new Pen(border, 1f) { Alignment = PenAlignment.Inset })
        {
            g.DrawPath(pen, path);
        }

        // Üst iç ışık — mavi tonlu, beyaz halo yok
        using (var highlight = new Pen(Color.FromArgb((int)(18 + 12 * _hoverT), 120, 165, 230), 1f))
        {
            int r = Math.Max(8, Height / 2);
            g.DrawLine(highlight, r + 1, 1, Width - r - 1, 1);
        }

        // ── İkon: vektör mercek (daire + sap), hover'da vurgu rengi ──
        var iconRect = new Rectangle(PadL, Math.Max(0, (Height - IconSize) / 2), IconSize, IconSize);
        Color iconBg = Color.FromArgb((int)(34 + 28 * _hoverT), 42, 62, 98);
        Color iconBorder = Color.FromArgb((int)(55 + 65 * _hoverT), 100, 150, 230);
        Color ringColor = Lerp(Color.FromArgb(210, TextBright), Accent, _hoverT);
        if (_capturing) ringColor = Color.FromArgb((int)(190 + 60 * Math.Sin(_pulse)) > 255 ? 255 : (int)(190 + 60 * Math.Sin(_pulse)), Accent);

        using (var iconPath = new GraphicsPath())
        {
            iconPath.AddEllipse(iconRect);
            using (var iconBrush = new LinearGradientBrush(
                iconRect,
                Color.FromArgb((int)(42 + 24 * _hoverT), 56, 78, 118),
                iconBg,
                LinearGradientMode.Vertical))
            using (var iconPen = new Pen(iconBorder, 1f) { Alignment = PenAlignment.Inset })
            {
                g.FillPath(iconBrush, iconPath);
                g.DrawPath(iconPen, iconPath);
            }
        }

        // Mercek gövdesi: ikonun ortasında küçük daire, sağ-alta inen kısa sap.
        float cx = iconRect.X + iconRect.Width * 0.44f;
        float cy = iconRect.Y + iconRect.Height * 0.44f;
        float lensR = iconRect.Width * 0.20f;
        using (var lensPen = new Pen(ringColor, 1.8f))
        {
            lensPen.StartCap = LineCap.Round;
            lensPen.EndCap = LineCap.Round;
            g.DrawEllipse(lensPen, cx - lensR, cy - lensR, lensR * 2, lensR * 2);
            float hx = cx + lensR * 0.72f;
            float hy = cy + lensR * 0.72f;
            g.DrawLine(lensPen, hx, hy, hx + iconRect.Width * 0.16f, hy + iconRect.Height * 0.16f);
        }

        // ── Durum metni ──
        Color textColor = _statusBright || _capturing ? TextBright : Lerp(TextMuted, TextBright, _hoverT * 0.55f);
        var textRect = new Rectangle(
            PadL + IconSize + Gap,
            0,
            Width - (PadL + IconSize + Gap + PadR),
            Height);
        TextRenderer.DrawText(
            g,
            _statusText,
            _statusFont,
            textRect,
            textColor,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    void OnPressDown(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        _pressing = true;
    }

    void OnPressMove(object sender, MouseEventArgs e)
    {
        // The pill is anchored to the top-center; pointer movement must not reposition it.
    }

    void OnPressUp(object sender, MouseEventArgs e)
    {
        if (!_pressing || e.Button != MouseButtons.Left) return;
        Emit("PILL_TOGGLE");
        _pressing = false;
    }

    void SetStatusText(string text)
    {
        string oneLine = (text ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        if (oneLine.Length == 0) oneLine = " ";
        _statusText = oneLine;
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
            if (p.Length >= 2 && int.TryParse(p[0], out x) && int.TryParse(p[1], out y))
            {
                _targetLocation = new Point(x, y);
                if (!_slideAnimating) Location = _targetLocation;
            }
        }
        else if (line.StartsWith("SIZE:"))
        {
            string[] p = line.Substring(5).Split(':');
            int w, h;
            if (p.Length >= 2 && int.TryParse(p[0], out w) && int.TryParse(p[1], out h))
            {
                Width = Math.Min(MaxW, Math.Max(MinW, w));
                Height = Math.Min(MaxH, Math.Max(MinH, h));
                Invalidate();
            }
        }
        else if (line.StartsWith("MAXW:"))
        {
            int mw;
            if (int.TryParse(line.Substring(5), out mw) && mw > MinW)
                _maxTextW = Math.Min(MaxW - (PadL + IconSize + Gap + PadR), mw - (PadL + IconSize + Gap + PadR));
        }
        else if (line == "SHOW")
        {
            if (!Visible)
            {
                Location = new Point(_targetLocation.X, _targetLocation.Y - Height - 18);
                _slideAnimating = true;
                Show();
            }
            TopMost = true;
        }
        else if (line == "HIDE") { _slideAnimating = false; Hide(); }
        else if (line.StartsWith("CAPTURE:")) SetCapturing(line.EndsWith("1"));
        else if (line == "ACTIVE") FlashActive();
        else if (line == "QUIT") Close();
    }

    [STAThread]
    public static void Main()
    {
        // Console.Input/OutputEncoding setter'ları konsolu olmayan winexe'de
        // SetConsoleCP çağırıp IOException fırlatır (Electron pipe ile başlatır,
        // konsol yoktur). Bu yüzden stdio üzerinde doğrudan UTF-8 stream kullan.
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new PillHudForm();

        var stdout = new System.IO.StreamWriter(
            Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false));
        stdout.AutoFlush = true;

        var outThread = new Thread(() =>
        {
            try
            {
                while (true)
                {
                    form._outboxSignal.WaitOne(500);
                    string msg;
                    while (form._outbox.TryDequeue(out msg)) stdout.WriteLine(msg);
                }
            }
            catch { }
        });
        outThread.IsBackground = true;
        outThread.Start();

        var stdin = new System.IO.StreamReader(
            Console.OpenStandardInput(), new System.Text.UTF8Encoding(false));

        var inThread = new Thread(() =>
        {
            try
            {
                string line;
                while ((line = stdin.ReadLine()) != null)
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
