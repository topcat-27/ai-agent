// unpdf's published types reference @napi-rs/canvas, an optional peer used only
// for image rendering. The gateway only extracts text, so we never install or
// call it — this stub lets the strict compiler resolve unpdf's types without it.
declare module "@napi-rs/canvas" {
  export type Canvas = unknown;
  export type SKRSContext2D = unknown;
}
