import { defineField, defineType } from "sanity";

export const music = defineType({
  name: "music",
  title: "Music",
  type: "document",
  fields: [
    defineField({
      name: "songName",
      title: "曲名",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "originalName",
      title: "動画タイトル",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "youtubeUrl",
      title: "YouTube 動画 URL",
      type: "url",
      validation: (Rule) =>
        Rule.uri({ scheme: ["http", "https"], allowRelative: false }),
    }),
    defineField({
      name: "singers",
      title: "歌唱者",
      type: "array",
      of: [{ type: "reference", to: [{ type: "liver" }] }],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "performance",
      title: "形式",
      type: "string",
      options: { list: ["ソロ", "コラボ"] },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "category",
      title: "カテゴリ",
      type: "string",
      options: { list: ["歌ってみた", "オリジナル曲"] },
      validation: (Rule) => Rule.required(),
    }),
  ],
});
