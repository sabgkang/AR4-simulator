declare module 'occt-import-js' {
  interface OcctAttribute { array: number[] }
  interface OcctMesh {
    name: string;
    color?: [number, number, number];
    attributes: { position: OcctAttribute; normal?: OcctAttribute };
    index: OcctAttribute;
  }
  interface OcctResult { success: boolean; meshes: OcctMesh[] }
  interface OcctApi {
    ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctResult;
  }
  export default function createOcct(options?: { locateFile?: (path: string) => string }): Promise<OcctApi>;
}
