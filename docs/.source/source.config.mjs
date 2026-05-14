// source.config.ts
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
var docs = defineDocs({
  dir: "content/docs"
});
var source_config_default = defineConfig({
  mdxOptions: {
    // Fumadocs already includes a sensible default rehype/remark chain
    // (anchor links, smartypants, shiki code highlighting). Leave it.
  }
});
export {
  source_config_default as default,
  docs
};
