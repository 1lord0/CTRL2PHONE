import * as path from 'path';

export function resolveApprovedDownloadedFile(
  requestedPath: unknown,
  approvedPaths: readonly string[],
  platform: NodeJS.Platform = process.platform
): string | null {
  if (typeof requestedPath !== 'string' || requestedPath.trim().length === 0) {
    return null;
  }

  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalizedRequest = pathApi.resolve(requestedPath);

  for (const approvedPath of approvedPaths) {
    const normalizedApproved = pathApi.resolve(approvedPath);
    const matches =
      platform === 'win32'
        ? normalizedApproved.toLocaleLowerCase('en-US') ===
          normalizedRequest.toLocaleLowerCase('en-US')
        : normalizedApproved === normalizedRequest;

    if (matches) return approvedPath;
  }

  return null;
}
