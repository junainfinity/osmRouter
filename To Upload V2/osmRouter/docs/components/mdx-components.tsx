import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(extra?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...extra,
  };
}
