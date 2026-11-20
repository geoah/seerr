import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ServerType } from '@server/constants/server';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface SecondaryImportSettingsProps {
  serverName: ServerType.PLEX | ServerType.JELLYFIN;
  signInEnabled: boolean;
}

interface ImportSettings {
  configured: boolean;
}

const messages = defineMessages('components.Settings.SettingsUsers', {
  secondaryImport: 'Import {serverName} Users',
  secondaryImportDescription:
    'Save {serverName} credentials to import users from the Users page.',
  secondaryImportRequiresSignIn: 'Enable {serverName} sign-in to import users.',
  secondaryImportPlexToken: 'Plex Server Owner Token',
  secondaryImportJellyfinKey: 'Jellyfin API Key',
  secondaryImportSavedCredential: 'An import credential is saved.',
  secondaryImportRemoveCredential: 'Remove the saved import credential',
  secondaryImportLoadFailed: 'Unable to load import settings.',
  secondaryImportSaved: 'Import settings saved.',
  secondaryImportSaveFailed:
    'Unable to save import settings. Check the import credential and server configuration.',
});

const SecondaryImportSettings = ({
  serverName,
  signInEnabled,
}: SecondaryImportSettingsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const plex = serverName === ServerType.PLEX;
  const endpoint = `/api/v1/settings/${plex ? 'plex' : 'jellyfin'}/import`;
  const { data, error, mutate } = useSWR<ImportSettings>(endpoint);

  return (
    <div className="mt-10">
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.secondaryImport, { serverName })}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.secondaryImportDescription, {
            serverName,
          })}
        </p>
      </div>
      {!signInEnabled && (
        <div className="mb-6">
          <Alert
            title={intl.formatMessage(messages.secondaryImportRequiresSignIn, {
              serverName,
            })}
            type="info"
          />
        </div>
      )}
      {error ? (
        <Alert
          title={intl.formatMessage(messages.secondaryImportLoadFailed)}
          type="error"
        />
      ) : !data ? (
        <LoadingSpinner />
      ) : (
        <Formik
          initialValues={{ credential: '', removeCredential: false }}
          onSubmit={async (values, { resetForm }) => {
            const credential = values.removeCredential
              ? null
              : values.credential.trim();
            if (credential === '') return;

            try {
              const { data: saved } = await axios.post<ImportSettings>(
                endpoint,
                plex ? { token: credential } : { apiKey: credential }
              );
              await mutate(saved, { revalidate: false });
              resetForm();
              addToast(intl.formatMessage(messages.secondaryImportSaved), {
                appearance: 'success',
                autoDismiss: true,
              });
            } catch {
              addToast(intl.formatMessage(messages.secondaryImportSaveFailed), {
                appearance: 'error',
                autoDismiss: true,
              });
            }
          }}
        >
          {({ values, isSubmitting }) => (
            <Form className="section">
              <div className="form-row">
                <label htmlFor="importCredential" className="text-label">
                  {intl.formatMessage(
                    plex
                      ? messages.secondaryImportPlexToken
                      : messages.secondaryImportJellyfinKey
                  )}
                  {data.configured && (
                    <span className="label-tip">
                      {intl.formatMessage(
                        messages.secondaryImportSavedCredential
                      )}
                    </span>
                  )}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="importCredential"
                      name="credential"
                      type="password"
                      disabled={values.removeCredential || isSubmitting}
                    />
                  </div>
                  {data.configured && (
                    <label className="mt-4 flex items-center gap-2 text-sm">
                      <Field type="checkbox" name="removeCredential" />
                      {intl.formatMessage(
                        messages.secondaryImportRemoveCredential
                      )}
                    </label>
                  )}
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    buttonType="primary"
                    disabled={
                      isSubmitting ||
                      (!values.removeCredential && !values.credential.trim())
                    }
                  >
                    {intl.formatMessage(
                      isSubmitting ? globalMessages.saving : globalMessages.save
                    )}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      )}
    </div>
  );
};

export default SecondaryImportSettings;
