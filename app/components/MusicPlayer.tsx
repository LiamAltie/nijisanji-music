"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import YouTube, { YouTubeProps, YouTubePlayer } from "react-youtube";
import { motion, TargetAndTransition } from "framer-motion";

// Musicインターフェース（変更なし）
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

// YouTube Player State (参考)
enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

export default function MusicPlayer({ musics }: { musics: Music[] }) {
  const [current, setCurrent] = useState<Music | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const nextVideoInfo = useRef<{ music: Music; id: string } | null>(null);

  const getRandomMusic = useCallback((): Music | null => {
    if (musics.length === 0) return null;
    // useCallback の依存配列に musics が含まれる
    return musics[Math.floor(Math.random() * musics.length)];
  }, [musics]); // ★ 依存配列に musics を指定

  useEffect(() => {
    const first = getRandomMusic();
    if (first) setCurrent(first);
  }, [getRandomMusic]);

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
    //host: "https://www.youtube-nocookie.com",
    playerVars: {
      autoplay: 1,
      rel: 0,
      origin:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  };

  const onReady: YouTubeProps["onReady"] = (event) => {
    playerRef.current = event.target; // ★ event.target は YouTubePlayer 型
  };

  // ★ 再生状態が変わった時の処理
  const onStateChange: YouTubeProps["onStateChange"] = (event) => {
    if (event.data === PlayerState.PLAYING && isTransitioning) {
      setIsTransitioning(false);
    }
  };

  const onEnd: YouTubeProps["onEnd"] = () => {
    if (!current || musics.length <= 1) {
      if (current && playerRef.current && musics.length === 1) {
        playerRef.current.seekTo(0);
        playerRef.current.playVideo();
      }
      return;
    }

    let next: Music | null = null;
    let attempts = 0;
    const maxAttempts = Math.min(musics.length * 2, 10);

    do {
      next = getRandomMusic();
      attempts++;
      if (!next) break;
    } while (next._id === current._id && attempts < maxAttempts);

    if (!next || (next._id === current._id && attempts >= maxAttempts)) {
      console.warn("Could not find a different song.");
      // 次の曲が見つからない場合、トランジション状態にせず終了
      return;
    }

    if (playerRef.current) {
      let nextId = "";
      try {
        const nextUrl = new URL(next.youtubeUrl);
        nextId =
          nextUrl.searchParams.get("v") ||
          nextUrl.pathname.split("/").pop() ||
          "";
      } catch (e) {
        console.error("Invalid next YouTube URL:", next.youtubeUrl, e);
        return;
      }

      if (nextId) {
        // ★ 次の動画情報をRefに保存
        nextVideoInfo.current = { music: next, id: nextId };
        // ★ 縮小アニメーションを開始
        setIsTransitioning(true);
        // !!! loadVideoById と setCurrent はここでは実行しない !!!
      } else {
        console.error("Could not extract videoId for:", next.youtubeUrl);
      }
    }
  };
  const handleAnimationComplete = (
    _definition: TargetAndTransition | string | string[]
  ) => {
    // ★ definition を使わないのでアンダースコア始まりにする
    if (isTransitioning && nextVideoInfo.current && playerRef.current) {
      const { music, id } = nextVideoInfo.current;
      playerRef.current.loadVideoById(id);
      setCurrent(music);
      nextVideoInfo.current = null;
    }
  };

  return (
    <div>
      <h1>Now Playing: {current.songName}</h1>
      {/* ★ div を motion.div に変更し、アニメーションプロパティを追加 */}
      <motion.div
        className="w-full aspect-video relative rounded-3xl overflow-hidden"
        // ★ isTransitioning 状態に応じてアニメーションのターゲット値を設定
        animate={{
          scale: isTransitioning ? 0.5 : 1, // 縮小時は50%に、通常時は100%に
          opacity: isTransitioning ? 0 : 1, // 同時にフェードアウト/イン
        }}
        // ★ アニメーションの挙動を設定
        transition={{
          type: "spring", // バネのような物理アニメーション（バウンス）
          stiffness: 250, // バネの硬さ（大きいほど速い） - 要調整
          damping: 20, // バネの抵抗（大きいほど早く収まる） - 要調整
          // scale と opacity で異なる transition を設定することも可能
          scale: { type: "spring", stiffness: 260, damping: 20 },
          opacity: { duration: 0.2 },
        }}
        initial={false}
        onAnimationComplete={handleAnimationComplete}
      >
        <YouTube
          videoId={vid}
          opts={opts}
          onReady={onReady}
          onEnd={onEnd}
          onStateChange={onStateChange}
          className="absolute top-0 left-0 w-full h-full"
        />
      </motion.div>
    </div>
  );
}
