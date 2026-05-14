declare module '@xenova/transformers' {
  export const env: {
    allowLocalModels?: boolean;
    backends: {
      onnx: {
        wasm: {
          numThreads?: number;
        };
      };
    };
  };

  export function pipeline(
    task: string,
    model?: string,
    options?: Record<string, unknown>,
  ): Promise<(
    input: unknown,
    options?: Record<string, unknown>,
  ) => Promise<unknown>>;
}
