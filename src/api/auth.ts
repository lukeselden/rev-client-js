import type { RevClient } from '../rev-client';
import type { Auth, OAuth } from '../types/auth';
import type { Rev } from '../types/rev';
import { mergeHeaders } from '../utils/merge-headers';
import {buildLegacyOAuthQuery, getOAuth2AuthorizationUrl, getOAuth2PKCEVerifier, parseLegacyOAuthRedirectResponse} from './oauth';

/** @ignore */
export type API = ReturnType<typeof authAPIFactory>;

/**
 * Authentication API methods
 * Generally you won't need to call these methods directly - {@link RevClient#connect | RevClient} instances use them internally to maintain an authentication session.
 *
 * The exception is the {@link AuthAPI.buildOAuth2Authentication} and {@link AuthAPI.loginOAuth2} methods, which can be used when building an OAuth2 authentication flow.
 *
 * @category Authentication
 * @group API
 * @see [Auth API Docs](https://revdocs.vbrick.com/reference/authenticateuser)
     */
export interface AuthAPI extends API {}

/** @ignore */
export default function authAPIFactory(rev: RevClient) {

    const authAPI = {
        async loginToken(apiKey: string, secret: string, options?: Rev.RequestOptions): Promise<Auth.LoginResponse> {
            return rev.post('/api/v2/authenticate', {
                apiKey,
                secret
            }, options);
        },
        async extendSessionToken(apiKey: string): Promise<Auth.ExtendResponse> {
            return rev.post(`/api/v2/auth/extend-session-timeout/${apiKey}`);
        },
        async logoffToken(apiKey: string): Promise<void> {
            return rev.delete(`/api/v2/tokens/${apiKey}`);
        },
        async loginUser(username: string, password: string, options?: Rev.RequestOptions): Promise<Auth.UserLoginResponse> {
            return rev.post('/api/v2/user/login', {
                username,
                password
            }, options);
        },
        async logoffUser(userId: string): Promise<void> {
            return rev.post('/api/v2/user/logoff', { userId });
        },
        async extendSessionUser(userId: string): Promise<Auth.ExtendResponse> {
            return rev.post('/api/v2/user/extend-session-timeout', { userId });
        },
        async loginJWT(jwtToken: string, options?: Rev.RequestOptions): Promise<Auth.JWTLoginResponse> {
            return rev.get('/api/v2/jwtauthenticate', { jwt_token: jwtToken }, options);
        },
        async loginGuestRegistration(webcastId: string, jwtToken: string, options?: Rev.RequestOptions): Promise<Auth.GuestRegistrationResposne> {
            const opts = {
                ...options,
                headers: mergeHeaders(options?.headers, { 'x-requested-with': 'xmlhttprequest' })
            };
            return rev.post(`/external/auth/jwt/${webcastId}`, { token: `vbrick_rev ${jwtToken}`}, options);
        },
        async extendSession(): Promise<Auth.ExtendResponse> {
            return rev.post('/api/v2/user/extend-session');
        },
        async verifySession(): Promise<void> {
            return rev.get('/api/v2/user/session');
        },

        /**
         * @deprecated - use logoffUser - put here because it's a common misspelling
         */
        get logoutUser() { return authAPI.logoffUser; },
        /**
         * @deprecated - use logoffToken - put here because it's a common misspelling
         */
        get logoutToken() { return authAPI.logoffToken; },
        /**
         * generate the Authorization URL for the OAuth2 flow as well as the codeVerifier for the
         * subsequent Access Token request. You *must* store the codeVerifier somehow (i.e. serverside database matched to user's state/cookies/session, or on browser SessionStorage) to be able to complete the OAuth2 login flow.
         * @param config OAuth signing settings, retrieved from Rev Admin -> Security -> API Keys page
         * @param state optional state to pass back to redirectUri once complete
         * @param verifier the code_verifier to use when generating the code challenge. Can be any string 43-128 characters in length, just these characters: [A-Za-z0-9._~-]. If not provided then code will automatically generate a suitable value
         * @returns A valid oauth flow URL + the code_verifier to save for later verification
         */
        async buildOAuth2Authentication(config: OAuth.ServerConfig, state: string = '1', verifier?: string): Promise<OAuth.AuthenticationData> {
            const {codeChallenge, codeVerifier} = await getOAuth2PKCEVerifier(verifier);
            const _cfg = { revUrl: rev.url, ...config };
            const url = getOAuth2AuthorizationUrl(_cfg, codeChallenge, state);
            return {
                url: `${url}`,
                codeVerifier
            };
        },
        async loginOAuth2(config: OAuth.Config, code: string, codeVerifier: string, options?: Rev.RequestOptions): Promise<OAuth.AuthTokenResponse> {
            return rev.post('/api/v2/oauth2/token', {
                // sometimes the authCode can get mangled, with the pluses in the code being replaced by spaces.
                code: code.replace(/ /g, '+'),
                client_id: config.oauthApiKey,
                grant_type: 'authorization_code',
                redirect_uri: config.redirectUri,
                code_verifier: codeVerifier
            }, options);
        },
        /**
         * @deprecated
         * @param config OAuth signing settings, retrieved from Rev Admin -> Security -> API Keys page
         * @param oauthSecret Secret from Rev Admin -> Security. This is a DIFFERENT value from the
         *                    User Secret used for API login. Do not expose client-side!
         * @param state optional state to pass back to redirectUri once complete
         * @returns A valid oauth flow URL
         */
        async buildOAuthAuthenticationURL(config: OAuth.Config, oauthSecret: string, state: string = '1'): Promise<string> {
            const query = await buildLegacyOAuthQuery(config, oauthSecret, state);
            const url = new URL('/api/v2/oauth/authorization', rev.url);
            url.search = `${new URLSearchParams(query)}`;
            return `${url}`;
        },
        /**
         * @deprecated
         */
        buildOAuthAuthenticationQuery: buildLegacyOAuthQuery,
        /**
         * @deprecated
         */
        parseOAuthRedirectResponse: parseLegacyOAuthRedirectResponse,
        /**
         * @deprecated
         * @param config
         * @param authCode
         * @returns
         */
        async loginOAuth(config: OAuth.Config, authCode: string): Promise<OAuth.LoginResponse> {
            const GRANT_AUTH = 'authorization_code';

            const {
                oauthApiKey: apiKey,
                redirectUri
            } = config;

            // sometimes the authCode can get mangled, with the pluses in the code
            // being replaced by spaces. This is just to make sure that isn't a problem (even though already done in parseOAuthRedirectResponse)
            authCode = authCode.replace(/ /g, '+');

            // COMBAK I don't think it matters if rev-client is logged in and passing Authorization headers or not.
            return rev.post('/api/v2/oauth/token', {
                authCode,
                apiKey,
                redirectUri,
                grantType: GRANT_AUTH
            });
        },
        /**
         * @deprecated
         * @param config
         * @param refreshToken
         * @returns
         */
        async extendSessionOAuth(config: OAuth.Config, refreshToken: string): Promise<OAuth.LoginResponse> {
            const GRANT_REFRESH = 'refresh_token';

            const {
                oauthApiKey: apiKey
            } = config;

            return rev.post('/api/v2/oauth/token', {
                apiKey,
                refreshToken,
                grantType: GRANT_REFRESH
            });
        }
    };

    return authAPI;
}
