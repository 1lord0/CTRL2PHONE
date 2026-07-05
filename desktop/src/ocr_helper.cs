using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

/// <summary>
/// Windows built-in OCR helper. Reads a PNG/JPEG path from argv[1], writes extracted
/// text to stdout. Used by the Electron main process for offline screen-text capture.
/// </summary>
class OcrHelper
{
    static int Main(string[] args)
    {
        try
        {
            return MainAsync(args).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    static async Task<int> MainAsync(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Usage: ocr_helper.exe <image-path>");
            return 1;
        }

        var path = args[0];
        if (!File.Exists(path))
        {
            Console.Error.WriteLine("File not found: " + path);
            return 1;
        }

        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine == null)
        {
            engine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en"));
        }
        if (engine == null)
        {
            Console.Error.WriteLine("OCR engine could not be created. Install a Windows language pack.");
            return 1;
        }

        byte[] bytes = File.ReadAllBytes(path);
        using (var stream = new InMemoryRandomAccessStream())
        {
            await stream.WriteAsync(bytes.AsBuffer());
            stream.Seek(0);

            var decoder = await BitmapDecoder.CreateAsync(stream);
            var bitmap = await decoder.GetSoftwareBitmapAsync(
                BitmapPixelFormat.Bgra8,
                BitmapAlphaMode.Premultiplied);

            var result = await engine.RecognizeAsync(bitmap);
            var text = result != null && result.Text != null ? result.Text : string.Empty;
            Console.Out.Write(text);
            return 0;
        }
    }
}