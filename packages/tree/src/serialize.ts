import { TreequelError } from "./error.js";
import { type Node, isSpread } from "./nodes.js";
import { FORMAT_VERSION } from "./version.js";

/** The JSON envelope produced by {@link serialize}. */
export interface TreeJson {
  readonly v: number;
  readonly root: unknown;
}

interface SerializeOptions {
  /** Keep `span` fields on every node (default: strip). */
  readonly keepSpans?: boolean;
}

// --- Constant value codec -------------------------------------------------
// JSON-unsafe values (Date, bigint, RegExp, undefined, NaN/Infinity) are
// encoded as tagged wrappers so the tree round-trips through JSON. The codec
// recurses into arrays and plain objects so nested specials survive too.

interface TaggedDate {
  readonly $tag: "date";
  readonly iso: string;
}
interface TaggedBigint {
  readonly $tag: "bigint";
  readonly value: string;
}
interface TaggedRegexp {
  readonly $tag: "regexp";
  readonly source: string;
  readonly flags: string;
}
interface TaggedUndefined {
  readonly $tag: "undefined";
}
interface TaggedNumber {
  readonly $tag: "number";
  readonly value: "NaN" | "Infinity" | "-Infinity";
}
type Tagged = TaggedDate | TaggedBigint | TaggedRegexp | TaggedUndefined | TaggedNumber;

const TAGS = new Set(["date", "bigint", "regexp", "undefined", "number"]);

function encodeValue(v: unknown): unknown {
  if (v === undefined) return { $tag: "undefined" } satisfies TaggedUndefined;
  if (v === null) return null;
  switch (typeof v) {
    case "bigint":
      return { $tag: "bigint", value: v.toString() } satisfies TaggedBigint;
    case "number":
      if (Number.isNaN(v)) return { $tag: "number", value: "NaN" } satisfies TaggedNumber;
      if (v === Infinity) return { $tag: "number", value: "Infinity" } satisfies TaggedNumber;
      if (v === -Infinity) return { $tag: "number", value: "-Infinity" } satisfies TaggedNumber;
      return v;
    case "string":
    case "boolean":
      return v;
    case "object":
      break;
    default:
      // functions / symbols are not serializable
      throw new TreequelError(
        "R1901",
        `Cannot serialize Constant of type ${typeof v}; only JSON-native values, Date, bigint, RegExp and undefined are supported.`,
      );
  }
  if (v instanceof Date) return { $tag: "date", iso: v.toISOString() } satisfies TaggedDate;
  if (v instanceof RegExp) {
    return { $tag: "regexp", source: v.source, flags: v.flags } satisfies TaggedRegexp;
  }
  if (Array.isArray(v)) return v.map(encodeValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = encodeValue(val);
  }
  return out;
}

function isTagged(v: unknown): v is Tagged {
  return (
    typeof v === "object" &&
    v !== null &&
    "$tag" in v &&
    typeof (v as { $tag: unknown }).$tag === "string" &&
    TAGS.has((v as { $tag: string }).$tag)
  );
}

function decodeValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (isTagged(v)) {
    switch (v.$tag) {
      case "undefined":
        return undefined;
      case "date":
        return new Date(v.iso);
      case "bigint":
        return BigInt(v.value);
      case "regexp":
        return new RegExp(v.source, v.flags);
      case "number":
        return v.value === "NaN" ? NaN : v.value === "Infinity" ? Infinity : -Infinity;
    }
  }
  if (Array.isArray(v)) return v.map(decodeValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = decodeValue(val);
  }
  return out;
}

// --- Node (de)serialization ----------------------------------------------

function serializeNode(n: Node, keepSpans: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: n.kind };
  if (keepSpans && n.span) out.span = { start: n.span.start, end: n.span.end };

  switch (n.kind) {
    case "Param":
      out.name = n.name;
      break;
    case "Capture":
      out.name = n.name;
      if (n.global) out.global = true;
      break;
    case "Constant":
      out.value = encodeValue(n.value);
      if (n.type) out.type = n.type;
      break;
    case "Member":
      out.object = serializeNode(n.object, keepSpans);
      out.prop = n.prop;
      if (n.optional) out.optional = true;
      break;
    case "Index":
      out.object = serializeNode(n.object, keepSpans);
      out.index = serializeNode(n.index, keepSpans);
      if (n.optional) out.optional = true;
      break;
    case "Call":
      out.callee = serializeNode(n.callee, keepSpans);
      out.args = n.args.map((a) => serializeNode(a, keepSpans));
      if (n.optional) out.optional = true;
      break;
    case "Binary":
    case "Logical":
      out.op = n.op;
      out.left = serializeNode(n.left, keepSpans);
      out.right = serializeNode(n.right, keepSpans);
      break;
    case "Unary":
      out.op = n.op;
      out.operand = serializeNode(n.operand, keepSpans);
      break;
    case "Ternary":
      out.test = serializeNode(n.test, keepSpans);
      out.then = serializeNode(n.then, keepSpans);
      out.else = serializeNode(n.else, keepSpans);
      break;
    case "Template":
      out.quasis = [...n.quasis];
      out.exprs = n.exprs.map((e) => serializeNode(e, keepSpans));
      break;
    case "ObjectLit":
      out.props = n.props.map((p) =>
        isSpread(p)
          ? { spread: serializeNode(p.spread, keepSpans) }
          : { key: p.key, value: serializeNode(p.value, keepSpans) },
      );
      break;
    case "ArrayLit":
      out.elements = n.elements.map((e) =>
        isSpread(e) ? { spread: serializeNode(e.spread, keepSpans) } : serializeNode(e, keepSpans),
      );
      break;
    case "Lambda":
      out.params = [...n.params];
      out.body = serializeNode(n.body, keepSpans);
      break;
    case "In":
      out.needle = serializeNode(n.needle, keepSpans);
      out.haystack = serializeNode(n.haystack, keepSpans);
      break;
  }
  return out;
}

/** Serialize a tree to a JSON-safe envelope. Spans stripped unless `keepSpans`. */
export function serialize(node: Node, opts: SerializeOptions = {}): TreeJson {
  return { v: FORMAT_VERSION, root: serializeNode(node, opts.keepSpans ?? false) };
}

function fail(msg: string): never {
  throw new TreequelError("R1901", msg);
}

function deserializeNode(raw: unknown, path: string): Node {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) {
    fail(`Malformed tree node at ${path}: expected an object with a "kind".`);
  }
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const span = r.span as { start: number; end: number } | undefined;
  const base = span ? { span } : {};

  const child = (v: unknown, key: string): Node => deserializeNode(v, `${path}.${key}`);
  const childList = (v: unknown, key: string): Node[] => {
    if (!Array.isArray(v)) fail(`Expected array at ${path}.${key}.`);
    return v.map((e, i) => deserializeNode(e, `${path}.${key}[${i}]`));
  };

  switch (kind) {
    case "Param":
      return { ...base, kind, name: String(r.name) };
    case "Capture":
      return { ...base, kind, name: String(r.name), ...(r.global ? { global: true } : {}) };
    case "Constant":
      return {
        ...base,
        kind,
        value: decodeValue(r.value),
        ...(r.type ? { type: r.type as Node & { type: unknown } } : {}),
      } as Node;
    case "Member":
      return {
        ...base,
        kind,
        object: child(r.object, "object"),
        prop: String(r.prop),
        ...(r.optional ? { optional: true } : {}),
      };
    case "Index":
      return {
        ...base,
        kind,
        object: child(r.object, "object"),
        index: child(r.index, "index"),
        ...(r.optional ? { optional: true } : {}),
      };
    case "Call":
      return {
        ...base,
        kind,
        callee: child(r.callee, "callee"),
        args: childList(r.args, "args"),
        ...(r.optional ? { optional: true } : {}),
      };
    case "Binary":
    case "Logical":
      return {
        ...base,
        kind,
        op: r.op,
        left: child(r.left, "left"),
        right: child(r.right, "right"),
      } as Node;
    case "Unary":
      return { ...base, kind, op: r.op, operand: child(r.operand, "operand") } as Node;
    case "Ternary":
      return {
        ...base,
        kind,
        test: child(r.test, "test"),
        then: child(r.then, "then"),
        else: child(r.else, "else"),
      };
    case "Template":
      if (!Array.isArray(r.quasis)) fail(`Expected quasis array at ${path}.`);
      return {
        ...base,
        kind,
        quasis: (r.quasis as unknown[]).map(String),
        exprs: childList(r.exprs, "exprs"),
      };
    case "ObjectLit": {
      if (!Array.isArray(r.props)) fail(`Expected props array at ${path}.`);
      const props = (r.props as unknown[]).map((p, i) => {
        const pr = p as Record<string, unknown>;
        return "spread" in pr
          ? { spread: deserializeNode(pr.spread, `${path}.props[${i}].spread`) }
          : { key: String(pr.key), value: deserializeNode(pr.value, `${path}.props[${i}].value`) };
      });
      return { ...base, kind, props };
    }
    case "ArrayLit": {
      if (!Array.isArray(r.elements)) fail(`Expected elements array at ${path}.`);
      const elements = (r.elements as unknown[]).map((e, i) => {
        if (e && typeof e === "object" && "spread" in e) {
          return {
            spread: deserializeNode(
              (e as { spread: unknown }).spread,
              `${path}.elements[${i}].spread`,
            ),
          };
        }
        return deserializeNode(e, `${path}.elements[${i}]`);
      });
      return { ...base, kind, elements };
    }
    case "Lambda":
      if (!Array.isArray(r.params)) fail(`Expected params array at ${path}.`);
      return {
        ...base,
        kind,
        params: (r.params as unknown[]).map(String),
        body: child(r.body, "body"),
      };
    case "In":
      return {
        ...base,
        kind,
        needle: child(r.needle, "needle"),
        haystack: child(r.haystack, "haystack"),
      };
    default:
      return fail(`Unknown node kind ${JSON.stringify(kind)} at ${path}.`);
  }
}

/** Validate and decode a {@link TreeJson} envelope back into a {@link Node}. */
export function deserialize(json: unknown): Node {
  if (typeof json !== "object" || json === null || !("v" in json) || !("root" in json)) {
    fail("Expected a { v, root } tree envelope.");
  }
  const env = json as { v: unknown; root: unknown };
  if (typeof env.v !== "number" || !Number.isInteger(env.v)) {
    fail(`Missing or non-integer format version.`);
  }
  if (env.v > FORMAT_VERSION) {
    fail(
      `Tree format v${env.v} is newer than this runtime understands (v${FORMAT_VERSION}). Upgrade @treequel/tree.`,
    );
  }
  return deserializeNode(env.root, "root");
}

// Re-exported for provider round-trip tests and fuzzers.
export { encodeValue as __encodeConstant, decodeValue as __decodeConstant };
