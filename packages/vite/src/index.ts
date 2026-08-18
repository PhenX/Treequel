/**
 * `@greffon/vite` — a thin Vite plugin over `@greffon/transform`. It uses only
 * Rollup-compatible hooks (`enforce: "pre"` + `transform`, with `this.resolve` /
 * `this.load` for the cross-module context manifest), so the same export runs
 * unchanged in Vite, Rollup and Rolldown.
 */
import {
  type ContextRegistry,
  type TransformHost,
  createRegistry,
  transformModule,
} from "@greffon/transform";

export type FilterPattern = RegExp | RegExp[];

export interface GreffonPluginOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
  /** Traced import sources. Default: `["@greffon/query"]`. */
  packages?: string[];
  /** How to surface subset diagnostics. Default: `error` in build, `warn` in dev. */
  diagnostics?: "error" | "warn";
  /** Emit original source text. Default: `"dev"` (on in serve, off in build). */
  emitSource?: boolean | "dev";
  /** Extra globals safelist. */
  globals?: string[];
}

/** Minimal structural typing so we don't hard-depend on Vite/Rollup types. */
interface PluginContext {
  resolve(source: string, importer?: string): Promise<{ id: string } | null>;
  load(opts: { id: string }): Promise<unknown>;
  warn(msg: string): void;
  error(msg: string): never;
}
interface TransformOutput {
  code: string;
  map: unknown;
}
export interface VitePlugin {
  name: string;
  enforce: "pre";
  configResolved?(config: { command: string }): void;
  transform?(
    this: PluginContext,
    code: string,
    id: string,
  ): Promise<TransformOutput | null> | TransformOutput | null;
}

const DEFAULT_INCLUDE = /\.[cm]?[jt]sx?$/;
const DEFAULT_EXCLUDE = /node_modules/;

function matches(patterns: FilterPattern, id: string): boolean {
  return Array.isArray(patterns) ? patterns.some((p) => p.test(id)) : patterns.test(id);
}

/** Create the Greffon build plugin. */
export function greffon(options: GreffonPluginOptions = {}): VitePlugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const registry: ContextRegistry = createRegistry();
  let command = "build";

  return {
    name: "greffon",
    enforce: "pre",
    configResolved(config): void {
      command = config.command;
    },
    async transform(code, id): Promise<TransformOutput | null> {
      const clean = id.replace(/\?.*$/, "");
      if (matches(exclude, clean) || !matches(include, clean)) return null;

      const emitSource =
        typeof options.emitSource === "boolean" ? options.emitSource : command !== "build";
      const mode = options.diagnostics ?? (command === "build" ? "error" : "warn");

      const host: TransformHost = {
        resolve: async (source, importer) => (await this.resolve(source, importer))?.id ?? null,
        load: async (resolvedId) => {
          await this.load({ id: resolvedId });
        },
      };

      const result = await transformModule(
        code,
        id,
        {
          ...(options.packages ? { packages: options.packages } : {}),
          ...(options.globals ? { globals: options.globals } : {}),
          emitSource,
          registry,
        },
        host,
      );
      if (!result) return null;

      for (const d of result.diagnostics) {
        const line = `${d.code} ${d.message}${d.hint ? ` — ${d.hint}` : ""} (${id})`;
        if (d.severity === "error" && mode === "error") this.error(line);
        else this.warn(line);
      }

      if (result.count === 0) return null;
      return { code: result.code, map: result.map };
    },
  };
}

export default greffon;
