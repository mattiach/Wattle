# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization & Existing Architecture

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns
- Respect the existing project folder structure and the separation of concerns already established in the codebase.
- Keep files inside the folder that owns their responsibility. Do not move files between folders, create duplicate folders, or introduce a new organizational pattern unless the task explicitly requires it.
- Preserve the existing relationship between:
  - `src/pages/` - page-level components and route-specific UI, one file per route
  - `src/components/` - shared components used by more than one feature, and only those
  - `src/components/ui/` - primitive UI components, including shadcn components
  - `src/components/layout/` - page and application chrome pages compose (app bar, page header, page intro, wordmark)
  - `src/components/widgets/` - autonomous blocks that read their own state and take little or no configuration (`navigation/`, `guidance/`)
  - `src/components/development/` - development-only surfaces, such as the component registry
  - `src/features/` - feature folders; everything specific to one feature lives under its own folder
  - `src/features/ai/` - AI-specific UI and functionality
  - `src/features/calendar/` - the density grids
  - `src/features/editor/` - editor-specific logic, extensions, node definitions, node views, and editor UI
  - `src/features/entries/` - entry-specific UI and utilities
  - `src/features/letters/` - letters-specific UI and functionality
  - `src/features/sparks/` - spark-specific UI
  - `src/hooks/` - shared hooks used by more than one feature or page
  - `src/redux/` - global application state, slices, types, and data
  - `src/languages/` - localization files and i18n infrastructure
  - `src/lib/` - generic application utilities
  - `src/routing/` - routing and navigation (`app/` for the layout and route table, `hooks/` for navigation hooks)
  - `src/styles/` - global styling
  - `src/theme/` - theme and appearance infrastructure
- Reuse existing logic, hooks, components, Redux state, editor extensions, and utilities before creating new equivalents.
- When adding functionality, place it in the existing folder responsible for that concern rather than creating a new top-level folder.
- Do not duplicate existing functionality under a different name or location.
- Before creating a new file, inspect the existing structure and determine whether the functionality belongs in an existing file or folder.

### What belongs in `src/components/`

`src/components/` is for what more than one feature uses. A component that
knows about one kind of writing belongs to that feature, not here - the test is
whether a second feature would ever render it.

- `ui/` - primitives. shadcn-generated files live here and stay unedited by hand
  where possible.
- `layout/` - the chrome a page composes: the app bar, the page header and
  intro, the wordmark.
- `widgets/` - autonomous blocks. They read their own state, take little or no
  configuration, and a caller drops them in without wiring: `navigation/`
  (top nav, floating nav, back to top) and `guidance/` (onboarding, page tour).
- `development/` - surfaces that are gone from a production build.
- The root itself - shared pieces that take props and are composed by pages and
  features: the confirm dialog, the date field, the empty state, the search
  results list. Add a new group only when three or more files share a nature;
  two files do not earn a folder.

### Inside a feature folder

A feature folder splits by the **nature** of what a file contains, not by
topic. Every subfolder is single-purpose, and a file that would mix two natures
gets split.

- `interfaces/` - **types only**: `interface`, `type`, and the `as const` tuples
  a type is derived from. No `invoke` wrappers, no data arrays, no logic. A file
  here that exports a function is the bug this rule exists to prevent.
- `functions/` - functions and the data they operate on: Tauri command wrappers,
  parsers, error-code mappers, static catalogues (`WRITING_NUDGES`,
  `LETTER_PROMPTS`). It imports its types from `../interfaces/`.
- `hooks/` - React hooks, one per file, named `use-*.ts`.
- `extensions/` - Tiptap extensions (editor only). Node definitions and their
  node views stay in `nodes/`; the slash menu stays in `slash-command/`.
- Feature root - the `.tsx` components and context providers. **They keep their
  own local types** (props interfaces and the like) beside them; only types
  shared across files move to `interfaces/`.

Rules that follow from that:

- **Create a subfolder only when it is needed.** A feature with two components
  and no shared logic needs none. Do not scaffold empty `functions/` or
  `hooks/` folders "for later".
- When a module genuinely mixes shapes and behaviour, split it into
  `interfaces/<name>.ts` and `functions/<name>.ts` **keeping the same filename**,
  so the pair is obvious.
- Importers must follow the split: `import type { … }` from `interfaces/`,
  value imports from `functions/`. Never `import type` something you call at
  runtime - it is erased at build time and throws.
- Cross-feature imports use the `@/features/<feature>/…` alias and point at the
  precise file, never at a barrel.

### Invariants a change can break silently

Two rules that no type or lint check enforces. Both are one careless edit away
from a bug nobody sees until a user does.

**The settings slice is the stored settings plus session-only fields.**
`Settings` is the wire shape of Rust's `SettingsDto`, field for field, and
`saveSettingsThunk` posts it whole. The slice's state is the wider
`SettingsState`. Anything added there and not to `Settings` must be stripped in
`saveSettingsThunk` **and** carried through `hydrateSettings`, `clearSettings`
and `resetSettings` - miss the first and it is written to the database as though
it were a preference; miss the second and it is wiped at boot or by a reset.

**Backups are `.wattle`, and `.wattle` is a ZIP.** Only the user-facing name
differs from a plain archive. Do not add extension-based validation to
`restore_backup`: the reader is deliberately extension-agnostic, and the file
dialog has already constrained the choice. Do not reintroduce `.zip` as an
accepted format anywhere: not in a dialog, not in a filename, not in the
exclusion the backup walk uses, and not in a line of UI copy in any of the
sixteen catalogues. There is nothing in the field written under the old name, so
there is no compatibility path to keep.

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

### Framework-Specific Guidance

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`
---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm dlx ultracite fix` before committing to ensure compliance.
