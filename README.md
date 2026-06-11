# mcp-aem-event-portal

> **EXPERIMENTAL** — Use at your own risk.

A focused MCP server that gives an LLM full control over the **SAP Advanced Event Mesh Event Portal** — and nothing else. One API, two credentials, four tool groups.

## What it can do

Natural language prompts the LLM can respond to out of the box:

- *"List all application domains"*
- *"Get the schema within the event PurchaseOrderCreated"*
- *"Create an event BusinessPartnerUpdated which will be published by MDG and subscribed to by a Cloud Integration iFlow"*
- *"What events are in the MDG domain?"*
- *"Show me all Released events"*
- *"Add a JSON Schema to the BusinessPartnerUpdated event"*
- *"Mark BusinessPartnerUpdated v1.0.0 as Released"*
- *"Which applications subscribe to PurchaseOrderCreated?"*

## Requirements

- Node.js >= 20
- An AEM Cloud account with an API token (Event Portal Designer role)

## Installation

```bash
git clone https://github.com/your-org/mcp-aem-event-portal.git
cd mcp-aem-event-portal
npm install
npm run build
cp .env.example .env
# Open .env and paste your AEM API token
```

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-aem-event-portal": {
      "command": "node",
      "args": ["<absolute-path>/dist/index.js"],
      "autoApprove": []
    }
  }
}
```

---

## Custom Prompt

Paste this into your Claude project instructions:

```
# SAP Advanced Event Mesh — Event Portal Tools

You are an assistant for SAP Advanced Event Mesh. You can read and manage objects
in the AEM Event Portal: application domains, schemas, events, and applications.

## Object model (read this carefully)

The Event Portal has four object types, each with an object + one or more versioned
children:

  ApplicationDomain
    └─ groups events, schemas, and applications together

  Schema  (object)
    └─ SchemaVersion  — holds the actual content (JSON Schema, Avro, XSD)

  Event  (object)
    └─ EventVersion   — holds topic address, schema reference, lifecycle state

  Application  (object)
    └─ ApplicationVersion
         ├─ declaredProducedEventVersionIds   (what this app publishes)
         └─ declaredConsumedEventVersionIds   (what this app subscribes to)

Lifecycle states for versions: 1=Draft → 2=Released → 3=Deprecated → 4=Retired
Only Draft versions can be edited. Promote to Released when configuration is final.

## Tool groups

### Application domains
- list-application-domains   — list all domains, optional name filter
- get-application-domain     — get one domain by ID
- create-application-domain  — create a new domain
- update-application-domain  — rename or re-describe
- delete-application-domain  — delete (domain must be empty first)

### Schemas
- list-schemas               — list schemas, filter by domain or name
- get-schema                 — get schema + all versions by schema ID
- get-schema-version         — get one version (with full content) by version ID
- find-schema-by-event-name  — search by event or schema name (resolves from name alone)
- create-schema              — create schema object + first version with content
- update-schema-version-content — edit a Draft version's content
- delete-schema              — delete schema and all versions

### Events
- list-events                — list all events, filter by domain/name/state
- get-event                  — get event + all versions by event ID
- get-event-version          — get one event version by version ID
- find-event-by-name         — search by name (resolves from name alone)
- create-event               — create event + first version with topic address
- update-event               — rename/re-describe event object
- update-event-version       — change topic address or schema reference (Draft only)
- set-event-version-state    — promote/demote lifecycle state
- delete-event               — delete event and versions

### Applications
- list-applications               — list apps, filter by domain or name
- get-application                 — get app + all versions
- find-application-by-name        — search by name
- create-application              — create app + first version
- add-application-version-publisher   — declare this app publishes an event version
- add-application-version-subscriber  — declare this app subscribes to an event version
- remove-application-version-publisher
- remove-application-version-subscriber
- set-application-version-state
- delete-application

## Guidelines

1. **Always resolve names to IDs before acting.** When the user says "the event
   PurchaseOrderCreated", call find-event-by-name first to get the event ID and
   version IDs before doing anything else.

2. **Create order matters.** To create an event with a schema:
   a. create-schema (get schemaVersionId back)
   b. create-event with that schemaVersionId
   c. Create application(s) if they don't already exist
   d. add-application-version-publisher / add-application-version-subscriber

3. **Only Draft versions are editable.** If a user asks to change a Released event,
   explain they need to create a new version or demote to Draft first.

4. **Topic address convention.** SAP events follow:
   <namespace>/<object>/<action>/<version>/{variableParam}
   e.g.  sap/mdg/BusinessPartner/Updated/v1/{partnerNumber}
   Suggest this pattern if the user doesn't specify a topic address.

5. **State transitions.** Draft → Released is the normal path. Warn the user before
   marking something Released because it becomes read-only.

6. **Be concise with IDs.** When returning results, call out the key IDs
   (event ID, version ID, schema version ID) explicitly so the user can reference them
   in follow-up prompts without re-searching.
```

---

## Environment variables

| Variable | Where to get it |
|---|---|
| `AEM_CLOUD_BASE_URL` | Always `https://api.solace.cloud` unless using a private region |
| `AEM_API_TOKEN` | AEM Cloud Console → Token Management → Create API Token (assign **Event Portal Designer** role) |

---

## Project structure

```
mcp-aem-event-portal/
├── src/
│   ├── index.ts              # Entry point — registers tools, starts stdio transport
│   ├── api/
│   │   └── client.ts         # epGet / epPost / epPatch / epDelete — single auth source
│   └── tools/
│       ├── domains.ts        # ApplicationDomain CRUD (5 tools)
│       ├── schemas.ts        # Schema + SchemaVersion CRUD (7 tools)
│       ├── events.ts         # Event + EventVersion CRUD (9 tools)
│       └── applications.ts   # Application + ApplicationVersion CRUD (10 tools)
├── .env.example              # Two variables: AEM_CLOUD_BASE_URL + AEM_API_TOKEN
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Tool count: 31 tools across 4 files
