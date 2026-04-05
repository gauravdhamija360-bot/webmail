'use strict';

const fs = require('fs');

module.exports.title = 'File DKIM Signer';
module.exports.init = function (app, done) {
    let privateKey;

    try {
        privateKey = fs.readFileSync(app.config.path, 'ascii').trim();
    } catch (err) {
        app.logger.error('DKIM', 'Failed loading private key from %s: %s', app.config.path, err.message);
        return done();
    }

    app.addHook('sender:connect', (delivery, options, next) => {
        if (!delivery.dkim) {
            delivery.dkim = {};
        }

        if (!delivery.dkim.keys) {
            delivery.dkim.keys = [];
        }

        delivery.dkim.keys.push({
            domainName: app.config.domain,
            keySelector: app.config.selector,
            privateKey
        });

        return next();
    });

    done();
};
