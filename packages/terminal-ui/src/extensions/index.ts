import type { InlineExtension } from "@earendil-works/pi-core";
import llamaExtension from "./llama/index.ts";

export const builtInExtensions: InlineExtension[] = [{ name: "llama.cpp", factory: llamaExtension, hidden: true }];
