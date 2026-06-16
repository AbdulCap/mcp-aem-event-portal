import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

const STATE_LABELS: Record<string, string> = {
  '1': 'Draft', '2': 'Released', '3': 'Deprecated', '4': 'Retired',
};

export function registerEnumerationTools(server: McpServer): void {

  // ── Enumeration objects ───────────────────────────────────────────────────

  server.registerTool('list-enumerations', {
    description: `List all enumerations in the Event Portal. Enumerations define a fixed set of named
string values that can be reused across schemas and topic address variable segments.
Example: a "BusinessPartnerType" enumeration with values ["Customer", "Supplier", "Employee"].`,
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by application domain ID'),
      name: z.string().optional().describe('Filter by enumeration name (partial match)'),
      shared: z.boolean().optional().describe('Filter by shared flag — true returns enumerations shared across domains'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/enums?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    if (args.shared !== undefined) path += `&shared=${args.shared}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-enumeration', {
    description: 'Get a single enumeration by ID, including all its versions and their defined values.',
    inputSchema: {
      enumId: z.string().describe('Enumeration object ID'),
    },
  }, async (args) => {
    const [enumObj, versions] = await Promise.all([
      epGet(`/api/v2/architecture/enums/${args.enumId}`),
      epGet(`/api/v2/architecture/enums/${args.enumId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ enumeration: enumObj, versions }, null, 2) }] };
  });

  server.registerTool('find-enumeration-by-name', {
    description: 'Find an enumeration by name. Returns the enumeration object and all its versions with their values and state labels.',
    inputSchema: {
      name: z.string().describe('Enumeration name to search for, e.g. "BusinessPartnerType"'),
      applicationDomainId: z.string().optional().describe('Narrow to a specific domain'),
    },
  }, async (args) => {
    let path = `/api/v2/architecture/enums?pageSize=100&name=${encodeURIComponent(args.name)}`;
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    const resp = await epGet(path) as any;
    const enums: any[] = resp?.data ?? [];
    if (enums.length === 0) {
      return { content: [{ type: 'text' as const, text: `No enumerations found matching "${args.name}".` }] };
    }
    const enriched = await Promise.all(
      enums.map(async (e: any) => {
        const v = await epGet(`/api/v2/architecture/enums/${e.id}/versions?pageSize=100`) as any;
        const versions = (v?.data ?? []).map((ver: any) => ({
          ...ver,
          _stateLabel: STATE_LABELS[ver.stateId] ?? ver.stateId,
        }));
        return { ...e, versions };
      }),
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }] };
  });

  server.registerTool('create-enumeration', {
    description: `Create a new enumeration in the Event Portal with its first version and initial set of values.
Enumerations are reusable named value sets — define them once and reference them inside
JSON Schemas or as constraints on topic address variable segments.

Example values for a "BusinessPartnerType" enum: ["Customer", "Supplier", "Employee"]`,
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the enumeration in'),
      name: z.string().describe('Enumeration name, e.g. "BusinessPartnerType"'),
      description: z.string().optional().describe('Description of what this enumeration represents'),
      values: z.array(z.string()).describe('Initial list of enumeration values, e.g. ["Customer", "Supplier", "Employee"]'),
      version: z.string().default('1.0.0').describe('Version label for the first version'),
      shared: z.boolean().default(false).describe('Make this enumeration visible and reusable across all domains'),
    },
  }, async (args) => {
    // 1. Create the enumeration object
    const enumObj = await epPost('/api/v2/architecture/enums', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      description: args.description ?? '',
      shared: args.shared,
    }) as any;

    // 2. Create the first version with values
    const enumVersion = await epPost('/api/v2/architecture/enumVersions', {
      enumId: enumObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      values: args.values.map((value: string) => ({ value })),
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ enumeration: enumObj, version: enumVersion }, null, 2) }] };
  });

  server.registerTool('update-enumeration', {
    description: 'Update the name, description, or shared flag of an existing enumeration object.',
    inputSchema: {
      enumId: z.string().describe('Enumeration object ID'),
      name: z.string().optional(),
      description: z.string().optional(),
      shared: z.boolean().optional().describe('Set to true to share the enumeration across all domains'),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name) body.name = args.name;
    if (args.description) body.description = args.description;
    if (args.shared !== undefined) body.shared = args.shared;
    const data = await epPatch(`/api/v2/architecture/enums/${args.enumId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('delete-enumeration', {
    description: 'Delete an enumeration and all its versions. Only possible when all versions are in Draft state and no schema or topic address references this enumeration.',
    inputSchema: {
      enumId: z.string().describe('Enumeration object ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/enums/${args.enumId}`);
    return { content: [{ type: 'text' as const, text: `Enumeration ${args.enumId} deleted.` }] };
  });

  // ── Enumeration versions ──────────────────────────────────────────────────

  server.registerTool('get-enumeration-version', {
    description: 'Get a specific enumeration version by its version ID. Returns the full list of values defined in this version and its lifecycle state.',
    inputSchema: {
      versionId: z.string().describe('Enumeration version ID'),
    },
  }, async (args) => {
    const data = await epGet(`/api/v2/architecture/enumVersions/${args.versionId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('update-enumeration-version-values', {
    description: `Replace the full set of values in an enumeration version (Draft state only).
Provide the complete new list — this overwrites the existing values entirely.
To add a single value, first call get-enumeration-version to read current values,
append the new one, then pass the full updated list here.`,
    inputSchema: {
      versionId: z.string().describe('Enumeration version ID to update'),
      values: z.array(z.string()).describe('Complete new list of enumeration values'),
      description: z.string().optional().describe('Optional updated description for this version'),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      values: args.values.map((value: string) => ({ value })),
    };
    if (args.description) body.description = args.description;
    const data = await epPatch(`/api/v2/architecture/enumVersions/${args.versionId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('add-enumeration-value', {
    description: `Add a single value to an existing enumeration version (Draft state only).
Fetches the current values, appends the new one, and saves — so you don't need
to supply the full list yourself.`,
    inputSchema: {
      versionId: z.string().describe('Enumeration version ID to update'),
      value: z.string().describe('The new value to add, e.g. "Contractor"'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/enumVersions/${args.versionId}`) as any;
    const existing: string[] = (current?.data?.values ?? []).map((v: any) => v.value ?? v);
    if (existing.includes(args.value)) {
      return { content: [{ type: 'text' as const, text: `Value "${args.value}" already exists in this enumeration version.` }] };
    }
    const updated = [...existing, args.value];
    const data = await epPatch(`/api/v2/architecture/enumVersions/${args.versionId}`, {
      values: updated.map((value: string) => ({ value })),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-enumeration-value', {
    description: `Remove a single value from an existing enumeration version (Draft state only).
Fetches the current values, removes the specified one, and saves.`,
    inputSchema: {
      versionId: z.string().describe('Enumeration version ID to update'),
      value: z.string().describe('The value to remove, e.g. "Contractor"'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/enumVersions/${args.versionId}`) as any;
    const existing: string[] = (current?.data?.values ?? []).map((v: any) => v.value ?? v);
    if (!existing.includes(args.value)) {
      return { content: [{ type: 'text' as const, text: `Value "${args.value}" not found in this enumeration version.` }] };
    }
    const updated = existing.filter((v: string) => v !== args.value);
    const data = await epPatch(`/api/v2/architecture/enumVersions/${args.versionId}`, {
      values: updated.map((value: string) => ({ value })),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('create-enumeration-version', {
    description: `Create a new version of an existing enumeration — use this when you need to make breaking
changes to values while keeping the previous version available for existing consumers.
Starts in Draft state; promote with set-enumeration-version-state when ready.`,
    inputSchema: {
      enumId: z.string().describe('Enumeration object ID to add a new version to'),
      values: z.array(z.string()).describe('Values for this new version'),
      version: z.string().describe('Version label, e.g. "2.0.0"'),
      description: z.string().optional(),
    },
  }, async (args) => {
    const data = await epPost('/api/v2/architecture/enumVersions', {
      enumId: args.enumId,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      values: args.values.map((value: string) => ({ value })),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('set-enumeration-version-state', {
    description: 'Change the lifecycle state of an enumeration version: Draft → Released → Deprecated → Retired.',
    inputSchema: {
      versionId: z.string().describe('Enumeration version ID'),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    const data = await epPatch(`/api/v2/architecture/enumVersions/${args.versionId}`, { stateId: args.stateId }) as any;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...data, _newState: STATE_LABELS[args.stateId] }, null, 2) }] };
  });
}
