import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "S-Invoice 2.0 Demo – Tích hợp Hóa đơn điện tử Viettel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  // Font mặc định của ImageResponse thiếu dấu tiếng Việt → dùng font có sẵn trong repo
  const font = await readFile(path.join(process.cwd(), "assets/fonts/LiberationSerif-Bold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
          color: "white",
          fontFamily: "Liberation Serif",
        }}
      >
        <div style={{ fontSize: 36, color: "#93c5fd" }}>Integration Demo</div>
        <div style={{ fontSize: 96, marginTop: 12 }}>S-Invoice 2.0</div>
        <div style={{ fontSize: 44, marginTop: 24, color: "#e2e8f0" }}>
          Tích hợp Hóa đơn điện tử Viettel
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Liberation Serif", data: font, weight: 700 }] },
  );
}
