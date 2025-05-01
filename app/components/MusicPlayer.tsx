"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import YouTube, { YouTubeProps, YouTubePlayer } from "react-youtube";
import { motion, TargetAndTransition } from "framer-motion";
import { FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

import BlurredThumbnailBackground from "./BlurredThumbnailBackground";

// --- Interfaces ---
interface Singer {
  _id: string;
  name: string;
  color?: string;
  twitter?: string;
  youtube?: string;
  profileImage?: {
    asset?: {
      url?: string;
    };
  };
}

export interface Music {
  _id: string;
  songName: string;
  originalName: string;
  youtubeUrl: string;
  performance: string;
  category: string;
  singers: Singer[];
}

// --- Constants ---
enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

// --- Utility Function ---
/**
 * Extracts YouTube Video ID from various URL formats.
 * @param urlString - The YouTube URL string.
 * @returns The video ID or an empty string if extraction fails.
 */
const extractVideoId = (urlString: string): string => {
  try {
    const url = new URL(urlString);
    if (url.hostname === "youtu.be") {
      return url.pathname.split("/")[1] || "";
    }
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v") || url.pathname.split("/").pop() || "";
    }
  } catch (e) {
    console.error("Invalid YouTube URL:", urlString, e);
  }
  return "";
};

// --- Sub Components ---

/**
 * Displays song title and original title.
 */
const SongInfo = ({ music }: { music: Music }) => (
  <div className="mt-4 p-4 rounded-lg bg-black/50 backdrop-blur-md shadow-lg">
    <h1 className="text-2xl font-bold text-white">{music.songName}</h1>
    <h2 className="text-sm text-gray-200">{music.originalName}</h2>
  </div>
);

/**
 * Displays a singer's information card with links.
 */
const SingerCard = ({ singer }: { singer: Singer }) => (
  <div
    key={singer._id}
    className="
      relative w-40 p-4 rounded-lg
      border border-gray-200/50
      bg-white/60 dark:bg-gray-800/60
      backdrop-blur-sm shadow-md
      flex flex-col items-center text-center
      overflow-hidden
    "
  >
    {/* Accent border using singer's color */}
    <div
      className="absolute top-0 left-0 right-0 h-1"
      style={{ backgroundColor: singer.color || "transparent" }}
    />

    {/* Profile Image */}
    <div className="mt-3 mb-2.5">
      {singer.profileImage?.asset?.url ? (
        <Image
          src={singer.profileImage.asset.url}
          alt={`${singer.name}'s profile`}
          width={80}
          height={80}
          className="rounded-full"
        />
      ) : (
        <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-gray-600"></div>
      )}
    </div>

    {/* Singer Name */}
    <h4 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
      {singer.name}
    </h4>

    {/* Social Links */}
    {(singer.twitter || singer.youtube) && (
      <div className="flex w-full gap-2 mt-auto">
        {singer.twitter && (
          <a
            href={singer.twitter}
            target="_blank"
            rel="noopener noreferrer"
            title={`Visit ${singer.name}'s X profile`}
            aria-label={`Visit ${singer.name}'s X profile`}
            className="
              flex-1 py-1.5 px-2 rounded
              bg-black hover:bg-gray-800 text-white
              flex items-center justify-center transition
            "
          >
            <FaXTwitter size={16} />
          </a>
        )}
        {singer.youtube && (
          <a
            href={singer.youtube}
            target="_blank"
            rel="noopener noreferrer"
            title={`Visit ${singer.name}'s YouTube channel`}
            aria-label={`Visit ${singer.name}'s YouTube channel`}
            className="
              flex-1 py-1.5 px-2 rounded
              bg-red-600 hover:bg-red-700 text-white
              flex items-center justify-center transition
            "
          >
            <FaYoutube size={16} />
          </a>
        )}
      </div>
    )}
  </div>
);

// --- Main Component ---

export default function MusicPlayer({ musics }: { musics: Music[] }) {
  const [currentMusic, setCurrentMusic] = useState<Music | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const nextVideoInfo = useRef<{ music: Music; id: string } | null>(null);

  const getRandomMusic = useCallback((): Music | null => {
    if (!musics || musics.length === 0) return null;
    return musics[Math.floor(Math.random() * musics.length)];
  }, [musics]);

  useEffect(() => {
    if (!currentMusic) {
      const firstMusic = getRandomMusic();
      if (firstMusic) {
        setCurrentMusic(firstMusic);
      }
    }
  }, [getRandomMusic, currentMusic]);

  const currentVideoId = currentMusic
    ? extractVideoId(currentMusic.youtubeUrl)
    : "";

  const opts: YouTubeProps["opts"] = {
    width: "100%",
    height: "100%",
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

  const onStateChange: YouTubeProps["onStateChange"] = (event) => {
    if (event.data === PlayerState.PLAYING && isTransitioning) {
      setIsTransitioning(false);
    }
  };

  const onEnd: YouTubeProps["onEnd"] = () => {
    if (!currentMusic || !playerRef.current || !musics || musics.length === 0) {
      return;
    }

    if (musics.length === 1) {
      playerRef.current.seekTo(0);
      playerRef.current.playVideo();
      return;
    }

    let nextMusic: Music | null = null;
    let attempts = 0;
    const maxAttempts = Math.min(musics.length * 2, 10);

    do {
      nextMusic = getRandomMusic();
      attempts++;
      if (!nextMusic) break;
    } while (nextMusic?._id === currentMusic._id && attempts < maxAttempts);

    if (!nextMusic || nextMusic._id === currentMusic._id) {
      console.warn("Could not find a different song to play next.");
      return;
    }

    const nextId = extractVideoId(nextMusic.youtubeUrl);

    if (nextId) {
      nextVideoInfo.current = { music: nextMusic, id: nextId };
      setIsTransitioning(true);
    } else {
      console.error(
        "Could not extract videoId for the next song:",
        nextMusic.youtubeUrl
      );
    }
  };

  const handleAnimationComplete = (
    _definition: TargetAndTransition | string | string[]
  ) => {
    if (isTransitioning && nextVideoInfo.current && playerRef.current) {
      const { music, id } = nextVideoInfo.current;
      playerRef.current.loadVideoById(id);
      setCurrentMusic(music);
      nextVideoInfo.current = null;
    }
  };

  // --- Render Logic ---

  if (!currentMusic || !currentVideoId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="p-8 font-sans text-white">Loading Music Player...</div>
      </div>
    );
  }

  return (
    <BlurredThumbnailBackground youtubeUrl={currentMusic.youtubeUrl}>
      <div className="max-w-screen-xl mx-auto p-4">
        {/* Animated Player Container */}
        <motion.div
          className="w-full aspect-video relative rounded-md overflow-hidden shadow-lg"
          animate={{
            scale: isTransitioning ? 0.5 : 1,
            opacity: isTransitioning ? 0 : 1,
          }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 20,
          }}
          initial={false}
          onAnimationComplete={handleAnimationComplete}
        >
          <YouTube
            videoId={currentVideoId}
            opts={opts}
            onReady={onReady}
            onEnd={onEnd}
            onStateChange={onStateChange}
            className="absolute top-0 left-0 w-full h-full"
          />
        </motion.div>

        {/* Song Information */}
        <SongInfo music={currentMusic} />

        {/* Singers Information */}
        {currentMusic.singers && currentMusic.singers.length > 0 ? (
          <div className="flex flex-wrap gap-5 mt-4">
            {" "}
            {/* Adjusted gap/margin */}
            {currentMusic.singers.map((singer) => (
              <SingerCard key={singer._id} singer={singer} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-gray-300">No singer information available.</p>
        )}
      </div>
    </BlurredThumbnailBackground>
  );
}
