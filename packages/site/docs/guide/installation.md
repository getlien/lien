# Installation

## Prerequisites

- **Node.js 22.21.0 or higher** (check with `node --version`)
- At least 200MB free disk space (for ML model)
- 8GB+ RAM recommended for large codebases

## Global Installation (Recommended)

Install Lien globally to use it across all your projects:

```bash
npm install -g @liendev/lien
```

Verify installation:

```bash
lien --version
```

## Using npx (No Installation)

You can run Lien without installing it globally:

```bash
npx @liendev/lien init
npx @liendev/lien index
npx @liendev/lien serve
```

::: tip
Global installation is recommended for better performance and convenience.
:::

## Upgrading

To upgrade to the latest version:

```bash
npm update -g @liendev/lien
```

After upgrading, restart Cursor completely to load the new version.

::: warning
Code changes (new features) require restarting Cursor. The auto-reconnect feature only handles data changes (reindexing).
:::

## Uninstalling

To remove Lien:

```bash
# Remove global package
npm uninstall -g @liendev/lien

# Remove cached indices (optional)
rm -rf ~/.lien
```

## Verifying Installation

Check that Lien is properly installed:

```bash
# Check version
lien --version

# Show help
lien --help

# Check available commands
lien
```

## Next Steps

Now that Lien is installed, proceed to the [Quick Start guide](/guide/getting-started) to initialize your first project.


