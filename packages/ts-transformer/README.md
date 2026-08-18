# @greffon/ts-transformer

The TypeScript-compiler transformer of [Greffon](https://github.com/PhenX/Greffon), expression trees for TypeScript.
For projects that compile with `tsc` (or `tsc -b`) and no bundler, it does during compiler emit what
[`@greffon/vite`](https://github.com/PhenX/Greffon/tree/main/packages/vite) does in a bundler: validate query lambdas
against the expression subset and reify each into `__expr({...})`, keeping the original function as `compiled`.

Detection and capture live in `@greffon/transform`, shared with the Vite plugin, so both paths agree on what is legal.
`typescript` is a peer dependency (`>=5`); the compiler is the host, brought by you.

## Install

```
npm install -D @greffon/ts-transformer ts-patch
```

## Usage

Stock `tsc` runs no custom emit transformers; ts-patch fills that gap. Register the transformer in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "plugins": [{ "transform": "@greffon/ts-transformer" }]
  }
}
```

Then compile with `npx tspc` (or run `ts-patch install` once, then `tsc`). Options go on the same plugin entry.

Driving the compiler API yourself, pass the factory to `program.emit` as a `before` transformer:

```ts
import ts from "typescript";
import { createTransformerFactory } from "@greffon/ts-transformer";

const program = ts.createProgram(fileNames, compilerOptions);
program.emit(undefined, undefined, undefined, false, {
  before: [createTransformerFactory(program, { packages: ["@greffon/query"] })],
});
```

Pass the `program` so cross-file contexts resolve; without it, only `expr()` wrappers and same-module contexts reify.

## Limits

- ES-module output only: set `module` to `esnext` or `nodenext`. CommonJS emit is refused (unbound host import).
- It runs during emit, so `.d.ts` output and type checking are unaffected.
- An emitter that skips the TypeScript program (esbuild, swc, Babel) never runs it. Use the Vite plugin there.
- Source maps are coarser than the Vite plugin's; prefer the bundler plugin when you need exact maps.

## Docs

- [Compiling with tsc](https://phenx.github.io/Greffon/guide/compiling-with-tsc) — setup and the full options table
- [Error reference](https://phenx.github.io/Greffon/errors)

## License

[MIT](https://github.com/PhenX/Greffon/blob/main/LICENSE)
