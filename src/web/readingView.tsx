import { memo } from "react";

// Only accepts HTML from the existing escaped renderers, never raw artifact content.
export const RenderedHtml = memo(function RenderedHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
