// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

// Published at https://sotarak.github.io/anchor/ — every internal link includes the /anchor base.
export default defineConfig({
  site: "https://sotarak.github.io",
  base: "/anchor",
  integrations: [
    starlight({
      title: "Anchor",
      description:
        "A self-hosted secrets manager that runs entirely on Cloudflare Workers, D1 and Queues.",
      logo: { src: "./src/assets/anchor.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/sotarak/anchor" }],
      editLink: { baseUrl: "https://github.com/sotarak/anchor/edit/main/apps/docs/" },
      customCss: ["./src/styles/theme.css"],
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Contributing", items: [{ autogenerate: { directory: "contributing" } }] },
      ],
    }),
  ],
});
