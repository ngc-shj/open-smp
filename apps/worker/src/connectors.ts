import type { SaaSConnector } from '@open-smp/connectors-core';
import { GoogleWorkspaceConnector } from '@open-smp/connector-google-workspace';
import { SlackConnector } from '@open-smp/connector-slack';

export type ConnectorFactory = (credentials: Record<string, string>) => SaaSConnector;

/** Maps saas_apps.key to a connector factory. Injectable so tests can register a fake connector. */
export type ConnectorRegistry = ReadonlyMap<string, ConnectorFactory>;

function buildGoogleWorkspaceConnector(credentials: Record<string, string>): SaaSConnector {
  const serviceAccountJson = credentials.serviceAccountJson;
  const impersonateAdminEmail = credentials.impersonateAdminEmail;
  if (!serviceAccountJson || !impersonateAdminEmail) {
    throw new Error(
      'google-workspace credentials require serviceAccountJson and impersonateAdminEmail',
    );
  }

  return new GoogleWorkspaceConnector({
    serviceAccountJson,
    impersonateAdminEmail,
    ...(credentials.customerId ? { customerId: credentials.customerId } : {}),
  });
}

function buildSlackConnector(credentials: Record<string, string>): SaaSConnector {
  const botToken = credentials.botToken;
  if (!botToken) {
    // A fixed string, like every other message this file can produce: it is
    // thrown inside runSync's try, so it becomes a discovery_events payload in
    // a table whose UPDATE and DELETE are REVOKEd. Naming the missing FIELD is
    // useful; echoing what was supplied would be unredactable.
    throw new Error('slack credentials require botToken');
  }

  return new SlackConnector({ botToken });
}

export function createConnectorRegistry(): ConnectorRegistry {
  return new Map<string, ConnectorFactory>([
    ['google-workspace', buildGoogleWorkspaceConnector],
    ['slack', buildSlackConnector],
  ]);
}
