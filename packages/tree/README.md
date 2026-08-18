# @greffon/tree

The wire format of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript: the node types, the
(de)serializer, and the JSON schema. Zero runtime dependencies, and it stays that way.

Every other Greffon package produces or consumes these nodes. Depend on this package alone to store, validate, or
inspect trees without pulling in a runtime, a build plugin, or a provider.

## Install

```
npm install @greffon/tree
```

## Usage

```ts
import { deserialize, serialize, type Node } from "@greffon/tree";

// The tree for `u => u.age >= 18`, written by hand:
const tree: Node = {
  kind: "Binary",
  op: ">=",
  left: { kind: "Member", object: { kind: "Param", name: "u" }, prop: "age" },
  right: { kind: "Constant", value: 18 },
};

const json = serialize(tree); // { v: 1, root: … } — JSON-plain, spans stripped
const back = deserialize(json); // validates shape and version, returns a Node
```

`deserialize` refuses input it does not understand — a malformed node, an unknown kind, a format version newer than
this package — with a `GreffonError` carrying diagnostic code `R1901`.

## API

- `Node` and the 15 node interfaces (`Param`, `Capture`, `Constant`, `Member`, `Call`, `Binary`, …): a small, closed
  grammar. `NODE_KINDS` and `isNode` narrow unknown values.
- `serialize` / `deserialize`: a versioned `{ v, root }` JSON envelope. `Date`, `bigint`, `RegExp`, `undefined`, and
  non-finite numbers round-trip through tagged wrappers.
- `FORMAT_VERSION`: bumped on any breaking format change; the deserializer refuses newer versions.
- `treeJsonSchema`: a JSON Schema for the envelope, so non-TypeScript consumers can validate trees too.
- `GreffonError` / `docsUrl`: the coded error type shared by every Greffon package.

To evaluate, print, rewrite, or build trees with less typing, add
[`@greffon/core`](https://github.com/PhenX/Greffon/tree/main/packages/core).

## Docs

- [The expression tree](https://phenx.github.io/Greffon/guide/the-tree)
- [Tree JSON schema](https://phenx.github.io/Greffon/reference/tree-schema)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
