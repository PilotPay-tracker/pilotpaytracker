/**
 * useImportQueue - Multi-File Import Queue Manager
 *
 * Manages the state of importing multiple files:
 * - Tracks overall and per-file progress
 * - Handles sequential file processing
 * - Provides callbacks for UI updates
 */

import { useState, useCallback } from 'react';
import type { ImportQueueState, ImportFileStatus } from '@/components/trips/ImportProgressOverlay';

export function useImportQueue() {
  const [queue, setQueue] = useState<ImportQueueState>({
    isActive: false,
    totalFiles: 0,
    processedFiles: 0,
    currentFileIndex: 0,
    files: [],
    overallProgress: 0,
  });

  // Start a new import queue with file names
  const startQueue = useCallback((fileNames: string[]) => {
    const files: ImportFileStatus[] = fileNames.map((name, index) => ({
      id: `file-${index}-${Date.now()}`,
      name,
      status: 'pending',
      progress: 0,
    }));

    setQueue({
      isActive: true,
      totalFiles: fileNames.length,
      processedFiles: 0,
      currentFileIndex: 0,
      files,
      overallProgress: 0,
    });
  }, []);

  // Update a specific file's status
  const updateFileStatus = useCallback(
    (index: number, status: ImportFileStatus['status'], progress?: number, extra?: Partial<ImportFileStatus>) => {
      setQueue(prev => {
        const newFiles = [...prev.files];
        if (newFiles[index]) {
          newFiles[index] = {
            ...newFiles[index],
            status,
            progress: progress ?? (status === 'done' ? 100 : newFiles[index].progress),
            ...extra,
          };
        }

        // Calculate overall progress
        const processedFiles = newFiles.filter(f => f.status === 'done' || f.status === 'error').length;
        const overallProgress = Math.round((processedFiles / prev.totalFiles) * 100);

        return {
          ...prev,
          files: newFiles,
          processedFiles,
          currentFileIndex: status === 'done' || status === 'error' ? Math.min(index + 1, prev.totalFiles - 1) : index,
          overallProgress,
        };
      });
    },
    []
  );

  // Mark current file as uploading
  const setFileUploading = useCallback(
    (index: number, progress: number = 0) => {
      updateFileStatus(index, 'uploading', progress);
    },
    [updateFileStatus]
  );

  // Mark current file as parsing
  const setFileParsing = useCallback(
    (index: number, progress: number = 50) => {
      updateFileStatus(index, 'parsing', progress);
    },
    [updateFileStatus]
  );

  // Mark current file as done
  const setFileDone = useCallback(
    (index: number, tripsFound: number = 0) => {
      updateFileStatus(index, 'done', 100, { tripsFound });
    },
    [updateFileStatus]
  );

  // Mark current file as error
  const setFileError = useCallback(
    (index: number, errorMessage: string) => {
      updateFileStatus(index, 'error', 0, { errorMessage });
    },
    [updateFileStatus]
  );

  // Cancel the queue
  const cancelQueue = useCallback(() => {
    setQueue(prev => ({
      ...prev,
      isActive: false,
    }));
  }, []);

  // Reset/dismiss the queue
  const dismissQueue = useCallback(() => {
    setQueue({
      isActive: false,
      totalFiles: 0,
      processedFiles: 0,
      currentFileIndex: 0,
      files: [],
      overallProgress: 0,
    });
  }, []);

  return {
    queue,
    startQueue,
    setFileUploading,
    setFileParsing,
    setFileDone,
    setFileError,
    cancelQueue,
    dismissQueue,
  };
}

export type UseImportQueueReturn = ReturnType<typeof useImportQueue>;
