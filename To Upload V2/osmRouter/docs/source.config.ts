import { defineConfig, defineDocs } from "fumadocs-mdx/config";

// Tells fumadocs-mdx where the MDX content lives.
// `content/docs` is conventional; matching the path keeps `lib/source.ts` boring.
export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    // Fumadocs already includes a sensible default rehype/remark chain
    // (anchor links, smartypants, shiki code highlighting). Leave it.
  },
});
