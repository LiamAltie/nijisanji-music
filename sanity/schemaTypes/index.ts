import { group } from "./group";
import { liver } from "./liver";
import { music } from "./music";
import { type SchemaTypeDefinition } from "sanity";

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [music, liver, group],
};
