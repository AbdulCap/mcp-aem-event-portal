import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerSchemaTools(server: McpServer): void {

  server.tool(
    'list-schemas',
    'List all schemas in the Event Portal, optionally filtered by application domain.',
    {
      applicationDomainId: z.string().optional().describe('Filter by domain ID'),
      name: z.string().optional().describe('Filter by schema name (partial match)'),
    },
    async ({ applicationDomainId, name }) => {
      let path = '/api/v2/architecture/schemas?pageSize=100';
      if (applicationDomainId) path += `&applicationDomainId=${applicationDomainId}`;
      if (name) path += `&name=${encodeURIComponent(name)}`;
      const data = await epGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'get-schema',
    'Get a schema object by ID. Returns the schema name, type, and all its versions.',
    {
      schemaId: z.string().describe('Schema object ID'),
    },
    async ({ schemaId }) => {
      const [schema, versions] = await Promise.all([
        epGet(`/api/v2/architecture/schemas/${schemaId}`),
        epGet(`/api/v2/architecture/schemas/${schemaId}/versions?pageSize=100`),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ schema, versions }, null, 2) }],
      };
    },
  );

  server.tool(
    'get-schema-version',
    'Get a specific schema version by its version ID. Returns the full schema content (JSON Schema, Avro, XSD, etc.).',
    {
      versionId: z.string().describe('Schema version ID'),
    },
    async ({ versionId }) => {
      const data = await epGet(`/api/v2/architecture/schemaVersions/${versionId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'find-schema-by-event-name',
    `Find schemas linked to an event by searching for a schema whose name matches or is related to the event name.
    Useful for prompts like "get the schema within the event PurchaseOrderCreated" when you don't have IDs.
    Returns matching schemas and their latest version content.`,
    {
      eventName: z.string().describe('Event or schema name to search for, e.g. "PurchaseOrderCreated"'),
      applicationDomainId: z.string().optional().describe('Narrow search to a specific domain'),
    },
    async ({ eventName, applicationDomainId }) => {
      // Search schemas by name
      let schemaPath = `/api/v2/architecture/schemas?pageSize=100&name=${encodeURIComponent(eventName)}`;
      if (applicationDomainId) schemaPath += `&applicationDomainId=${applicationDomainId}`;
      const schemasResp = await epGet(schemaPath) as any;
      const schemas: any[] = schemasResp?.data ?? [];

      if (schemas.length === 0) {
        // Also search for events with this name so we can find their referenced schema
        let evtPath = `/api/v2/architecture/events?pageSize=100&name=${encodeURIComponent(eventName)}`;
        if (applicationDomainId) evtPath += `&applicationDomainId=${applicationDomainId}`;
        const eventsResp = await epGet(evtPath) as any;
        const events: any[] = eventsResp?.data ?? [];

        if (events.length === 0) {
          return {
            content: [{ type: 'text', text: `No schemas or events found matching "${eventName}".` }],
          };
        }

        // For each event, look up versions and their schema version IDs
        const results = await Promise.all(
          events.map(async (evt: any) => {
            const versionsResp = await epGet(
              `/api/v2/architecture/events/${evt.id}/versions?pageSize=100`,
            ) as any;
            const versions: any[] = versionsResp?.data ?? [];
            const enriched = await Promise.all(
              versions.map(async (v: any) => {
                let schemaContent: unknown = null;
                if (v.schemaVersionId) {
                  schemaContent = await epGet(`/api/v2/architecture/schemaVersions/${v.schemaVersionId}`);
                }
                return { ...v, schemaContent };
              }),
            );
            return { event: evt, versions: enriched };
          }),
        );
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      // Fetch latest version content for each matching schema
      const enriched = await Promise.all(
        schemas.map(async (s: any) => {
          const versionsResp = await epGet(
            `/api/v2/architecture/schemas/${s.id}/versions?pageSize=100`,
          ) as any;
          const versions: any[] = versionsResp?.data ?? [];
          return { schema: s, versions };
        }),
      );
      return { content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }] };
    },
  );

  server.tool(
    'create-schema',
    'Create a new schema object in the Event Portal, then create its first version with the provided content.',
    {
      applicationDomainId: z.string().describe('Domain to create the schema in'),
      name: z.string().describe('Schema name, e.g. "BusinessPartnerUpdatedPayload"'),
      schemaType: z.enum(['jsonSchema', 'avro', 'xsd', 'protobuf']).default('jsonSchema'),
      content: z.string().describe('The schema content as a string (JSON Schema, Avro IDL, XSD, etc.)'),
      description: z.string().optional(),
      version: z.string().default('1.0.0').describe('Version label for the first version'),
    },
    async ({ applicationDomainId, name, schemaType, content, description, version }) => {
      // 1. Create the schema object
      const schemaObj = await epPost('/api/v2/architecture/schemas', {
        applicationDomainId,
        name,
        schemaType,
        shared: false,
      }) as any;

      const schemaId = schemaObj?.data?.id;

      // 2. Create version 1 with content
      const schemaVersion = await epPost('/api/v2/architecture/schemaVersions', {
        schemaId,
        description: description ?? '',
        version,
        content,
        stateId: '1', // Draft
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ schema: schemaObj, version: schemaVersion }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update-schema-version-content',
    'Update the content of a schema version (while it is still in Draft state).',
    {
      versionId: z.string().describe('Schema version ID to update'),
      content: z.string().describe('New schema content'),
      description: z.string().optional(),
    },
    async ({ versionId, content, description }) => {
      const body: Record<string, unknown> = { content };
      if (description) body.description = description;
      const data = await epPatch(`/api/v2/architecture/schemaVersions/${versionId}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'delete-schema',
    'Delete a schema object and all its versions from the Event Portal.',
    {
      schemaId: z.string().describe('The schema object ID to delete'),
    },
    async ({ schemaId }) => {
      await epDelete(`/api/v2/architecture/schemas/${schemaId}`);
      return { content: [{ type: 'text', text: `Schema ${schemaId} deleted.` }] };
    },
  );
}
