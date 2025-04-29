import { defineField, defineType } from "sanity";

export const group = defineType({
  name: "group",
  title: "Group",
  type: "document",
  fields: [
    {
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    },
    {
      name: "color",
      title: "Color",
      type: "string",
      description: "Hex color code (e.g., #FF0000)",
      validation: (Rule) =>
        Rule.regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { name: "hex color" }),
    },
  ],
});
