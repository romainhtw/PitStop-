import { ImageResponse } from "next/og";
import { brandIconDataUri } from "@/lib/brandIcon";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brandIconDataUri()} width={512} height={512} alt="" />
      </div>
    ),
    { ...size, fonts: [] }
  );
}
