# Public Documentation Bilingualization Policy

[中文](../../architecture/bilingual-public-documentation.md)

> Status: active
> Effective date: 2026-09-17
> Scope: Markdown documentation intended for GitHub readers, npm users, and external integration developers.

## Goal

Give Chinese readers and international npm users semantically equivalent, mutually reachable product and integration information without misrepresenting acceptance procedures, temporary plans, or raw evidence as public documentation.

## Public bilingual scope

| Category                            | Chinese entry                                           | English entry                                                 | Maintenance rule                                    |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| Project entry                       | `README.md`                                             | `README.en.md`                                                | Update together in one commit                       |
| npm package documentation           | each package `README.md`                                | sibling `README.en.md`                                        | Link both directions at the top                     |
| Documentation navigation            | `docs/README.md`                                        | `docs/README.en.md`                                           | List public material in the matching language       |
| Product guides                      | `docs/guides/*.md`                                      | `docs/en/guides/*.md`                                         | Mirror paths; existing Chinese paths remain stable  |
| Architecture and external reference | `docs/architecture/overview.md`, `docs/references/*.md` | `docs/en/architecture/overview.md`, `docs/en/references/*.md` | Preserve technical semantics, versions, and sources |
| Current and later release records   | `docs/releases/vX.Y.Z.md`                               | `docs/en/releases/vX.Y.Z.md`                                  | Release status must be semantically identical       |

## Excluded material

- Browser cases, test data, and acceptance procedures in `docs/testing/`.
- Temporary designs, plans, and execution records in `docs/superpowers/`.
- `AGENTS.md`, raw screenshots, service responses, logs, and `.artifacts/`.
- Details intended only for maintainer troubleshooting. A public document may instead provide a short, sanitized conclusion.

## Language and media rules

1. Each public document begins with an explicit relative link to its other-language counterpart.
2. Do not translate commands, package names, configuration keys, error codes, versions, URLs, or provider names. Translation must not change their meaning.
3. npm automatically displays only a package-root `README.md`; both package README variants must explicitly link each other.
4. A UI screenshot in a public document must match that document’s language. Collect raw evidence in `.artifacts/`; put only compressed, long-lived material in `docs/assets/`.
5. Any change to user behavior, public API, default, provider capability, error semantics, or release status updates both language versions in the same commit.

## Acceptance

1. Every public Chinese entry reaches an equivalent English entry, and vice versa.
2. Installation commands, configuration keys, support boundaries, versions, and release states agree across languages.
3. All Markdown local links resolve and `pnpm format:check` passes.
4. Public documentation contains no credentials, user paths, raw service responses, or conclusions that apply only to internal acceptance.
