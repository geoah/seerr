import EmbyLogo from '@app/assets/services/emby-icon-only.svg';
import JellyfinLogo from '@app/assets/services/jellyfin-icon.svg';
import Button from '@app/components/Common/Button';
import ImageFader from '@app/components/Common/ImageFader';
import PageTitle from '@app/components/Common/PageTitle';
import LanguagePicker from '@app/components/Layout/LanguagePicker';
import JellyfinLogin from '@app/components/Login/JellyfinLogin';
import LocalLogin from '@app/components/Login/LocalLogin';
import PlexLoginButton from '@app/components/Login/PlexLoginButton';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { XCircleIcon } from '@heroicons/react/24/solid';
import { MediaServerType, ServerType } from '@server/constants/server';
import axios from 'axios';
import { useRouter } from 'next/dist/client/router';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Login', {
  signin: 'Sign In',
  signinheader: 'Sign in to continue',
  signinwithplex: 'Use your Plex account',
  signinwithjellyfin: 'Use your {mediaServerName} account',
  signinwithoverseerr: 'Use your {applicationTitle} account',
  loginwithapp: 'Login with {appName}',
});

const Login = () => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const { user, revalidate } = useUser();

  const [error, setError] = useState('');
  const [isProcessing, setProcessing] = useState(false);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<'media' | 'local' | null>(null);

  // Effect that is triggered when the `authToken` comes back from the Plex OAuth
  // We take the token and attempt to sign in. If we get a success message, we will
  // ask swr to revalidate the user which _should_ come back with a valid user.
  useEffect(() => {
    const login = async () => {
      setProcessing(true);
      try {
        const response = await axios.post('/api/v1/auth/plex', { authToken });

        if (response.data?.id) {
          revalidate();
        }
      } catch (e) {
        setError(e.response?.data?.message);
        setAuthToken(undefined);
        setProcessing(false);
      }
    };
    if (authToken) {
      login();
    }
  }, [authToken, revalidate]);

  // Effect that is triggered whenever `useUser`'s user changes. If we get a new
  // valid user, we redirect the user to the home page as the login was successful.
  useEffect(() => {
    if (user) {
      router.push('/');
    }
  }, [user, router]);

  const { data: backdrops } = useSWR<string[]>('/api/v1/backdrops', {
    refreshInterval: 0,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
  });

  const {
    mediaServerType,
    mediaServerLogin,
    localLogin,
    secondaryLoginEnabled,
  } = settings.currentSettings;
  const plexLoginEnabled =
    (mediaServerType === MediaServerType.PLEX && mediaServerLogin) ||
    (mediaServerType === MediaServerType.JELLYFIN && secondaryLoginEnabled);
  const secondaryJellyfinLogin =
    mediaServerType === MediaServerType.PLEX && secondaryLoginEnabled;
  const credentialServerType = secondaryJellyfinLogin
    ? MediaServerType.JELLYFIN
    : mediaServerType;
  const credentialLoginEnabled =
    secondaryJellyfinLogin ||
    (mediaServerLogin &&
      (mediaServerType === MediaServerType.JELLYFIN ||
        mediaServerType === MediaServerType.EMBY));
  const credentialServerName =
    credentialServerType === MediaServerType.EMBY
      ? ServerType.EMBY
      : ServerType.JELLYFIN;
  const CredentialServerLogo =
    credentialServerType === MediaServerType.EMBY ? EmbyLogo : JellyfinLogo;

  return (
    <div className="relative flex min-h-screen flex-col bg-gray-900 py-14">
      <PageTitle title={intl.formatMessage(messages.signin)} />
      <ImageFader
        backgroundImages={
          backdrops?.map(
            (backdrop) => `https://image.tmdb.org/t/p/original${backdrop}`
          ) ?? []
        }
      />
      <div className="absolute right-4 top-4 z-50">
        <LanguagePicker />
      </div>
      <div className="relative z-40 mt-10 flex flex-col items-center px-4 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="relative h-48 w-full max-w-full">
          <Image src="/logo_stacked.svg" alt="Logo" fill />
        </div>
      </div>
      <div className="relative z-50 mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div
          className="bg-gray-800/50 shadow sm:rounded-lg"
          style={{ backdropFilter: 'blur(5px)' }}
        >
          <>
            <Transition
              as="div"
              show={!!error}
              enter="transition-opacity duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="mb-4 rounded-md bg-red-600 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <XCircleIcon className="h-5 w-5 text-red-300" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-300">
                      {error}
                    </h3>
                  </div>
                </div>
              </div>
            </Transition>
            <div className="px-10 py-8">
              {form === 'local' && localLogin ? (
                <LocalLogin revalidate={revalidate} />
              ) : form === 'media' && credentialLoginEnabled ? (
                <JellyfinLogin
                  serverType={credentialServerType}
                  secondary={secondaryJellyfinLogin}
                  revalidate={revalidate}
                />
              ) : (
                <>
                  <h2 className="mb-6 text-center text-lg font-bold text-neutral-200">
                    {intl.formatMessage(messages.signinheader)}
                  </h2>
                  <div className="flex flex-col gap-3">
                    {plexLoginEnabled && (
                      <PlexLoginButton
                        large
                        isProcessing={isProcessing}
                        onAuthToken={setAuthToken}
                        onError={setError}
                      />
                    )}
                    {credentialLoginEnabled && (
                      <Button
                        data-testid="mediaserver-login-button"
                        onClick={() => {
                          setError('');
                          setForm('media');
                        }}
                      >
                        <CredentialServerLogo
                          className="mr-2 h-5 w-5"
                          aria-hidden="true"
                        />
                        {intl.formatMessage(messages.loginwithapp, {
                          appName: credentialServerName,
                        })}
                      </Button>
                    )}
                    {localLogin && (
                      <Button
                        data-testid="seerr-login-button"
                        onClick={() => {
                          setError('');
                          setForm('local');
                        }}
                      >
                        <Image
                          src="/os_icon.svg"
                          width={20}
                          height={20}
                          alt=""
                          className="mr-2"
                        />
                        {intl.formatMessage(messages.loginwithapp, {
                          appName: settings.currentSettings.applicationTitle,
                        })}
                      </Button>
                    )}
                  </div>
                </>
              )}
              {form && (
                <Button
                  buttonType="ghost"
                  className="mt-4 w-full"
                  onClick={() => setForm(null)}
                >
                  {intl.formatMessage(globalMessages.back)}
                </Button>
              )}
            </div>
          </>
        </div>
      </div>
    </div>
  );
};

export default Login;
