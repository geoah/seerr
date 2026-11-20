import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import settingsRoutes, {
  userDirectorySettingsRoutes,
} from '@server/routes/settings';
import { setupTestDb } from '@server/test/db';
import {
  assertNoCredentials,
  seedUserSettings,
} from '@server/test/userSettings';
import { permissionsOf, seedManagerAndAdmin } from '@server/test/users';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/user', isAuthenticated(), userRoutes);
  app.use('/settings', userDirectorySettingsRoutes);
  app.use('/settings', isAuthenticated(Permission.ADMIN), settingsRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('POST /user/import-from-plex', () => {
  it('preserves a Jellyfin account when a Plex share has the same email', async (t) => {
    const userRepository = getRepository(User);
    await userRepository.update(
      { email: 'demo@seerr.dev' },
      {
        userType: UserType.JELLYFIN,
        plexId: null,
        jellyfinUserId: 'jellyfin-demo',
      }
    );
    t.mock.method(PlexTvAPI.prototype, 'getUsers', async () => ({
      MediaContainer: {
        User: [
          { $: { id: '99', email: 'demo@seerr.dev', username: 'plex-demo' } },
        ],
      },
    }));
    t.mock.method(PlexTvAPI.prototype, 'checkUserAccess', async () => true);

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const response = await admin
      .post('/user/import-from-plex')
      .send({ plexIds: ['99'] });

    assert.equal(response.status, 201);
    assert.equal(response.body.refreshedUsers, 0);
    assert.deepEqual(response.body.createdUsers, []);
    const jellyfinUser = await userRepository.findOneByOrFail({
      email: 'demo@seerr.dev',
    });
    assert.equal(jellyfinUser.plexId, null);
    assert.notEqual(jellyfinUser.plexUsername, 'plex-demo');
  });
});

describe('Secondary user imports', () => {
  it('imports members of the configured Plex server without linking email matches', async (t) => {
    const settings = getSettings();
    const prior = { ...settings.main };
    const initialized = settings.public.initialized;
    const machineId = settings.plex.machineId;
    t.after(() => {
      settings.main = prior;
      settings.public.initialized = initialized;
      settings.plex.machineId = machineId;
      delete settings.secondaryImport.plex;
    });
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    settings.main.secondaryLoginEnabled = true;
    settings.public.initialized = true;
    settings.plex.machineId = 'secondary-plex';
    t.mock.method(settings, 'save', async () => {});
    const resources = [
      { owned: true, clientIdentifier: 'secondary-plex', provides: ['server'] },
    ];
    t.mock.method(PlexTvAPI.prototype, 'getDevices', async () => resources);
    let plexAccountId = 98;
    t.mock.method(PlexTvAPI.prototype, 'getUser', async () => ({
      id: plexAccountId,
      email: 'owner@seerr.dev',
      username: 'plex-owner',
      thumb: '',
    }));
    t.mock.method(PlexTvAPI.prototype, 'getUsers', async () => ({
      MediaContainer: {
        User: [
          {
            id: '19',
            email: 'member@seerr.dev',
            machineId: 'secondary-plex',
            pending: '0',
          },
          { id: '20', email: 'outsider@seerr.dev', machineId: 'other-plex' },
          { id: '21', email: 'demo@seerr.dev', machineId: 'secondary-plex' },
          {
            id: '22',
            email: 'pending@seerr.dev',
            machineId: 'secondary-plex',
            pending: '1',
          },
          {
            id: '23',
            email: 'pending-user@seerr.dev',
            machineId: 'secondary-plex',
            pending: 'false',
            pendingUser: 'true',
          },
        ].map(({ id, email, machineId, pending, pendingUser }) => ({
          $: { id, email, username: email, thumb: '', pending: pendingUser },
          Server: [{ $: { machineIdentifier: machineId, pending } }],
        })),
      },
    }));

    await seedManagerAndAdmin();
    const manager = await loginAs('demo@seerr.dev', 'test1234');
    const admin = await loginAs('admin@seerr.dev', 'test1234');
    assert.equal(
      (
        await manager
          .post('/settings/plex/import')
          .send({ token: 'secret-plex' })
      ).status,
      403
    );
    resources[0].owned = false;
    assert.equal(
      (await admin.post('/settings/plex/import').send({ token: 'secret-plex' }))
        .status,
      400
    );
    resources[0].owned = true;
    const configured = await admin
      .post('/settings/plex/import')
      .send({ token: 'secret-plex' });
    assert.equal(configured.status, 200);
    assert.deepEqual(configured.body, { configured: true });
    assert.deepEqual((await manager.get('/settings/plex/import')).body, {
      configured: true,
    });
    const listed = await manager.get('/settings/plex/users');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map(({ id }: { id: string }) => id).sort(), [
      '19',
      '98',
    ]);
    const imported = await manager
      .post('/user/import-from-plex')
      .send({ plexIds: ['19', '20', '21', '22', '23'] });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.createdUsers.length, 1);
    assert.doesNotMatch(JSON.stringify(imported.body), /secret-plex/);
    assert.equal(
      (await getRepository(User).findOneByOrFail({ plexId: 19 })).userType,
      UserType.PLEX
    );
    assert.equal(await getRepository(User).existsBy({ plexId: 20 }), false);
    assert.equal(await getRepository(User).existsBy({ plexId: 21 }), false);
    assert.equal(await getRepository(User).existsBy({ plexId: 22 }), false);
    assert.equal(await getRepository(User).existsBy({ plexId: 23 }), false);
    settings.main.newPlexLogin = false;
    plexAccountId = 19;
    const login = await request(app).post('/auth/plex').send({
      authToken: 'secondary-account-token',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.id, imported.body.createdUsers[0].id);

    const cleared = await admin
      .post('/settings/plex/import')
      .send({ token: null });
    assert.deepEqual(cleared.body, { configured: false });
    assert.equal(settings.main.mediaServerType, MediaServerType.JELLYFIN);
  });

  it('imports enabled members from the verified Jellyfin server without attaching a password', async (t) => {
    const settings = getSettings();
    const prior = { ...settings.main };
    const initialized = settings.public.initialized;
    const priorJellyfin = { ...settings.jellyfin };
    t.after(() => {
      settings.main = prior;
      settings.public.initialized = initialized;
      settings.jellyfin = priorJellyfin;
      delete settings.secondaryImport.jellyfin;
    });
    settings.main.mediaServerType = MediaServerType.PLEX;
    settings.main.secondaryLoginEnabled = true;
    settings.public.initialized = true;
    settings.jellyfin.ip = 'jellyfin.test';
    settings.jellyfin.serverId = 'secondary-jellyfin';
    t.mock.method(settings, 'save', async () => {});
    let serverId = 'other-jellyfin';
    t.mock.method(JellyfinAPI.prototype, 'getPublicSystemInfo', async () => ({
      Id: serverId,
      ProductName: 'Jellyfin Server',
      ServerName: 'Jellyfin',
    }));
    const memberId = '10000000000000000000000000000001';
    const disabledId = '10000000000000000000000000000002';
    const collidingId = '10000000000000000000000000000003';
    const getUsers = t.mock.method(
      JellyfinAPI.prototype,
      'getUsers',
      async () => ({
        users: [
          { Id: memberId, Name: 'jf-member', IsDisabled: false },
          { Id: disabledId, Name: 'jf-disabled', IsDisabled: true },
          { Id: collidingId, Name: 'demo@seerr.dev', IsDisabled: false },
        ].map(({ IsDisabled, ...user }) => ({
          ...user,
          ServerId: 'secondary-jellyfin',
          Policy: { IsDisabled },
        })),
      })
    );

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const invalid = await admin
      .post('/settings/jellyfin/import')
      .send({ apiKey: 'secret-jf' });
    assert.equal(invalid.status, 400);
    assert.equal(getUsers.mock.callCount(), 0);
    serverId = 'secondary-jellyfin';
    const configured = await admin
      .post('/settings/jellyfin/import')
      .send({ apiKey: 'secret-jf' });
    assert.equal(configured.status, 200);
    assert.deepEqual(configured.body, { configured: true });

    const listed = await admin.get('/settings/jellyfin/users');
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.body.map(({ id }: { id: string }) => id),
      [memberId]
    );
    const imported = await admin.post('/user/import-from-jellyfin').send({
      jellyfinUserIds: [memberId, disabledId, collidingId],
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.length, 1);
    assert.equal(imported.body[0].jellyfinUserId, memberId);
    assert.equal(imported.body[0].userType, UserType.JELLYFIN);
    assert.doesNotMatch(JSON.stringify(imported.body), /secret-jf/);
    const importedUser = await getRepository(User).findOneOrFail({
      where: { id: imported.body[0].id },
      select: { id: true, password: true, jellyfinAuthToken: true },
    });
    assert.equal(importedUser.password, null);
    assert.equal(importedUser.jellyfinAuthToken, null);
    settings.main.newPlexLogin = false;
    t.mock.method(JellyfinAPI.prototype, 'login', async () => ({
      User: { Id: memberId, ServerId: 'secondary-jellyfin' },
      AccessToken: 'session-token',
    }));
    const login = await request(app).post('/auth/jellyfin').send({
      username: 'jf-member',
      password: 'test-provider-password',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.id, importedUser.id);
    assert.equal(
      await getRepository(User).existsBy({ jellyfinUserId: disabledId }),
      false
    );
    assert.equal(
      await getRepository(User).existsBy({ jellyfinUserId: collidingId }),
      false
    );
    settings.jellyfin.ip = 'different-host.test';
    assert.deepEqual((await admin.get('/settings/jellyfin/import')).body, {
      configured: false,
    });
    assert.equal(settings.main.mediaServerType, MediaServerType.PLEX);
  });
});

describe('GET /user/:id/watchlist', () => {
  it('omits notification settings from every requestedBy in the page', async () => {
    const owner = await seedUserSettings('demo@seerr.dev');

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 12345,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    await getRepository(Watchlist).save(
      new Watchlist({
        mediaType: MediaType.MOVIE,
        tmdbId: 12345,
        title: 'Watchlisted Movie',
        ratingKey: 'rk-12345',
        requestedBy: owner,
        media,
      })
    );

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.get(`/user/${owner.id}/watchlist`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
    assert.ok(!('settings' in res.body.results[0].requestedBy));
    assertNoCredentials(res.body);
  });
});

describe('GET /user/:id', () => {
  it('still returns full settings to the user themselves', async () => {
    const owner = await seedUserSettings('demo@seerr.dev');

    const agent = await loginAs('demo@seerr.dev', 'test1234');
    const res = await agent.get(`/user/${owner.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.pgpKey, 'test-pgp-key');
    assert.strictEqual(
      res.body.settings.pushoverUserKey,
      'test-pushover-user-key'
    );
  });

  it('still returns full settings to a manage-users admin', async () => {
    const owner = await seedUserSettings('demo@seerr.dev');

    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.get(`/user/${owner.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.pgpKey, 'test-pgp-key');
  });

  it('strips settings for an unrelated user', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    await seedUserSettings('admin@seerr.dev');

    const agent = await loginAs('demo@seerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}`);

    assert.strictEqual(res.status, 200);
    assert.ok(!('settings' in res.body));
    assertNoCredentials(res.body);
  });
});

describe('PUT /user/:id', () => {
  it('stops a manager from removing admin from another admin', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const manager = await loginAs('demo@seerr.dev', 'test1234');

    const res = await manager
      .put(`/user/${otherAdmin.id}`)
      .send({ username: 'admin2', permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.ADMIN);
  });

  it('stops a manager from changing their own permissions', async () => {
    const { manager } = await seedManagerAndAdmin();
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.put(`/user/${manager.id}`).send({
      username: 'demo',
      permissions: Permission.MANAGE_USERS | Permission.MANAGE_SETTINGS,
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      await permissionsOf(manager.id),
      Permission.MANAGE_USERS
    );
  });

  it('lets a manager rename themselves', async () => {
    const { manager } = await seedManagerAndAdmin();
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .put(`/user/${manager.id}`)
      .send({ username: 'renamed', permissions: Permission.MANAGE_USERS });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, 'renamed');
  });

  it('lets the owner remove admin from another admin', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const res = await owner
      .put(`/user/${otherAdmin.id}`)
      .send({ username: 'admin2', permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.REQUEST);
  });
});

describe('PUT /user', () => {
  it("skips admins and the caller in a manager's bulk edit", async () => {
    const { manager, otherAdmin } = await seedManagerAndAdmin();
    const regular = await getRepository(User).save(
      new User({
        email: 'regular@seerr.dev',
        permissions: Permission.REQUEST,
        avatar: '',
      })
    );
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.put('/user').send({
      ids: [otherAdmin.id, manager.id, regular.id].map(String),
      permissions: Permission.VOTE,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.ADMIN);
    assert.strictEqual(
      await permissionsOf(manager.id),
      Permission.MANAGE_USERS
    );
    assert.strictEqual(await permissionsOf(regular.id), Permission.VOTE);
  });

  it('lets the owner bulk edit admins', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const res = await owner
      .put('/user')
      .send({ ids: [String(otherAdmin.id)], permissions: Permission.REQUEST });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await permissionsOf(otherAdmin.id), Permission.REQUEST);
  });
});

describe('DELETE /user/:id', () => {
  it('stops a manager from demoting an admin to delete them', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const manager = await loginAs('demo@seerr.dev', 'test1234');

    const demote = await manager
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const remove = await manager.delete(`/user/${otherAdmin.id}`);

    assert.strictEqual(demote.status, 403);
    assert.strictEqual(remove.status, 405);
    assert.ok(
      await getRepository(User).exists({ where: { id: otherAdmin.id } })
    );
  });

  it('lets the owner demote an admin and delete them', async () => {
    const { otherAdmin } = await seedManagerAndAdmin();
    const owner = await loginAs('admin@seerr.dev', 'test1234');

    const demote = await owner
      .post(`/user/${otherAdmin.id}/settings/permissions`)
      .send({ permissions: Permission.REQUEST });
    const remove = await owner.delete(`/user/${otherAdmin.id}`);

    assert.strictEqual(demote.status, 200);
    assert.strictEqual(remove.status, 200);
    assert.ok(
      !(await getRepository(User).exists({ where: { id: otherAdmin.id } }))
    );
  });
});
