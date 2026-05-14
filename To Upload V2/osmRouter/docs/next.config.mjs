import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // gtag injection lives in app/layout.tsx — no rewrite needed here.
};

export default withMDX(config);
