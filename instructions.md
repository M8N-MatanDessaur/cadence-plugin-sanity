## Sanity.io Plugin -- AI Instructions

Sanity.io as a screen inside Cadence: the dataset's types and documents, each document editable field by field from the schema the repository declares, drafts and publishing with the Studio's own semantics, assets with alt text, insights, a GROQ console, the code side, and one script per action for every CLI. The user should not need to open the Studio.

**All routes are at** `$CADENCE_API/api/plugins/sanity/` (the server that opened your shell; fallback `http://127.0.0.1:3800`). Mutating calls (`POST`, `PATCH`, `DELETE`) need the `x-cadence-token: $CADENCE_TOKEN` header. The scripts attach it for you.

### Which project

Several Sanity projects can be configured. Every route accepts `?project=<name>` or `?repo=<path>`; without either, the stored active project answers. The scripts pass `-Project <name>`, or the repository the shell is on (`CADENCE_ACTIVE_REPO_PATH`), automatically. API tokens never leave the server: `GET /projects` returns `apiTokenSet`, not the token.

### Start with context

```bash
curl -s $CADENCE_API/api/plugins/sanity/health      # types with counts, unpublished, changed, stale, assets, recent, issues, schema standing
curl -s $CADENCE_API/api/plugins/sanity/summary     # the same as plain text
curl -s "$CADENCE_API/api/plugins/sanity/summary/press"   # one type: fields (from code or inferred) and every document previewed
```

### Scripts (prefer these)

From bash: `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/sanity/scripts/<Name>.ps1" -Param value`. From a PowerShell shell, run them directly. Every script prints JSON (arrays always as arrays) or plain text, and takes `-Project <name>` when the shell is not on the project's repository.

| Script | Does | Parameters |
|---|---|---|
| `Get-Health.ps1` | The dataset at a glance | |
| `Get-ProjectSummary.ps1` | Plain-text overview | |
| `Get-DocumentTypes.ps1` | Types with counts and schema standing | |
| `Get-TypeSummary.ps1` | One type: fields and documents, as text | `-Type` |
| `Get-Schema.ps1` | Schema from the repository (one type with `-Type`, documents merged in) | `[-Type] [-Refresh]` |
| `Get-Documents.ps1` | Documents of a type, one row each (status published / changed / draft) | `-Type [-Query] [-Status] [-Limit] [-Offset]` |
| `Search-Documents.ps1` | Documents of any type by title, slug or id | `-Query` |
| `Get-Document.ps1` | One document: both versions, references both ways, preview and Studio URLs | `-Id` |
| `Get-Drafts.ps1` | Unpublished documents and pending changes | `[-Limit]` |
| `Get-Insights.ps1` | Every document with a problem, by kind | `[-Kind changed\|draft\|stale\|missing-title\|missing-slug\|duplicate-slug\|missing-alt\|broken-ref\|missing-required]` |
| `Audit-Content.ps1` | Issues in one type | `-Type` |
| `Get-References.ps1` | Incoming and outgoing references | `-Type -Id` |
| `Get-History.ps1` | Who changed a document and when | `-Id [-Limit]` |
| `Run-Groq.ps1` | A GROQ query | `-Query [-Params '{"name":..}']` |
| `New-Document.ps1` | Create from a JSON file, as a draft (or `-Publish`) | `-Type -JsonFile [-Publish]` |
| `Save-Document.ps1` | Write a whole document as its draft (or `-Publish`) | `-Id -JsonFile [-Publish]` |
| `Update-Document.ps1` | Set fields from a JSON file, `-Unset` fields | `-Type -Id [-JsonFile] [-Unset a,b]` |
| `Publish-Document.ps1` | Draft becomes the published version | `-Type -Id` |
| `Unpublish-Document.ps1` | Published version becomes a draft | `-Type -Id` |
| `Discard-Draft.ps1` | Drop the draft, keep what is published | `-Type -Id` |
| `Copy-Document.ps1` | Duplicate as a new draft | `-Id [-Title]` |
| `Remove-Document.ps1` | Delete draft and published (checks references first) | `-Type -Id [-Force]` |
| `Export-Documents.ps1` | Every document of a type as JSON | `-Type [-OutFile]` |
| `Import-Documents.ps1` | createOrReplace from a JSON array | `-Type -JsonFile [-AsDrafts]` |
| `Update-Documents.ps1` | Bulk patch from `[{id, set, unset}]` | `-Type -JsonFile` |
| `Invoke-Mutations.ps1` | Raw mutations from a JSON array | `-JsonFile [-DryRun]` |
| `Get-Assets.ps1` | Images and files with alt text | `[-Kind] [-Query] [-Limit] [-Offset]` |
| `Get-AssetUsage.ps1` | Documents using an asset | `-Id` |
| `Set-AssetAlt.ps1` | Alt text (title, description) on the asset itself | `-Id -AltText [-Title] [-Description]` |
| `Remove-Asset.ps1` | Delete an unused asset | `-Id` |
| `Get-Projects.ps1` / `Switch-Project.ps1` / `Switch-Environment.ps1` | Configured projects, the active one, the preview environment | `-Name` / `-Env` |
| `Get-Datasets.ps1` / `Test-Connection.ps1` | Datasets of the project; does the token read the dataset | |
| `Get-RepoInfo.ps1` / `Get-Schemas.ps1` / `Get-Components.ps1` / `Get-RepoFile.ps1` | The repository: framework, schema files, components, one file | `-Path` |
| `Test-Preview.ps1` | Is a URL reachable | `-Url` |

### Documents: drafts and publishing, as the Studio does it

A document has up to two versions: `<id>` (published) and `drafts.<id>`. Status is `published` (no draft), `changed` (both exist; the draft is newer) or `draft` (never published).

- Editing writes the draft: `POST /save { id, doc }` writes `drafts.<id>` in full (`publish: true` writes the published version and drops the draft).
- `POST /documents/<type>/<id>/publish` copies the draft over the published version. `/unpublish` moves the published version to a draft. `/discard` drops the draft.
- `POST /documents/<type>?draft=1` creates as a draft (the response carries `id` and `draftId`). `POST /duplicate { id }` copies as a new draft.
- `PATCH /documents/<type>/<id>` with `{ set, unset }` patches the id as given: use `drafts.<id>` to patch the draft.
- `DELETE /documents/<type>/<id>` removes both versions. Sanity refuses while another document references it; read `GET /documents/<type>/<id>/references` first.

```bash
curl -s "$CADENCE_API/api/plugins/sanity/entries?type=press&status=changed"     # one row per document
curl -s "$CADENCE_API/api/plugins/sanity/document?id=press-article-1"           # both versions, refs resolved, incoming, previewUrl, studioUrl
curl -s -X POST $CADENCE_API/api/plugins/sanity/save -H "Content-Type: application/json" -H "x-cadence-token: $CADENCE_TOKEN" -d '{"id":"press-article-1","doc":{"_type":"press","title":"..."}}'
```

### The schema comes from the repository

`GET /schema` reads every `defineType` / document literal in the project's repository (no build needed) and returns document types and object types with their fields: name, title, type, required, options.list, `of`, `to`, nested `fields`. `GET /schema?type=<name>` returns one type with fields the documents hold that the code does not name (`inferred: true`). Arrays whose members are spread in from elsewhere carry `anyObject: true`: any object type fits. Use it before writing a document so the shape matches: `_key` on every array item, `{ _type: 'slug', current }`, `{ _type: 'image', asset: { _type: 'reference', _ref } }`, `{ _type: 'reference', _ref }`, Portable Text as blocks (never HTML).

### Insights

`GET /insights` reads up to 2500 documents and returns `counts` and `entries` with issues: `draft`, `changed`, `stale` (published, 90 days untouched), `missing-title`, `missing-slug`, `duplicate-slug`, `missing-alt` (with `images[]` paths), `broken-ref` (with `brokenRefs[]`), `missing-required:<field>`. Fix through the document routes; alt text lives either next to the image (`alt` field in the document) or on the asset (`PATCH /assets/<id> { altText }`).

### GROQ

`POST /groq { query, params?, meta? }`. With `meta: true` the answer is `{ result, ms, took, count }`. Reads go through the API with the token, so drafts are visible; filter with `_id in path("drafts.**")` or `!(_id in path("drafts.**"))`.

### Other routes

`GET /history?id=` (transactions with author and time), `GET /assets?type=&q=&limit=&offset=`, `GET /assets/<id>/usage`, `PATCH /assets/<id>`, `DELETE /assets/<id>`, `GET /datasets`, `GET /project-info`, `GET /repo/info`, `GET /repo/schemas`, `GET /repo/file/<path>`, `GET /repo/components`, `GET /repo/tree?path=`, `GET /preview-check?url=`, `GET /preview?url=` (the page proxied for an iframe), `GET /projects`, `POST /projects`, `PATCH /projects/<name>` (a blank `apiToken` keeps the stored one), `DELETE /projects/<name>`, `POST /projects/active { name }`, `POST /env { env }`, `POST /documents/<type>/export`, `/import`, `/bulk-update`, `POST /mutate`.

### Rules

- Read the schema and a type summary before creating content; match `_type` values and field names exactly.
- Create as drafts unless told to publish. Never delete without checking references. Never edit or delete on the user's behalf from a read-only task (Ask).
- Content lives in the Content Lake; the repository is for schema and component code only. Schema changes are code changes: open a shell on the repository.
- Large datasets are paged (`limit`, `offset`); `entries` folds drafts into their published row.

### Legacy (2.0 tab)

The 2.0 center tab still works on the same routes. `GET /types`, `GET /documents/<type>`, `GET /documents/<type>/<id>`, `GET /drafts`, `POST /drafts/<id>/publish`, `/discard`, `GET /audit/<type>` are unchanged.
