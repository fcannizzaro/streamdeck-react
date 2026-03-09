# Contributing

Thanks for your interest in contributing to **streamdeck-react**!

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Node.js](https://nodejs.org) v24+ (for Stream Deck CLI tooling)

## Setup

```bash
# Clone the repo
git clone https://github.com/fcannizzaro/streamdeck-react.git
cd streamdeck-react

# Install dependencies
bun install
```

## Development

The project is a monorepo managed with **Turborepo**. Main packages live under `packages/`, sample plugins under `samples/`, and the documentation site under `docs/`.

```bash
# Build all packages
bun run build

# Build only library packages (excludes samples/docs)
bun run build --filter='./packages/*'

# Type-check a specific package
bun run check-types --filter=@fcannizzaro/streamdeck-react
```

## Testing

Tests use Bun's built-in test runner:

```bash
# Run all package tests
bun run test

# Run tests for a specific package
bun test ./src  # from within a package directory
```

## Formatting

The project uses [oxfmt](https://oxc.rs) for formatting:

```bash
bun run format
```

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org):

| Prefix       | Usage                          |
| ------------ | ------------------------------ |
| `feat:`      | New feature                    |
| `fix:`       | Bug fix                        |
| `refactor:`  | Code change (no feature/fix)   |
| `docs:`      | Documentation only             |
| `chore:`     | Tooling, deps, CI              |

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs. When your PR includes user-facing changes, add a changeset:

```bash
bunx changeset
```

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Run `bun run format`, `bun run build`, and `bun run test`.
4. Add a changeset if your change affects published packages.
5. Open a pull request against `main`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
