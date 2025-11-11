# Contributing to Lien

Thank you for your interest in contributing to Lien! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/alfhenderson/lien.git
   cd lien
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Test the CLI:
   ```bash
   node packages/cli/dist/index.js --help
   ```

## Project Structure

```
lien/
├── packages/
│   └── cli/                  # Main CLI package
│       ├── src/
│       │   ├── cli/          # CLI commands
│       │   ├── config/       # Configuration
│       │   ├── embeddings/   # Embedding generation
│       │   ├── indexer/      # Indexing logic
│       │   ├── mcp/          # MCP server
│       │   └── vectordb/     # Vector database
│       └── package.json
├── .cursor/                  # Cursor IDE rules
└── package.json              # Workspace root
```

## Development Workflow

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Build and test:
   ```bash
   npm run build
   node packages/cli/dist/index.js init
   node packages/cli/dist/index.js index
   ```

4. Test with Cursor (optional but recommended)

### Code Style

- Follow the existing code style
- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Use meaningful variable and function names
- Keep functions small and focused

### Commit Messages

Follow conventional commits:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Build process or tooling changes

Example: `feat: add incremental indexing support`

## Pull Request Process

1. Update README.md if needed
2. Update CHANGELOG.md (if we have one)
3. Ensure all builds pass
4. Request review from maintainers
5. Address review feedback
6. Squash commits before merging (if requested)

## Testing

### Manual Testing

Test on a real project:

```bash
cd /path/to/test/project
lien init
lien index
lien serve
```

Then test with Cursor.

### Automated Tests

Coming soon - contributions welcome!

## Areas for Contribution

### High Priority

- [ ] Incremental indexing (watch mode)
- [ ] Tree-sitter integration for better chunking
- [ ] Automated tests
- [ ] Performance optimizations
- [ ] Better error messages

### Medium Priority

- [ ] Multi-repo support
- [ ] Web dashboard
- [ ] GitHub integration
- [ ] More language support
- [ ] Custom embedding models

### Documentation

- [ ] Video tutorials
- [ ] More examples
- [ ] Troubleshooting guide
- [ ] Architecture deep-dive

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Reach out on Twitter: [@alfhenderson](https://twitter.com/alfhenderson)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

