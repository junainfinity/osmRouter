import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// ⌘K search endpoint. Fumadocs builds an in-memory index from the MDX tree;
// it's tiny because the corpus is small. Swap to Algolia/Orama-Cloud later
// if the corpus grows.
export const { GET } = createFromSource(source);
