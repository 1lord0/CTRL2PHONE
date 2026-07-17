import { resolveApprovedDownloadedFile } from '../src/lib/downloadedFileAccess';

describe('resolveApprovedDownloadedFile', () => {
  const approvedFiles = [
    'C:\\Users\\eren\\AppData\\Local\\Temp\\ctrl2phone\\phone_1.png',
    'C:\\Users\\eren\\AppData\\Local\\Temp\\ctrl2phone\\phone_2.jpg',
  ];

  it('returns the canonical approved path for a listed download', () => {
    // Given a renderer path that only differs by Windows path casing
    const requestedPath = approvedFiles[0].toUpperCase();

    // When it is resolved against paths issued by the main process
    const result = resolveApprovedDownloadedFile(requestedPath, approvedFiles, 'win32');

    // Then the main-process-owned path is returned
    expect(result).toBe(approvedFiles[0]);
  });

  it('rejects a local file that was not issued as a phone download', () => {
    // Given an unrelated local file
    const requestedPath = 'C:\\Users\\eren\\Documents\\private.txt';

    // When it is checked against the approved download list
    const result = resolveApprovedDownloadedFile(requestedPath, approvedFiles, 'win32');

    // Then no filesystem operation is authorized
    expect(result).toBeNull();
  });

  it('rejects traversal and non-string IPC payloads', () => {
    // Given untrusted renderer payloads
    const traversalPath = `${approvedFiles[0]}\\..\\..\\private.txt`;

    // When each payload is checked
    const traversalResult = resolveApprovedDownloadedFile(traversalPath, approvedFiles, 'win32');
    const objectResult = resolveApprovedDownloadedFile({ path: approvedFiles[0] }, approvedFiles, 'win32');

    // Then neither payload is authorized
    expect(traversalResult).toBeNull();
    expect(objectResult).toBeNull();
  });
});
