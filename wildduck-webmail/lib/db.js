'use strict';

const config = require('wild-config');
const Redis = require('ioredis');
const { MongoClient } = require('mongodb');

module.exports.redis = false;
module.exports.mongoClient = false;
module.exports.mongo = false;

module.exports.connect = async callback => {
    try {
        module.exports.redis = new Redis(config.dbs.redis);

        if (config.dbs && config.dbs.mongo) {
            module.exports.mongoClient = new MongoClient(config.dbs.mongo);
            await module.exports.mongoClient.connect();
            module.exports.mongo = module.exports.mongoClient.db();
        }

        return callback();
    } catch (err) {
        return callback(err);
    }
};

module.exports.collection = name => {
    if (!module.exports.mongo) {
        throw new Error('MongoDB is not connected');
    }

    return module.exports.mongo.collection(name);
};
