import React from "react";

interface Props {
  youtubeUrl: string;
  children: React.ReactNode;
}

const BlurredThumbnailBackground: React.FC<Props> = ({
  youtubeUrl,
  children,
}) => {
  let videoId = "";
  try {
    const urlParams = new URLSearchParams(new URL(youtubeUrl).search);
    videoId = urlParams.get("v") || "";
    if (!videoId && youtubeUrl.includes("v=")) {
      const parts = youtubeUrl.split("v=")[1];
      const ampersandPosition = parts.indexOf("&");
      if (ampersandPosition !== -1) {
        videoId = parts.substring(0, ampersandPosition);
      } else {
        videoId = parts;
      }
    }
  } catch (error) {
    console.error("Error parsing YouTube URL for background:", error);
  }

  const thumbnailUrl = videoId
    ? `http://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    : "";

  return (
    <>
      {thumbnailUrl && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            backgroundImage: `url(${thumbnailUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(15px)",
            transform: "scale(1.15)",
            zIndex: -10,
            transition: "background-image 0.5s ease-in-out",
          }}
        />
      )}

      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </>
  );
};

export default BlurredThumbnailBackground;
