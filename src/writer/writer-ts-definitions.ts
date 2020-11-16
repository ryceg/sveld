import * as path from "path";
import { ComponentDocApi, ComponentDocs } from "../rollup-plugin";
import Writer from "./Writer";

const ANY_TYPE = "any";
const EMPTY_STR = "";

export function formatTsProps(props?: string) {
  if (props === undefined) return ANY_TYPE;
  return props + "\n";
}

export function getTypeDefs(def: Pick<ComponentDocApi, "typedefs">) {
  if (def.typedefs.length === 0) return EMPTY_STR;
  return def.typedefs.map((typedef) => typedef.ts).join("\n\n");
}

function clampKey(key: string) {
  return /\-/.test(key) ? `["${key}"]` : key;
}

function addCommentLine(value: any, returnValue?: any) {
  if (!value) return undefined;
  return `* ${returnValue || value}\n`;
}

function genPropDef(def: Pick<ComponentDocApi, "props" | "rest_props" | "moduleName">) {
  const props = def.props
    .map((prop) => {
      const prop_comments = [
        addCommentLine(prop.description?.replace(/\n/g, "\n* ")),
        addCommentLine(prop.constant, "@constant"),
        addCommentLine(
          prop.value,
          `@default ${typeof prop.value === "string" ? prop.value.replace(/\s+/g, " ") : prop.value}`
        ),
      ]
        .filter(Boolean)
        .join("");

      let prop_value = prop.constant && !prop.isFunction ? prop.value : prop.type;

      return `
      ${prop_comments.length > 0 ? `/**\n${prop_comments}*/` : EMPTY_STR}
      ${prop.name}?: ${prop_value};`;
    })
    .join("\n");

  const props_name = `${def.moduleName}Props`;

  let prop_def = EMPTY_STR;

  if (def.rest_props?.type === "Element") {
    prop_def = `
    export interface ${props_name} extends svelte.JSX.HTMLAttributes<HTMLElementTagNameMap["${def.rest_props.name}"]> {
      ${props}
    }
  `;
  } else {
    prop_def = `
    export interface ${props_name} {
      ${props}
    }
  `;
  }

  return {
    props_name,
    prop_def,
  };
}

function genSlotDef(def: Pick<ComponentDocApi, "slots">) {
  const slots = def.slots
    .map(({ name, slot_props, ...rest }) => {
      const key = rest.default ? "default" : clampKey(name!);
      return `${key}: ${formatTsProps(slot_props)};`;
    })
    .join("\n");

  return `$$slot_def: {
            ${slots}
          }`;
}

function genEventDef(def: Pick<ComponentDocApi, "events">) {
  const events = def.events
    .map((event) => {
      const handler =
        event.type === "dispatched" ? `CustomEvent<${event.detail || ANY_TYPE}>` : `WindowEventMap["${event.name}"]`;

      return `$on(eventname: "${event.name}", cb: (event: ${handler}) => void): () => void;`;
    })
    .join("\n");

  return `
    ${events}
    $on(eventname: string, cb: (event: Event) => void): () => void;
  `;
}

export function writeTsDefinition(component: ComponentDocApi) {
  const { moduleName, typedefs, props, slots, events, rest_props } = component;
  const { props_name, prop_def } = genPropDef({
    moduleName,
    props,
    rest_props,
  });

  return `
  /// <reference types="svelte" />

  ${getTypeDefs({ typedefs })}
  ${prop_def}

  export default class ${moduleName} {
    $$prop_def: ${props_name}
    ${genSlotDef({ slots })}
    ${genEventDef({ events })}
  }`;
}

function createExport(file_path: string, { moduleName, isDefault }: { moduleName: string; isDefault: boolean }) {
  return `export { default as ${isDefault ? "default" : moduleName} } from "./${file_path}";`;
}

export interface WriteTsDefinitionsOptions {
  outDir: string;
  inputDir: string;
  preamble: string;
  exports: string[];
  default_export: { moduleName: null | string; only: boolean };
  rendered_exports: string[];
}

export default async function writeTsDefinitions(components: ComponentDocs, options: WriteTsDefinitionsOptions) {
  const base_path = path.join(process.cwd(), options.inputDir);
  const ts_folder_path = path.join(process.cwd(), options.outDir);
  const ts_base_path = path.join(ts_folder_path, "index.d.ts");
  const writer = new Writer({ parser: "typescript", printWidth: 120 });

  let indexDTs = options.preamble;

  for await (const [moduleName, component] of components) {
    const ts_filepath = component.filePath.replace(".svelte", ".d.ts");
    const write_ts_filepath = path.join(ts_folder_path, ts_filepath.replace(base_path, ""));
    const write_ts_filename = path.relative(base_path, ts_filepath.replace(".d.ts", ""));

    if (options.default_export.moduleName == null) {
      indexDTs += createExport(write_ts_filename, {
        moduleName,
        isDefault: false,
      });
    } else {
      if (options.default_export.only) {
        indexDTs += createExport(write_ts_filename, {
          moduleName,
          isDefault: true,
        });
      } else {
        indexDTs += createExport(write_ts_filename, {
          moduleName,
          isDefault: false,
        });

        if (options.rendered_exports.includes(moduleName)) {
          indexDTs += createExport(write_ts_filename, {
            moduleName,
            isDefault: true,
          });
        }
      }
    }

    await writer.write(write_ts_filepath, writeTsDefinition(component));
  }

  await writer.write(ts_base_path, indexDTs);

  process.stdout.write(`created TypeScript definitions.\n`);
}
