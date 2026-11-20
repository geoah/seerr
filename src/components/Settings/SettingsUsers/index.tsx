import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LabeledCheckbox from '@app/components/Common/LabeledCheckbox';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PermissionEdit from '@app/components/PermissionEdit';
import QuotaSelector from '@app/components/QuotaSelector';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import { MediaServerType, ServerType } from '@server/constants/server';
import type { JellyfinSettings, MainSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as yup from 'yup';
import SecondaryImportSettings from './SecondaryImportSettings';

const messages = defineMessages('components.Settings.SettingsUsers', {
  users: 'Users',
  userSettings: 'User Settings',
  userSettingsDescription: 'Configure global and default user settings.',
  toastSettingsSuccess: 'User settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  loginMethods: 'Login Methods',
  loginMethodsTip: 'Configure login methods for users.',
  localLogin: 'Enable Local Sign-In',
  localLoginTip:
    'Allow users to sign in using their email address and password',
  mediaServerLogin: 'Enable {mediaServerName} Sign-In',
  mediaServerLoginTip:
    'Allow users to sign in using their {mediaServerName} account',
  secondaryLoginTip:
    'Allow users to sign in with {mediaServerName}. This also requires {primaryMediaServerName} sign-in to be enabled.',
  secondaryJellyfinUrl: 'Jellyfin Server URL',
  secondaryPlexMachineId: 'Plex Machine Identifier',
  secondaryPlexMachineIdError: 'Enter a valid Plex machine identifier.',
  secondaryJellyfinUrlError: 'Enter a valid HTTP or HTTPS Jellyfin server URL.',
  secondarySettingsLoadFailure: 'Unable to load secondary sign-in settings.',
  atLeastOneAuth: 'At least one authentication method must be selected.',
  newPlexLogin: 'Enable New {mediaServerName} Sign-In',
  newPlexLoginTip:
    'Allow {mediaServerName} users to sign in without first being imported',
  newMediaServerLogin: 'Allow New Media Server Accounts',
  newMediaServerLoginTip:
    'Allow users from {primaryMediaServerName} or {mediaServerName} to create an account when they first sign in',
  movieRequestLimitLabel: 'Global Movie Request Limit',
  tvRequestLimitLabel: 'Global Series Request Limit',
  defaultPermissions: 'Default Permissions',
  defaultPermissionsTip: 'Initial permissions assigned to new users',
  disabledMediaServerLoginWarning:
    'Some users may not have a {applicationTitle} password set. Disabling {mediaServerName} sign-in could lock them out. Affected users will need to set a password from their profile or via a password reset link.',
});

const parseJellyfinUrl = (value?: string) => {
  try {
    const url = new URL(value ?? '');
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    ) {
      return url;
    }
  } catch {
    // An unconfigured or invalid URL has no connection details.
  }
};

const SettingsUsers = () => {
  const { addToast } = useToasts();
  const intl = useIntl();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MainSettings>('/api/v1/settings/main');
  const settings = useSettings();
  const { mediaServerType } = settings.currentSettings;
  const plexPrimary = mediaServerType === MediaServerType.PLEX;
  const jellyfinPrimary = mediaServerType === MediaServerType.JELLYFIN;
  const secondaryServerName = plexPrimary
    ? ServerType.JELLYFIN
    : ServerType.PLEX;
  const {
    data: secondaryJellyfin,
    error: secondaryJellyfinError,
    mutate: revalidateJellyfin,
  } = useSWR<Pick<JellyfinSettings, 'ip' | 'port' | 'useSsl' | 'urlBase'>>(
    plexPrimary ? '/api/v1/settings/jellyfin/login' : null
  );
  const {
    data: secondaryPlex,
    error: secondaryPlexError,
    mutate: revalidatePlex,
  } = useSWR<{ machineId: string }>(
    jellyfinPrimary ? '/api/v1/settings/plex/login' : null
  );
  const secondarySettingsError = secondaryJellyfinError || secondaryPlexError;
  const jellyfinUrl = secondaryJellyfin?.ip
    ? `${secondaryJellyfin.useSsl ? 'https' : 'http'}://${secondaryJellyfin.ip}:${secondaryJellyfin.port}${secondaryJellyfin.urlBase ?? ''}`
    : '';

  const schema = yup
    .object()
    .shape({
      localLogin: yup.boolean(),
      mediaServerLogin: yup.boolean(),
      secondaryLoginEnabled: yup.boolean(),
      jellyfinUrl: yup.string().when('secondaryLoginEnabled', {
        is: (enabled: boolean) =>
          enabled && plexPrimary && !secondarySettingsError,
        then: (field) =>
          field.test(
            'jellyfin-url',
            intl.formatMessage(messages.secondaryJellyfinUrlError),
            (value) => !!parseJellyfinUrl(value)
          ),
      }),
      plexMachineId: yup.string().when('secondaryLoginEnabled', {
        is: (enabled: boolean) =>
          enabled && jellyfinPrimary && !secondarySettingsError,
        then: (field) =>
          field.matches(
            /^\s*[a-zA-Z0-9-]{1,128}\s*$/,
            intl.formatMessage(messages.secondaryPlexMachineIdError)
          ),
      }),
    })
    .test({
      name: 'atLeastOneAuth',
      test: function (values) {
        const isValid = (
          ['localLogin', 'mediaServerLogin'] as (keyof typeof values)[]
        ).some((field) => !!values[field]);

        if (isValid) return true;
        return this.createError({
          path: 'localLogin | mediaServerLogin',
          message: intl.formatMessage(messages.atLeastOneAuth),
        });
      },
    });

  if (
    (!data && !error) ||
    (plexPrimary && !secondaryJellyfin && !secondaryJellyfinError) ||
    (jellyfinPrimary && !secondaryPlex && !secondaryPlexError)
  ) {
    return <LoadingSpinner />;
  }

  const mediaServerFormatValues = {
    mediaServerName:
      settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? ServerType.JELLYFIN
        : settings.currentSettings.mediaServerType === MediaServerType.EMBY
          ? ServerType.EMBY
          : settings.currentSettings.mediaServerType === MediaServerType.PLEX
            ? ServerType.PLEX
            : undefined,
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.users),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.userSettings)}</h3>
        <p className="description">
          {intl.formatMessage(messages.userSettingsDescription)}
        </p>
      </div>
      <div className="section">
        <Formik
          initialValues={{
            localLogin: data?.localLogin,
            mediaServerLogin: data?.mediaServerLogin,
            secondaryLoginEnabled: data?.secondaryLoginEnabled ?? false,
            jellyfinUrl,
            plexMachineId: secondaryPlex?.machineId ?? '',
            newPlexLogin: data?.newPlexLogin,
            movieQuotaLimit: data?.defaultQuotas.movie.quotaLimit ?? 0,
            movieQuotaDays: data?.defaultQuotas.movie.quotaDays ?? 7,
            tvQuotaLimit: data?.defaultQuotas.tv.quotaLimit ?? 0,
            tvQuotaDays: data?.defaultQuotas.tv.quotaDays ?? 7,
            defaultPermissions: data?.defaultPermissions ?? 0,
          }}
          validationSchema={schema}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              if (values.secondaryLoginEnabled && !secondarySettingsError) {
                if (plexPrimary && values.jellyfinUrl !== jellyfinUrl) {
                  const url = parseJellyfinUrl(values.jellyfinUrl);
                  if (!url) return;
                  const useSsl = url.protocol === 'https:';
                  await axios.post('/api/v1/settings/jellyfin/login', {
                    ip: url.hostname,
                    port: Number(url.port) || (useSsl ? 443 : 80),
                    useSsl,
                    urlBase: url.pathname.replace(/\/+$/, ''),
                  });
                }
                if (
                  jellyfinPrimary &&
                  values.plexMachineId !== secondaryPlex?.machineId
                ) {
                  await axios.post('/api/v1/settings/plex/login', {
                    machineId: values.plexMachineId.trim(),
                  });
                }
              }

              await axios.post('/api/v1/settings/main', {
                localLogin: values.localLogin,
                mediaServerLogin: values.mediaServerLogin,
                secondaryLoginEnabled: secondarySettingsError
                  ? undefined
                  : values.secondaryLoginEnabled,
                newPlexLogin: values.newPlexLogin,
                defaultQuotas: {
                  movie: {
                    quotaLimit: values.movieQuotaLimit,
                    quotaDays: values.movieQuotaDays,
                  },
                  tv: {
                    quotaLimit: values.tvQuotaLimit,
                    quotaDays: values.tvQuotaDays,
                  },
                },
                defaultPermissions: values.defaultPermissions,
              });
              mutate('/api/v1/settings/public');

              addToast(intl.formatMessage(messages.toastSettingsSuccess), {
                autoDismiss: true,
                appearance: 'success',
              });
            } catch {
              addToast(intl.formatMessage(messages.toastSettingsFailure), {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              revalidate();
              if (plexPrimary) revalidateJellyfin();
              if (jellyfinPrimary) revalidatePlex();
            }
          }}
        >
          {({ isSubmitting, isValid, values, errors, setFieldValue }) => {
            return (
              <Form className="section">
                <div
                  role="group"
                  aria-labelledby="group-label"
                  className="form-group"
                >
                  <div className="form-row">
                    <span id="group-label" className="group-label">
                      {intl.formatMessage(messages.loginMethods)}
                      <span className="label-tip">
                        {intl.formatMessage(messages.loginMethodsTip)}
                      </span>
                      {'localLogin | mediaServerLogin' in errors && (
                        <span className="error">
                          {errors['localLogin | mediaServerLogin'] as string}
                        </span>
                      )}
                    </span>

                    <div className="form-input-area max-w-lg">
                      <LabeledCheckbox
                        id="localLogin"
                        label={intl.formatMessage(messages.localLogin)}
                        description={intl.formatMessage(
                          messages.localLoginTip,
                          mediaServerFormatValues
                        )}
                        onChange={() =>
                          setFieldValue('localLogin', !values.localLogin)
                        }
                      />
                      <LabeledCheckbox
                        id="mediaServerLogin"
                        className="mt-4"
                        label={intl.formatMessage(
                          messages.mediaServerLogin,
                          mediaServerFormatValues
                        )}
                        description={intl.formatMessage(
                          messages.mediaServerLoginTip,
                          mediaServerFormatValues
                        )}
                        onChange={() =>
                          setFieldValue(
                            'mediaServerLogin',
                            !values.mediaServerLogin
                          )
                        }
                      />
                      {secondarySettingsError ? (
                        <div className="mt-4">
                          <Alert
                            title={intl.formatMessage(
                              messages.secondarySettingsLoadFailure
                            )}
                            type="warning"
                          />
                        </div>
                      ) : (
                        (plexPrimary || jellyfinPrimary) && (
                          <LabeledCheckbox
                            id="secondaryLoginEnabled"
                            className="mt-4"
                            label={intl.formatMessage(
                              messages.mediaServerLogin,
                              {
                                mediaServerName: secondaryServerName,
                              }
                            )}
                            description={intl.formatMessage(
                              messages.secondaryLoginTip,
                              {
                                mediaServerName: secondaryServerName,
                                primaryMediaServerName:
                                  mediaServerFormatValues.mediaServerName,
                              }
                            )}
                            onChange={() =>
                              setFieldValue(
                                'secondaryLoginEnabled',
                                !values.secondaryLoginEnabled
                              )
                            }
                          >
                            {values.secondaryLoginEnabled &&
                              (plexPrimary ? (
                                <div className="space-y-1">
                                  <label
                                    htmlFor="jellyfinUrl"
                                    className="text-label"
                                  >
                                    {intl.formatMessage(
                                      messages.secondaryJellyfinUrl
                                    )}
                                  </label>
                                  <Field
                                    type="url"
                                    id="jellyfinUrl"
                                    name="jellyfinUrl"
                                    className="w-full"
                                    required
                                  />
                                  {errors.jellyfinUrl && (
                                    <span className="error">
                                      {errors.jellyfinUrl}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <label
                                    htmlFor="plexMachineId"
                                    className="text-label"
                                  >
                                    {intl.formatMessage(
                                      messages.secondaryPlexMachineId
                                    )}
                                  </label>
                                  <Field
                                    type="text"
                                    id="plexMachineId"
                                    name="plexMachineId"
                                    className="w-full"
                                    required
                                  />
                                  {errors.plexMachineId && (
                                    <span className="error">
                                      {errors.plexMachineId}
                                    </span>
                                  )}
                                </div>
                              ))}
                          </LabeledCheckbox>
                        )
                      )}
                      {!values.mediaServerLogin && values.localLogin && (
                        <div className="mt-4">
                          <Alert
                            title={intl.formatMessage(
                              messages.disabledMediaServerLoginWarning,
                              {
                                applicationTitle:
                                  settings.currentSettings.applicationTitle,
                                ...mediaServerFormatValues,
                              }
                            )}
                            type="warning"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="newPlexLogin" className="checkbox-label">
                    {values.secondaryLoginEnabled
                      ? intl.formatMessage(messages.newMediaServerLogin)
                      : intl.formatMessage(
                          messages.newPlexLogin,
                          mediaServerFormatValues
                        )}
                    <span className="label-tip">
                      {values.secondaryLoginEnabled
                        ? intl.formatMessage(messages.newMediaServerLoginTip, {
                            mediaServerName: secondaryServerName,
                            primaryMediaServerName:
                              mediaServerFormatValues.mediaServerName,
                          })
                        : intl.formatMessage(
                            messages.newPlexLoginTip,
                            mediaServerFormatValues
                          )}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="newPlexLogin"
                      name="newPlexLogin"
                      onChange={() => {
                        setFieldValue('newPlexLogin', !values.newPlexLogin);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.movieRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="movieQuotaDays"
                      limitFieldName="movieQuotaLimit"
                      mediaType="movie"
                      defaultDays={values.movieQuotaDays}
                      defaultLimit={values.movieQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.tvRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="tvQuotaDays"
                      limitFieldName="tvQuotaLimit"
                      mediaType="tv"
                      defaultDays={values.tvQuotaDays}
                      defaultLimit={values.tvQuotaLimit}
                    />
                  </div>
                </div>
                <div
                  role="group"
                  aria-labelledby="group-label"
                  className="form-group"
                >
                  <div className="form-row">
                    <span id="group-label" className="group-label">
                      {intl.formatMessage(messages.defaultPermissions)}
                      <span className="label-tip">
                        {intl.formatMessage(messages.defaultPermissionsTip)}
                      </span>
                    </span>
                    <div className="form-input-area">
                      <div className="max-w-lg">
                        <PermissionEdit
                          currentPermission={values.defaultPermissions}
                          onUpdate={(newPermissions) =>
                            setFieldValue('defaultPermissions', newPermissions)
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <div className="flex justify-end">
                    <span className="ml-3 inline-flex rounded-md shadow-sm">
                      <Button
                        buttonType="primary"
                        type="submit"
                        disabled={isSubmitting || !isValid}
                      >
                        <ArrowDownOnSquareIcon />
                        <span>
                          {isSubmitting
                            ? intl.formatMessage(globalMessages.saving)
                            : intl.formatMessage(globalMessages.save)}
                        </span>
                      </Button>
                    </span>
                  </div>
                </div>
              </Form>
            );
          }}
        </Formik>
      </div>
      {(secondaryJellyfin?.ip || secondaryPlex?.machineId) && (
        <SecondaryImportSettings
          key={secondaryServerName}
          serverName={secondaryServerName}
          signInEnabled={settings.currentSettings.secondaryLoginEnabled}
        />
      )}
    </>
  );
};

export default SettingsUsers;
