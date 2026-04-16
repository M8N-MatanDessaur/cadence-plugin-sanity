# Symphonee Plugin: Sanity.io

Manage Sanity.io datasets, document types, and documents directly from Symphonee.

## Features

- Browse document types and documents in a visual dashboard
- Full CRUD operations on Sanity documents via REST API proxy
- Run arbitrary GROQ queries
- AI-powered content generation, auditing, and bulk operations
- JSON editor with Monaco for direct document editing
- Export/import and bulk update support
- PowerShell helper scripts for quick CLI access

## Installation

### From plugin directory
Copy this folder to your Symphonee plugins directory, or symlink it:
```bash
mklink /D "%APPDATA%\symphonee\plugins\sanity" "C:\path\to\symphonee-plugin-sanity"
```

### Configuration
1. Open Symphonee > Settings > Plugins
2. Enter your Sanity Project ID, Dataset, and API Token
3. Click Test to verify the connection

Get your API token at: https://www.sanity.io/manage > Your Project > API > Tokens

## API Routes

All routes are available at `http://127.0.0.1:3800/api/plugins/sanity/`

See [instructions.md](instructions.md) for full endpoint documentation with curl examples.

## Scripts

| Script | Description |
|--------|-------------|
| `Get-ProjectSummary.ps1` | Full overview of all document types with counts |
| `Get-DocumentTypes.ps1` | List document types in a bar chart format |
| `Get-Documents.ps1 -Type "post"` | List documents of a specific type with field previews |
