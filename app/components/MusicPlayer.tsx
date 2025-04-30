"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import YouTube, { YouTubeProps, YouTubePlayer } from "react-youtube";
import { motion, TargetAndTransition } from "framer-motion";
import BlurredThumbnailBackground from "./BlurredThumbnailBackground";
import { FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

// Musicインターフェース（変更なし）
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
    <BlurredThumbnailBackground youtubeUrl={current.youtubeUrl}>
      <div className="max-w-screen-xl mx-auto p-4">
        <motion.div
          className="w-full aspect-video relative rounded-md overflow-hidden shadow-lg"
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
        <div className="mt-4">
          <div className="mt-4 p-4 rounded-lg bg-black/50 backdrop-blur-md shadow-lg">
            {/* ↑↑↑ ここにクラスを追加 ↑↑↑ */}
            {/* 例: */}
            {/* p-4: 内側の余白 */}
            {/* rounded-lg: 角丸 */}
            {/* bg-black/50: 半透明の黒背景 (50%の不透明度)。 /30 や /70 などで調整可能 */}
            {/* backdrop-blur-md: 背景へのぼかし効果 (sm, lg などで強度調整可能) */}
            {/* shadow-lg: 任意で影を追加 */}
            {/* ★ 背景色に合わせて文字色も調整 ★ */}
            <h1 className="text-2xl font-bold text-white">
              {current.songName}
            </h1>{" "}
            {/* 暗い背景なので白文字に */}
            <h2 className="text-sm text-gray-200">
              {current.originalName}
            </h2>{" "}
            {/* 少し薄い白系 */}
          </div>
          {current.singers && current.singers.length > 0 ? (
            <div
              className="flex flex-wrap gap-5 mt-2.5" // 親コンテナ (Tailwind使用例)
              // style={{ display: "flex", flexWrap: "wrap", gap: "20px", marginTop: "10px" }}
            >
              {current.singers.map((singer) => (
                <div
                  key={singer._id}
                  // ★ カード全体のスタイルをTailwindクラスで指定
                  className="
                relative // 子の絶対配置のため
                w-40 p-4 rounded-lg
                border border-gray-200/50  // 枠線も少し透明に (任意)
                bg-white/60               // ★ 白背景 (60%不透明度) - 背景のサムネイルが透ける
                dark:bg-gray-800/60       // ★ ダークモード用の背景 (任意)
                backdrop-blur-sm          // ★ 背景へのぼかし効果 (sm, md, lg)
                shadow-md                   // 影 (任意)
                flex flex-col items-center text-center // カード内レイアウト
                overflow-hidden           // 上部ボーダー用
              "
                  // --- インラインスタイルで書く場合の主要部分 ---
                  // style={{
                  //   position: 'relative',
                  //   width: '160px',
                  //   padding: '16px',
                  //   borderRadius: '8px',
                  //   border: '1px solid rgba(226, 232, 240, 0.5)', // gray-200/50
                  //   backgroundColor: 'rgba(255, 255, 255, 0.6)', // white/60
                  //   backdropFilter: 'blur(4px)', // blur-sm (値は調整)
                  //   boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', // shadow-md
                  //   display: 'flex',
                  //   flexDirection: 'column',
                  //   alignItems: 'center',
                  //   textAlign: 'center',
                  //   overflow: 'hidden',
                  // }}
                >
                  {/* ★ singer.color を使った上部アクセントボーダー */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1" // position absoluteで上部に配置
                    style={{ backgroundColor: singer.color || "transparent" }} // 動的に色を設定
                  ></div>

                  {/* 1行目: 画像 (上部ボーダー分のマージン調整) */}
                  <div className="mt-3 mb-2.5">
                    {" "}
                    {/* Tailwind使用例 */}
                    {/* <div style={{ marginTop: '12px', marginBottom: '10px' }}> */}
                    {singer.profileImage?.asset?.url ? (
                      <Image
                        src={singer.profileImage.asset.url}
                        alt={`${singer.name}'s profile`}
                        width={80}
                        height={80}
                        className="rounded-full" // Tailwind使用例
                        // style={{ borderRadius: "50%" }}
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-gray-600"></div> // Tailwind使用例
                      // <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: '#cbd5e1' }}></div>
                    )}
                  </div>

                  {/* 2行目: 名前 */}
                  {/* ★ 背景が白系なので暗い文字色を指定 */}
                  <h4 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                    {" "}
                    {/* Tailwind使用例 */}
                    {/* <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", fontWeight: "600", color: '#1f2937' }}> */}
                    {singer.name}
                  </h4>

                  {/* ボタンコンテナ */}
                  {(singer.twitter || singer.youtube) && (
                    <div className="flex w-full gap-2 mt-auto">
                      {/* Twitter/Xボタン */}
                      {singer.twitter && (
                        <a
                          href={singer.twitter}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Visit ${singer.name}'s X profile`} // アクセシビリティ用
                          aria-label={`Visit ${singer.name}'s X profile`} // アクセシビリティ用
                          // ★ 背景色を黒に、ホバー色を濃いグレーに、アイコンを中央揃えに
                          className="
                      flex-1 py-1.5 px-2 rounded
                      bg-black hover:bg-gray-800 // ★ 色変更
                      text-white // アイコンの色
                      flex items-center justify-center // ★ アイコン中央揃え
                      transition
                    "
                        >
                          {/* ★ テキストの代わりにアイコンを表示 */}
                          <FaXTwitter size={16} /> {/* アイコンサイズ調整 */}
                        </a>
                      )}
                      {/* YouTubeボタン */}
                      {singer.youtube && (
                        <a
                          href={singer.youtube}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Visit ${singer.name}'s YouTube channel`} // アクセシビリティ用
                          aria-label={`Visit ${singer.name}'s YouTube channel`} // アクセシビリティ用
                          // ★ アイコンを中央揃えにするクラスを追加
                          className="
                       flex-1 py-1.5 px-2 rounded
                       bg-red-600 hover:bg-red-700
                       text-white
                       flex items-center justify-center // ★ アイコン中央揃え
                       transition
                     "
                        >
                          {/* ★ テキストの代わりにアイコンを表示 */}
                          <FaYoutube size={16} /> {/* アイコンサイズ調整 */}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">歌唱者情報がありません</p> // Tailwind使用例
            // <p>歌唱者情報がありません</p>
          )}
        </div>
      </div>
    </BlurredThumbnailBackground>
  );
}
