import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import gravatarUrl from 'gravatar-url';

export type SecondaryProvider = 'plex' | 'jellyfin';

export function isSecondaryProvider(provider: SecondaryProvider): boolean {
  const primary = getSettings().main.mediaServerType;
  return provider === 'plex'
    ? primary === MediaServerType.JELLYFIN
    : primary === MediaServerType.PLEX;
}

export function secondaryImportConfigured(
  provider: SecondaryProvider
): boolean {
  const settings = getSettings();
  if (!isSecondaryProvider(provider) || !settings.secondaryLoginConfigured) {
    return false;
  }

  if (provider === 'plex') {
    const credentials = settings.secondaryImport.plex;
    return (
      !!credentials?.token && credentials.machineId === settings.plex.machineId
    );
  }

  const credentials = settings.secondaryImport.jellyfin;
  return (
    !!credentials?.apiKey &&
    credentials.serverId === settings.jellyfin.serverId &&
    credentials.hostname === getHostname()
  );
}

function plexSharePending(value?: string): boolean {
  return value === '1' || value === 'true';
}

export async function getSecondaryPlexUsers(token: string, machineId: string) {
  const plex = new PlexTvAPI(token);
  const devices = await plex.getDevices();
  if (
    !devices?.some(
      (device) =>
        device.owned &&
        device.clientIdentifier === machineId &&
        device.provides.includes('server')
    )
  ) {
    throw new Error('Plex token does not own the configured server.');
  }

  const [owner, directory] = await Promise.all([
    plex.getUser(),
    plex.getUsers(),
  ]);
  const members = (directory.MediaContainer.User ?? [])
    .filter(
      (user) =>
        !plexSharePending(user.$.pending) &&
        user.Server?.some(
          (server) =>
            server.$.machineIdentifier === machineId &&
            !plexSharePending(server.$.pending)
        )
    )
    .map((user) => user.$);
  return [...members, { ...owner, id: String(owner.id) }]
    .filter(
      ({ id, email }) =>
        !!email && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    )
    .map(({ id, title, username, email, thumb }) => ({
      id,
      title,
      username,
      email,
      thumb,
    }));
}

export async function getSecondaryJellyfinUsers(
  apiKey: string,
  serverId: string,
  hostname: string
) {
  const server = await new JellyfinAPI(hostname).getPublicSystemInfo();
  if (server?.Id !== serverId || server.ProductName !== 'Jellyfin Server') {
    throw new Error(
      'The Jellyfin directory does not match the configured server.'
    );
  }

  const { users } = await new JellyfinAPI(hostname, apiKey).getUsers(true);
  return users
    .filter(
      (user) =>
        !user.Policy?.IsDisabled &&
        user.ServerId === serverId &&
        !!normalizeJellyfinGuid(user.Id) &&
        !!user.Name
    )
    .map((user) => ({
      id: user.Id,
      username: user.Name,
      email: user.Name,
      thumb: gravatarUrl(user.Name, { default: 'mm', size: 200 }),
    }));
}

export async function listSecondaryPlexUsers() {
  const settings = getSettings();
  const credentials = settings.secondaryImport.plex;
  if (
    !settings.secondaryLoginAvailable ||
    !secondaryImportConfigured('plex') ||
    !credentials
  ) {
    throw new Error('Plex import is unavailable.');
  }
  const directory = await getSecondaryPlexUsers(
    credentials.token,
    credentials.machineId
  );
  if (
    settings.secondaryImport.plex !== credentials ||
    !settings.secondaryLoginAvailable ||
    !secondaryImportConfigured('plex')
  ) {
    throw new Error('Plex import settings changed.');
  }
  return directory;
}

export async function listSecondaryJellyfinUsers() {
  const settings = getSettings();
  const credentials = settings.secondaryImport.jellyfin;
  if (
    !settings.secondaryLoginAvailable ||
    !secondaryImportConfigured('jellyfin') ||
    !credentials
  ) {
    throw new Error('Jellyfin import is unavailable.');
  }
  const directory = await getSecondaryJellyfinUsers(
    credentials.apiKey,
    credentials.serverId,
    credentials.hostname
  );
  if (
    settings.secondaryImport.jellyfin !== credentials ||
    !settings.secondaryLoginAvailable ||
    !secondaryImportConfigured('jellyfin')
  ) {
    throw new Error('Jellyfin import settings changed.');
  }
  return directory;
}
