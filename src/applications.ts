import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerApplicationTools(server: McpServer): void {

  server.tool(
    'list-applications',
    'List all applications (producers/consumers) in the Event Portal. Applications represent the systems that publish or subscribe to events.',
    {
      applicationDomainId: z.string().optional().describe('Filter by domain'),
      name: z.string().optional().describe('Filter by application name'),
    },
    async ({ applicationDomainId, name }) => {
      let path = '/api/v2/architecture/applications?pageSize=100';
      if (applicationDomainId) path += `&applicationDomainId=${applicationDomainId}`;
      if (name) path += `&name=${encodeURIComponent(name)}`;
      const data = await epGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'get-application',
    'Get an application by ID including all its versions and the events it publishes or subscribes to.',
    {
      applicationId: z.string().describe('Application object ID'),
    },
    async ({ applicationId }) => {
      const [app, versions] = await Promise.all([
        epGet(`/api/v2/architecture/applications/${applicationId}`),
        epGet(`/api/v2/architecture/applications/${applicationId}/versions?pageSize=100`),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ application: app, versions }, null, 2) }],
      };
    },
  );

  server.tool(
    'find-application-by-name',
    'Find an application by name. Useful for resolving names like "MDG" or "Cloud Integration iFlow" into application IDs.',
    {
      name: z.string().describe('Application name to search for'),
      applicationDomainId: z.string().optional(),
    },
    async ({ name, applicationDomainId }) => {
      let path = `/api/v2/architecture/applications?pageSize=100&name=${encodeURIComponent(name)}`;
      if (applicationDomainId) path += `&applicationDomainId=${applicationDomainId}`;
      const data = await epGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'create-application',
    `Create a new application in the Event Portal, then create its first version.
    Use this to register systems like "MDG" (publisher) or "Cloud Integration iFlow" (subscriber).
    After creation, use add-application-version-publisher and add-application-version-subscriber
    to wire the application to specific event versions.`,
    {
      applicationDomainId: z.string().describe('Domain to create the application in'),
      name: z.string().describe('Application name, e.g. "MDG" or "Cloud Integration - BP Subscriber"'),
      description: z.string().optional(),
      applicationType: z.enum(['standard', 'connector']).default('standard'),
      version: z.string().default('1.0.0'),
    },
    async ({ applicationDomainId, name, description, applicationType, version }) => {
      const appObj = await epPost('/api/v2/architecture/applications', {
        applicationDomainId,
        name,
        description: description ?? '',
        applicationType,
      }) as any;

      const appId = appObj?.data?.id;

      const appVersion = await epPost('/api/v2/architecture/applicationVersions', {
        applicationId: appId,
        description: description ?? '',
        version,
        stateId: '1',
        declaredProducedEventVersionIds: [],
        declaredConsumedEventVersionIds: [],
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ application: appObj, version: appVersion }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'add-application-version-publisher',
    `Declare that an application version publishes a specific event version.
    Example: "MDG publishes BusinessPartnerUpdated v1.0.0"
    The event version ID comes from create-event or get-event.`,
    {
      appVersionId: z.string().describe('Application version ID'),
      eventVersionId: z.string().describe('Event version ID that this application publishes'),
    },
    async ({ appVersionId, eventVersionId }) => {
      // Fetch current produced events first, then append
      const current = await epGet(`/api/v2/architecture/applicationVersions/${appVersionId}`) as any;
      const existing: string[] = current?.data?.declaredProducedEventVersionIds ?? [];
      if (existing.includes(eventVersionId)) {
        return {
          content: [{ type: 'text', text: `Application version already publishes event version ${eventVersionId}.` }],
        };
      }
      const data = await epPatch(`/api/v2/architecture/applicationVersions/${appVersionId}`, {
        declaredProducedEventVersionIds: [...existing, eventVersionId],
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'add-application-version-subscriber',
    `Declare that an application version subscribes to (consumes) a specific event version.
    Example: "Cloud Integration iFlow subscribes to BusinessPartnerUpdated v1.0.0"`,
    {
      appVersionId: z.string().describe('Application version ID'),
      eventVersionId: z.string().describe('Event version ID that this application subscribes to'),
    },
    async ({ appVersionId, eventVersionId }) => {
      const current = await epGet(`/api/v2/architecture/applicationVersions/${appVersionId}`) as any;
      const existing: string[] = current?.data?.declaredConsumedEventVersionIds ?? [];
      if (existing.includes(eventVersionId)) {
        return {
          content: [{ type: 'text', text: `Application version already subscribes to event version ${eventVersionId}.` }],
        };
      }
      const data = await epPatch(`/api/v2/architecture/applicationVersions/${appVersionId}`, {
        declaredConsumedEventVersionIds: [...existing, eventVersionId],
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'remove-application-version-publisher',
    'Remove a published event from an application version.',
    {
      appVersionId: z.string(),
      eventVersionId: z.string(),
    },
    async ({ appVersionId, eventVersionId }) => {
      const current = await epGet(`/api/v2/architecture/applicationVersions/${appVersionId}`) as any;
      const updated = (current?.data?.declaredProducedEventVersionIds ?? []).filter(
        (id: string) => id !== eventVersionId,
      );
      const data = await epPatch(`/api/v2/architecture/applicationVersions/${appVersionId}`, {
        declaredProducedEventVersionIds: updated,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'remove-application-version-subscriber',
    'Remove a subscribed event from an application version.',
    {
      appVersionId: z.string(),
      eventVersionId: z.string(),
    },
    async ({ appVersionId, eventVersionId }) => {
      const current = await epGet(`/api/v2/architecture/applicationVersions/${appVersionId}`) as any;
      const updated = (current?.data?.declaredConsumedEventVersionIds ?? []).filter(
        (id: string) => id !== eventVersionId,
      );
      const data = await epPatch(`/api/v2/architecture/applicationVersions/${appVersionId}`, {
        declaredConsumedEventVersionIds: updated,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'set-application-version-state',
    'Change the lifecycle state of an application version.',
    {
      appVersionId: z.string(),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
    async ({ appVersionId, stateId }) => {
      const data = await epPatch(`/api/v2/architecture/applicationVersions/${appVersionId}`, { stateId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'delete-application',
    'Delete an application and all its versions.',
    {
      applicationId: z.string(),
    },
    async ({ applicationId }) => {
      await epDelete(`/api/v2/architecture/applications/${applicationId}`);
      return { content: [{ type: 'text', text: `Application ${applicationId} deleted.` }] };
    },
  );
}
