"use client";
import { useState, useEffect, useRef } from "react";
import YouTube, { YouTubeProps } from "react-youtube";

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
  const playerRef = useRef<any>(null);

  const getRandomMusic = (): Music | null => {
    if (musics.length === 0) return null;
    return musics[Math.floor(Math.random() * musics.length)];
  };

  useEffect(() => {
    const first = getRandomMusic();
    if (first) setCurrent(first);
  }, [musics]);

  if (!current) return <div className="p-8 font-sans">Loading...</div>;

  let vid = "";
  try {
    const url = new URL(current.youtubeUrl);
    vid = url.searchParams.get("v") || url.pathname.split("/").pop() || "";
  } catch (e) {
    console.error("Invalid YouTube URL:", current.youtubeUrl, e);
  }

  const opts: YouTubeProps["opts"] = {
    width: "100%",
    height: "100%",
    host: "https://www.youtube-nocookie.com",
    playerVars: {
      autoplay: 1,
      rel: 0,
      origin:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  };

  const onReady: YouTubeProps["onReady"] = (event) => {
    playerRef.current = event.target;
  };

  const onEnd: YouTubeProps["onEnd"] = () => {
    const next = getRandomMusic();
    if (next && playerRef.current) {
      let nextId = "";
      try {
        const nextUrl = new URL(next.youtubeUrl);
        nextId =
          nextUrl.searchParams.get("v") ||
          nextUrl.pathname.split("/").pop() ||
          "";
      } catch (e) {
        console.error("Invalid next YouTube URL:", next.youtubeUrl, e);
        const nextTry = getRandomMusic();
        if (nextTry && nextTry._id !== next._id) {
          setCurrent(nextTry);
        } else {
          console.log("No more valid songs to play.");
        }
        return;
      }

      if (nextId) {
        playerRef.current.loadVideoById(nextId);
        setCurrent(next);
      } else {
        console.error("Could not extract videoId for:", next.youtubeUrl);
      }
    }
  };

  return (
    <div>
      <h1>Now Playing: {current.songName}</h1>
      <div className="w-full aspect-video relative rounded-3xl shadow-lg mb-4 overflow-hidden">
        <YouTube
          videoId={vid}
          opts={opts}
          onReady={onReady}
          onEnd={onEnd}
          className="absolute top-0 left-0 w-full h-full"
          key={vid}
        />
      </div>
    </div>
  );
}
