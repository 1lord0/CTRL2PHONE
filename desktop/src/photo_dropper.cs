using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

namespace PhotoDropper
{
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
                    {
                        pb.Image = Image.FromStream(ms);
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
