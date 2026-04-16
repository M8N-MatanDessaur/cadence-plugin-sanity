## Sanity.io Plugin -- AI Instructions

You have access to a full-featured Sanity.io CMS management plugin via the Symphonee API. This is a complete content management system -- the user should never need to open Sanity Studio separately. You can create, edit, delete, publish, audit, export, and generate content. You can also read the local codebase to discover schemas, components, and generate new ones.

**All routes are at** `http://127.0.0.1:3800/api/plugins/sanity/`

### IMPORTANT: Start with Context

**Before doing ANY Sanity work, always fetch the project context first:**

```bash
# Full health check -- types, counts, drafts, assets, repo info, studio URL
curl -s http://127.0.0.1:3800/api/plugins/sanity/health
```

This gives you: `projectId`, `dataset`, `previewUrl`, `repoPath`, `studioUrl`, document types with counts, drafts count, asset counts, recent activity, and issues.

**Then use summaries to understand content structure:**

```bash
# Plain-text overview of all document types and counts
curl -s http://127.0.0.1:3800/api/plugins/sanity/summary

# Detailed summary of a specific type (fields + document previews)
curl -s http://127.0.0.1:3800/api/plugins/sanity/summary/DOCUMENT_TYPE
```

### Multi-Project Management

The plugin supports multiple Sanity projects. The active project is used for all operations.

```bash
# List all projects
curl -s http://127.0.0.1:3800/api/plugins/sanity/projects

# Switch active project
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/projects/active \
  -H "Content-Type: application/json" -d '{"name":"My Project"}'

# Add a new project
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"My Project","projectId":"abc123","dataset":"production","apiToken":"sk...","previewUrl":"https://mysite.com","repoPath":"C:/Code/my-site","studioUrl":"https://my-project.sanity.studio"}'
```

### Pre-Made Scripts (USE THESE -- faster, no tokens wasted)

**From bash**, prefix all scripts with:
```bash
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/sanity/scripts/ScriptName.ps1"
# Or with parameters:
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./dashboard/plugins/sanity/scripts/ScriptName.ps1 -Param 'value'"
```

| Script | Description | Parameters |
|--------|-------------|------------|
| `Get-ProjectSummary.ps1` | Full overview of all document types | |
| `Get-Health.ps1` | Content health: types, drafts, assets, issues | |
| `Get-DocumentTypes.ps1` | List document types in table format | |
| `Get-Documents.ps1` | List documents of a type with field previews | `-Type "post" [-Limit 20]` |
| `New-Document.ps1` | Create a new document from JSON file | `-Type "post" -JsonFile ".ai-workspace/doc.json"` |
| `Update-Document.ps1` | Update document fields from JSON file | `-Type "post" -Id "doc-id" -JsonFile ".ai-workspace/patch.json"` |
| `Remove-Document.ps1` | Delete a document | `-Type "post" -Id "doc-id" [-Force]` |
| `Get-Drafts.ps1` | List all unpublished drafts | `[-Limit 50]` |
| `Publish-Draft.ps1` | Publish a draft document | `-Id "drafts.doc-id"` |
| `Get-Assets.ps1` | List image/file assets | `[-Type "image"] [-Limit 50]` |
| `Run-Groq.ps1` | Execute a GROQ query | `-Query '*[_type == "post"]{title}'` |
| `Audit-Content.ps1` | Audit a document type for issues | `-Type "post"` |
| `Export-Documents.ps1` | Export all documents of a type | `-Type "post" [-OutFile "export.json"]` |
| `Get-References.ps1` | Show incoming/outgoing references | `-Type "post" -Id "doc-id"` |
| `Get-Schemas.ps1` | Find Sanity schema files in local repo | |
| `Get-Components.ps1` | Find frontend components in local repo | |
| `Get-RepoInfo.ps1` | Local repo info (framework, studio path) | |
| `Switch-Project.ps1` | Switch the active Sanity project | `-Name "My Project"` |

### Content Operations (CRUD)

```bash
# List documents of a type (paginated)
curl -s "http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE?limit=100&offset=0"

# Get a specific document
curl -s http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/DOCUMENT_ID

# Create a document
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE \
  -H "Content-Type: application/json" \
  -d '{"title":"My Post","slug":{"_type":"slug","current":"my-post"}}'

# Update specific fields (partial patch)
curl -s -X PATCH http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/DOCUMENT_ID \
  -H "Content-Type: application/json" -d '{"title":"Updated Title"}'

# Delete a document
curl -s -X DELETE http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/DOCUMENT_ID
```

### Draft Management

Sanity uses a `drafts.` prefix on document IDs for unpublished content.

```bash
# List all drafts
curl -s http://127.0.0.1:3800/api/plugins/sanity/drafts?limit=50

# Publish a draft (copies to published ID, deletes draft)
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/drafts/DRAFT_ID/publish

# Discard a draft (deletes without publishing)
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/drafts/DRAFT_ID/discard
```

### Document References

```bash
# Get incoming + outgoing references for a document
curl -s http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/DOCUMENT_ID/references
```

Returns: `{ incoming: [{_id, _type, title}], outgoing: [{_ref, _path, title, resolvedType}] }`

### Asset Management

```bash
# List assets (type: all, image, file)
curl -s "http://127.0.0.1:3800/api/plugins/sanity/assets?type=image&limit=50"

# Get documents using a specific asset
curl -s http://127.0.0.1:3800/api/plugins/sanity/assets/ASSET_ID/usage
```

### Content Health & Audit

```bash
# Full project health check
curl -s http://127.0.0.1:3800/api/plugins/sanity/health

# Audit a specific document type (missing fields, stale content, drafts)
curl -s http://127.0.0.1:3800/api/plugins/sanity/audit/DOCUMENT_TYPE
```

### GROQ Queries

```bash
# Simple query
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/groq \
  -H "Content-Type: application/json" \
  -d '{"query":"*[_type == \"post\"] | order(_createdAt desc) [0...10]{title, _id}"}'

# With parameters
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/groq \
  -H "Content-Type: application/json" \
  -d '{"query":"*[_type == $type && title match $q]{title}","params":{"type":"post","q":"hello*"}}'
```

**GROQ tips:**
- `*[_type == "typename"]` -- filter by type
- `| order(field desc)` -- sorting
- `[0...10]` -- pagination
- `{field1, field2}` -- projections
- `->` -- dereference references
- `match` -- text search
- `references($id)` -- find docs referencing another
- `_id in path("drafts.**")` -- find drafts

### Raw Mutations & Bulk Operations

```bash
# Raw mutations
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/mutate \
  -H "Content-Type: application/json" \
  -d '{"mutations":[{"create":{"_type":"post","title":"New"}}],"returnDocuments":true}'

# Export all documents of a type
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/export

# Import documents (createOrReplace)
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/import \
  -H "Content-Type: application/json" -d '{"documents":[...]}'

# Bulk update
curl -s -X POST http://127.0.0.1:3800/api/plugins/sanity/documents/DOCUMENT_TYPE/bulk-update \
  -H "Content-Type: application/json" -d '{"patches":[{"id":"doc1","set":{"featured":true}}]}'
```

### Local Repo Access (Schema & Component Discovery)

When a local repo path is configured, you can read the codebase:

```bash
# Repo info (framework, studio path, etc.)
curl -s http://127.0.0.1:3800/api/plugins/sanity/repo/info

# Find Sanity schema files (searches common locations)
curl -s http://127.0.0.1:3800/api/plugins/sanity/repo/schemas

# Read a specific schema file
curl -s http://127.0.0.1:3800/api/plugins/sanity/repo/schema/schemas/post.ts

# Find frontend components
curl -s http://127.0.0.1:3800/api/plugins/sanity/repo/components

# Read any file from the repo
curl -s http://127.0.0.1:3800/api/plugins/sanity/repo/file/src/components/Hero.tsx

# Browse repo directory structure
curl -s "http://127.0.0.1:3800/api/plugins/sanity/repo/tree?path=src/components"
```

### Key Workflows

**1. Generate a New Page:**
- Fetch schemas: `curl -s .../repo/schemas` to understand the page schema
- Fetch existing pages: `curl -s .../summary/page` to see the structure
- Create the document: `POST .../documents/page` with matching fields
- Use existing component types from the schema for the `components` array

**2. Generate Content for Existing Types:**
- Use summary to discover field structure
- Create realistic content matching the schema
- POST to create each document

**3. Add SEO Fields:**
- Fetch the document, add/update SEO-related fields (title, description, slug, etc.)
- PATCH to update only the SEO fields

**4. Create New Sanity Components:**
- Read existing schemas: `GET .../repo/schemas`
- Read existing component code: `GET .../repo/components`
- Generate new schema file matching patterns (defineType, defineField)
- Generate new frontend component matching the project's patterns
- Write files to the repo using the file system

**5. Content Audit & Cleanup:**
- Run health check: `GET .../health`
- Audit specific types: `GET .../audit/TYPE`
- Fix issues via PATCH or bulk-update

**6. Draft Review & Publishing:**
- List drafts: `GET .../drafts`
- Review content, then publish: `POST .../drafts/ID/publish`
- Or discard: `POST .../drafts/ID/discard`

**7. Reference Integrity:**
- Before deleting: `GET .../documents/TYPE/ID/references` to check what links to it
- If incoming refs exist, warn the user before proceeding

**8. Working Locally:**
- The local repo path gives you direct access to the codebase
- Read schemas to understand data structure
- Read components to understand rendering patterns
- Generate new schemas and components matching existing patterns
- The Studio URL lets users open Sanity Studio for manual edits

**9. Open in Sanity Studio:**
- If studioUrl is configured, deep-link to edit a document:
  `studioUrl + /intent/edit/id=DOCUMENT_ID`

### Sanity-Specific Concepts

**Document IDs:** Regular = auto-generated UUID, Drafts = `drafts.` prefix, Singletons = fixed ID (e.g. `siteSettings`)

**References:** `{"_type": "reference", "_ref": "document-id"}`

**Slugs:** `{"_type": "slug", "current": "my-page-slug"}`

**Images:** `{"_type": "image", "asset": {"_type": "reference", "_ref": "image-asset-id"}}`

**Portable Text:** Array of block objects with `_type: "block"`, `children`, `style`, `markDefs`

**Component Arrays:** Pages often have a `components` array where each item has `_type` (component type), `_key` (unique key), and type-specific fields. Match existing component types when generating new content.

### Opening in the Dashboard

```bash
# Open the Sanity tab
curl -s -X POST http://127.0.0.1:3800/api/ui/view-plugin \
  -H "Content-Type: application/json" -d '{"plugin":"sanity"}'

# Open and navigate to a specific document type
curl -s -X POST http://127.0.0.1:3800/api/ui/view-plugin \
  -H "Content-Type: application/json" \
  -d '{"plugin":"sanity","message":{"type":"openType","docType":"DOCUMENT_TYPE"}}'
```

### Important Notes

- Content lives in the Sanity cloud (Content Lake) -- edits apply whether the frontend is local or deployed
- Use the summary endpoint to discover field structure before creating content
- Match existing component `_type` values exactly when generating page components
- Portable Text is NOT HTML -- it's structured block data. Use the correct block format.
- Always check references before deleting documents
- The local repo path is for reading/writing code files (schemas, components), not for Sanity content
- When generating new schema types or components, follow the patterns found in existing code
- Large datasets are paginated -- use `limit` and `offset` query params
