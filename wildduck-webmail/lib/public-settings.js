'use strict';

const { getRuntimeEnvValue } = require('./runtime-env');

const isTruthy = value => ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

module.exports.getPublicSetting = async key => getRuntimeEnvValue(key);

module.exports.isTestSignupLinkAllowed = async () => isTruthy(await module.exports.getPublicSetting('SECURITY_ALLOW_TEST_SIGNUP_LINK'));
