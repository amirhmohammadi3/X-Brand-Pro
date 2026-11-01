/**
 * Ambient types for `file-type` v22 (B1.9).
 *
 * file-type 22 is ESM-only and exposes its types ONLY through the package
 * `exports` map, which TypeScript's `moduleResolution: "Node"` (the api
 * tsconfig chain, tsconfig.node.json) cannot read. The real types live at
 * node_modules/file-type/source/index.d.ts — this shim declares the exact
 * subset the media module uses so `tsc --noEmit` passes without changing the
 * module resolution for the whole app. Remove this file if/when the api
 * tsconfig moves to moduleResolution node16/nodenext/bundler.
 */
declare module 'file-type' {
  export interface FileTypeResult {
    /** The file extension (e.g. `jpg`, `png`, `webp`, `pdf`). */
    ext: string;
    /** The MIME type (e.g. `image/jpeg`, `application/pdf`). */
    mime: string;
  }

  /** Detect the file type from a Buffer/Uint8Array by magic bytes. */
  export function fileTypeFromBuffer(
    buffer: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;
}
