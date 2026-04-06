'use strict';

const fs = require('fs');
const path = require('path');

const ENV_FILE_PATH = path.resolve(__dirname, '..', '.env');
const CACHE_TTL_MS = 5000;

let cachedEnvMap = null;
let cachedAt = 0;

const parseEnvContent = raw => {
    const envMap = new Map();

    String(raw || '')
        .split(/\r?\n/)
        .forEach(line => {
            const trimmed = line.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex < 0) {
                return;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            const value = trimmed.slice(separatorIndex + 1).trim();

            if (key) {
                envMap.set(key, value);
            }
        });

    return envMap;
};

const readEnvMap = () => {
    const now = Date.now();

    if (cachedEnvMap && now - cachedAt < CACHE_TTL_MS) {
        return cachedEnvMap;
    }

    try {
        const raw = fs.readFileSync(ENV_FILE_PATH, 'utf8');
        cachedEnvMap = parseEnvContent(raw);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }

        cachedEnvMap = new Map();
    }

    cachedAt = now;
    return cachedEnvMap;
};

module.exports.getRuntimeEnvValue = key => {
    const envMap = readEnvMap();

    if (envMap.has(key)) {
        return envMap.get(key);
    }

    return process.env[key] || '';
};
