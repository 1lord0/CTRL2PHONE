declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'png' | 'jpg';
    screen?: number | string | 'all';
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
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
