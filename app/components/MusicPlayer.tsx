"use client";
import { useState, useEffect } from "react";
import YouTube from "react-youtube";

export interface Music {
  _id: string;
  songName: string;
  youtubeUrl: string;
  performance: string;
  category: string;
  singers: Array<{
    _id: string;
    name: string;
    profileImage?: { asset: { url: string } };
  }>;
}

export default function MusicPlayer({ musics }: { musics: Music[] }) {
  const [current, setCurrent] = useState<Music | null>(null);

  const pickRandom = () => {
    if (musics.length === 0) return;
    const next = musics[Math.floor(Math.random() * musics.length)];
    setCurrent(next);
  };

  useEffect(() => {
    pickRandom();
  }, []);

  const handleEnd = () => {
    pickRandom();
  };

  if (!current) return <div>Loading...</div>;

  // YouTube URL から videoId を抽出
  const url = new URL(current.youtubeUrl);
  const vid = url.searchParams.get("v") || url.pathname.split("/").pop() || "";

  return (
    <div>
      <h1>Now Playing: {current.songName}</h1>
      <div className="w-full aspect-video relative rounded-3xl shadow-lg mb-4 overflow-hidden">
        <YouTube
          videoId={vid}
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { autoplay: 1 },
          }}
          onEnd={handleEnd}
          className="absolute top-0 left-0 w-full h-full"
        />
      </div>
    </div>
  );
}
