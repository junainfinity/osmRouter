import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";

// `source` is the canonical Fumadocs loader. Pass it `.page(slug)` to render
// MDX, `.pageTree` to get the sidebar tree, `.getLanguages()` for i18n later.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
