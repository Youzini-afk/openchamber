/// <reference lib="webworker" />

type LoadMessage = {
  type: 'load';
  modelId: string;
};

type TranscribeMessage = {
  type: 'transcribe';
  audio: ArrayBuffer;
  language?: string;
};

type WorkerRequest = LoadMessage | TranscribeMessage;

type Transcriber = (
  input: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string }>;

let transcriber: Transcriber | null = null;

const post = (message: Record<string, unknown>): void => {
  self.postMessage(message);
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;

  try {
    if (data.type === 'load') {
      const { pipeline, env } = await import('@xenova/transformers');
      env.backends.onnx.wasm.numThreads = 1;
      env.allowLocalModels = false;

      const fileDoneBytes = new Map<string, number>();
      let totalDone = 0;
      let totalEstimate = 0;

      transcriber = await pipeline('automatic-speech-recognition', data.modelId, {
        progress_callback: (info: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (info.status !== 'progress' || !info.file) return;
          const prevDone = fileDoneBytes.get(info.file) ?? 0;
          const currentDone = info.loaded ?? 0;
          const delta = Math.max(0, currentDone - prevDone);
          fileDoneBytes.set(info.file, currentDone);
          totalDone += delta;
          if (info.total && info.total > totalEstimate) totalEstimate = info.total;
          const effectiveTotal = Math.max(totalEstimate, totalDone);
          const progress = effectiveTotal > 0 ? Math.min(100, Math.round((totalDone / effectiveTotal) * 100)) : 0;
          post({ type: 'progress', progress });
        },
      }) as Transcriber;

      post({ type: 'loaded' });
      return;
    }

    if (data.type === 'transcribe') {
      if (!transcriber) {
        throw new Error('Whisper model is not loaded');
      }

      const result = await transcriber(new Float32Array(data.audio), {
        task: 'transcribe',
        ...(data.language ? { language: data.language } : {}),
      });

      post({ type: 'result', transcript: (result?.text ?? '').trim() });
    }
  } catch (error) {
    post({ type: 'error', error: error instanceof Error ? error.message : 'WASM STT worker failed' });
  }
};

export {};
