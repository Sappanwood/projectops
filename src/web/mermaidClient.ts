import mermaid from "mermaid/dist/mermaid.esm.min.mjs";

type MermaidRenderer = (root: ParentNode) => Promise<void>;

let renderGeneration = 0;

function fallback(source: string, block: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-fallback";
  const notice = document.createElement("p");
  notice.className = "reading-notice";
  notice.setAttribute("role", "status");
  notice.textContent = "Mermaid 图表无法渲染，已保留源码。";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  wrapper.append(notice, pre);
  block.replaceWith(wrapper);
}

function safeSvg(svg: string): SVGElement | null {
  const template = document.createElement("template");
  template.innerHTML = svg;
  const root = template.content.firstElementChild;
  if (!(root instanceof SVGElement)) return null;
  if (root.querySelector("script, foreignObject, image, iframe, object, embed")) return null;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name))
        element.removeAttribute(attribute.name);
      if (attribute.name === "style" && /url\s*\(|@import/i.test(attribute.value)) return null;
    }
  }
  return root;
}

const renderMermaidBlocks: MermaidRenderer = async (root) => {
  const generation = ++renderGeneration;
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-mermaid-source]")];
  if (blocks.length === 0) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "dark",
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
    maxTextSize: 32_000,
    maxEdges: 200,
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "htmlLabels",
      "flowchart",
      "themeCSS",
      "dompurifyConfig",
    ],
    deterministicIds: true,
    deterministicIDSeed: `projectops-${generation}`,
  });
  for (const [index, block] of blocks.entries()) {
    const source = block.textContent ?? "";
    if (/@\{[\s\S]*?["']?img["']?\s*:|<\s*(?:img|image)\b/i.test(source)) {
      fallback(source, block);
      continue;
    }
    try {
      const result = await mermaid.render(`projectops-mermaid-${generation}-${index}`, source);
      if (generation !== renderGeneration || !block.isConnected) return;
      const svg = safeSvg(result.svg);
      if (svg === null) throw new Error("Mermaid output is not safe SVG");
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram";
      const width = Number(svg.getAttribute("viewBox")?.split(/\s+/)[2]);
      if (width > 0) {
        svg.style.width = `${width}px`;
        svg.style.maxWidth = "none";
      }
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "img");
      wrapper.setAttribute("aria-label", "Mermaid diagram");
      wrapper.append(svg);
      block.replaceWith(wrapper);
    } catch {
      if (generation !== renderGeneration || !block.isConnected) return;
      fallback(source, block);
    }
  }
};

declare global {
  var projectOpsRenderMermaid: MermaidRenderer | undefined;
}

globalThis.projectOpsRenderMermaid = renderMermaidBlocks;
if (typeof window !== "undefined") window.dispatchEvent(new Event("projectops-mermaid-ready"));
