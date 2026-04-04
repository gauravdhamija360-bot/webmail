'use strict';

const { ObjectId } = require('mongodb');
const db = require('./db');

const ACCOUNTS_COLLECTION = 'billing_accounts';
const PAYMENTS_COLLECTION = 'billing_payments';

const now = () => new Date();

const getAccounts = () => db.collection(ACCOUNTS_COLLECTION);
const getPayments = () => db.collection(PAYMENTS_COLLECTION);

const sanitizePaymentMethods = paymentMethods =>
    [].concat(paymentMethods || []).map(method => ({
        customerPaymentProfileId: method.customerPaymentProfileId,
        cardType: method.cardType || 'card',
        cardNumber: method.cardNumber || '',
        expirationDate: method.expirationDate || '',
        billTo: method.billTo || {},
        defaultPaymentProfile: Boolean(method.defaultPaymentProfile),
        addedAt: method.addedAt || now()
    }));

module.exports.init = async () => {
    if (!db.mongo) {
        return;
    }

    await Promise.all([
        getAccounts().createIndex({ emailAddress: 1 }, { unique: true }),
        getAccounts().createIndex({ username: 1 }),
        getAccounts().createIndex({ 'authorizeNet.subscriptionId': 1 }),
        getPayments().createIndex({ accountId: 1, createdAt: -1 }),
        getPayments().createIndex({ transactionId: 1 }, { unique: true, sparse: true })
    ]);
};

module.exports.getAccountByEmail = async emailAddress => {
    if (!db.mongo) {
        return null;
    }

    return getAccounts().findOne({ emailAddress });
};

module.exports.getAccountForUser = async user => {
    if (!db.mongo || !user) {
        return null;
    }

    return getAccounts().findOne({
        $or: [{ emailAddress: user.address }, { username: user.username }]
    });
};

module.exports.upsertAccount = async billingAccount => {
    if (!db.mongo) {
        return null;
    }

    const emailAddress = billingAccount.emailAddress;
    const existingAccount = await getAccounts().findOne({ emailAddress });
    const createdAt = existingAccount ? existingAccount.createdAt : now();

    const nextDocument = {
        username: billingAccount.username,
        emailAddress,
        fullName: billingAccount.fullName,
        billingEmail: billingAccount.billingEmail,
        recoveryEmail: billingAccount.recoveryEmail,
        wildduckUserId: billingAccount.wildduckUserId || null,
        plan: billingAccount.plan,
        status: billingAccount.status,
        authorizeNet: billingAccount.authorizeNet,
        paymentMethods: sanitizePaymentMethods(billingAccount.paymentMethods),
        subscription: billingAccount.subscription,
        meta: billingAccount.meta || {},
        createdAt,
        updatedAt: now()
    };

    await getAccounts().updateOne({ emailAddress }, { $set: nextDocument }, { upsert: true });

    return getAccounts().findOne({ emailAddress });
};

module.exports.recordPayment = async payment => {
    if (!db.mongo) {
        return null;
    }

    const paymentDocument = {
        accountId: typeof payment.accountId === 'string' ? new ObjectId(payment.accountId) : payment.accountId,
        emailAddress: payment.emailAddress,
        username: payment.username,
        transactionId: payment.transactionId || null,
        subscriptionId: payment.subscriptionId || null,
        amount: payment.amount,
        status: payment.status,
        type: payment.type,
        gateway: 'authorize.net',
        cardNumber: payment.cardNumber || '',
        cardType: payment.cardType || '',
        authCode: payment.authCode || '',
        notes: payment.notes || '',
        createdAt: payment.createdAt || now()
    };

    await getPayments().updateOne(
        { transactionId: paymentDocument.transactionId || new ObjectId().toString() },
        { $set: paymentDocument },
        { upsert: true }
    );

    return paymentDocument;
};

module.exports.listPayments = async accountId => {
    if (!db.mongo) {
        return [];
    }

    return getPayments()
        .find({ accountId: typeof accountId === 'string' ? new ObjectId(accountId) : accountId })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
};

module.exports.setSubscriptionStatus = async (accountId, status, patch) => {
    if (!db.mongo) {
        return null;
    }

    await getAccounts().updateOne(
        { _id: typeof accountId === 'string' ? new ObjectId(accountId) : accountId },
        {
            $set: {
                status,
                authorizeNet: patch.authorizeNet,
                subscription: patch.subscription,
                paymentMethods: sanitizePaymentMethods(patch.paymentMethods),
                updatedAt: now()
            }
        }
    );

    return getAccounts().findOne({ _id: typeof accountId === 'string' ? new ObjectId(accountId) : accountId });
};
