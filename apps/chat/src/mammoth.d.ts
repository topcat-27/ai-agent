// Minimal ambient declaration for the parts of mammoth the gateway uses.
// mammoth ships no bundled types, and we only need raw-text extraction.
declare module "mammoth" {
  interface ExtractRawTextInput {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }

  export function extractRawText(
    input: ExtractRawTextInput,
  ): Promise<ExtractRawTextResult>;

  const mammoth: {
    extractRawText: typeof extractRawText;
  };

  export default mammoth;
}
