# create-streamdeck-react

Scaffold a new Stream Deck plugin powered by `@fcannizzaro/streamdeck-react`.

## Usage

```bash
npm create streamdeck-react@latest
```

```bash
pnpm create streamdeck-react
```

```bash
bun create streamdeck-react
```

The interactive CLI walks you through the setup:

- **Project directory** and **plugin name**
- **Plugin UUID** (reverse-domain format) and **author**
- **Description** and **category**
- **Package manager** (`npm`, `pnpm`, `bun`)
- **Starter example** (`minimal`, `counter`, `zustand`, `jotai`, `pokemon`)
- **Supported platforms** (`mac`, `windows`)
- **Native targets** for the selected bundler
- **React Compiler** opt-in (enabled by default)

After scaffolding, the CLI optionally:

- Installs dependencies via your chosen package manager
- Links the plugin to the Stream Deck app using `@elgato/cli`

## Options

```
-y, --yes                  Skip prompts and use defaults
-h, --help                 Show help message
--example <name>           minimal | counter | zustand | jotai | pokemon
--name <display-name>      Plugin display name
--uuid <plugin-uuid>       Reverse-domain plugin UUID
--author <name>            Manifest author
--description <text>       Manifest description
--category <text>          Manifest category
--package-manager <pm>     npm | pnpm | bun
--platforms <list>         Comma-separated: mac,windows
--targets <list>           Comma-separated native targets
--react-compiler <bool>    Enable React Compiler (true | false)
```

## Output

The generated project includes:

- `package.json` with all required dependencies
- `vite.config.ts` (Rolldown) configured for the selected native targets
- Stream Deck manifest (`<uuid>.sdPlugin/manifest.json`)
- Starter source files based on the chosen example
- Auto-generated plugin and action icons
- Inter font via `googleFont("Inter")` for text rendering
