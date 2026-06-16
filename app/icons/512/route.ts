import { ImageResponse } from "next/og";
import { createElement as h } from "react";
import { brandIconDataUri } from "@/lib/brandIcon";

export const dynamic = "force-dynamic";

export function GET() {
  return new ImageResponse(
    h(
      "div",
      { style: { display: "flex", width: "100%", height: "100%" } },
      h("img", { src: brandIconDataUri(), width: 512, height: 512, alt: "" })
    ),
    { width: 512, height: 512, fonts: [] }
  );
}
