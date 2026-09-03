// Type declarations for the Emscripten-compiled WASM module.
// The module exports a default factory function.

type EngineModuleFactory = (options?: Record<string, unknown>) => Promise<{
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => unknown;
  cwrap: (ident: string, returnType: string | null, argTypes: string[]) => (...args: unknown[]) => unknown;
}>;

declare module 'wasm/xiangqiblast-engine.js' {
  const factory: EngineModuleFactory;
  export default factory;
}
