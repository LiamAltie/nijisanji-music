import { defineField, defineType } from "sanity";

export const liver = defineType({
  name: "liver",
  title: "Liver",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "group",
      title: "Group",
      type: "array",
      of: [{ type: "reference", to: [{ type: "group" }] }],
    }),
    defineField({
      name: "color",
      title: "Color",
      type: "string",
      description: "Hex color code (e.g., #00FF00)",
      validation: (Rule) =>
        Rule.regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { name: "hex color" }),
    }),
    defineField({
      name: "twitter",
      title: "Twitter URL",
      type: "url",
      validation: (Rule) =>
        Rule.uri({ scheme: ["http", "https"], allowRelative: false }),
    }),
    defineField({
      name: "youtube",
      title: "YouTube URL",
      type: "url",
      description: "Link to YouTube channel or video",
      validation: (Rule) =>
        Rule.uri({ scheme: ["http", "https"], allowRelative: false }),
    }),
    defineField({
      name: "channelId",
      title: "YouTube Channel ID",
      type: "string",
      description:
        "YouTubeのチャンネルID（例: UCkhViRjLUKgIcVpar9JiNrw）。'UC'で始まる24文字のIDを入力してください。",
      validation: (Rule) =>
        Rule.required()
          .regex(/^UC[a-zA-Z0-9_-]{22}$/, {
            name: "youtube_channel_id",
            invert: false,
          })
          .error(
            "チャンネルIDの形式が正しくありません。'UC'で始まる24文字の英数字、ハイフン、アンダースコアで構成されている必要があります。"
          ),
    }),
    defineField({
      name: "profileImage",
      title: "Profile Image",
      type: "image",
      options: { hotspot: true },
      description: "Liver's profile picture",
    }),
  ],
});
