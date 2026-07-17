declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'png' | 'jpg';
    screen?: number | string | 'all';
  }
  interface ScreenshotDisplay {
    readonly id: string;
    readonly name: string;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
    readonly dpiScale: number;
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  namespace screenshot {
    function listDisplays(): Promise<readonly ScreenshotDisplay[]>;
  }
  export = screenshot;
}

declare module 'qrcode' {
  export function toDataURL(
    text: string,
    options?: {
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      margin?: number;
      width?: number;
      color?: {
        dark?: string;
        light?: string;
      };
    }
  ): Promise<string>;
}
