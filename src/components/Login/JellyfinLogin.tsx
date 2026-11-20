import Button from '@app/components/Common/Button';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import { useQuickConnect } from '@app/hooks/useQuickConnect';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType, ServerType } from '@server/constants/server';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useRef } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Login', {
  loginwithapp: 'Login with {appName}',
  username: 'Username',
  password: 'Password',
  validationusernamerequired: 'Username required',
  validationpasswordrequired: 'Password required',
  loginerror: 'Something went wrong while trying to sign in.',
  adminerror: 'You must use an admin account to sign in.',
  noadminerror: 'No admin user found on the server.',
  credentialerror: 'The username or password is incorrect.',
  invalidurlerror: 'Unable to connect to {mediaServerName} server.',
  tipUsernameHasTrailingWhitespace: 'The username ends with whitespace',
  signingin: 'Signing In…',
  signin: 'Sign In',
  forgotpassword: 'Forgot Password?',
  quickconnect: 'Quick Connect',
  authorizeCode:
    'In your Jellyfin app, go to Settings → Quick Connect and enter this code.',
  codeExpired: 'This code has expired.',
  orUsePassword: 'Or sign in with your password',
});

interface JellyfinLoginProps {
  revalidate: () => void;
  serverType?: MediaServerType;
  secondary?: boolean;
}

const JellyfinLogin = ({
  revalidate,
  serverType,
  secondary = false,
}: JellyfinLoginProps) => {
  const toasts = useToasts();
  const intl = useIntl();
  const settings = useSettings();
  const isJellyfin = serverType === MediaServerType.JELLYFIN;
  const pendingLogin = useRef<ReturnType<typeof axios.post> | null>(null);
  // A code approval can arrive while the password form is being submitted.
  const signIn = async (path: string, credentials: Record<string, string>) => {
    pendingLogin.current ??= axios.post(path, credentials).finally(() => {
      pendingLogin.current = null;
    });
    await pendingLogin.current;
  };
  const quickConnect = useQuickConnect({
    show: isJellyfin,
    onSuccess: revalidate,
    authenticate: (secret) =>
      signIn('/api/v1/auth/jellyfin/quickconnect/authenticate', { secret }),
  });

  const mediaServerFormatValues = {
    mediaServerName:
      serverType === MediaServerType.JELLYFIN
        ? ServerType.JELLYFIN
        : serverType === MediaServerType.EMBY
          ? ServerType.EMBY
          : 'Media Server',
  };

  const LoginSchema = Yup.object().shape({
    username: Yup.string().required(
      intl.formatMessage(messages.validationusernamerequired)
    ),
    password: Yup.string(),
  });
  const baseUrl = settings.currentSettings.jellyfinExternalHost
    ? settings.currentSettings.jellyfinExternalHost
    : settings.currentSettings.jellyfinHost;
  const jellyfinForgotPasswordUrl =
    settings.currentSettings.jellyfinForgotPasswordUrl;

  return (
    <div>
      <h2 className="-mt-1 mb-6 text-center text-lg font-bold text-neutral-200">
        {intl.formatMessage(messages.loginwithapp, {
          appName: mediaServerFormatValues.mediaServerName,
        })}
      </h2>
      {isJellyfin && (
        <>
          <section
            aria-labelledby="quick-connect-title"
            className="text-center"
          >
            <h3
              id="quick-connect-title"
              className="text-sm font-semibold text-gray-200"
            >
              {intl.formatMessage(messages.quickconnect)}
            </h3>
            <div role="status" className="my-2">
              {quickConnect.hasError || quickConnect.isExpired ? (
                <p className="text-sm text-gray-300">
                  {quickConnect.errorMessage ||
                    intl.formatMessage(messages.codeExpired)}
                </p>
              ) : quickConnect.isLoading ? (
                <p className="text-sm text-gray-300">
                  {intl.formatMessage(globalMessages.loading)}
                </p>
              ) : (
                <>
                  <p className="font-mono text-3xl font-semibold tracking-widest text-white">
                    {quickConnect.code}
                  </p>
                  <p className="mt-2 text-sm text-gray-300">
                    {intl.formatMessage(messages.authorizeCode)}
                  </p>
                </>
              )}
            </div>
            {(quickConnect.hasError || quickConnect.isExpired) && (
              <Button
                type="button"
                buttonType="ghost"
                onClick={quickConnect.initiateQuickConnect}
              >
                {intl.formatMessage(globalMessages.retry)}
              </Button>
            )}
          </section>
          <div className="my-5 flex items-center gap-3 text-center text-sm text-gray-300">
            <span className="flex-1 border-t border-gray-600" />
            {intl.formatMessage(messages.orUsePassword)}
            <span className="flex-1 border-t border-gray-600" />
          </div>
        </>
      )}
      <Formik
        initialValues={{
          username: '',
          password: '',
        }}
        validationSchema={LoginSchema}
        validateOnBlur={false}
        onSubmit={async (values) => {
          try {
            await signIn('/api/v1/auth/jellyfin', {
              username: values.username,
              password: values.password,
              email: values.username,
            });
          } catch (e) {
            let errorMessage = messages.loginerror;
            switch (e?.response?.data?.message) {
              case ApiErrorCode.InvalidUrl:
              case ApiErrorCode.ConnectionError:
                errorMessage = messages.invalidurlerror;
                break;
              case ApiErrorCode.InvalidCredentials:
                errorMessage = messages.credentialerror;
                break;
              case ApiErrorCode.NotAdmin:
                errorMessage = messages.adminerror;
                break;
              case ApiErrorCode.NoAdminUser:
                errorMessage = messages.noadminerror;
                break;
            }
            toasts.addToast(
              intl.formatMessage(errorMessage, mediaServerFormatValues),
              {
                autoDismiss: true,
                appearance: 'error',
              }
            );
          } finally {
            revalidate();
          }
        }}
      >
        {({ errors, touched, values, isSubmitting, isValid }) => {
          return (
            <>
              <Form data-form-type="login">
                <div>
                  <div className="mb-4 mt-1">
                    <div className="form-input-field">
                      <Field
                        id="username"
                        name="username"
                        type="text"
                        placeholder={intl.formatMessage(messages.username)}
                        className="!bg-gray-700/80 placeholder:text-gray-400"
                        data-form-type="username"
                      />
                    </div>
                    {touched.username && values.username.match(/\s$/) && (
                      <div className="warning label-tip flex items-center">
                        <ExclamationTriangleIcon className="mr-1 h-4 w-4" />
                        {intl.formatMessage(
                          messages.tipUsernameHasTrailingWhitespace
                        )}
                      </div>
                    )}
                    {errors.username && touched.username && (
                      <div className="error">{errors.username}</div>
                    )}
                  </div>

                  <div className="mb-2 mt-1">
                    <div className="form-input-field">
                      <SensitiveInput
                        as="field"
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder={intl.formatMessage(messages.password)}
                        className="!bg-gray-700/80 placeholder:text-gray-400"
                        data-form-type="password"
                        data-1pignore="false"
                        data-lpignore="false"
                      />
                    </div>
                    <div className="flex">
                      {errors.password && touched.password && (
                        <div className="error">{errors.password}</div>
                      )}
                      <div className="flex-grow" />
                      {!secondary && baseUrl && (
                        <a
                          href={
                            jellyfinForgotPasswordUrl
                              ? `${jellyfinForgotPasswordUrl}`
                              : `${baseUrl}/web/index.html#!/${
                                  settings.currentSettings.mediaServerType ===
                                  MediaServerType.EMBY
                                    ? 'startup/'
                                    : ''
                                }forgotpassword.html`
                          }
                          className="pt-2 text-sm text-indigo-500 hover:text-indigo-400"
                        >
                          {intl.formatMessage(messages.forgotpassword)}
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  buttonType="primary"
                  type="submit"
                  disabled={isSubmitting || !isValid}
                  className="mt-2 w-full shadow-sm"
                >
                  <ArrowLeftOnRectangleIcon />
                  <span>
                    {isSubmitting
                      ? intl.formatMessage(messages.signingin)
                      : intl.formatMessage(messages.signin)}
                  </span>
                </Button>
              </Form>
            </>
          );
        }}
      </Formik>
    </div>
  );
};

export default JellyfinLogin;
