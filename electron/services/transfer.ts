import * as fs from 'fs';
import * as path from 'path';

interface TransferProgress {
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  percentage: number;
  status: 'transferring' | 'completed' | 'error';
  error?: string;
}

export async function copyTracks(
  sourcePaths: string[],
  destinationDir: string,
  onProgress: (progress: TransferProgress) => void
): Promise<{ success: boolean; copiedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let copiedCount = 0;

  // Ensure destination directory exists
  await fs.promises.mkdir(destinationDir, { recursive: true });

  for (let i = 0; i < sourcePaths.length; i++) {
    const sourcePath = sourcePaths[i];
    const fileName = path.basename(sourcePath);
    let destPath = path.join(destinationDir, fileName);

    onProgress({
      totalFiles: sourcePaths.length,
      completedFiles: i,
      currentFile: fileName,
      percentage: Math.round((i / sourcePaths.length) * 100),
      status: 'transferring',
    });

    try {
      // Handle duplicate file names
      if (await fileExists(destPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        let counter = 1;
        while (await fileExists(destPath)) {
          destPath = path.join(destinationDir, `${base} (${counter})${ext}`);
          counter++;
        }
      }

      await copyFileWithStream(sourcePath, destPath);
      copiedCount++;
    } catch (err: any) {
      errors.push(`${fileName}: ${err.message}`);
    }
  }

  onProgress({
    totalFiles: sourcePaths.length,
    completedFiles: sourcePaths.length,
    currentFile: '',
    percentage: 100,
    status: errors.length > 0 ? 'error' : 'completed',
    error: errors.length > 0 ? errors.join('\n') : undefined,
  });

  return { success: errors.length === 0, copiedCount, errors };
}

async function copyFileWithStream(
  source: string,
  destination: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(source);
    const writeStream = fs.createWriteStream(destination);

    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    readStream.pipe(writeStream);
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
