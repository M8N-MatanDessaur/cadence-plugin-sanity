# Cadence Plugin: Sanity.io

Sanity.io as a screen inside Cadence 3.0, and a center tab in 2.0. The dataset's types and documents, each document edited field by field from the schema the repository declares (no Studio build needed), drafts and publishing with the Studio's own semantics, assets with alt text, insights, a GROQ console, the code side, AI review and generation, and one PowerShell script per action so every CLI works the same way.

## The 3.0 surface

- **Overview**: documents, unpublished, what to look at, whether the site is up; types, what changed last, what needs attention.
- **Content**: types (content and singletons), a type's documents with draft and published folded into one row (published / changes pending / unpublished), and a document as a form: strings, text, numbers, switches, choices, dates, slugs, images and files (picked from the dataset), references (picked by type), Portable Text as rich text, arrays of objects as cards drawn from their own schema, nested objects, JSON for the rest. Save writes the draft; Publish, Unpublish, Discard, Delete, Duplicate; a preview of the page on the site; AI review, SEO and alt text; references, history.
- **Insights**: unpublished, changed, stale, missing title or slug, duplicate slug, images without alt text, broken references, empty required fields.
- **Assets**: grid, usage, alt text and title on the asset, delete when unused.
- **GROQ**: Monaco console, results as JSON, documents in the result openable, history, useful queries.
- **Studio**: schema files and which types they define, components, the repository's shape, a shell to work on it.
- **Ask**: a question about the content, answered by the AI from read-only routes.
- **Projects**: several projects, each with a dataset, a token (never shown again), a repository the screen follows, a Studio URL and preview environments.

Scripts live in `scripts/` (40 of them; see `instructions.md`). The schema parser (`schema-parser.js`) reads `defineType` files without running them.

## Installation

### From plugin directory
Copy this folder to your Cadence plugins directory, or symlink it:
```bash
mklink /D "%APPDATA%\cadence\plugins\sanity" "C:\path\to\cadence-plugin-sanity"
```

### Configuration
1. Open Cadence > Settings > Plugins
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
