'use strict';

const { getRuntimeEnvValue } = require('./runtime-env');

const normalizeMode = value => {
    const normalized = String(value || '').trim().toLowerCase();

    if (['live', 'production', 'prod'].includes(normalized)) {
        return 'production';
    }

    return 'sandbox';
};

const getLegacyEnvironment = () => (String(getRuntimeEnvValue('AUTHORIZE_ENV') || '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox');

module.exports.getAuthorizeConfig = () => {
    const mode = normalizeMode(getRuntimeEnvValue('AUTHORIZE_MODE') || getLegacyEnvironment());
    const modePrefix = mode === 'production' ? 'AUTHORIZE_PRODUCTION' : 'AUTHORIZE_SANDBOX';

    const apiLoginId = getRuntimeEnvValue(`${modePrefix}_API_LOGIN_ID`) || getRuntimeEnvValue('AUTHORIZE_API_LOGIN_ID');
    const transactionKey = getRuntimeEnvValue(`${modePrefix}_TRANSACTION_KEY`) || getRuntimeEnvValue('AUTHORIZE_TRANSACTION_KEY');
    const signatureKey = getRuntimeEnvValue(`${modePrefix}_SIGNATURE_KEY`) || getRuntimeEnvValue('AUTHORIZE_SIGNATURE_KEY');
    const clientKey = getRuntimeEnvValue(`${modePrefix}_CLIENT_KEY`) || getRuntimeEnvValue('AUTHORIZE_CLIENT_KEY');

    return {
        mode,
        environment: mode,
        apiLoginId,
        transactionKey,
        signatureKey,
        clientKey,
        acceptJsUrl:
            mode === 'production'
                ? 'https://js.authorize.net/v1/Accept.js'
                : 'https://jstest.authorize.net/v1/Accept.js'
    };
};
