using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PhotoDropper
{
    [StructLayout(LayoutKind.Sequential)]
    struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeSize
    {
        public int Width;
        public int Height;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ShellDragImage
    {
        public NativeSize SizeDragImage;
        public NativePoint CursorOffset;
        public IntPtr BitmapHandle;
        public int ColorKey;
    }

    [ComImport]
    [Guid("DE5BF786-477A-11D2-839D-00C04FD918D0")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDragSourceHelper
    {
        void InitializeFromBitmap(
            ref ShellDragImage dragImage,
            [MarshalAs(UnmanagedType.Interface)]
            System.Runtime.InteropServices.ComTypes.IDataObject dataObject);

        void InitializeFromWindow(
            IntPtr windowHandle,
            ref NativePoint cursorOffset,
            [MarshalAs(UnmanagedType.Interface)]
            System.Runtime.InteropServices.ComTypes.IDataObject dataObject);
    }

    [ComImport]
    [Guid("4657278A-411B-11D2-839A-00C04FD918D0")]
    class DragDropHelper
    {
    }

    static class NativeMethods
    {
        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DeleteObject(IntPtr handle);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int awareness);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDPIAware();

        public static void EnablePerMonitorDpiAwareness()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
            }
            catch (EntryPointNotFoundException) { }
            catch (DllNotFoundException) { }

            try
            {
                if (SetProcessDpiAwareness(2) == 0) return;
            }
            catch (EntryPointNotFoundException) { }
            catch (DllNotFoundException) { }

            try { SetProcessDPIAware(); } catch { }
        }
    }

    sealed class DragGhostForm : Form
    {
        private const int WindowExTransparent = 0x20;
        private const int WindowExToolWindow = 0x80;
        private const int WindowExNoActivate = 0x08000000;
        private const int WindowNcHitTest = 0x84;
        private static readonly IntPtr HitTestTransparent = new IntPtr(-1);

        private readonly Point cursorOffset;
        private readonly Timer positionTimer;
        private readonly Bitmap preview;

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= WindowExTransparent | WindowExToolWindow | WindowExNoActivate;
                return parameters;
            }
        }

        public DragGhostForm(string path, Rectangle sourceBounds, Point pressScreen)
        {
            const int MaxPreviewWidth = 320;
            const int MaxPreviewHeight = 240;
            const int Border = 3;
            const int Shadow = 7;
            Color colorKey = Color.FromArgb(255, 1, 0, 1);

            using (var source = new Bitmap(path))
            {
                double scale = Math.Min(
                    1.0,
                    Math.Min(
                        (double)MaxPreviewWidth / Math.Max(1, source.Width),
                        (double)MaxPreviewHeight / Math.Max(1, source.Height)));
                int previewWidth = Math.Max(1, (int)Math.Round(source.Width * scale));
                int previewHeight = Math.Max(1, (int)Math.Round(source.Height * scale));
                preview = new Bitmap(
                    previewWidth + Border * 2 + Shadow,
                    previewHeight + Border * 2 + Shadow,
                    PixelFormat.Format32bppArgb);

                using (var graphics = Graphics.FromImage(preview))
                {
                    graphics.Clear(colorKey);
                    graphics.SmoothingMode = SmoothingMode.None;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.FillRectangle(
                        Brushes.DimGray,
                        Border + Shadow,
                        Border + Shadow,
                        previewWidth,
                        previewHeight);
                    graphics.FillRectangle(
                        Brushes.White,
                        0,
                        0,
                        previewWidth + Border * 2,
                        previewHeight + Border * 2);
                    graphics.DrawImage(
                        source,
                        new Rectangle(Border, Border, previewWidth, previewHeight),
                        new Rectangle(0, 0, source.Width, source.Height),
                        GraphicsUnit.Pixel);
                }

                int localPressX = Math.Max(
                    0,
                    Math.Min(sourceBounds.Width, pressScreen.X - sourceBounds.Left));
                int localPressY = Math.Max(
                    0,
                    Math.Min(sourceBounds.Height, pressScreen.Y - sourceBounds.Top));
                cursorOffset = new Point(
                    Math.Max(
                        0,
                        Math.Min(
                            preview.Width - 1,
                            Border + (int)Math.Round(
                                localPressX * (double)previewWidth / Math.Max(1, sourceBounds.Width)))),
                    Math.Max(
                        0,
                        Math.Min(
                            preview.Height - 1,
                            Border + (int)Math.Round(
                                localPressY * (double)previewHeight / Math.Max(1, sourceBounds.Height)))));
            }

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = colorKey;
            TransparencyKey = colorKey;
            Opacity = 0.82;
            ClientSize = preview.Size;
            BackgroundImage = preview;
            BackgroundImageLayout = ImageLayout.None;

            positionTimer = new Timer();
            positionTimer.Interval = 16;
            positionTimer.Tick += delegate { FollowCursor(); };
            Shown += delegate
            {
                FollowCursor();
                positionTimer.Start();
            };
        }

        public void FollowCursor()
        {
            Point cursor = Control.MousePosition;
            Location = new Point(cursor.X - cursorOffset.X, cursor.Y - cursorOffset.Y);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WindowNcHitTest)
            {
                message.Result = HitTestTransparent;
                return;
            }
            base.WndProc(ref message);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                positionTimer.Stop();
                positionTimer.Dispose();
                preview.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    sealed class DragProxyForm : Form
    {
        sealed class DragImageResources : IDisposable
        {
            private IntPtr bitmapHandle;
            private object helper;

            public DragImageResources(IntPtr bitmap, object dragHelper)
            {
                bitmapHandle = bitmap;
                helper = dragHelper;
            }

            public void Dispose()
            {
                if (bitmapHandle != IntPtr.Zero)
                {
                    NativeMethods.DeleteObject(bitmapHandle);
                    bitmapHandle = IntPtr.Zero;
                }
                if (helper != null && Marshal.IsComObject(helper))
                {
                    try { Marshal.FinalReleaseComObject(helper); } catch { }
                }
                helper = null;
            }
        }

        private readonly string filePath;
        private readonly StreamWriter output;
        private readonly Rectangle sourceBounds;
        private Point pressScreen;
        private bool pressing;
        private bool dragging;

        protected override bool ShowWithoutActivation { get { return true; } }

        public DragProxyForm(string path, Rectangle bounds)
        {
            filePath = path;
            sourceBounds = bounds;
            output = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false));
            output.AutoFlush = true;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            TopMost = true;
            Opacity = 0.01;
            Cursor = Cursors.Default;
            MouseDown += OnProxyMouseDown;
            MouseMove += OnProxyMouseMove;
            MouseUp += delegate
            {
                pressing = false;
                Capture = false;
            };
            Shown += delegate { Emit("READY"); };
        }

        private void Emit(string message)
        {
            try { output.WriteLine(message); } catch { }
        }

        private void OnProxyMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left || dragging) return;
            pressing = true;
            pressScreen = Control.MousePosition;
            Capture = true;
        }

        private void OnProxyMouseMove(object sender, MouseEventArgs e)
        {
            if (!pressing || dragging) return;
            if ((Control.MouseButtons & MouseButtons.Left) == 0)
            {
                pressing = false;
                Capture = false;
                return;
            }
            Point current = Control.MousePosition;
            Size dragSize = SystemInformation.DragSize;
            var threshold = new Rectangle(
                pressScreen.X - dragSize.Width / 2,
                pressScreen.Y - dragSize.Height / 2,
                Math.Max(1, dragSize.Width),
                Math.Max(1, dragSize.Height));
            if (threshold.Contains(current)) return;
            pressing = false;
            dragging = true;
            Capture = false;
            try
            {
                var data = new DataObject(DataFormats.FileDrop, new[] { filePath });
                Emit("STARTING");
                string command = Console.In.ReadLine();
                if (!string.Equals(command == null ? null : command.Trim(), "GO", StringComparison.Ordinal))
                {
                    Emit("FAILED:DragStartNotAcknowledged");
                    return;
                }

                // Keep the source HWND alive for OLE, but remove it from every
                // real monitor so it can never cover a website drop target.
                TopMost = false;
                Rectangle desktop = SystemInformation.VirtualScreen;
                Location = new Point(
                    desktop.Left - sourceBounds.Width - 64,
                    desktop.Top - sourceBounds.Height - 64);

                DragImageResources dragImage = null;
                DragGhostForm dragGhost = null;
                GiveFeedbackEventHandler feedback = null;
                try
                {
                    try
                    {
                        dragImage = AttachShellDragImage(data);
                    }
                    catch (Exception imageError)
                    {
                        // WinForms' COM IDataObject rejects the Shell helper's
                        // private formats on some .NET Framework versions. Keep
                        // the native OLE file drag and provide an input-transparent
                        // hotspot-aware preview in that case.
                        Emit("DRAG_IMAGE_FALLBACK:" + imageError.GetType().Name);
                        dragGhost = new DragGhostForm(filePath, sourceBounds, pressScreen);
                        dragGhost.Show();
                        dragGhost.FollowCursor();
                        feedback = delegate(object feedbackSender, GiveFeedbackEventArgs feedbackArgs)
                        {
                            dragGhost.FollowCursor();
                            feedbackArgs.UseDefaultCursors = true;
                        };
                        GiveFeedback += feedback;
                    }

                    Emit("STARTED");
                    var effect = DoDragDrop(data, DragDropEffects.Copy);
                    Emit("DONE:" + effect);
                }
                finally
                {
                    if (feedback != null) GiveFeedback -= feedback;
                    if (dragGhost != null)
                    {
                        dragGhost.Close();
                        dragGhost.Dispose();
                    }
                    if (dragImage != null) dragImage.Dispose();
                }
            }
            catch (Exception ex)
            {
                Emit("FAILED:" + ex.GetType().Name + ":" + ex.Message.Replace('\r', ' ').Replace('\n', ' '));
            }
            finally
            {
                Close();
            }
        }

        private DragImageResources AttachShellDragImage(DataObject data)
        {
            const int MaxPreviewWidth = 320;
            const int MaxPreviewHeight = 240;
            const int Border = 3;
            const int Shadow = 7;
            Color colorKey = Color.FromArgb(255, 1, 0, 1);

            using (var source = new Bitmap(filePath))
            {
                double scale = Math.Min(
                    1.0,
                    Math.Min(
                        (double)MaxPreviewWidth / Math.Max(1, source.Width),
                        (double)MaxPreviewHeight / Math.Max(1, source.Height)));
                int previewWidth = Math.Max(1, (int)Math.Round(source.Width * scale));
                int previewHeight = Math.Max(1, (int)Math.Round(source.Height * scale));
                int bitmapWidth = previewWidth + Border * 2 + Shadow;
                int bitmapHeight = previewHeight + Border * 2 + Shadow;

                using (var bitmap = new Bitmap(bitmapWidth, bitmapHeight, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(colorKey);
                    graphics.SmoothingMode = SmoothingMode.None;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.FillRectangle(
                        Brushes.DimGray,
                        Border + Shadow,
                        Border + Shadow,
                        previewWidth,
                        previewHeight);
                    graphics.FillRectangle(
                        Brushes.White,
                        0,
                        0,
                        previewWidth + Border * 2,
                        previewHeight + Border * 2);
                    graphics.DrawImage(
                        source,
                        new Rectangle(Border, Border, previewWidth, previewHeight),
                        new Rectangle(0, 0, source.Width, source.Height),
                        GraphicsUnit.Pixel);

                    IntPtr bitmapHandle = bitmap.GetHbitmap(colorKey);
                    object helperObject = new DragDropHelper();
                    try
                    {
                        var helper = (IDragSourceHelper)helperObject;
                        int localPressX = Math.Max(
                            0,
                            Math.Min(sourceBounds.Width, pressScreen.X - sourceBounds.Left));
                        int localPressY = Math.Max(
                            0,
                            Math.Min(sourceBounds.Height, pressScreen.Y - sourceBounds.Top));
                        int cursorX = Border + (int)Math.Round(
                                localPressX * (double)previewWidth / Math.Max(1, sourceBounds.Width));
                        int cursorY = Border + (int)Math.Round(
                                localPressY * (double)previewHeight / Math.Max(1, sourceBounds.Height));
                        var dragImage = new ShellDragImage
                        {
                            SizeDragImage = new NativeSize
                            {
                                Width = bitmapWidth,
                                Height = bitmapHeight
                            },
                            CursorOffset = new NativePoint
                            {
                                X = Math.Max(0, Math.Min(bitmapWidth - 1, cursorX)),
                                Y = Math.Max(0, Math.Min(bitmapHeight - 1, cursorY))
                            },
                            BitmapHandle = bitmapHandle,
                            ColorKey = ColorTranslator.ToWin32(colorKey)
                        };
                        helper.InitializeFromBitmap(
                            ref dragImage,
                            (System.Runtime.InteropServices.ComTypes.IDataObject)data);
                        return new DragImageResources(bitmapHandle, helperObject);
                    }
                    catch
                    {
                        NativeMethods.DeleteObject(bitmapHandle);
                        if (Marshal.IsComObject(helperObject))
                        {
                            try { Marshal.FinalReleaseComObject(helperObject); } catch { }
                        }
                        throw;
                    }
                }
            }
        }

    }

    public class DropperForm : Form
    {
        private FlowLayoutPanel galleryPanel;
        private Label titleLabel;
        private Label subtitleLabel;
        private Button closeButton;
        private Button dragAllButton;
        private string[] filePaths;

        // For frameless window dragging
        private bool isMoving = false;
        private Point moveStart;

        public DropperForm(string[] imagePaths)
        {
            this.filePaths = imagePaths;
            InitializeUI();
            LoadImages();
        }

        private void InitializeUI()
        {
            // Responsive width based on image count
            int numImages = filePaths.Length;
            int thumbWidth = 110;
            int galleryWidth = Math.Min(numImages, 3) * (thumbWidth + 10) + 10;
            int contentWidth = 240;
            int formWidth = galleryWidth + contentWidth;
            int formHeight = 110;

            // Form settings
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // #0f172a (dark slate)
            this.Size = new Size(formWidth, formHeight);
            this.DoubleBuffered = true;

            // Position at top center of working area
            var screen = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point(
                (screen.Width - this.Width) / 2,
                40
            );

            // Windows 11 style rounded corners
            this.Region = CreateRoundedRegion(this.Width, this.Height, 18);

            // ── Gallery Panel (Left side flow) ─────────────────────────
            galleryPanel = new FlowLayoutPanel
            {
                Location = new Point(10, 10),
                Size = new Size(galleryWidth, 90),
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoScroll = numImages > 3,
                BackColor = Color.Transparent
            };
            this.Controls.Add(galleryPanel);

            // ── Content side (Right) ───────────────────────────────────
            int textX = galleryWidth + 15;

            titleLabel = new Label
            {
                Text = numImages > 1 ? numImages + " Yeni Görsel Alındı" : "Yeni Görsel Alındı",
                ForeColor = Color.FromArgb(248, 250, 252), // #f8fafc
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Location = new Point(textX, 18),
                AutoSize = true
            };
            this.Controls.Add(titleLabel);

            subtitleLabel = new Label
            {
                Text = "Sürükleyip paylaşın",
                ForeColor = Color.FromArgb(148, 163, 184), // #94a3b8
                Font = new Font("Segoe UI", 9, FontStyle.Regular),
                Location = new Point(textX, 42),
                AutoSize = true
            };
            this.Controls.Add(subtitleLabel);

            // Drag All Button (Only shown or styled nicely for single/multiple)
            dragAllButton = new Button
            {
                Text = numImages > 1 ? "⠂⠂ Hepsini Sürükle" : "⠂⠂ Sürükle",
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(59, 130, 246), // Blue-500
                BackColor = Color.FromArgb(30, 41, 59), // Slate-800
                Font = new Font("Segoe UI", 8f, FontStyle.Bold),
                Size = new Size(130, 26),
                Location = new Point(textX, 68),
                Cursor = Cursors.SizeAll
            };
            dragAllButton.FlatAppearance.BorderSize = 0;
            dragAllButton.MouseDown += DragAllButton_MouseDown;
            this.Controls.Add(dragAllButton);

            // ── Close button ───────────────────────────────────────────
            closeButton = new Button
            {
                Text = "✕",
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(148, 163, 184),
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                Size = new Size(24, 24),
                Location = new Point(this.Width - 32, 8),
                Cursor = Cursors.Hand
            };
            closeButton.FlatAppearance.BorderSize = 0;
            closeButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 68, 68);
            closeButton.Click += (s, e) => this.Close();
            this.Controls.Add(closeButton);

            // ── Enable window dragging from the background & text ──────
            this.MouseDown += Window_MouseDown;
            this.MouseMove += Window_MouseMove;
            this.MouseUp += Window_MouseUp;
            titleLabel.MouseDown += Window_MouseDown;
            titleLabel.MouseMove += Window_MouseMove;
            titleLabel.MouseUp += Window_MouseUp;
            subtitleLabel.MouseDown += Window_MouseDown;
            subtitleLabel.MouseMove += Window_MouseMove;
            subtitleLabel.MouseUp += Window_MouseUp;
        }

        private void LoadImages()
        {
            foreach (var path in filePaths)
            {
                if (!File.Exists(path)) continue;

                // Thumbnail container
                var itemPanel = new Panel
                {
                    Size = new Size(100, 75),
                    Margin = new Padding(0, 5, 10, 5),
                    BackColor = Color.FromArgb(30, 41, 59), // Slate-800
                    Cursor = Cursors.Hand
                };

                var pb = new PictureBox
                {
                    Dock = DockStyle.Fill,
                    SizeMode = PictureBoxSizeMode.Zoom,
                    BackColor = Color.Transparent,
                    Cursor = Cursors.Hand
                };

                try
                {
                    byte[] bytes = File.ReadAllBytes(path);
                    using (var ms = new MemoryStream(bytes))
                    using (var tmp = Image.FromStream(ms))
                    {
                        // Copy into an independent Bitmap so the PictureBox doesn't
                        // depend on the soon-to-be-disposed stream (GDI+ requires the
                        // source stream to stay open otherwise).
                        pb.Image = new Bitmap(tmp);
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Failed to load thumbnail: " + ex.Message);
                    continue;
                }

                // Tag it with its path for the drag event
                pb.Tag = path;
                pb.MouseDown += Thumbnail_MouseDown;

                // Border paint helper
                itemPanel.Paint += (s, e) =>
                {
                    using (var pen = new Pen(Color.FromArgb(51, 255, 255, 255), 1))
                    {
                        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                        e.Graphics.DrawRectangle(pen, 0, 0, itemPanel.Width - 1, itemPanel.Height - 1);
                    }
                };

                itemPanel.Controls.Add(pb);
                galleryPanel.Controls.Add(itemPanel);
            }
        }

        // ── Drag specific thumbnail ──────────────────────────────────
        private void Thumbnail_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                var pb = sender as PictureBox;
                string singlePath = (pb != null) ? pb.Tag as string : null;

                if (!string.IsNullOrEmpty(singlePath) && File.Exists(singlePath))
                {
                    var data = new DataObject(DataFormats.FileDrop, new string[] { singlePath });
                    DoDragDrop(data, DragDropEffects.Copy);

                    // De-escalate window focus after drop
                    this.TopMost = false;
                    this.SendToBack();
                }
            }
        }

        // ── Drag all files ───────────────────────────────────────────
        private void DragAllButton_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && filePaths.Length > 0)
            {
                var validPaths = new List<string>();
                foreach (var path in filePaths)
                {
                    if (File.Exists(path)) validPaths.Add(path);
                }

                if (validPaths.Count > 0)
                {
                    var data = new DataObject(DataFormats.FileDrop, validPaths.ToArray());
                    DoDragDrop(data, DragDropEffects.Copy);

                    this.TopMost = false;
                    this.SendToBack();
                }
            }
        }

        // ── Form movement dragging ────────────────────────────────────
        private void Window_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                isMoving = true;
                moveStart = e.Location;
            }
        }

        private void Window_MouseMove(object sender, MouseEventArgs e)
        {
            if (isMoving)
            {
                this.Left += e.X - moveStart.X;
                this.Top += e.Y - moveStart.Y;
            }
        }

        private void Window_MouseUp(object sender, MouseEventArgs e)
        {
            isMoving = false;
        }

        // ── Windows 11 style rounded region ───────────────────────────
        private Region CreateRoundedRegion(int width, int height, int radius)
        {
            var path = new GraphicsPath();
            path.AddArc(0, 0, radius * 2, radius * 2, 180, 90);
            path.AddArc(width - radius * 2, 0, radius * 2, radius * 2, 270, 90);
            path.AddArc(width - radius * 2, height - radius * 2, radius * 2, radius * 2, 0, 90);
            path.AddArc(0, height - radius * 2, radius * 2, radius * 2, 90, 90);
            path.CloseFigure();
            return new Region(path);
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length == 6 && args[0] == "--drag-proxy")
            {
                int x, y, width, height;
                if (!File.Exists(args[1]) ||
                    !int.TryParse(args[2], out x) || !int.TryParse(args[3], out y) ||
                    !int.TryParse(args[4], out width) || !int.TryParse(args[5], out height)) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new DragProxyForm(
                    args[1],
                    new Rectangle(x, y, Math.Max(8, width), Math.Max(8, height))));
                return;
            }

            if (args.Length == 0)
            {
                MessageBox.Show("Kullanım: photo_dropper.exe <resim-yolu1> <resim-yolu2> ...", "Hata");
                return;
            }

            var validPaths = new List<string>();
            foreach (var path in args)
            {
                if (File.Exists(path)) validPaths.Add(path);
            }

            if (validPaths.Count == 0)
            {
                MessageBox.Show("Gösterilecek geçerli dosya bulunamadı.", "Hata");
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DropperForm(validPaths.ToArray()));
        }
    }
}
