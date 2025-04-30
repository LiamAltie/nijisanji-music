import { createClient } from "next-sanity";
import dynamic from "next/dynamic";

// ISR のリバリデート間隔（秒）
export const revalidate = 60;

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "",
  apiVersion: "2024-01-01",
  useCdn: true,
});

const musicQuery = `*[_type == "music"]{
  _id,
  songName,
  originalName,
  youtubeUrl,
  performance,
  category,
  singers[]->{
    _id,
    name,
    color,
    twitter,
    youtube,
    profileImage {
      asset-> {
        url
      }
    }
  }
}`;

const MusicPlayer = dynamic(() => import("./components/MusicPlayer"), {
  ssr: false,
});

export default async function Page() {
  const musics = await client.fetch(musicQuery);
  return (
    <div className="">
      <MusicPlayer musics={musics} />
    </div>
  );
}
